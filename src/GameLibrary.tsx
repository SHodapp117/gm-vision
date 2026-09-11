import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  Library,
  CloudDownload,
  Loader,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Swords,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Search,
  Sparkles,
  Trophy,
  Gauge,
  X,
} from "lucide-react";

import { createClient, ChessComError, isValidUsername, type ChessComClient } from "./chesscom/client";
import { importGames } from "./chesscom/import";
import { createIndexedDbStore } from "./chesscom/store";
import { analyzeGame, analyzeGames } from "./chesscom/analyzeGame";
import { buildCoachReport } from "./chesscom/metaReport";
import type {
  GameFinding,
  GameStore,
  ImportedGame,
  ImportRecord,
  ImportSummary,
  Insight,
  MoveQualityEntry,
} from "./chesscom/types";
import type { MoveQuality } from "./engine/classify";
import { getEngine } from "./engine/stockfish";
import { fenPosition, type TrainingPosition } from "./game/trainingPosition";

/* ------------------------------------------------------------------ */
/*  Module-level singletons — one store/client for the whole app.       */
/* ------------------------------------------------------------------ */
const store: GameStore = createIndexedDbStore();
const client: ChessComClient = createClient();

const USERNAME_KEY = "gmv.chesscom.user";
const MONTH_OPTIONS = [1, 3, 6, 12] as const;

/* ------------------------------------------------------------------ */
/*  Small helpers                                                       */
/* ------------------------------------------------------------------ */

function readStoredUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeUsername(u: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, u);
  } catch {
    // Storage unavailable (private mode) — the username just won't persist.
  }
}

function chessComErrorMessage(err: unknown, username: string): string {
  if (err instanceof ChessComError) {
    switch (err.kind) {
      case "invalid-username":
        return "That username isn't valid.";
      case "not-found":
        return `No Chess.com player called '${username}'.`;
      case "rate-limited":
        return "Chess.com is rate-limiting us — try again in a moment.";
      case "network":
        return "Couldn't reach Chess.com — check your connection.";
      default:
        return "Something went wrong talking to Chess.com.";
    }
  }
  return "Something went wrong talking to Chess.com.";
}

function formatDate(ms: number): string {
  if (!ms) return "never";
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function formatGameDate(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return "";
  }
}

const RESULT_BADGE: Record<ImportedGame["playerResult"], string> = {
  win: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  loss: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  draw: "border-slate-500/40 bg-slate-500/10 text-slate-300",
};

const QUALITY_BADGE: Record<MoveQuality, string> = {
  best: "bg-emerald-500/20 text-emerald-300",
  good: "bg-slate-500/20 text-slate-300",
  inaccuracy: "bg-amber-500/25 text-amber-200",
  mistake: "bg-orange-500/25 text-orange-200",
  blunder: "bg-rose-500/30 text-rose-200",
};

const SEVERITY_STYLE: Record<Insight["severity"], { border: string; bg: string; text: string }> = {
  strong: { border: "border-rose-500/40", bg: "bg-rose-500/10", text: "text-rose-300" },
  warn: { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-300" },
  info: { border: "border-slate-700", bg: "bg-slate-800/40", text: "text-slate-300" },
};

// Analysis-breakdown arrows: the move you played vs. the engine's best move.
const PLAYED_ARROW = "rgba(255, 7, 58, 0.9)"; // neon red — what you played
const BEST_ARROW = "rgba(85, 204, 33, 0.95)"; // rave green — the best move
const BRILLIANT_ARROW = "rgba(217, 70, 239, 0.95)"; // fuchsia — a brilliant move

const BRILLIANT_BADGE = "bg-fuchsia-500/25 text-fuchsia-200";

/** Tailwind classes for a move-quality chip, brilliant taking precedence. */
function qualityBadgeClass(quality: MoveQualityEntry["quality"], brilliant?: boolean): string {
  return brilliant ? BRILLIANT_BADGE : QUALITY_BADGE[quality];
}

/** "12." for a White move, "12…" for a Black move. */
function moveLabel(moveNo: number, ply: number): string {
  return ply % 2 === 0 ? `${moveNo}.` : `${moveNo}…`;
}

/** Human loss label: forced-mate swings read as mate, not a nonsense pawn count. */
function lossLabel(cpLoss: number, allowsMateIn?: number): string {
  if (allowsMateIn) return `allows mate in ${allowsMateIn}`;
  return `−${(cpLoss / 100).toFixed(1)}`;
}

type ResultFilter = "all" | "win" | "loss" | "draw";
type TimeClassFilter = "all" | "bullet" | "blitz" | "rapid" | "daily";

interface AnalyzeProgress {
  done: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export default function GameLibrary({
  onPlayFromPosition,
}: {
  onPlayFromPosition: (pos: TrainingPosition) => void;
}) {
  /* ---- Connect / import state -------------------------------------- */
  const [username, setUsername] = useState<string>(() => readStoredUsername());
  const [months, setMonths] = useState<number>(3);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importRecord, setImportRecord] = useState<ImportRecord | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);

  /* ---- Games + filters ----------------------------------------------- */
  const [games, setGames] = useState<ImportedGame[]>([]);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [timeClassFilter, setTimeClassFilter] = useState<TimeClassFilter>("all");
  const [opponentFilter, setOpponentFilter] = useState("");
  const [minRating, setMinRating] = useState("");
  const [analyzedOnly, setAnalyzedOnly] = useState(false);

  /* ---- Selected game / viewer ----------------------------------------- */
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [ply, setPly] = useState(0);

  /* ---- Analysis-in-progress state -------------------------------------- */
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  /* ---- Batch ("Analyze N games") state for the Coach Report ------------ */
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const didInitRef = useRef(false);

  /* ---- Board sizing: same ResizeObserver-with-ignore-0 trick ----------- */
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(480);
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setBoardWidth(w);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ---- Load an account's games + import record from the store --------- */
  const loadAccount = useCallback(async (account: string) => {
    try {
      const [accountGames, rec] = await Promise.all([
        store.gamesByAccount(account),
        store.getImportRecord(account),
      ]);
      setGames(accountGames);
      setImportRecord(rec ?? null);
      if (accountGames.length || rec) {
        setConnectedAccount(account);
      }
    } catch {
      // IndexedDB unavailable/broken — render with an empty library.
      setGames([]);
      setImportRecord(null);
    }
  }, []);

  /* ---- On mount: restore the last username & its games ----------------- */
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const stored = readStoredUsername();
    if (stored) {
      void loadAccount(stored.trim().toLowerCase());
    }
  }, [loadAccount]);

  /* ---- Import ----------------------------------------------------------- */
  const handleImport = useCallback(async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setImportError("Enter a Chess.com username.");
      return;
    }
    if (!isValidUsername(trimmed)) {
      setImportError("That username isn't valid.");
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportProgress("Starting import…");

    try {
      const result = await importGames(client, store, trimmed, {
        months,
        onProgress: (p) => {
          const archiveLabel = p.archive.split("/").slice(-2).join("/");
          setImportProgress(`Fetching ${archiveLabel}… ${p.inserted} new`);
        },
      });
      const account = trimmed.toLowerCase();
      storeUsername(trimmed);
      setSummary(result);
      await loadAccount(account);
      setImportProgress(null);
    } catch (err) {
      setImportError(chessComErrorMessage(err, trimmed));
      setImportProgress(null);
    } finally {
      setImporting(false);
    }
  }, [username, months, loadAccount]);

  /* ---- Filtered + sorted game list --------------------------------------- */
  const filteredGames = useMemo(() => {
    const minRatingNum = minRating.trim() ? Number(minRating) : null;
    const opponentNeedle = opponentFilter.trim().toLowerCase();

    return games
      .filter((g) => {
        if (resultFilter !== "all" && g.playerResult !== resultFilter) return false;
        if (timeClassFilter !== "all" && g.timeClass !== timeClassFilter) return false;
        if (opponentNeedle && !g.opponent.toLowerCase().includes(opponentNeedle)) return false;
        if (minRatingNum !== null && !Number.isNaN(minRatingNum) && g.opponentRating < minRatingNum) return false;
        if (analyzedOnly && !g.analyzed) return false;
        return true;
      })
      .sort((a, b) => b.endTime - a.endTime);
  }, [games, resultFilter, timeClassFilter, opponentFilter, minRating, analyzedOnly]);

  const selectedGame = useMemo(
    () => (selectedUuid ? games.find((g) => g.uuid === selectedUuid) ?? null : null),
    [games, selectedUuid]
  );

  const selectGame = useCallback((game: ImportedGame) => {
    setSelectedUuid(game.uuid);
    setPly(0);
    setAnalyzeError(null);
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedUuid(null);
    if (analyzeAbortRef.current) {
      analyzeAbortRef.current.abort();
      analyzeAbortRef.current = null;
    }
    setAnalyzing(false);
    setAnalyzeProgress(null);
  }, []);

  /* ---- Replay to the current ply ----------------------------------------- */
  const replay = useMemo(() => {
    if (!selectedGame) return null;
    const g = new Chess(selectedGame.startFen);
    for (let i = 0; i < ply && i < selectedGame.moves.length; i++) {
      try {
        g.move(selectedGame.moves[i]);
      } catch {
        break;
      }
    }
    return { fen: g.fen(), turn: g.turn() };
  }, [selectedGame, ply]);

  const shownFen = replay?.fen ?? new Chess().fen();
  const maxPly = selectedGame?.moves.length ?? 0;

  // Every analysed player move's quality, keyed by ply — drives move-list badges.
  const qualityByPly = useMemo(() => {
    const map = new Map<number, MoveQualityEntry>();
    // `?.` on moveQualities: analyses stored before best/brilliant existed lack it.
    selectedGame?.analysis?.moveQualities?.forEach((e) => map.set(e.ply, e));
    return map;
  }, [selectedGame]);

  // Notable moves (errors + brilliancies), keyed by ply, for the board arrows,
  // caption, and Key-moments list.
  const notableByPly = useMemo(() => {
    const map = new Map<number, GameFinding>();
    selectedGame?.analysis?.findings.forEach((f) => map.set(f.ply, f));
    selectedGame?.analysis?.brilliancies?.forEach((f) => map.set(f.ply, f));
    return map;
  }, [selectedGame]);

  // The notable move at the position currently on the board (ply === finding.ply
  // is the position BEFORE that move — where the choice was made), if any.
  const activeFinding = useMemo(() => notableByPly.get(ply) ?? null, [notableByPly, ply]);

  // Arrows: a brilliant move (played === best) gets one fuchsia arrow; an error
  // gets the played move (red) and the engine's best move (green).
  const arrows = useMemo<[Square, Square, string][]>(() => {
    if (!activeFinding) return [];
    const list: [Square, Square, string][] = [];
    const played = activeFinding.playedUci;
    const best = activeFinding.bestUci;
    if (activeFinding.brilliant) {
      if (played && played.length >= 4) {
        list.push([played.slice(0, 2) as Square, played.slice(2, 4) as Square, BRILLIANT_ARROW]);
      }
      return list;
    }
    if (played && played.length >= 4) {
      list.push([played.slice(0, 2) as Square, played.slice(2, 4) as Square, PLAYED_ARROW]);
    }
    if (best && best.length >= 4) {
      list.push([best.slice(0, 2) as Square, best.slice(2, 4) as Square, BEST_ARROW]);
    }
    return list;
  }, [activeFinding]);

  // Notable moves sorted for the breakdown list (earliest first).
  const sortedNotable = useMemo(() => {
    const a = selectedGame?.analysis;
    if (!a) return [];
    return [...a.findings, ...(a.brilliancies ?? [])].sort((x, y) => x.ply - y.ply);
  }, [selectedGame]);

  const pairedMoves = useMemo(() => {
    const moves = selectedGame?.moves ?? [];
    const rows: { no: number; wPly: number; w?: string; bPly: number; b?: string }[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      rows.push({ no: i / 2 + 1, wPly: i, w: moves[i], bPly: i + 1, b: moves[i + 1] });
    }
    return rows;
  }, [selectedGame]);

  const jumpToPly = useCallback((target: number) => {
    setPly(Math.max(0, Math.min(target, maxPly)));
  }, [maxPly]);

  /* ---- Analyze the selected game ------------------------------------------ */
  const handleAnalyze = useCallback(async () => {
    if (!selectedGame || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeProgress({ done: 0, total: 0 });

    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    try {
      const analysis = await analyzeGame(
        selectedGame,
        (fen, opts) => getEngine().analyze(fen, opts),
        {
          onProgress: (p) => setAnalyzeProgress(p),
          signal: controller.signal,
        }
      );
      const updated: ImportedGame = { ...selectedGame, analyzed: true, analysis };
      await store.putGame(updated);
      setGames((prev) => prev.map((g) => (g.uuid === updated.uuid ? updated : g)));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
      analyzeAbortRef.current = null;
    }
  }, [selectedGame, analyzing]);

  const handleCancelAnalyze = useCallback(() => {
    analyzeAbortRef.current?.abort();
  }, []);

  const handlePlayFromHere = useCallback(() => {
    if (!replay) return;
    onPlayFromPosition(fenPosition(replay.fen, replay.turn));
  }, [replay, onPlayFromPosition]);

  /* ---- Coach Report — meta-analysis over the whole game history ---------- */
  const report = useMemo(() => buildCoachReport(games), [games]);
  const unanalyzedCount = useMemo(() => games.filter((g) => !g.analyzed).length, [games]);

  // Batch-analyze the most-recent unanalyzed games to deepen the report. Each
  // game is persisted + folded into state as it finishes, so the report updates
  // live; cancellable via the abort controller.
  const handleAnalyzeBatch = useCallback(async () => {
    if (batchRunning) return;
    const BATCH = 20;
    const targets = games
      .filter((g) => !g.analyzed)
      .sort((a, b) => b.endTime - a.endTime)
      .slice(0, BATCH);
    if (!targets.length) return;

    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length });
    const controller = new AbortController();
    batchAbortRef.current = controller;
    try {
      await analyzeGames(targets, (fen, opts) => getEngine().analyze(fen, opts), {
        movetime: 300,
        signal: controller.signal,
        onGame: async (updated) => {
          await store.putGame(updated);
          setGames((prev) => prev.map((g) => (g.uuid === updated.uuid ? updated : g)));
        },
        onProgress: (p) => setBatchProgress({ done: p.done, total: p.total }),
      });
    } catch {
      // Individual game failures are already swallowed inside analyzeGame.
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
      batchAbortRef.current = null;
    }
  }, [batchRunning, games]);

  const cancelBatch = useCallback(() => batchAbortRef.current?.abort(), []);

  const orientation = selectedGame?.playerColor === "b" ? "black" : "white";

  return (
    <div className="min-h-screen w-full bg-slate-950 font-sans text-slate-100 antialiased">
      {/* ambient background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8 md:px-8">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-indigo-500 shadow-lg shadow-emerald-500/20">
              <Library className="h-6 w-6 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Game Library</h1>
              <p className="text-xs text-slate-400">Import your Chess.com games, review them, and let the coach find your patterns</p>
            </div>
          </div>
        </header>

        {/* ---- Connect / Import card ---------------------------------- */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <CloudDownload className="h-4 w-4 text-emerald-400" /> Connect to Chess.com
          </h2>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. hikaru"
                disabled={importing}
                className="w-full rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Months</label>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                disabled={importing}
                className="rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50 disabled:opacity-50"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} {m === 1 ? "month" : "months"}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? <Loader className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
              {importing
                ? "Importing…"
                : connectedAccount || importRecord
                ? "Import New Games"
                : "Import Games"}
            </button>
          </div>

          {importProgress && (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <Loader className="h-3.5 w-3.5 animate-spin" /> {importProgress}
            </p>
          )}

          {importError && (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {importError}
            </p>
          )}

          {(summary || importRecord) && (connectedAccount || username) && (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Connected to Chess.com {connectedAccount ?? username.trim().toLowerCase()}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
                <div>
                  Games imported <span className="font-mono text-slate-200">{importRecord?.total ?? games.length}</span>
                </div>
                {summary && (
                  <>
                    <div>
                      New games <span className="font-mono text-slate-200">{summary.inserted}</span>
                    </div>
                    <div>
                      Already imported <span className="font-mono text-slate-200">{summary.duplicates}</span>
                    </div>
                    {summary.failedToParse > 0 && (
                      <div>
                        Failed to parse <span className="font-mono text-rose-300">{summary.failedToParse}</span>
                      </div>
                    )}
                  </>
                )}
                <div>
                  Last import{" "}
                  <span className="font-mono text-slate-200">
                    {formatDate(summary?.lastImport ?? importRecord?.lastImport ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ---- Coach Report — whole-history meta-analysis --------------- */}
        {report.totalGames > 0 && (
          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Sparkles className="h-4 w-4 text-emerald-400" /> Coach Report
              </h2>
              {unanalyzedCount > 0 &&
                (batchRunning ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">
                      Analyzing {batchProgress?.done ?? 0}/{batchProgress?.total ?? 0}…
                    </span>
                    <button
                      onClick={cancelBatch}
                      className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200 transition-all hover:border-rose-400/60"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleAnalyzeBatch}
                    title="Analyze your most recent unanalyzed games to unlock deeper tips"
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 transition-all hover:border-emerald-400/60 hover:bg-emerald-500/15"
                  >
                    <Gauge className="h-3.5 w-3.5" /> Analyze {Math.min(20, unanalyzedCount)} games
                  </button>
                ))}
            </div>

            <p className="mb-3 text-sm leading-relaxed text-slate-300">{report.headline}</p>

            {batchRunning && batchProgress && (
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%` }}
                />
              </div>
            )}

            {/* Summary stats */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {report.stats.map((s) => (
                <div key={s.label} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2" title={s.hint}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</div>
                  <div className="font-mono text-sm text-slate-200">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Prioritized recommendations */}
            {report.recommendations.length > 0 ? (
              <div className="flex flex-col gap-2">
                {report.recommendations.map((rec) => {
                  const style = SEVERITY_STYLE[rec.severity];
                  const examples = (rec.exampleUuids ?? [])
                    .map((id) => games.find((g) => g.uuid === id))
                    .filter((g): g is ImportedGame => !!g);
                  return (
                    <div key={rec.id} className={`rounded-xl border ${style.border} ${style.bg} p-3.5`}>
                      <p className={`text-sm font-semibold ${style.text}`}>{rec.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{rec.detail}</p>
                      {rec.tip && <p className="mt-1.5 text-xs leading-relaxed text-slate-300">→ {rec.tip}</p>}
                      {examples.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {examples.map((g) => (
                            <button
                              key={g.uuid}
                              onClick={() => selectGame(g)}
                              className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
                            >
                              vs {g.opponent} ({g.playerResult})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-slate-500">
                Not enough games yet for firm patterns — import more, or analyze some games to unlock deeper tips.
              </p>
            )}
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* ---- Game list ------------------------------------------- */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Filter className="h-4 w-4 text-emerald-400" /> Games ({filteredGames.length})
            </h2>

            {/* Filters */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value as ResultFilter)}
                className="rounded-lg border border-slate-800 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                <option value="all">All results</option>
                <option value="win">Wins</option>
                <option value="loss">Losses</option>
                <option value="draw">Draws</option>
              </select>

              <select
                value={timeClassFilter}
                onChange={(e) => setTimeClassFilter(e.target.value as TimeClassFilter)}
                className="rounded-lg border border-slate-800 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                <option value="all">All time classes</option>
                <option value="bullet">Bullet</option>
                <option value="blitz">Blitz</option>
                <option value="rapid">Rapid</option>
                <option value="daily">Daily</option>
              </select>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={analyzedOnly}
                  onChange={(e) => setAnalyzedOnly(e.target.checked)}
                  className="accent-emerald-500"
                />
                Analyzed only
              </label>

              <div className="relative col-span-2 sm:col-span-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={opponentFilter}
                  onChange={(e) => setOpponentFilter(e.target.value)}
                  placeholder="Opponent contains…"
                  className="w-full rounded-lg border border-slate-800 bg-slate-800/60 py-1.5 pl-8 pr-2.5 text-xs text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
                />
              </div>

              <input
                type="number"
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                placeholder="Min opp. rating"
                className="rounded-lg border border-slate-800 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              />
            </div>

            {/* List */}
            <div className="flex max-h-[640px] flex-col gap-1.5 overflow-y-auto pr-1">
              {filteredGames.length === 0 && (
                <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-center text-xs text-slate-500">
                  {games.length === 0
                    ? "No games yet — connect a Chess.com account above and import some games."
                    : "No games match these filters."}
                </p>
              )}
              {filteredGames.map((g) => {
                const isSelected = g.uuid === selectedUuid;
                return (
                  <button
                    key={g.uuid}
                    onClick={() => selectGame(g)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        g.playerColor === "w" ? "bg-slate-100" : "bg-slate-600 ring-1 ring-slate-400"
                      }`}
                      title={g.playerColor === "w" ? "Played White" : "Played Black"}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-200">
                      vs {g.opponent}{" "}
                      <span className="font-mono text-slate-500">({g.opponentRating})</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${RESULT_BADGE[g.playerResult]}`}
                    >
                      {g.playerResult}
                    </span>
                    <span className="hidden shrink-0 text-slate-500 sm:inline">{g.timeClass}</span>
                    {g.eco && <span className="hidden shrink-0 truncate text-slate-500 md:inline">{g.eco}</span>}
                    <span className="shrink-0 text-slate-500">{formatGameDate(g.endTime)}</span>
                    {g.analyzed && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- Viewer -------------------------------------------- */}
          {selectedGame ? (
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Trophy className="h-4 w-4 text-emerald-400" /> vs {selectedGame.opponent}
                </h2>
                <button
                  onClick={closeViewer}
                  className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-col items-center">
                <div className="w-full max-w-[440px]">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 shadow-2xl shadow-black/40">
                    <div ref={boardWrapRef}>
                      <Chessboard
                        position={shownFen}
                        boardWidth={boardWidth}
                        boardOrientation={orientation}
                        arePiecesDraggable={false}
                        animationDuration={150}
                        customArrows={arrows}
                        customBoardStyle={{ borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                        customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                        customLightSquareStyle={{ backgroundColor: "#c3ccda" }}
                      />
                    </div>
                  </div>
                </div>

                {/* When parked on a notable move, name it (brilliant, or played vs. best). */}
                {activeFinding && (
                  <p className="mt-2 text-center text-xs">
                    {activeFinding.brilliant ? (
                      <span className="text-fuchsia-300">
                        Brilliant! {activeFinding.playedSan} — a sacrifice the engine loves
                      </span>
                    ) : (
                      <>
                        <span className="text-rose-300">You played {activeFinding.playedSan}</span>
                        {activeFinding.bestSan && (
                          <>
                            {" "}·{" "}
                            <span className="text-lime-300">best was {activeFinding.bestSan}</span>
                          </>
                        )}
                      </>
                    )}
                  </p>
                )}

                {/* Prev/Next controls */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => jumpToPly(0)}
                    disabled={ply === 0}
                    className="rounded-lg border border-slate-800 bg-slate-800/50 p-2 text-slate-300 transition-colors hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Start"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => jumpToPly(ply - 1)}
                    disabled={ply === 0}
                    className="rounded-lg border border-slate-800 bg-slate-800/50 p-2 text-slate-300 transition-colors hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Previous"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[70px] text-center font-mono text-xs text-slate-400">
                    {ply} / {maxPly}
                  </span>
                  <button
                    onClick={() => jumpToPly(ply + 1)}
                    disabled={ply >= maxPly}
                    className="rounded-lg border border-slate-800 bg-slate-800/50 p-2 text-slate-300 transition-colors hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => jumpToPly(maxPly)}
                    disabled={ply >= maxPly}
                    className="rounded-lg border border-slate-800 bg-slate-800/50 p-2 text-slate-300 transition-colors hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    title="End"
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Action buttons */}
                <div className="mt-3 grid w-full max-w-[440px] grid-cols-2 gap-2">
                  <button
                    onClick={handlePlayFromHere}
                    className="flex items-center justify-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 transition-all hover:border-indigo-400/60 hover:bg-indigo-500/15"
                  >
                    <Swords className="h-3.5 w-3.5" /> Play from here
                  </button>
                  {analyzing ? (
                    <button
                      onClick={handleCancelAnalyze}
                      className="flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 transition-all hover:border-rose-400/60 hover:bg-rose-500/15"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  ) : (
                    <button
                      onClick={handleAnalyze}
                      className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:brightness-110 active:scale-[0.98]"
                    >
                      <Gauge className="h-3.5 w-3.5" />
                      {selectedGame.analyzed ? "Re-analyze" : "Analyze game"}
                    </button>
                  )}
                </div>

                {analyzing && analyzeProgress && (
                  <div className="mt-3 w-full max-w-[440px]">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{
                          width: `${
                            analyzeProgress.total > 0
                              ? Math.round((analyzeProgress.done / analyzeProgress.total) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-center text-[11px] text-slate-500">
                      Analyzing move {analyzeProgress.done} of {analyzeProgress.total}…
                    </p>
                  </div>
                )}

                {analyzeError && (
                  <p className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {analyzeError}
                  </p>
                )}

                {/* Findings summary */}
                {selectedGame.analysis && (
                  <div className="mt-4 flex w-full max-w-[440px] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                    {(selectedGame.analysis.brilliant ?? 0) > 0 && (
                      <span className={`font-medium ${BRILLIANT_BADGE} rounded px-1.5 py-0.5`}>
                        {selectedGame.analysis.brilliant} brilliant
                      </span>
                    )}
                    <span className={`font-medium ${QUALITY_BADGE.best} rounded px-1.5 py-0.5`}>
                      {selectedGame.analysis.best ?? 0} best
                    </span>
                    <span className={`font-medium ${QUALITY_BADGE.good} rounded px-1.5 py-0.5`}>
                      {selectedGame.analysis.good ?? 0} good
                    </span>
                    <span className={`font-medium ${QUALITY_BADGE.inaccuracy} rounded px-1.5 py-0.5`}>
                      {selectedGame.analysis.inaccuracies} inacc.
                    </span>
                    <span className={`font-medium ${QUALITY_BADGE.mistake} rounded px-1.5 py-0.5`}>
                      {selectedGame.analysis.mistakes} mistakes
                    </span>
                    <span className={`font-medium ${QUALITY_BADGE.blunder} rounded px-1.5 py-0.5`}>
                      {selectedGame.analysis.blunders} blunders
                    </span>
                    <span>avg cp loss {selectedGame.analysis.avgCpLoss}</span>
                  </div>
                )}
              </div>

              {/* Key moments — click one to see it (and its best move) on the board */}
              {sortedNotable.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Key moments ({sortedNotable.length})
                  </h3>
                  <ul className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto pr-1">
                    {sortedNotable.map((f) => {
                      const isActive = f.ply === ply;
                      return (
                        <li key={f.ply}>
                          <button
                            onClick={() => jumpToPly(f.ply)}
                            className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                              isActive
                                ? "border-emerald-500/50 bg-emerald-500/10"
                                : "border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60"
                            }`}
                          >
                            <span className="font-mono text-slate-500">{moveLabel(f.moveNo, f.ply)}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${qualityBadgeClass(
                                f.quality,
                                f.brilliant
                              )}`}
                            >
                              {f.brilliant ? "brilliant" : f.quality}
                            </span>
                            {f.brilliant ? (
                              <span className="text-slate-300">
                                <span className="font-mono font-semibold text-fuchsia-300">{f.playedSan}</span> — a
                                winning sacrifice
                              </span>
                            ) : (
                              <>
                                <span className="text-slate-300">
                                  You played{" "}
                                  <span className="font-mono font-semibold text-rose-300">{f.playedSan}</span>
                                </span>
                                {f.bestSan && (
                                  <span className="text-slate-300">
                                    · best{" "}
                                    <span className="font-mono font-semibold text-lime-300">{f.bestSan}</span>
                                  </span>
                                )}
                              </>
                            )}
                            <span className="ml-auto font-mono text-slate-500">
                              {f.brilliant ? "!!" : lossLabel(f.cpLoss, f.allowsMateIn)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-slate-600">
                    Red = your move · green = engine's best · fuchsia = a brilliant move.
                  </p>
                </div>
              )}

              {/* Move list */}
              <div className="mt-4 max-h-[260px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                <table className="w-full text-xs">
                  <tbody>
                    {pairedMoves.map((row) => {
                      const wQual = qualityByPly.get(row.wPly);
                      const bQual = qualityByPly.get(row.bPly);
                      return (
                        <tr key={row.no}>
                          <td className="w-8 py-0.5 pr-2 text-right font-mono text-slate-600">{row.no}.</td>
                          <td className="py-0.5">
                            {row.w && (
                              <button
                                onClick={() => jumpToPly(row.wPly + 1)}
                                className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                                  ply === row.wPly + 1
                                    ? "ring-1 ring-emerald-400/60"
                                    : "hover:bg-slate-800"
                                } ${wQual ? qualityBadgeClass(wQual.quality, wQual.brilliant) : "text-slate-300"}`}
                              >
                                {row.w}
                              </button>
                            )}
                          </td>
                          <td className="py-0.5">
                            {row.b && (
                              <button
                                onClick={() => jumpToPly(row.bPly + 1)}
                                className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                                  ply === row.bPly + 1
                                    ? "ring-1 ring-emerald-400/60"
                                    : "hover:bg-slate-800"
                                } ${bQual ? qualityBadgeClass(bQual.quality, bQual.brilliant) : "text-slate-300"}`}
                              >
                                {row.b}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-10 text-center">
              <RefreshCw className="mb-3 h-8 w-8 text-slate-700" />
              <p className="text-sm text-slate-500">Select a game from the list to review it here.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
