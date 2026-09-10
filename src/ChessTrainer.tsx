import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  Crown,
  Swords,
  RotateCcw,
  Play,
  AlertTriangle,
  Sparkles,
  Gauge,
  BookOpen,
  MessageSquareText,
  ShieldAlert,
  Lightbulb,
  Zap,
  ChevronRight,
  Compass,
} from "lucide-react";
import { getEngine, parseUciMove, isSuperseded, type EngineLine } from "./engine/stockfish";
import { evaluateMove, type MoveEvaluation, type MoveQuality } from "./engine/classify";
import {
  PIECE_VALUE,
  PIECE_NAME,
  buildAttackMap,
  findHangingPieces,
} from "./game/boardAnalysis";
import {
  OPENING_LINES,
  bookMovesAtFen,
  pickBookMove,
  nextBookMove,
  type BookHint,
} from "./game/openings";
import EvalBar from "./components/EvalBar";

/* Electric, high-voltage vision palette (neon over slate squares). */
const ELECTRIC = {
  lastFill: "rgba(179, 102, 255, 0.30)", // electric violet — last move
  lastRing: "rgba(179, 102, 255, 0.75)",
};
// In-danger pieces: Hong-Kong-neon red, uniform (danger = red, universally).
const DANGER = "#ff073a";

// Player suggestion arrows (best moves + the opening-guide book move) are all
// electric blue — the same "you" color as the control heatmap. Best-move rank
// is encoded by opacity so the top pick reads brightest.
const BEST_ARROW_ALPHA = [0.95, 0.7, 0.5];
const arrowColor = (alpha = 1) => `rgba(0, 179, 255, ${alpha})`; // electric blue (matches CYBER_MINE)

/* ------------------------------------------------------------------ */
/*  Control heatmap — cyberpunk neon triad (side-based, toggleable).   */
/*  YOU = electric blue, CPU = electric pink, contested = electric      */
/*  green. Opacity scales with control density (more attackers → vivid).*/
/* ------------------------------------------------------------------ */

const CYBER_MINE = (a: number) => `rgba(0, 179, 255, ${a})`; // electric blue — your control
const CYBER_ENEMY = (a: number) => `rgba(255, 45, 210, ${a})`; // electric pink — CPU control
const CYBER_CONTESTED = (a: number) => `rgba(57, 255, 20, ${a})`; // electric green — contested
// Solid swatch colors for the legend/toggles.
const CYBER_SWATCH = { mine: "rgb(0, 179, 255)", enemy: "rgb(255, 45, 210)", contested: "rgb(57, 255, 20)" };

type ControlKind = "mine" | "enemy" | "contested";

/** Who holds a square (by attacker counts) + its neon fill; null if uncontrolled. */
function controlOf(
  yourTypes: string[] | undefined,
  enemyTypes: string[] | undefined
): { kind: ControlKind; color: string } | null {
  const p = yourTypes?.length ?? 0;
  const o = enemyTypes?.length ?? 0;
  const density = p + o;
  if (density === 0) return null;
  const alpha = Math.min(0.62, 0.3 + 0.09 * (density - 1)); // vibrancy ← density
  if (p && o) return { kind: "contested", color: CYBER_CONTESTED(alpha) };
  if (o) return { kind: "enemy", color: CYBER_ENEMY(alpha) };
  return { kind: "mine", color: CYBER_MINE(alpha) };
}

/* ------------------------------------------------------------------ */
/*  Best-move suggestion (heuristic — same stub family as the bot).    */
/*                                                                     */
/*  Not a real engine eval yet: it scores each legal move by material  */
/*  won, threats resolved vs. created (via the hanging-piece model),   */
/*  checks, promotions, and center play. Good enough to coach with;    */
/*  swap in Stockfish's multipv for a true eval later.                 */
/* ------------------------------------------------------------------ */

interface RankedMove {
  from: Square;
  to: Square;
  san: string;
  score: number;
  captured?: string;
  piece: string; // moving piece type — drives the arrow hue
}

const hangingValue = (g: Chess, color: "w" | "b") =>
  findHangingPieces(g, color).reduce((sum, h) => sum + PIECE_VALUE[h.type], 0);

function rankPlayerMoves(game: Chess, color: "w" | "b"): RankedMove[] {
  const before = hangingValue(game, color);
  return game
    .moves({ verbose: true })
    .map((m) => {
      const clone = new Chess(game.fen());
      clone.move({ from: m.from, to: m.to, promotion: m.promotion });
      const after = hangingValue(clone, color);
      const capture = m.captured ? PIECE_VALUE[m.captured] : 0;

      let score = capture * 3; // reward winning material
      score += (before - after) * 2.5; // reward defending, punish self-hanging
      if (m.san.includes("#")) score += 100;
      else if (m.san.includes("+")) score += 0.6;
      if (m.promotion) score += 8;
      if (["d4", "e4", "d5", "e5"].includes(m.to)) score += 0.5;

      return { from: m.from, to: m.to, san: m.san, score, captured: m.captured, piece: m.piece };
    })
    .sort((a, b) => b.score - a.score);
}

function moveReason(m: RankedMove): string {
  if (m.san.includes("#")) return "it's checkmate.";
  if (m.captured) return `it wins the ${PIECE_NAME[m.captured]}.`;
  if (m.san.includes("+")) return "it checks and keeps the initiative.";
  return "it improves your position while keeping everything defended.";
}

/** Human-readable reason for a flagged mistake/blunder, from the engine's verdict. */
function describeEngineVerdict(verdict: MoveEvaluation, fenBefore: string): string {
  let bestSan: string | undefined;
  if (verdict.bestMoveUci) {
    try {
      const clone = new Chess(fenBefore);
      const { from, to, promotion } = parseUciMove(verdict.bestMoveUci);
      const mv = clone.move({ from, to, promotion });
      bestSan = mv?.san;
    } catch {
      bestSan = undefined;
    }
  }
  const bestSuffix = bestSan ? ` The engine's top choice was ${bestSan} instead.` : "";

  if (verdict.allowsMateIn !== undefined) {
    return `That allows a forced checkmate in ${verdict.allowsMateIn}!${bestSuffix}`;
  }
  const label = verdict.quality === "blunder" ? "a blunder" : "a mistake";
  const pawns = (verdict.cpLoss / 100).toFixed(1);
  return `That's ${label} — it costs about ${pawns} pawns of evaluation.${bestSuffix}`;
}

/** Short " (eval +1.4)" / " (mate in 3)" suffix for coach text. */
function formatEvalForCoach(line: EngineLine | undefined): string {
  if (!line) return "";
  if (line.mate !== undefined) return ` (mate in ${Math.abs(line.mate)})`;
  if (line.cp === undefined) return "";
  const pawns = (line.cp / 100).toFixed(1);
  return ` (eval ${line.cp >= 0 ? "+" : ""}${pawns})`;
}

/* ------------------------------------------------------------------ */
/*  Bot engine — real Stockfish, with a heuristic fallback.             */
/*                                                                     */
/*  While the position is still in the chosen opening's book, the bot   */
/*  plays a book move (same position-keyed book the guide arrow uses).  */
/*  Off book, it asks Stockfish for a move at a strength                */
/*  derived from the ELO slider. If the engine isn't ready yet or the   */
/*  call fails/times out, it falls back to the old material+noise      */
/*  heuristic (`pickMove`) so the bot never simply hangs.               */
/* ------------------------------------------------------------------ */

type VerboseMove = ReturnType<Chess["moves"]> extends (infer T)[] ? T : never;

/** Scale bot "thinking time" with ELO — weaker bots move faster, not just worse. */
function eloToMovetime(elo: number): number {
  const t = Math.max(0, Math.min(1, (elo - 600) / 2600));
  return Math.round(200 + t * 900);
}

function pickMove(game: Chess, elo: number, opening: string): VerboseMove | null {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;

  // 1) Follow the opening's position-keyed book (keyed by board position, so it
  //    works from a bare FEN and handles sidelines/transpositions).
  const bookPick = pickBookMove(bookMovesAtFen(game.fen(), opening));
  if (bookPick) {
    const bookMove = moves.find((m) => m.san === bookPick.san);
    if (bookMove) return bookMove;
  }

  // 2) Weighted heuristic scaled by ELO (higher ELO = sharper, less noise).
  const skill = Math.min(1, Math.max(0, (elo - 600) / 2600));
  const centerSquares = new Set(["d4", "e4", "d5", "e5", "c4", "f4", "c5", "f5"]);

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    let score = 0;
    if (m.captured) score += PIECE_VALUE[m.captured] * 10;
    if (m.san.includes("+")) score += 5;
    if (m.san.includes("#")) score += 1000;
    if (m.promotion) score += 8;
    if (centerSquares.has(m.to)) score += 2;
    const noise = (1 - skill) * Math.random() * 22;
    const total = skill * score + noise;
    if (total > bestScore) {
      bestScore = total;
      best = m;
    }
  }
  return best;
}

async function getBotMove(fen: string, elo: number, opening: string): Promise<VerboseMove | null> {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;

  // 1) Stay in book while the position is known (position-keyed, so it works
  //    from a bare FEN and follows player sidelines that are in the tree).
  const bookPick = pickBookMove(bookMovesAtFen(fen, opening));
  if (bookPick) {
    const bookMove = moves.find((m) => m.san === bookPick.san);
    if (bookMove) return bookMove;
  }

  // 2) Off book — ask the real engine, strength-limited to the ELO slider.
  try {
    const result = await getEngine().analyze(fen, {
      movetime: eloToMovetime(elo),
      multipv: 1,
      elo,
      channel: "bot",
    });
    if (result.bestmove) {
      const { from, to, promotion } = parseUciMove(result.bestmove);
      const exact = moves.find((m) => m.from === from && m.to === to && (m.promotion ?? "") === (promotion ?? ""));
      if (exact) return exact;
      // Engine's promotion choice may not match chess.js's default ("q") — match on from/to alone.
      const loose = moves.find((m) => m.from === from && m.to === to);
      if (loose) return loose;
    }
  } catch {
    // Engine not ready / worker failed / timed out — fall through to the heuristic.
  }

  // 3) Fallback so the bot can never simply hang.
  return pickMove(game, elo, opening);
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ChessTrainer() {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);

  // Setup / config
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [elo, setElo] = useState(1500);
  const [opening, setOpening] = useState<keyof typeof OPENING_LINES>("Ruy Lopez");
  const [started, setStarted] = useState(false);

  // Training visuals — three independent vision layers
  // Control heatmap, split into three independently-toggleable neon layers.
  const [showMine, setShowMine] = useState(true); // your control — electric blue
  const [showEnemy, setShowEnemy] = useState(true); // CPU control — electric pink
  const [showContested, setShowContested] = useState(true); // contested — electric green
  const [showAttacks, setShowAttacks] = useState(true); // under-attack markers
  const [showLast, setShowLast] = useState(true); // last-move highlight
  const [openingGuide, setOpeningGuide] = useState(true); // guide me through the book
  const [bestMoves, setBestMoves] = useState<RankedMove[]>([]);

  // Coach + blunder flow
  const [coach, setCoach] = useState("Configure your session and press Start Training.");
  const [thinking, setThinking] = useState(false);
  const [checkingMove, setCheckingMove] = useState(false); // engine cp-loss check in flight
  const [blunder, setBlunder] = useState<{ reason: string; quality: MoveQuality; cpLoss: number } | null>(null);

  // Click-to-move: the currently selected friendly square, if any.
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);

  // Lichess Opening Explorer — real-world game stats for the current position.
  const [explorerStats, setExplorerStats] = useState<{ white: number; draws: number; black: number } | null>(null);

  const botColor = playerColor === "w" ? "b" : "w";
  const orientation = playerColor === "w" ? "white" : "black";

  // react-chessboard v4 only sets up its own resize-driven sizing once, at
  // mount, gated on the container already having a non-zero offsetWidth —
  // in this flex/grid layout that check can land before layout settles, so
  // the board silently never renders. Measuring the container ourselves and
  // passing an explicit `boardWidth` sidesteps that internal gate entirely.
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(480);
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    // Ignore transient 0-width measurements (hidden pane / mount race) so the
    // board never latches to 0 and renders blank — keep the last good width.
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setBoardWidth(w);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const syncState = useCallback(() => {
    setFen(gameRef.current.fen());
    setHistory(gameRef.current.history());
    setBestMoves([]); // stale once the position changes
  }, []);

  /* ---- Start / restart --------------------------------------------- */
  const startGame = useCallback(() => {
    gameRef.current = new Chess();
    setBlunder(null);
    setThinking(false);
    setStarted(true);
    setCoach(
      `Playing the ${opening} as ${playerColor === "w" ? "White" : "Black"}. Bot rated ${elo}.${
        openingGuide ? " Follow the book arrow to learn the main line." : " Best Moves and the Vision layers are one click away."
      }`
    );
    syncState();
  }, [opening, playerColor, elo, openingGuide, syncState]);

  /* ---- Bot move ---------------------------------------------------- */
  const runBot = useCallback(async () => {
    if (thinking) return;
    setThinking(true);
    const move = await getBotMove(gameRef.current.fen(), elo, opening);
    if (move) {
      gameRef.current.move({ from: move.from, to: move.to, promotion: move.promotion });
      syncState();
      const threats = findHangingPieces(gameRef.current, playerColor);
      if (threats.length) {
        const t = threats[0];
        setCoach(
          `⚠ Careful — your ${PIECE_NAME[t.type]} on ${t.square} is now under pressure. Defend it or move it.`
        );
      } else {
        setCoach("Your move. Look for undefended enemy pieces on the red squares.");
      }
    }
    setThinking(false);
  }, [thinking, elo, opening, playerColor, syncState]);

  // Trigger the bot whenever it is its turn. Gated on `checkingMove` too — the
  // player's move is committed optimistically, so the bot must wait for the
  // async cp-loss verdict before it's allowed to reply.
  useEffect(() => {
    if (!started || blunder || checkingMove) return;
    if (gameRef.current.isGameOver()) return;
    if (gameRef.current.turn() === botColor) {
      runBot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, started, blunder, checkingMove, botColor]);

  // Lichess Opening Explorer — real-world game stats for the current
  // position. Debounced, abortable, and silent on failure (offline-friendly).
  useEffect(() => {
    if (!started) {
      setExplorerStats(null);
      return;
    }
    const controller = new AbortController();
    const debounce = setTimeout(() => {
      const url = `https://explorer.lichess.org/lichess?fen=${encodeURIComponent(fen)}&topGames=0&recentGames=0&moves=0`;
      fetch(url, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
        .then((data) => {
          setExplorerStats({
            white: Number(data.white) || 0,
            draws: Number(data.draws) || 0,
            black: Number(data.black) || 0,
          });
        })
        .catch(() => {
          // A stale/aborted request (superseded by a newer position) leaves the
          // card as-is — the effect for the new position owns it. A genuine
          // failure (offline, bad status) hides the card instead of showing
          // stats for the wrong position.
          if (controller.signal.aborted) return;
          setExplorerStats(null);
        });
    }, 350);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [fen, started]);

  /* ---- Commit a move to the real game ------------------------------ */
  const commitMove = useCallback(
    (from: Square, to: Square) => {
      const mv = gameRef.current.move({ from, to, promotion: "q" });
      syncState();
      return mv;
    },
    [syncState]
  );

  /* ---- Post-move cp-loss check (engine, with heuristic fallback) --- */
  // Runs AFTER the move is already committed (see onDrop below) — a real
  // engine eval can't be had synchronously, so the drop is accepted
  // optimistically and this retroactively flags the blunder modal if the
  // verdict comes back bad enough.
  const classifyPlayedMove = useCallback(
    async (fenBefore: string, fenAfter: string, playedMoveUci: string): Promise<{ quality: MoveQuality; cpLoss: number; reason: string }> => {
      try {
        const verdict = await evaluateMove({
          analyze: (fen, opts) => getEngine().analyze(fen, opts),
          fenBefore,
          fenAfter,
          playedMoveUci,
          movetime: 450,
        });
        if (verdict.quality !== "mistake" && verdict.quality !== "blunder") {
          return { quality: verdict.quality, cpLoss: verdict.cpLoss, reason: "" };
        }
        return { quality: verdict.quality, cpLoss: verdict.cpLoss, reason: describeEngineVerdict(verdict, fenBefore) };
      } catch (err) {
        if (isSuperseded(err)) return { quality: "good", cpLoss: 0, reason: "" };
        // Engine not ready / worker failed / timed out — fall back to the old
        // material-hang heuristic so a blunder check never just hangs.
        const afterGame = new Chess(fenAfter);
        const hangingAfter = findHangingPieces(afterGame, playerColor);
        const seriousHang = hangingAfter.find(
          (h) => PIECE_VALUE[h.type] >= 3 && (!h.defended || h.minAttacker < PIECE_VALUE[h.type])
        );
        if (seriousHang) {
          return {
            quality: "blunder",
            cpLoss: 300,
            reason: `That move leaves your ${PIECE_NAME[seriousHang.type]} on ${seriousHang.square} hanging — it's attacked by a ${
              seriousHang.minAttacker < PIECE_VALUE[seriousHang.type] ? "lower-value piece" : "piece"
            } and ${seriousHang.defended ? "under-defended" : "completely undefended"}.`,
          };
        }
        return { quality: "good", cpLoss: 0, reason: "" };
      }
    },
    [playerColor]
  );

  /* ---- User move + blunder correction ------------------------------ */
  const onDrop = useCallback(
    (sourceSquare: string, targetSquare: string) => {
      if (!started || blunder || thinking || checkingMove) return false;
      if (gameRef.current.turn() !== playerColor) return false;

      const from = sourceSquare as Square;
      const to = targetSquare as Square;

      // Validate on a clone first so an illegal move never mutates state.
      const legalityClone = new Chess(gameRef.current.fen());
      try {
        if (!legalityClone.move({ from, to, promotion: "q" })) return false;
      } catch {
        return false; // illegal move
      }

      // Opening-guide feedback (read from the live game, before we commit).
      const fenBefore = gameRef.current.fen();
      const bookBefore = openingGuide ? bookMovesAtFen(fenBefore, opening) : [];

      // Optimistic commit — a real engine eval takes time, so we can't block
      // the drop on it. The cp-loss verdict arrives async below and, if bad
      // enough, retroactively opens the blunder modal (Undo & Retry pops
      // this move back off; Play it anyway just dismisses the flag).
      const result = commitMove(from, to);
      if (!result) return false;

      let msg = result.captured
        ? `Nice — you won a ${PIECE_NAME[result.captured]}. Keep your pieces coordinated.`
        : "Solid. The bot is thinking…";
      if (bookBefore.length) {
        // A move is "in book" if it's ANY of the tree's continuations here —
        // playing a valid sideline no longer counts as leaving the book.
        const played = bookBefore.find((e) => e.san === result.san);
        if (played) {
          msg = played.main
            ? `📖 On book — ${result.san} is the ${opening} main line. Bot to reply…`
            : `📖 A known ${opening} sideline — ${result.san}. Still in book; bot to reply…`;
        } else {
          const mainMove = pickBookMove(bookBefore);
          msg = `You left the ${opening} book (main line was ${mainMove?.san ?? "?"}). Own your plan — bot to reply…`;
        }
      }
      setCoach(msg);

      const fenAfter = gameRef.current.fen();
      const playedMoveUci = `${result.from}${result.to}${result.promotion ?? ""}`;
      setCheckingMove(true);
      classifyPlayedMove(fenBefore, fenAfter, playedMoveUci)
        .then((verdict) => {
          if (verdict.quality === "mistake" || verdict.quality === "blunder") {
            setBlunder({ reason: verdict.reason, quality: verdict.quality, cpLoss: verdict.cpLoss });
            setCoach("Coach flagged this move. Undo and rethink, or override and play it anyway — your call.");
          }
        })
        .finally(() => setCheckingMove(false));

      return true;
    },
    [started, blunder, thinking, checkingMove, playerColor, commitMove, openingGuide, opening, classifyPlayedMove]
  );

  // Legal targets for the currently selected square (recomputed whenever the
  // selection or the position changes; empty when nothing is selected).
  const selectionTargets = useMemo(() => {
    if (!selectedSquare) return [];
    return gameRef.current.moves({ square: selectedSquare, verbose: true });
  }, [selectedSquare, fen]);

  // Clear any click-to-move selection whenever the position changes (our own
  // move, the bot's reply, or a restart) so stale hints never linger.
  useEffect(() => {
    setSelectedSquare(null);
  }, [fen]);

  /* ---- Click-to-move: select a piece, then click a legal target ---- */
  const onSquareClick = useCallback(
    (square: string) => {
      if (!started || blunder || thinking || checkingMove) return;
      const sq = square as Square;

      if (selectedSquare) {
        if (sq === selectedSquare) {
          setSelectedSquare(null); // clicking the selected square again deselects
          return;
        }
        const isTarget = selectionTargets.some((m) => m.to === sq);
        if (isTarget) {
          onDrop(selectedSquare, sq); // reuse the same validation/blunder-check path as drag-drop
          setSelectedSquare(null);
          return;
        }
      }

      if (gameRef.current.turn() !== playerColor) {
        setSelectedSquare(null);
        return;
      }
      const piece = gameRef.current.get(sq);
      setSelectedSquare(piece && piece.color === playerColor ? sq : null);
    },
    [started, blunder, thinking, checkingMove, selectedSquare, selectionTargets, playerColor, onDrop]
  );

  // Player takes the flagged move back — it's already on the board, so this
  // pops it back off rather than simply clearing a pre-commit flag.
  const undoAndRetry = useCallback(() => {
    gameRef.current.undo();
    syncState();
    setBlunder(null);
    setCoach("Good — reassess the position. Find a move that keeps every piece defended.");
  }, [syncState]);

  // Player overrides the coach — the move is already committed, so this just
  // dismisses the flag and lets the bot proceed.
  const playAnyway = useCallback(() => {
    const wasBlunder = blunder?.quality === "blunder";
    setBlunder(null);
    setCoach(
      wasBlunder
        ? "Override accepted — you played through the blunder warning. Bold; let's see if it holds up."
        : "Override accepted — you played through the warning. Own the plan; the bot is thinking…"
    );
  }, [blunder]);

  // Compute + show (or hide) the top best moves as arrows and coach text.
  const toggleBestMoves = useCallback(async () => {
    if (bestMoves.length) {
      setBestMoves([]);
      return;
    }
    if (!started || blunder || thinking || checkingMove) return;
    if (gameRef.current.turn() !== playerColor || gameRef.current.isGameOver()) return;

    const fen = gameRef.current.fen();
    try {
      const result = await getEngine().analyze(fen, { multipv: 3, movetime: 700, channel: "bestmoves" });
      if (gameRef.current.fen() !== fen) return; // position moved on while we awaited — discard
      if (!result.lines.length) throw new Error("no engine lines");

      const ranked: RankedMove[] = [];
      for (const line of result.lines) {
        const { from, to, promotion } = parseUciMove(line.moveUci);
        try {
          const clone = new Chess(fen);
          const mv = clone.move({ from, to, promotion });
          if (!mv) continue;
          ranked.push({
            from: mv.from,
            to: mv.to,
            san: mv.san,
            piece: mv.piece,
            captured: mv.captured,
            score: line.mate !== undefined ? (line.mate > 0 ? 100000 : -100000) : line.cp ?? 0,
          });
        } catch {
          // Skip a single unparseable engine line rather than losing the whole feature.
        }
      }
      if (!ranked.length) throw new Error("no parseable engine lines");

      setBestMoves(ranked);
      const top = ranked[0];
      setCoach(
        `Top candidates: ${ranked.map((r) => r.san).join(", ")}. I'd play ${top.san}${formatEvalForCoach(
          result.lines[0]
        )} — ${moveReason(top)}`
      );
    } catch (err) {
      if (isSuperseded(err)) return;
      // Engine unavailable/failed — fall back to the material/threat heuristic.
      const ranked = rankPlayerMoves(gameRef.current, playerColor).slice(0, 3);
      setBestMoves(ranked);
      if (ranked.length) {
        const top = ranked[0];
        setCoach(`Top candidates: ${ranked.map((r) => r.san).join(", ")}. I'd play ${top.san} — ${moveReason(top)}`);
      }
    }
  }, [bestMoves, started, blunder, thinking, checkingMove, playerColor]);

  /* ---- Vision layers → per-square styles ---------------------------- */
  const squareStyles = useMemo(() => {
    if (!started) return {};
    const styles: Record<string, React.CSSProperties> = {};

    // Layer 1 — control heatmap: neon triad, each side independently toggled.
    if (showMine || showEnemy || showContested) {
      const playerMap = buildAttackMap(gameRef.current, playerColor);
      const oppMap = buildAttackMap(gameRef.current, botColor);
      const all = new Set([...Object.keys(playerMap), ...Object.keys(oppMap)]);
      all.forEach((sq) => {
        const c = controlOf(playerMap[sq], oppMap[sq]);
        if (!c) return;
        const on = c.kind === "mine" ? showMine : c.kind === "enemy" ? showEnemy : showContested;
        if (on) styles[sq] = { background: c.color };
      });
    }

    // Layer 2 — last-move highlight (from + to), under the attack glow.
    if (showLast) {
      const verbose = gameRef.current.history({ verbose: true });
      const last = verbose[verbose.length - 1];
      if (last) {
        [last.from, last.to].forEach((sq) => {
          styles[sq] = {
            ...(styles[sq] || {}),
            background: styles[sq]?.background ?? ELECTRIC.lastFill,
            boxShadow: `inset 0 0 0 2px ${ELECTRIC.lastRing}`,
          };
        });
      }
    }

    // Layer 3 — in-danger pieces: uniform neon-red ring with a heartbeat (wins).
    if (showAttacks) {
      findHangingPieces(gameRef.current, playerColor).forEach((h) => {
        styles[h.square] = {
          ...(styles[h.square] || {}),
          boxShadow: `inset 0 0 0 3px ${DANGER}`,
          animation: "ct-beat 1.4s ease-in-out infinite",
          borderRadius: "4px",
        };
      });
    }

    // Layer 4 — click-to-move hints: selected square ring + legal-target dots.
    // The selected square uses `outline` rather than `boxShadow` because a
    // hanging piece (Layer 3) drives its `boxShadow` via the ct-beat
    // animation, which would otherwise overwrite a static appended shadow —
    // outline is a distinct property so the ring still shows even there.
    if (selectedSquare) {
      const prevSel = styles[selectedSquare] || {};
      styles[selectedSquare] = {
        ...prevSel,
        outline: "2px solid rgba(85,204,33,0.55)",
        outlineOffset: "-2px",
      };

      selectionTargets.forEach((m) => {
        const prev = styles[m.to] || {};
        const isCapture = !!gameRef.current.get(m.to); // enemy piece present on the target square
        if (isCapture) {
          styles[m.to] = {
            ...prev,
            boxShadow: prev.boxShadow
              ? `${prev.boxShadow}, inset 0 0 0 4px rgba(85,204,33,0.55)`
              : "inset 0 0 0 4px rgba(85,204,33,0.55)",
            borderRadius: "50%",
          };
        } else {
          const dot = "radial-gradient(circle, rgba(85,204,33,0.5) 22%, transparent 24%)";
          styles[m.to] = {
            ...prev,
            background: prev.background ? `${dot}, ${prev.background}` : dot,
          };
        }
      });
    }

    return styles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, showMine, showEnemy, showContested, showLast, showAttacks, started, playerColor, botColor, selectedSquare, selectionTargets]);

  // Opening-guide hint — the book move for the player, while still in book.
  const bookHint = useMemo<BookHint | null>(() => {
    if (!started || blunder || !openingGuide) return null;
    if (gameRef.current.isGameOver()) return null;
    if (gameRef.current.turn() !== playerColor) return null;
    return nextBookMove(gameRef.current, opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, started, blunder, openingGuide, playerColor, opening]);

  // Board arrows are all electric blue (the "you" color). Best-move rank is
  // encoded by opacity; the opening-guide book move is drawn at full strength.
  const arrows = useMemo(() => {
    // Dedupe by from→to: react-chessboard keys arrows on their squares, so the
    // book move and a best-move suggestion for the same move must not both add.
    const seen = new Set<string>();
    const list: [Square, Square, string][] = [];
    const add = (from: Square, to: Square, color: string) => {
      const key = `${from}-${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push([from, to, color]);
    };
    if (bookHint) add(bookHint.from, bookHint.to, arrowColor());
    bestMoves.slice(0, 3).forEach((m, i) => add(m.from, m.to, arrowColor(BEST_ARROW_ALPHA[i])));
    return list;
  }, [bestMoves, bookHint]);

  /* ---- Derived UI data --------------------------------------------- */
  const pairedHistory = useMemo(() => {
    const rows: { no: number; w?: string; b?: string }[] = [];
    for (let i = 0; i < history.length; i += 2) {
      rows.push({ no: i / 2 + 1, w: history[i], b: history[i + 1] });
    }
    return rows;
  }, [history]);

  // Opening Explorer percentages, derived from the raw win/draw/loss counts.
  const explorerPct = useMemo(() => {
    if (!explorerStats) return null;
    const total = explorerStats.white + explorerStats.draws + explorerStats.black;
    if (total <= 0) return null;
    const w = Math.round((explorerStats.white / total) * 100);
    const d = Math.round((explorerStats.draws / total) * 100);
    const b = Math.max(0, 100 - w - d);
    return { total, w, d, b };
  }, [explorerStats]);

  const status = gameRef.current.isCheckmate()
    ? "Checkmate"
    : gameRef.current.isDraw()
    ? "Draw"
    : blunder
    ? "Coach flagged your move"
    : checkingMove
    ? "Checking your move…"
    : gameRef.current.isCheck()
    ? "Check"
    : started
    ? gameRef.current.turn() === playerColor
      ? "Your move"
      : "Bot thinking…"
    : "Not started";

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="min-h-screen w-full bg-slate-950 font-sans text-slate-100 antialiased">
      {/* In-danger heartbeat — a subtle neon-red lub-dub, then rest. */}
      <style>{`
        @keyframes ct-beat {
          0%, 100% { box-shadow: inset 0 0 0 3px ${DANGER}; }
          10%      { box-shadow: inset 0 0 0 4px ${DANGER}, 0 0 11px 2px rgba(255,7,58,0.95); }
          20%      { box-shadow: inset 0 0 0 3px ${DANGER}; }
          32%      { box-shadow: inset 0 0 0 4px ${DANGER}, 0 0 8px 1px rgba(255,7,58,0.8); }
          46%      { box-shadow: inset 0 0 0 3px ${DANGER}; }
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
              <Crown className="h-6 w-6 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">GM Vision</h1>
              <p className="text-xs text-slate-400">Board control &amp; blunder-correction trainer</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs font-medium text-slate-400">
            {status}
          </span>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          {/* -------- Board column -------- */}
          <div className="flex flex-col items-center">
            <div className="flex w-full max-w-[560px] items-stretch gap-3">
              <EvalBar fen={fen} active={started} orientation={orientation} />
              <div className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-black/40">
                <div ref={boardWrapRef}>
                  <Chessboard
                    position={fen}
                    onPieceDrop={onDrop}
                    onSquareClick={onSquareClick}
                    boardOrientation={orientation}
                    boardWidth={boardWidth}
                    animationDuration={200}
                    arePiecesDraggable={
                      started && !blunder && !thinking && !checkingMove && gameRef.current.turn() === playerColor
                    }
                    customSquareStyles={squareStyles}
                    customArrows={arrows}
                    customArrowColor="hsl(200, 16%, 66%)"
                    customBoardStyle={{ borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                    customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                    customLightSquareStyle={{ backgroundColor: "#c3ccda" }}
                  />
                </div>
              </div>
            </div>

            {/* Vision legend — mirrors the active layers */}
            {started &&
              (showMine || showEnemy || showContested || showAttacks || showLast || bestMoves.length > 0 || bookHint) && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-400">
                {showMine && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm" style={{ background: CYBER_SWATCH.mine }} /> Your control
                  </span>
                )}
                {showEnemy && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm" style={{ background: CYBER_SWATCH.enemy }} /> CPU control
                  </span>
                )}
                {showContested && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm" style={{ background: CYBER_SWATCH.contested }} /> Contested
                  </span>
                )}
                {(showMine || showEnemy || showContested) && (
                  <span className="text-slate-500">brighter = more attackers</span>
                )}
                {showAttacks && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ boxShadow: `inset 0 0 0 2px ${DANGER}` }}
                    />{" "}
                    In danger (neon-red beat)
                  </span>
                )}
                {showLast && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm" style={{ background: ELECTRIC.lastFill }} /> Last move
                  </span>
                )}
                {(bookHint || bestMoves.length > 0) && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm leading-none text-slate-400">➜</span>
                    Suggested move — arrow in the moving piece's color
                    {bestMoves.length > 0 ? " (brighter = higher-ranked)" : ""}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* -------- Control panel column -------- */}
          <div className="flex flex-col gap-5">
            {/* Setup card */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Sparkles className="h-4 w-4 text-emerald-400" /> Session Setup
              </h2>

              {/* Color toggle */}
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Play as</label>
              <div className="mb-4 grid grid-cols-2 gap-2">
                {(["w", "b"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setPlayerColor(c)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                      playerColor === c
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-inner"
                        : "border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {c === "w" ? "♔ White" : "♚ Black"}
                  </button>
                ))}
              </div>

              {/* ELO slider */}
              <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" /> Bot ELO
                </span>
                <span className="font-mono text-emerald-300">{elo}</span>
              </label>
              <input
                type="range"
                min={600}
                max={3200}
                step={50}
                value={elo}
                onChange={(e) => setElo(Number(e.target.value))}
                className="mb-4 w-full cursor-pointer accent-emerald-500"
              />

              {/* Opening dropdown */}
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <BookOpen className="h-3.5 w-3.5" /> Opening
              </label>
              <select
                value={opening}
                onChange={(e) => setOpening(e.target.value as keyof typeof OPENING_LINES)}
                className="mb-4 w-full rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                {Object.keys(OPENING_LINES).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>

              {/* Opening guide toggle */}
              <label className="mb-4 flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Compass className="h-3.5 w-3.5 text-emerald-300" /> Guide me through the opening
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={openingGuide}
                  onClick={() => setOpeningGuide((v) => !v)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    openingGuide ? "bg-emerald-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                      openingGuide ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </label>

              <button
                onClick={startGame}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:brightness-110 active:scale-[0.98]"
              >
                <Play className="h-4 w-4" /> {started ? "Restart" : "Start Training"}
              </button>

              {/* Vision layers */}
              <div className="mt-4 border-t border-slate-800 pt-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <Zap className="h-3.5 w-3.5 text-cyan-300" /> Vision Layers
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { on: showMine, set: setShowMine, label: "You", dot: CYBER_SWATCH.mine, ring: "border-sky-400/50 bg-sky-400/10 text-sky-200" },
                      { on: showEnemy, set: setShowEnemy, label: "CPU", dot: CYBER_SWATCH.enemy, ring: "border-pink-400/50 bg-pink-400/10 text-pink-200" },
                      { on: showContested, set: setShowContested, label: "Contested", dot: CYBER_SWATCH.contested, ring: "border-lime-400/50 bg-lime-400/10 text-lime-200" },
                      { on: showAttacks, set: setShowAttacks, label: "Threats", dot: DANGER, ring: "border-rose-500/50 bg-rose-500/10 text-rose-200" },
                      { on: showLast, set: setShowLast, label: "Last move", dot: "#b366ff", ring: "border-violet-400/50 bg-violet-400/10 text-violet-200" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.label}
                      onClick={() => t.set((v) => !v)}
                      aria-pressed={t.on}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-all ${
                        t.on ? t.ring : "border-slate-800 bg-slate-800/40 text-slate-500 hover:border-slate-700"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full transition-all"
                        style={{ background: t.on ? t.dot : "#475569" }}
                      />
                      {t.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={toggleBestMoves}
                  disabled={!started || !!blunder || thinking || checkingMove}
                  className={`mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    bestMoves.length
                      ? "border-violet-400/60 bg-violet-500/15 text-violet-200"
                      : "border-slate-700 bg-slate-800/50 text-slate-200 hover:border-violet-500/40 hover:bg-violet-500/10"
                  }`}
                >
                  <Lightbulb className="h-4 w-4" />
                  {bestMoves.length ? "Hide Best Moves" : "Show Best Moves"}
                </button>
              </div>
            </section>

            {/* Coach feedback */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <MessageSquareText className="h-4 w-4 text-indigo-400" /> Coach's Feedback
              </h2>
              {openingGuide && bookHint && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200">
                  <Compass className="h-4 w-4 shrink-0" />
                  <span>
                    <span className="font-semibold">{opening}</span> — play{" "}
                    <span className="font-mono font-semibold text-emerald-100">{bookHint.san}</span> to stay in
                    book (green arrow)
                    {bookHint.alts > 0 && (
                      <span className="text-emerald-300/80">
                        {" "}
                        · +{bookHint.alts} book {bookHint.alts === 1 ? "sideline" : "sidelines"}
                      </span>
                    )}
                    .
                  </span>
                </div>
              )}
              <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <Swords className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <p className="text-sm leading-relaxed text-slate-300">{coach}</p>
              </div>
            </section>

            {/* Lichess Opening Explorer — real-world stats for this exact position */}
            {started && explorerPct && (
              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <BookOpen className="h-4 w-4 text-slate-400" /> Opening Explorer
                </h2>
                <p className="mb-2.5 text-xs text-slate-400">
                  Played in {explorerPct.total.toLocaleString()} games — White {explorerPct.w}% / Draw{" "}
                  {explorerPct.d}% / Black {explorerPct.b}%
                </p>
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-slate-100" style={{ width: `${explorerPct.w}%` }} />
                  <div className="h-full bg-slate-500" style={{ width: `${explorerPct.d}%` }} />
                  <div className="h-full bg-slate-950" style={{ width: `${explorerPct.b}%` }} />
                </div>
              </section>
            )}

            {/* Move history */}
            <section className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-3 text-sm font-semibold text-slate-200">Move History</h2>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
                {pairedHistory.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-500">No moves yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {pairedHistory.map((row) => (
                        <tr key={row.no} className="border-b border-slate-800/50 last:border-0">
                          <td className="w-10 px-3 py-1.5 font-mono text-xs text-slate-500">{row.no}.</td>
                          <td className="px-2 py-1.5 font-mono text-slate-200">{row.w}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-400">{row.b ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* -------- Blunder modal -------- */}
      {blunder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-orange-500/30 bg-slate-900 p-6 shadow-2xl shadow-orange-500/10 duration-200 animate-in fade-in zoom-in">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/15">
                <AlertTriangle className="h-6 w-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-orange-300">Inaccuracy / Blunder</h3>
                <p className="text-xs text-slate-400">Your coach stopped the clock.</p>
              </div>
            </div>

            <div className="mb-5 flex gap-3 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
              <p className="text-sm leading-relaxed text-slate-200">{blunder.reason}</p>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                onClick={playAnyway}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-2.5 text-sm font-medium text-slate-300 transition-all hover:border-slate-600 hover:text-slate-100 active:scale-[0.98]"
              >
                Play it anyway <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={undoAndRetry}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-all hover:brightness-110 active:scale-[0.98]"
              >
                <RotateCcw className="h-4 w-4" /> Undo &amp; Retry
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-500">
              You're the player — the coach only advises.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
