import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
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
import { analyzeGame } from "./chesscom/analyzeGame";
import { buildInsights } from "./chesscom/insights";
import type { GameAnalysis, GameStore, ImportedGame, ImportRecord, ImportSummary, Insight } from "./chesscom/types";
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

  const findingsByPly = useMemo(() => {
    const map = new Map<number, GameAnalysis["findings"][number]>();
    selectedGame?.analysis?.findings.forEach((f) => map.set(f.ply, f));
    return map;
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

  /* ---- Coach insights over the connected account's analyzed games -------- */
  const insights = useMemo(() => buildInsights(games), [games]);

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

        {/* ---- Coach insights ------------------------------------------ */}
        {insights.length > 0 && (
          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Sparkles className="h-4 w-4 text-emerald-400" /> Coach Insights
            </h2>
            <div className="flex flex-col gap-2">
              {insights.map((insight) => {
                const style = SEVERITY_STYLE[insight.severity];
                return (
                  <div
                    key={insight.id}
                    className={`rounded-xl border ${style.border} ${style.bg} p-3.5`}
                  >
                    <p className={`text-sm font-semibold ${style.text}`}>{insight.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{insight.detail}</p>
                  </div>
                );
              })}
            </div>
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
                        customBoardStyle={{ borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                        customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                        customLightSquareStyle={{ backgroundColor: "#c3ccda" }}
                      />
                    </div>
                  </div>
                </div>

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
                  <div className="mt-4 flex w-full max-w-[440px] flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                    <span className={`font-medium ${QUALITY_BADGE.inaccuracy} rounded px-1.5 py-0.5`}>
                      {selectedGame.analysis.inaccuracies} inaccuracies
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

              {/* Move list */}
              <div className="mt-4 max-h-[260px] overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                <table className="w-full text-xs">
                  <tbody>
                    {pairedMoves.map((row) => {
                      const wFinding = findingsByPly.get(row.wPly);
                      const bFinding = findingsByPly.get(row.bPly);
                      return (
                        <tr key={row.no}>
                          <td className="w-8 py-0.5 pr-2 text-right font-mono text-slate-600">{row.no}.</td>
                          <td className="py-0.5">
                            {row.w && (
                              <button
                                onClick={() => jumpToPly(row.wPly + 1)}
                                className={`rounded px-1.5 py-0.5 font-mono transition-colors ${
                                  ply === row.wPly + 1 ? "bg-emerald-500/20 text-emerald-300" : "text-slate-300 hover:bg-slate-800"
                                } ${wFinding ? QUALITY_BADGE[wFinding.quality] : ""}`}
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
                                  ply === row.bPly + 1 ? "bg-emerald-500/20 text-emerald-300" : "text-slate-300 hover:bg-slate-800"
                                } ${bFinding ? QUALITY_BADGE[bFinding.quality] : ""}`}
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
