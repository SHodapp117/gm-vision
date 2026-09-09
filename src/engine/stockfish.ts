/* ------------------------------------------------------------------ */
/*  Real Stockfish (WASM) engine wrapper — single-threaded, worker-based. */
/*                                                                      */
/*  Uses the nmrugg/stockfish.js "lite-single" build (Stockfish 18,     */
/*  single-threaded, no SharedArrayBuffer/Atomics/pthreads) so it runs  */
/*  on a static host with NO COOP/COEP headers. The engine's .js/.wasm  */
/*  live in public/engine/ and are loaded via a classic `new Worker(…)` */
/*  — no bundler transform needed, so the same URL works in both        */
/*  `npm run dev` and `npm run build` output.                           */
/*                                                                      */
/*  The worker is created lazily — importing this module does nothing  */
/*  until `.ready` is awaited or `.analyze()` is called — so the first  */
/*  paint is never blocked waiting on a 7MB wasm download.              */
/* ------------------------------------------------------------------ */

// `import.meta.env.BASE_URL` already ends in "/", and resolves correctly
// whether the app is served from the domain root or a GitHub Pages
// project subpath (vite.config.ts sets no `base`, so this defaults to "/").
const ENGINE_JS_PATH = `${import.meta.env.BASE_URL}engine/stockfish.js`;

const INIT_TIMEOUT_MS = 20000;
const ISREADY_TIMEOUT_MS = 10000;
const ANALYZE_SAFETY_MARGIN_MS = 8000;
const DEFAULT_MOVETIME = 1000;

/** UCI_Elo is only accepted in this range; below it we fall back to Skill Level. */
const MIN_UCI_ELO = 1320;
const MAX_UCI_ELO = 3190;

export interface EngineLine {
  /** The line's first move, in raw UCI form (e.g. "e2e4", "e7e8q"). */
  moveUci: string;
  cp?: number;
  mate?: number;
  pv: string[];
}

export interface AnalyzeResult {
  bestmove: string;
  lines: EngineLine[];
}

export interface AnalyzeOptions {
  movetime?: number;
  depth?: number;
  multipv?: number;
  /** Target playing strength, 600-3200. Omit (or leave undefined) for full strength. */
  elo?: number;
  /**
   * Optional dedup channel. When a newer `analyze()` call on the same
   * channel is made before an older one has reached the front of the
   * engine's (single-worker) queue, the older one is skipped without ever
   * touching the engine — keeps rapid UI-driven requests (eval bar on
   * every move, etc.) from piling up multi-second backlogs.
   */
  channel?: string;
}

/** Thrown when a queued `analyze()` call was superseded by a newer request on the same channel. */
export class SupersededError extends Error {
  constructor() {
    super("Stockfish: analyze() call superseded by a newer request on the same channel");
    this.name = "SupersededError";
  }
}

export function isSuperseded(err: unknown): boolean {
  return err instanceof SupersededError;
}

/** Split a raw UCI move ("e2e4", "e7e8q") into chess.js move-input shape. */
export function parseUciMove(uci: string): { from: string; to: string; promotion?: string } {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  return { from, to, promotion };
}

function parseInfoLine(line: string, lines: Map<number, EngineLine>): void {
  if (line.includes("upperbound") || line.includes("lowerbound")) return; // not a stable eval
  const tokens = line.split(/\s+/);
  let multipv = 1;
  let cp: number | undefined;
  let mate: number | undefined;
  let pvStart = -1;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "multipv") {
      multipv = parseInt(tokens[i + 1], 10) || 1;
    } else if (tokens[i] === "score") {
      if (tokens[i + 1] === "cp") cp = parseInt(tokens[i + 2], 10);
      else if (tokens[i + 1] === "mate") mate = parseInt(tokens[i + 2], 10);
    } else if (tokens[i] === "pv") {
      pvStart = i + 1;
      break;
    }
  }

  if (pvStart === -1 || pvStart >= tokens.length) return;
  const pv = tokens.slice(pvStart);
  if (!pv.length) return;
  lines.set(multipv, { moveUci: pv[0], cp, mate, pv });
}

class StockfishEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private pendingRejects = new Set<(err: Error) => void>();

  private appliedMultiPv = 1;
  private appliedLimitStrength = false;
  private appliedUciElo: number | undefined;
  private appliedSkillLevel = 20;
  private latestByChannel = new Map<string, symbol>();
  private queue: Promise<unknown> = Promise.resolve();

  /** Resolves once the engine has completed the uci/isready handshake. Lazily starts the worker. */
  get ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.init().catch((err: unknown) => {
        // Allow a fresh attempt (e.g. after the worker is recreated) on next access.
        this.readyPromise = null;
        throw err;
      });
    }
    return this.readyPromise;
  }

  private getWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(ENGINE_JS_PATH);
      worker.addEventListener("error", (e: ErrorEvent) => {
        const err = new Error(`Stockfish worker error: ${e.message || "failed to load engine"}`);
        const rejecters = Array.from(this.pendingRejects);
        this.pendingRejects.clear();
        rejecters.forEach((reject) => reject(err));
      });
      this.worker = worker;
    }
    return this.worker;
  }

  private send(cmd: string): void {
    this.getWorker().postMessage(cmd);
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    const worker = this.getWorker();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        this.pendingRejects.delete(wrappedReject);
      };
      const wrappedReject = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => wrappedReject(new Error("Stockfish: timed out waiting for engine response")), timeoutMs);
      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };
      this.pendingRejects.add(wrappedReject);
      worker.addEventListener("message", onMessage);
    });
  }

  private async init(): Promise<void> {
    // Register the listener before sending "uci" so a fast response can't race it.
    const uciok = this.waitFor((l) => l.startsWith("uciok"), INIT_TIMEOUT_MS);
    this.send("uci");
    await uciok;
    this.send("setoption name Threads value 1");
    await this.isReadyNow();
  }

  private isReadyNow(): Promise<void> {
    const p = this.waitFor((l) => l.trim() === "readyok", ISREADY_TIMEOUT_MS);
    this.send("isready");
    return p.then(() => undefined);
  }

  private applyStrength(elo: number | undefined): void {
    if (elo === undefined) {
      if (this.appliedLimitStrength !== false) {
        this.send("setoption name UCI_LimitStrength value false");
        this.appliedLimitStrength = false;
      }
      if (this.appliedSkillLevel !== 20) {
        this.send("setoption name Skill Level value 20");
        this.appliedSkillLevel = 20;
      }
      return;
    }

    if (elo < MIN_UCI_ELO) {
      const skill = Math.max(0, Math.min(20, Math.round(((elo - 600) / (MIN_UCI_ELO - 600)) * 20)));
      if (this.appliedLimitStrength !== false) {
        this.send("setoption name UCI_LimitStrength value false");
        this.appliedLimitStrength = false;
      }
      if (this.appliedSkillLevel !== skill) {
        this.send(`setoption name Skill Level value ${skill}`);
        this.appliedSkillLevel = skill;
      }
      return;
    }

    const clamped = Math.max(MIN_UCI_ELO, Math.min(MAX_UCI_ELO, Math.round(elo)));
    if (this.appliedLimitStrength !== true) {
      this.send("setoption name UCI_LimitStrength value true");
      this.appliedLimitStrength = true;
    }
    if (this.appliedUciElo !== clamped) {
      this.send(`setoption name UCI_Elo value ${clamped}`);
      this.appliedUciElo = clamped;
    }
  }

  async analyze(fen: string, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    await this.ready;

    const channel = opts.channel;
    let token: symbol | undefined;
    if (channel) {
      token = Symbol(channel);
      this.latestByChannel.set(channel, token);
    }

    const job = this.queue.then(() => {
      if (channel && token && this.latestByChannel.get(channel) !== token) {
        throw new SupersededError();
      }
      return this.runAnalysis(fen, opts);
    });

    // Keep the queue chain alive regardless of individual job outcomes.
    this.queue = job.then(
      () => undefined,
      () => undefined
    );

    return job;
  }

  private runAnalysis(fen: string, opts: AnalyzeOptions): Promise<AnalyzeResult> {
    const worker = this.getWorker();
    const multipv = Math.max(1, Math.floor(opts.multipv ?? 1));
    if (this.appliedMultiPv !== multipv) {
      this.send(`setoption name MultiPV value ${multipv}`);
      this.appliedMultiPv = multipv;
    }
    this.applyStrength(opts.elo);

    const movetime = opts.depth ? undefined : opts.movetime ?? DEFAULT_MOVETIME;
    const searchBudget = (opts.depth ? 15000 : movetime ?? DEFAULT_MOVETIME) + ANALYZE_SAFETY_MARGIN_MS;
    const lines = new Map<number, EngineLine>();

    return this.isReadyNow().then(
      () =>
        new Promise<AnalyzeResult>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            this.pendingRejects.delete(wrappedReject);
          };
          const wrappedReject = (err: Error) => {
            cleanup();
            reject(err);
          };
          const timer = setTimeout(() => wrappedReject(new Error("Stockfish: analyze timed out")), searchBudget);

          const onMessage = (e: MessageEvent) => {
            const line = String(e.data);
            if (line.startsWith("info") && line.includes(" pv ")) {
              parseInfoLine(line, lines);
            } else if (line.startsWith("bestmove")) {
              cleanup();
              const parts = line.split(/\s+/);
              const bestmove = parts[1] && parts[1] !== "(none)" ? parts[1] : "";
              const sorted = Array.from(lines.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([, v]) => v);
              resolve({ bestmove, lines: sorted });
            }
          };

          this.pendingRejects.add(wrappedReject);
          worker.addEventListener("message", onMessage);

          this.send(`position fen ${fen}`);
          this.send(opts.depth ? `go depth ${opts.depth}` : `go movetime ${movetime}`);
        })
    );
  }

  /** Tear down the worker. Not wired to any component lifecycle — call only on full app teardown. */
  terminate(): void {
    if (this.worker) {
      try {
        this.worker.postMessage("quit");
      } catch {
        /* worker may already be gone */
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.readyPromise = null;
    this.pendingRejects.clear();
    this.latestByChannel.clear();
    this.appliedMultiPv = 1;
    this.appliedLimitStrength = false;
    this.appliedUciElo = undefined;
    this.appliedSkillLevel = 20;
    this.queue = Promise.resolve();
  }
}

let singleton: StockfishEngine | null = null;

/** The shared engine instance. The worker is created lazily on first `.ready`/`.analyze()` use. */
export function getEngine(): StockfishEngine {
  if (!singleton) singleton = new StockfishEngine();
  return singleton;
}

export type { StockfishEngine };
