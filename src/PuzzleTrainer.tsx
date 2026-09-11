import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  Puzzle as PuzzleIcon,
  Target,
  Lightbulb,
  RotateCcw,
  SkipForward,
  Check,
  X,
  Flame,
  Trophy,
  TrendingUp,
  Filter,
  Gauge,
  Sparkles,
  ChevronRight,
  RefreshCw,
  Swords,
} from "lucide-react";
import { type Puzzle } from "./data/puzzles";
import { puzzlePosition, type TrainingPosition } from "./game/trainingPosition";
import { createIndexedDbStore } from "./chesscom/store";
import { generatePuzzles, type GeneratedPuzzle } from "./chesscom/generatePuzzles";
import {
  getProgress,
  updateProgress,
  resetProgress,
  type TacticsProgress,
} from "./puzzles/rating";
import {
  selectPuzzle,
  clearRecent,
  TACTIC_THEMES,
  RATING_BANDS,
  type RatingBand,
} from "./puzzles/session";

/* ------------------------------------------------------------------ */
/*  Palette — matches the app's brand language.                        */
/* ------------------------------------------------------------------ */
const SUCCESS = "#55cc21"; // Rave Green — correct / solved
const FAILURE = "#ff073a"; // Neon red — wrong / failed
const HINT = "#fbbf24"; // Amber — hint highlight
const LASTFILL = "rgba(179, 102, 255, 0.30)"; // Electric violet — last move
const LASTRING = "rgba(179, 102, 255, 0.75)";

const THEME_LABELS: Record<string, string> = {
  fork: "Fork",
  pin: "Pin",
  skewer: "Skewer",
  discoveredAttack: "Discovered Attack",
  doubleCheck: "Double Check",
  backRankMate: "Back-Rank Mate",
  hangingPiece: "Hanging Piece",
  sacrifice: "Sacrifice",
  deflection: "Deflection",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
};

const prettyTheme = (t: string) =>
  THEME_LABELS[t] ?? t.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/* UCI helpers ------------------------------------------------------- */
interface Uci {
  from: Square;
  to: Square;
  promotion?: string;
}
function parseUci(uci: string): Uci {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.slice(4) || undefined,
  };
}

type Status = "opponent" | "solving" | "solved" | "failed";
type PuzzleMode = "curated" | "mistakes";

/** Shared IndexedDB handle (same "gmvision" DB the Games tab writes to). */
const mistakeStore = createIndexedDbStore();

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
interface PuzzleTrainerProps {
  /** Hand the current puzzle position to the Play tab as a normal game. */
  onPlayFromPuzzle?: (pos: TrainingPosition) => void;
  /** Start directly in "My mistakes" mode (deep-linked from the Games tab). */
  startMode?: PuzzleMode | null;
  /** Called once `startMode` has been applied, so the parent can clear it. */
  onStartModeConsumed?: () => void;
}

export default function PuzzleTrainer({ onPlayFromPuzzle, startMode, onStartModeConsumed }: PuzzleTrainerProps = {}) {
  // --- Live game / puzzle state (refs drive timer-safe logic) --------
  const gameRef = useRef(new Chess());
  const movesRef = useRef<string[]>([]);
  const expectedIndexRef = useRef(0); // index of the next move to be played
  const solverColorRef = useRef<"w" | "b">("w");
  const tokenRef = useRef(0); // bumped on every load/retry — guards stale timers
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRecordedRef = useRef(false); // rating/streak update once per puzzle
  const didInitRef = useRef(false);

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState(gameRef.current.fen());
  const [status, setStatus] = useState<Status>("opponent");
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);

  // --- Progress + filters -------------------------------------------
  const [progress, setProgress] = useState<TacticsProgress>(() => getProgress());
  const [lastDelta, setLastDelta] = useState<number | null>(null);
  const [theme, setTheme] = useState<string>(""); // "" = all themes
  const [bandLabel, setBandLabel] = useState<string>(""); // "" = auto (near rating)

  // --- Puzzle source: curated Lichess pool vs the player's own mistakes ---
  const [mode, setMode] = useState<PuzzleMode>("curated");
  const modeRef = useRef<PuzzleMode>("curated");
  modeRef.current = mode;
  const [mistakeCount, setMistakeCount] = useState(0);
  const [noMistakes, setNoMistakes] = useState(false);
  const mistakesRef = useRef<GeneratedPuzzle[]>([]);
  const mistakeIdxRef = useRef(0);
  const mistakeMetaRef = useRef<Map<string, GeneratedPuzzle>>(new Map());

  const progressRef = useRef(progress);
  progressRef.current = progress;

  // --- Board sizing: replicate ChessTrainer's ResizeObserver trick ---
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(480);
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    // Ignore transient 0-width measurements (hidden pane / lazy-load mount
    // race) so the board never latches to 0 and renders blank.
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setBoardWidth(w);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const currentBand = useCallback((): RatingBand | null => {
    return RATING_BANDS.find((b) => b.label === bandLabel) ?? null;
  }, [bandLabel]);

  /* ---- Load a puzzle (fresh or retry of the same one) -------------- */
  const loadPuzzle = useCallback(
    (p: Puzzle, isRetry: boolean) => {
      clearTimer();
      const token = ++tokenRef.current;

      gameRef.current = new Chess(p.fen);
      movesRef.current = p.moves.split(" ").filter(Boolean);
      expectedIndexRef.current = 0;
      solverColorRef.current = gameRef.current.turn() === "w" ? "b" : "w";
      if (!isRetry) resultRecordedRef.current = false;

      // `token` is bumped so any timer still pending from a prior puzzle
      // (opponent reply, etc.) is invalidated even though we don't schedule
      // the setup move here — the setup runs in its own effect below so that
      // StrictMode's mount/cleanup/mount cycle reschedules it correctly.
      void token;

      setPuzzle(p);
      setFen(gameRef.current.fen());
      setStatus("opponent");
      setHintLevel(0);
      setSelectedSquare(null);
      setFlash(null);
    },
    [clearTimer]
  );

  // Auto-play the opponent's setup move (moves[0]) after a short beat. Driven
  // by an effect keyed on the puzzle + "opponent" phase so it survives
  // StrictMode's double-invoke (the cleanup clears the timer, the re-run
  // reschedules it) — a plain setTimeout inside loadPuzzle would be cleared and
  // never rescheduled, leaving the board stuck on the opponent's turn.
  useEffect(() => {
    if (!puzzle || status !== "opponent") return;
    const id = setTimeout(() => {
      const setup = movesRef.current[0];
      if (setup) {
        gameRef.current.move(parseUci(setup));
        expectedIndexRef.current = 1;
        setFen(gameRef.current.fen());
      }
      setStatus("solving");
    }, 550);
    return () => clearTimeout(id);
  }, [puzzle, status]);

  /* ---- Pick the next puzzle from the current filters --------------- */
  const nextPuzzle = useCallback(() => {
    const p = selectPuzzle({
      theme: theme || null,
      band: currentBand(),
      userRating: progressRef.current.rating,
    });
    loadPuzzle(p, false);
  }, [theme, currentBand, loadPuzzle]);

  /* ---- "My mistakes" pool: puzzles built from the player's blunders ---- */
  const loadMistakes = useCallback(async (): Promise<GeneratedPuzzle[]> => {
    let list: GeneratedPuzzle[] = [];
    try {
      list = generatePuzzles(await mistakeStore.allGames());
    } catch {
      list = [];
    }
    mistakesRef.current = list;
    mistakeIdxRef.current = 0;
    mistakeMetaRef.current = new Map(list.map((p) => [p.id, p]));
    setMistakeCount(list.length);
    return list;
  }, []);

  const loadNextMistake = useCallback(() => {
    const list = mistakesRef.current;
    if (!list.length) {
      setNoMistakes(true);
      return;
    }
    setNoMistakes(false);
    const p = list[mistakeIdxRef.current % list.length];
    mistakeIdxRef.current++;
    loadPuzzle(p, false);
  }, [loadPuzzle]);

  const chooseMode = useCallback(
    async (m: PuzzleMode) => {
      setMode(m);
      modeRef.current = m;
      setLastDelta(null);
      if (m === "mistakes") {
        const list = await loadMistakes();
        if (list.length) loadNextMistake();
        else {
          setNoMistakes(true);
          setPuzzle(null);
        }
      } else {
        setNoMistakes(false);
        nextPuzzle();
      }
    },
    [loadMistakes, loadNextMistake, nextPuzzle]
  );

  // First puzzle on mount (guarded against StrictMode double-invoke).
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (startMode === "mistakes") {
      void chooseMode("mistakes");
      onStartModeConsumed?.();
    } else {
      nextPuzzle();
      void loadMistakes(); // populate the mistake count for the mode toggle
    }
    return () => clearTimer();
  }, [nextPuzzle, clearTimer, startMode, chooseMode, loadMistakes, onStartModeConsumed]);

  // Keep a ref to the current puzzle for use inside stable callbacks.
  const puzzleRef = useRef<Puzzle | null>(null);
  puzzleRef.current = puzzle;

  /* ---- Result recording (once per puzzle) ------------------------- */
  const recordResult = useCallback((solved: boolean) => {
    if (resultRecordedRef.current || !puzzleRef.current) return;
    resultRecordedRef.current = true;
    const { progress: next, delta } = updateProgress(puzzleRef.current.rating, solved);
    setProgress(next);
    setLastDelta(delta);
  }, []);

  const flashThen = useCallback((kind: "good" | "bad") => {
    setFlash(kind);
    setTimeout(() => setFlash(null), 550);
  }, []);

  /* ---- Schedule the forced opponent reply -------------------------- */
  const scheduleOpponentReply = useCallback(() => {
    const token = tokenRef.current;
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (token !== tokenRef.current) return;
      const idx = expectedIndexRef.current;
      const reply = movesRef.current[idx];
      if (reply) {
        gameRef.current.move(parseUci(reply));
        expectedIndexRef.current = idx + 1;
        setFen(gameRef.current.fen());
      }
    }, 450);
  }, [clearTimer]);

  /* ---- Attempt a solver move (drag or click) ---------------------- */
  const attemptMove = useCallback(
    (from: Square, to: Square, promotion?: string): boolean => {
      if (status !== "solving") return false;
      if (gameRef.current.turn() !== solverColorRef.current) return false;

      // Validate on a clone so an illegal / wrong move never mutates the board.
      const clone = new Chess(gameRef.current.fen());
      let mv;
      try {
        mv = clone.move({ from, to, promotion: promotion ?? "q" });
      } catch {
        return false;
      }
      if (!mv) return false;

      const userUci = `${mv.from}${mv.to}${mv.promotion ?? ""}`;
      const expected = movesRef.current[expectedIndexRef.current] ?? "";

      if (userUci !== expected) {
        // Wrong — record the failure (first attempt only), reveal the answer.
        recordResult(false);
        setStatus("failed");
        setHintLevel(0);
        setSelectedSquare(null);
        flashThen("bad");
        return false; // snap the piece back
      }

      // Correct — commit to the real game.
      gameRef.current.move({ from, to, promotion: mv.promotion });
      const nextIdx = expectedIndexRef.current + 1;
      expectedIndexRef.current = nextIdx;
      setFen(gameRef.current.fen());
      setSelectedSquare(null);
      setHintLevel(0);
      flashThen("good");

      if (nextIdx >= movesRef.current.length) {
        // Final solver move landed — puzzle solved.
        recordResult(true);
        setStatus("solved");
      } else {
        // An opponent forced reply is next — auto-play it.
        scheduleOpponentReply();
      }
      return true;
    },
    [status, recordResult, flashThen, scheduleOpponentReply]
  );

  /* ---- react-chessboard handlers ---------------------------------- */
  const onPieceDrop = useCallback(
    (sourceSquare: string, targetSquare: string): boolean =>
      attemptMove(sourceSquare as Square, targetSquare as Square),
    [attemptMove]
  );

  const onPromotionPieceSelect = useCallback(
    (piece?: string, from?: string, to?: string): boolean => {
      if (!piece || !from || !to) return false;
      const promo = piece.charAt(1).toLowerCase(); // "wQ" -> "q"
      return attemptMove(from as Square, to as Square, promo);
    },
    [attemptMove]
  );

  // Click-to-move (drag gives the underpromotion dialog; clicks default to queen).
  const selectionTargets = useMemo(() => {
    if (!selectedSquare) return [];
    try {
      return gameRef.current.moves({ square: selectedSquare, verbose: true });
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSquare, fen]);

  const onSquareClick = useCallback(
    (square: string) => {
      if (status !== "solving") return;
      if (gameRef.current.turn() !== solverColorRef.current) return;
      const sq = square as Square;

      if (selectedSquare) {
        if (sq === selectedSquare) {
          setSelectedSquare(null);
          return;
        }
        if (selectionTargets.some((m) => m.to === sq)) {
          attemptMove(selectedSquare, sq);
          return;
        }
      }
      const piece = gameRef.current.get(sq);
      setSelectedSquare(piece && piece.color === solverColorRef.current ? sq : null);
    },
    [status, selectedSquare, selectionTargets, attemptMove]
  );

  /* ---- Controls --------------------------------------------------- */
  const handleRetry = useCallback(() => {
    if (puzzle) loadPuzzle(puzzle, true);
  }, [puzzle, loadPuzzle]);

  const handleNext = useCallback(() => {
    setLastDelta(null);
    if (modeRef.current === "mistakes") loadNextMistake();
    else nextPuzzle();
  }, [nextPuzzle, loadNextMistake]);

  const handleHint = useCallback(() => {
    if (status !== "solving") return;
    setHintLevel((l) => Math.min(2, l + 1));
  }, [status]);

  // Hand the CURRENT board position over to the Play tab as a normal game vs
  // the bot (the puzzle position becomes the starting position, not a script).
  const handlePlayFromHere = useCallback(() => {
    if (!onPlayFromPuzzle) return;
    const p = puzzleRef.current;
    onPlayFromPuzzle(
      puzzlePosition(gameRef.current.fen(), { puzzleId: p?.id, themes: p?.themes })
    );
  }, [onPlayFromPuzzle]);

  const onThemeChange = useCallback(
    (value: string) => {
      setTheme(value);
      clearRecent();
      const p = selectPuzzle({
        theme: value || null,
        band: currentBand(),
        userRating: progressRef.current.rating,
      });
      setLastDelta(null);
      loadPuzzle(p, false);
    },
    [currentBand, loadPuzzle]
  );

  const onBandChange = useCallback(
    (value: string) => {
      setBandLabel(value);
      clearRecent();
      const band = RATING_BANDS.find((b) => b.label === value) ?? null;
      const p = selectPuzzle({
        theme: theme || null,
        band,
        userRating: progressRef.current.rating,
      });
      setLastDelta(null);
      loadPuzzle(p, false);
    },
    [theme, loadPuzzle]
  );

  const handleResetProgress = useCallback(() => {
    const fresh = resetProgress();
    setProgress(fresh);
    setLastDelta(null);
  }, []);

  /* ---- Derived: the currently-expected solver move ---------------- */
  const expectedMove = useMemo<Uci | null>(() => {
    const m = movesRef.current[expectedIndexRef.current];
    return m ? parseUci(m) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, status, hintLevel]);

  /* ---- Square styles ---------------------------------------------- */
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    // Last move highlight.
    const verbose = gameRef.current.history({ verbose: true });
    const last = verbose[verbose.length - 1];
    if (last) {
      [last.from, last.to].forEach((sq) => {
        styles[sq] = {
          background: LASTFILL,
          boxShadow: `inset 0 0 0 2px ${LASTRING}`,
        };
      });
    }

    // Hint level 1: highlight the piece to move.
    if (status === "solving" && hintLevel >= 1 && expectedMove) {
      styles[expectedMove.from] = {
        ...(styles[expectedMove.from] || {}),
        boxShadow: `inset 0 0 0 3px ${HINT}`,
        borderRadius: "4px",
      };
    }

    // On failure: reveal the correct move squares in success green.
    if (status === "failed" && expectedMove) {
      [expectedMove.from, expectedMove.to].forEach((sq) => {
        styles[sq] = {
          ...(styles[sq] || {}),
          boxShadow: `inset 0 0 0 3px ${SUCCESS}`,
          borderRadius: "4px",
        };
      });
    }

    // Click-to-move selection + legal targets.
    if (selectedSquare) {
      styles[selectedSquare] = {
        ...(styles[selectedSquare] || {}),
        outline: `2px solid ${SUCCESS}99`,
        outlineOffset: "-2px",
      };
      selectionTargets.forEach((m) => {
        const prev = styles[m.to] || {};
        const isCapture = !!gameRef.current.get(m.to);
        if (isCapture) {
          styles[m.to] = {
            ...prev,
            boxShadow: prev.boxShadow
              ? `${prev.boxShadow}, inset 0 0 0 4px ${SUCCESS}88`
              : `inset 0 0 0 4px ${SUCCESS}88`,
            borderRadius: "50%",
          };
        } else {
          const dot = `radial-gradient(circle, ${SUCCESS}80 22%, transparent 24%)`;
          styles[m.to] = {
            ...prev,
            background: prev.background ? `${dot}, ${prev.background}` : dot,
          };
        }
      });
    }

    return styles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, status, hintLevel, expectedMove, selectedSquare, selectionTargets]);

  /* ---- Arrows: hint (full move) and reveal-on-fail ---------------- */
  const arrows = useMemo(() => {
    const list: [Square, Square, string][] = [];
    if (status === "solving" && hintLevel >= 2 && expectedMove) {
      list.push([expectedMove.from, expectedMove.to, HINT]);
    }
    if (status === "failed" && expectedMove) {
      list.push([expectedMove.from, expectedMove.to, SUCCESS]);
    }
    return list;
  }, [status, hintLevel, expectedMove]);

  /* ---- Derived UI text -------------------------------------------- */
  const orientation = solverColorRef.current === "w" ? "white" : "black";
  const solverName = solverColorRef.current === "w" ? "White" : "Black";
  // If the current puzzle came from the player's own game, its source metadata.
  const genMeta = puzzle ? mistakeMetaRef.current.get(puzzle.id) : undefined;
  const draggable =
    status === "solving" && gameRef.current.turn() === solverColorRef.current;

  const moveNumber = Math.floor((expectedIndexRef.current - 1) / 2) + 1;
  const totalSolverMoves = Math.ceil(movesRef.current.length / 2);

  const statusLine =
    status === "opponent"
      ? "Opponent to move…"
      : status === "solving"
      ? `${solverName} to play — find the best move`
      : status === "solved"
      ? "Solved!"
      : "Not quite — here's the winning idea.";

  return (
    <div className="min-h-screen w-full bg-slate-950 font-sans text-slate-100 antialiased">
      <style>{`
        @keyframes pt-shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        @keyframes pt-pop {
          0% { transform: scale(0.9); opacity: 0; }
          60% { transform: scale(1.04); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

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
              <PuzzleIcon className="h-6 w-6 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Tactics Trainer</h1>
              <p className="text-xs text-slate-400">Solve Lichess puzzles &amp; grow your tactics rating</p>
            </div>
          </div>
          <span
            className="rounded-full border px-3 py-1 text-xs font-medium"
            style={
              status === "solved"
                ? { borderColor: `${SUCCESS}80`, background: `${SUCCESS}1a`, color: SUCCESS }
                : status === "failed"
                ? { borderColor: `${FAILURE}80`, background: `${FAILURE}1a`, color: FAILURE }
                : { borderColor: "#1e293b", background: "rgba(15,23,42,0.6)", color: "#94a3b8" }
            }
          >
            {statusLine}
          </span>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          {/* -------- Board column -------- */}
          <div className="flex flex-col items-center">
            <div
              className="w-full max-w-[560px]"
              style={status === "failed" ? { animation: "pt-shake 0.4s ease-in-out" } : undefined}
            >
              <div
                className="min-w-0 flex-1 rounded-2xl border bg-slate-900/70 p-4 shadow-2xl shadow-black/40 transition-colors"
                style={{
                  borderColor:
                    flash === "good" ? SUCCESS : flash === "bad" ? FAILURE : "#1e293b",
                }}
              >
                <div ref={boardWrapRef}>
                  <Chessboard
                    position={fen}
                    onPieceDrop={onPieceDrop}
                    onPromotionPieceSelect={onPromotionPieceSelect}
                    onSquareClick={onSquareClick}
                    boardOrientation={orientation}
                    boardWidth={boardWidth}
                    animationDuration={200}
                    arePiecesDraggable={draggable}
                    customSquareStyles={squareStyles}
                    customArrows={arrows}
                    customArrowColor={SUCCESS}
                    customBoardStyle={{ borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                    customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                    customLightSquareStyle={{ backgroundColor: "#c3ccda" }}
                  />
                </div>
              </div>
            </div>

            {/* Puzzle meta / progress-in-line */}
            {puzzle && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" /> Puzzle rating{" "}
                  <span className="font-mono text-slate-200">{puzzle.rating}</span>
                </span>
                {status === "solving" && (
                  <span className="flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5" /> Move {Math.max(1, moveNumber)} of {totalSolverMoves}
                  </span>
                )}
                {(status === "solved" || status === "failed") && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {puzzle.themes
                      .filter((t) => THEME_LABELS[t])
                      .map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-300"
                        >
                          {prettyTheme(t)}
                        </span>
                      ))}
                    <span className="text-slate-500">#{puzzle.id}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* -------- Control panel column -------- */}
          <div className="flex flex-col gap-5">
            {/* Puzzle source: curated pool vs. your own mistakes */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-xl">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["curated", "Curated"],
                    ["mistakes", mistakeCount ? `My mistakes (${mistakeCount})` : "My mistakes"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => chooseMode(m)}
                    aria-pressed={mode === m}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                      mode === m
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-inner"
                        : "border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === "mistakes" && noMistakes && (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  No mistakes to train yet — import and analyze games in the Games tab (Coach Report → “Analyze N
                  games”), then your blunders show up here as puzzles.
                </p>
              )}
            </section>

            {/* Stats strip */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-400">
                    <TrendingUp className="h-3.5 w-3.5" /> Rating
                  </div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-emerald-300">
                    {progress.rating}
                  </div>
                  {lastDelta !== null && (
                    <div
                      className="text-xs font-semibold"
                      style={{ color: lastDelta >= 0 ? SUCCESS : FAILURE }}
                    >
                      {lastDelta >= 0 ? "+" : ""}
                      {lastDelta}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-400">
                    <Flame className="h-3.5 w-3.5" /> Streak
                  </div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-slate-100">
                    {progress.streak}
                  </div>
                  <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
                    <Trophy className="h-3 w-3" /> best {progress.bestStreak}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center">
                  <div className="text-[11px] font-medium text-slate-400">Solved / Failed</div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-slate-100">
                    <span style={{ color: SUCCESS }}>{progress.solved}</span>
                    <span className="text-slate-600"> / </span>
                    <span style={{ color: FAILURE }}>{progress.failed}</span>
                  </div>
                  <button
                    onClick={handleResetProgress}
                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-slate-300"
                  >
                    <RefreshCw className="h-2.5 w-2.5" /> reset
                  </button>
                </div>
              </div>
            </section>

            {/* Feedback / actions card */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              {status === "solved" && (
                <div
                  className="mb-4 flex items-center gap-3 rounded-xl border p-4"
                  style={{ borderColor: `${SUCCESS}40`, background: `${SUCCESS}12`, animation: "pt-pop 0.35s ease-out" }}
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `${SUCCESS}22` }}
                  >
                    <Check className="h-6 w-6" style={{ color: SUCCESS }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: SUCCESS }}>
                      Puzzle solved!
                    </p>
                    <p className="text-xs text-slate-400">
                      Nicely calculated. Ready for the next one?
                    </p>
                  </div>
                </div>
              )}
              {status === "failed" && (
                <div
                  className="mb-4 flex items-center gap-3 rounded-xl border p-4"
                  style={{ borderColor: `${FAILURE}40`, background: `${FAILURE}12` }}
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `${FAILURE}22` }}
                  >
                    <X className="h-6 w-6" style={{ color: FAILURE }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: FAILURE }}>
                      Incorrect
                    </p>
                    <p className="text-xs text-slate-400">
                      The winning move is shown in green. Retry it or move on.
                    </p>
                  </div>
                </div>
              )}
              {(status === "opponent" || status === "solving") && (
                <div className="mb-4 flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                  <p className="text-sm leading-relaxed text-slate-300">
                    {status === "opponent"
                      ? "Watch the opponent's move, then find the strongest reply."
                      : `You are ${solverName}. ${statusLine}.`}
                  </p>
                </div>
              )}

              {/* Source banner for a puzzle built from your own game */}
              {genMeta && (
                <div className="mb-4 flex gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3.5">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                  <p className="text-xs leading-relaxed text-indigo-100">
                    From your game vs <span className="font-semibold">{genMeta.opponent}</span> — you played{" "}
                    <span className="font-mono font-semibold text-rose-300">{genMeta.playedSan}</span> ({genMeta.quality}).
                    {status === "solving" || status === "opponent"
                      ? " Find the move you missed."
                      : genMeta.bestSan
                      ? <> The engine preferred <span className="font-mono font-semibold text-emerald-300">{genMeta.bestSan}</span>.</>
                      : null}
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleHint}
                  disabled={status !== "solving"}
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm font-medium text-slate-200 transition-all hover:border-amber-500/40 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Lightbulb className="h-4 w-4" />
                  {hintLevel === 0 ? "Hint" : hintLevel === 1 ? "Show move" : "Hint shown"}
                </button>
                {status === "failed" ? (
                  <button
                    onClick={handleRetry}
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm font-medium text-slate-200 transition-all hover:border-slate-600"
                  >
                    <RotateCcw className="h-4 w-4" /> Retry
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm font-medium text-slate-200 transition-all hover:border-slate-600"
                  >
                    <SkipForward className="h-4 w-4" /> Skip
                  </button>
                )}
              </div>

              <button
                onClick={handleNext}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:brightness-110 active:scale-[0.98]"
              >
                Next puzzle <ChevronRight className="h-4 w-4" />
              </button>

              {onPlayFromPuzzle && (
                <button
                  onClick={handlePlayFromHere}
                  disabled={!puzzle || status === "opponent"}
                  title="Continue this position as a normal game against the bot, with full coaching"
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm font-semibold text-indigo-200 transition-all hover:border-indigo-400/60 hover:bg-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Swords className="h-4 w-4" /> Play from here
                </button>
              )}
            </section>

            {/* Filters */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Filter className="h-4 w-4 text-emerald-400" /> Filters
              </h2>

              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Sparkles className="h-3.5 w-3.5" /> Theme
              </label>
              <select
                value={theme}
                onChange={(e) => onThemeChange(e.target.value)}
                className="mb-4 w-full rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                <option value="">All themes</option>
                {TACTIC_THEMES.map((t) => (
                  <option key={t} value={t}>
                    {prettyTheme(t)}
                  </option>
                ))}
              </select>

              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Gauge className="h-3.5 w-3.5" /> Rating band
              </label>
              <select
                value={bandLabel}
                onChange={(e) => onBandChange(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                <option value="">Near my rating (auto)</option>
                {RATING_BANDS.map((b) => (
                  <option key={b.label} value={b.label}>
                    {b.label}
                  </option>
                ))}
              </select>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Rating &amp; streak update on your first attempt only — retries are for
                learning and never change your score.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
