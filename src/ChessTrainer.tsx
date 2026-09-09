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

/* ------------------------------------------------------------------ */
/*  Static config                                                      */
/* ------------------------------------------------------------------ */

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

// Main lines, validated move-by-move against chess.js so every SAN is the
// exact notation the engine produces (castling, captures, disambiguation).
const OPENINGS: Record<string, string[]> = {
  "Ruy Lopez": ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O"],
  "Italian Game": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O", "a4", "a5"],
  "Scotch Game": ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4", "Nf6", "Nxc6", "bxc6", "e5", "Qe7", "Qe2", "Nd5"],
  "Vienna Game": ["e4", "e5", "Nc3", "Nf6", "f4", "d5", "fxe5", "Nxe4", "Nf3", "Be7", "d3", "Nxc3"],
  "Sicilian Najdorf": ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be2", "e5", "Nb3", "Be7", "O-O", "O-O"],
  "French Defense": ["e4", "e6", "d4", "d5", "Nc3", "Nf6", "Bg5", "Be7", "e5", "Nfd7", "Bxe7", "Qxe7", "f4", "a6", "Nf3", "c5"],
  "Caro-Kann": ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6", "h4", "h6", "Nf3", "Nd7"],
  "Scandinavian": ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "Nf6", "Nf3", "c6", "Bc4", "Bf5", "Bd2", "e6"],
  "Pirc Defense": ["e4", "d6", "d4", "Nf6", "Nc3", "g6", "f4", "Bg7", "Nf3", "O-O", "Be2", "c5"],
  "Queen's Gambit Declined": ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "h6", "Bh4", "b6"],
  "Slav Defense": ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "dxc4", "a4", "Bf5", "e3", "e6", "Bxc4", "Bb4"],
  "King's Indian Defense": ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6"],
  "Nimzo-Indian Defense": ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "e3", "O-O", "Bd3", "d5", "Nf3", "c5", "O-O", "Nc6"],
  "London System": ["d4", "d5", "Nf3", "Nf6", "Bf4", "e6", "e3", "c5", "c3", "Nc6", "Nbd2", "Bd6", "Bg3", "O-O"],
  "English Opening": ["c4", "e5", "Nc3", "Nf6", "Nf3", "Nc6", "g3", "d5", "cxd5", "Nxd5", "Bg2", "Nb6", "O-O", "Be7"],
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

const PIECE_NAME: Record<string, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

/* Electric, high-voltage vision palette (neon over slate squares). */
const ELECTRIC = {
  lastFill: "rgba(179, 102, 255, 0.30)", // electric violet — last move
  lastRing: "rgba(179, 102, 255, 0.75)",
};
/* ------------------------------------------------------------------ */
/*  Team color theory — side-based brand palettes.                     */
/*                                                                     */
/*  YOU always play in a cool Pacific-NW ramp; the BOT always plays in */
/*  a warm cyberpunk ramp. Within a side, piece type is placed along   */
/*  that side's 3-color ramp (pawn → king), so you still read WHICH    */
/*  piece controls a square while side identity is instant (cool vs    */
/*  warm). Opacity encodes control density (more attackers → vivid).   */
/*  A value-tie between sides is a standoff → neutral silver.          */
/* ------------------------------------------------------------------ */

// Ramps ordered for a smooth sweep across the provided brand colors.
const PLAYER_RAMP = ["#55cc21", "#7cd3d3", "#3151bf"]; // Rave Green → Heritage Aqua → Pacific Blue
const ENEMY_RAMP = ["#ff3503", "#ad0afe", "#0691db"]; // Electric Orange → Neon Purple → Electric Blue
const PIECE_ORDER = ["p", "n", "b", "r", "q", "k"]; // ramp position, cheapest → richest

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Sample a multi-stop color ramp at t ∈ [0,1]. */
function rampRgb(ramp: string[], t: number): [number, number, number] {
  const seg = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[i + 1]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Brand color for a piece on a given side, at an opacity. */
function pieceColor(side: "you" | "enemy", type: string, alpha = 1): string {
  const t = Math.max(0, PIECE_ORDER.indexOf(type)) / (PIECE_ORDER.length - 1);
  const [r, g, b] = rampRgb(side === "you" ? PLAYER_RAMP : ENEMY_RAMP, t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Suggestion arrows (always the player's moves) use the player ramp;
// best-move rank is encoded by opacity so same-piece candidates stay distinct.
const BEST_ARROW_ALPHA = [0.95, 0.7, 0.5];
const arrowColor = (pieceType: string, alpha = 1) => pieceColor("you", pieceType, alpha);

const lowestValueType = (types: string[]): string =>
  types.reduce((best, t) => (PIECE_VALUE[t] < PIECE_VALUE[best] ? t : best), types[0]);

/** Heatmap color for a square, from who attacks it (piece types per side). */
function controlColor(yourTypes: string[] | undefined, enemyTypes: string[] | undefined): string | null {
  const yours = yourTypes ?? [];
  const enemies = enemyTypes ?? [];
  const density = yours.length + enemies.length;
  if (density === 0) return null;

  const alpha = Math.min(0.72, 0.32 + 0.11 * (density - 1)); // vibrancy ← density
  const yourMinType = yours.length ? lowestValueType(yours) : null;
  const enemyMinType = enemies.length ? lowestValueType(enemies) : null;
  const yourMin = yourMinType ? PIECE_VALUE[yourMinType] : Infinity;
  const enemyMin = enemyMinType ? PIECE_VALUE[enemyMinType] : Infinity;

  if (yourMin === enemyMin) return `rgba(203, 213, 225, ${alpha})`; // standoff — silver
  const you = yourMin < enemyMin;
  return pieceColor(you ? "you" : "enemy", (you ? yourMinType : enemyMinType) as string, alpha);
}

/* ------------------------------------------------------------------ */
/*  Board-control / attack helpers (geometry, not legal-move based)    */
/*                                                                     */
/*  Returns a map: squareName -> array of attacker piece types.        */
/*  "Control" includes defended own pieces (sliders stop AT the first  */
/*  occupied square, which is still counted as controlled).            */
/* ------------------------------------------------------------------ */

type AttackMap = Record<string, string[]>;

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const sqName = (r: number, c: number) => `${FILES[c]}${8 - r}`;
const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

function buildAttackMap(game: Chess, color: "w" | "b"): AttackMap {
  const board = game.board(); // board[0] = rank 8, [7] = rank 1
  const map: AttackMap = {};
  const add = (r: number, c: number, type: string) => {
    if (!inBounds(r, c)) return;
    const key = sqName(r, c);
    (map[key] ||= []).push(type);
  };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;

      switch (piece.type) {
        case "p": {
          const dir = color === "w" ? -1 : 1; // white advances toward rank 8 (lower r)
          add(r + dir, c - 1, "p");
          add(r + dir, c + 1, "p");
          break;
        }
        case "n":
          KNIGHT_OFFSETS.forEach(([dr, dc]) => add(r + dr, c + dc, "n"));
          break;
        case "k":
          KING_OFFSETS.forEach(([dr, dc]) => add(r + dr, c + dc, "k"));
          break;
        case "b":
        case "r":
        case "q": {
          const dirs =
            piece.type === "b"
              ? BISHOP_DIRS
              : piece.type === "r"
              ? ROOK_DIRS
              : [...BISHOP_DIRS, ...ROOK_DIRS];
          dirs.forEach(([dr, dc]) => {
            let nr = r + dr;
            let nc = c + dc;
            while (inBounds(nr, nc)) {
              add(nr, nc, piece.type);
              if (board[nr][nc]) break; // stop at first occupied square (still controlled)
              nr += dr;
              nc += dc;
            }
          });
          break;
        }
      }
    }
  }
  return map;
}

/** Squares where `color` has a hanging piece (attacked & (undefended OR by lower value)). */
function findHangingPieces(game: Chess, color: "w" | "b") {
  const board = game.board();
  const oppMap = buildAttackMap(game, color === "w" ? "b" : "w");
  const ownMap = buildAttackMap(game, color);
  const hanging: { square: string; type: string; minAttacker: number; defended: boolean }[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color || piece.type === "k") continue;
      const name = sqName(r, c);
      const attackers = oppMap[name];
      if (!attackers?.length) continue;

      const minAttacker = Math.min(...attackers.map((t) => PIECE_VALUE[t]));
      const defended = !!ownMap[name]?.length;
      const pieceVal = PIECE_VALUE[piece.type];

      if (!defended || minAttacker < pieceVal) {
        hanging.push({ square: name, type: piece.type, minAttacker, defended });
      }
    }
  }
  return hanging;
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

/* ------------------------------------------------------------------ */
/*  Opening book — the next main-line move for the side to move.       */
/* ------------------------------------------------------------------ */

interface BookHint {
  from: Square;
  to: Square;
  san: string;
  piece: string; // moving piece type — drives the arrow hue
}

/** The next book move, but only while the game is still ON the main line. */
function nextBookMove(game: Chess, openingName: string): BookHint | null {
  const line = OPENINGS[openingName];
  if (!line) return null;
  const history = game.history();
  if (history.length >= line.length) return null;
  for (let i = 0; i < history.length; i++) {
    if (history[i] !== line[i]) return null; // player/bot has left the book
  }
  const san = line[history.length];
  const mv = game.moves({ verbose: true }).find((m) => m.san === san);
  return mv ? { from: mv.from, to: mv.to, san, piece: mv.piece } : null;
}

/* ------------------------------------------------------------------ */
/*  Bot engine — MOCK ASYNC STUB.                                      */
/*                                                                     */
/*  Replace the body of getBotMove() with a Stockfish Web Worker:      */
/*    const worker = new Worker('/stockfish.js');                      */
/*    worker.postMessage(`position fen ${fen}`);                       */
/*    worker.postMessage(`go depth ${eloToDepth(elo)}`);               */
/*    // resolve on 'bestmove ...'                                     */
/*  It already returns a valid chess.js verbose move, so the plug-in   */
/*  point is fully isolated here.                                      */
/* ------------------------------------------------------------------ */

type VerboseMove = ReturnType<Chess["moves"]> extends (infer T)[] ? T : never;

function pickMove(game: Chess, elo: number, opening: string): VerboseMove | null {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;

  // 1) Follow the selected opening book. Book index (ply) is derived from the
  //    FEN so it survives reconstructing the game from a bare FEN string.
  const parts = game.fen().split(" ");
  const fullmove = parseInt(parts[5] || "1", 10);
  const turn = parts[1];
  const ply = (fullmove - 1) * 2 + (turn === "b" ? 1 : 0);

  const book = OPENINGS[opening] || [];
  if (ply < book.length) {
    const nextSan = book[ply];
    const bookMove = moves.find((m) => m.san === nextSan);
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

function getBotMove(fen: string, elo: number, opening: string): Promise<VerboseMove | null> {
  return new Promise((resolve) => {
    // Simulated engine "think time" — swap for a real Web Worker later.
    const think = 300 + Math.random() * 500;
    setTimeout(() => {
      const g = new Chess(fen);
      resolve(pickMove(g, elo, opening));
    }, think);
  });
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
  const [opening, setOpening] = useState<keyof typeof OPENINGS>("Ruy Lopez");
  const [started, setStarted] = useState(false);

  // Training visuals — three independent vision layers
  const [showControl, setShowControl] = useState(true); // control heatmap (colors)
  const [showAttacks, setShowAttacks] = useState(true); // under-attack markers
  const [showLast, setShowLast] = useState(true); // last-move highlight
  const [openingGuide, setOpeningGuide] = useState(true); // guide me through the book
  const [bestMoves, setBestMoves] = useState<RankedMove[]>([]);

  // Coach + blunder flow
  const [coach, setCoach] = useState("Configure your session and press Start Training.");
  const [thinking, setThinking] = useState(false);
  const [blunder, setBlunder] = useState<{ reason: string; from: Square; to: Square } | null>(null);

  const botColor = playerColor === "w" ? "b" : "w";
  const orientation = playerColor === "w" ? "white" : "black";

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

  // Trigger the bot whenever it is its turn.
  useEffect(() => {
    if (!started || blunder) return;
    if (gameRef.current.isGameOver()) return;
    if (gameRef.current.turn() === botColor) {
      runBot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, started, blunder, botColor]);

  /* ---- Commit a move to the real game ------------------------------ */
  const commitMove = useCallback(
    (from: Square, to: Square) => {
      const mv = gameRef.current.move({ from, to, promotion: "q" });
      syncState();
      return mv;
    },
    [syncState]
  );

  /* ---- User move + blunder correction ------------------------------ */
  const onDrop = useCallback(
    (sourceSquare: string, targetSquare: string) => {
      if (!started || blunder || thinking) return false;
      if (gameRef.current.turn() !== playerColor) return false;

      const from = sourceSquare as Square;
      const to = targetSquare as Square;

      // Validate on a clone first so an illegal move never mutates state.
      const clone = new Chess(gameRef.current.fen());
      let result;
      try {
        result = clone.move({ from, to, promotion: "q" });
      } catch {
        return false; // illegal move
      }
      if (!result) return false;

      // ---- Blunder detection: does this move hang material? ----
      const hangingAfter = findHangingPieces(clone, playerColor);
      const seriousHang = hangingAfter.find(
        (h) => PIECE_VALUE[h.type] >= 3 && (!h.defended || h.minAttacker < PIECE_VALUE[h.type])
      );
      const randomBlunder = Math.random() < 0.05 && result.captured === undefined;

      if (seriousHang || randomBlunder) {
        const reason = seriousHang
          ? `That move leaves your ${PIECE_NAME[seriousHang.type]} on ${seriousHang.square} hanging — it's attacked by a ${
              seriousHang.minAttacker < PIECE_VALUE[seriousHang.type] ? "lower-value piece" : "piece"
            } and ${seriousHang.defended ? "under-defended" : "completely undefended"}.`
          : "This drops the evaluation. There's a stronger, safer continuation here.";
        // Pause and let the player decide — undo, or override the coach.
        setBlunder({ reason, from, to });
        setCoach("Coach flagged this move. Undo and rethink, or override and play it anyway — your call.");
        return false; // don't commit yet; the modal decides
      }

      // Opening-guide feedback (read from the live game, before we commit).
      const expected = openingGuide ? nextBookMove(gameRef.current, opening) : null;

      commitMove(from, to);

      let msg = result.captured
        ? `Nice — you won a ${PIECE_NAME[result.captured]}. Keep your pieces coordinated.`
        : "Solid. The bot is thinking…";
      if (expected) {
        msg =
          result.san === expected.san
            ? `📖 On book — ${result.san} is the ${opening} main line. Bot to reply…`
            : `You left the ${opening} book (main line was ${expected.san}). Own your plan — bot to reply…`;
      }
      setCoach(msg);
      return true;
    },
    [started, blunder, thinking, playerColor, commitMove, openingGuide, opening]
  );

  const undoAndRetry = () => {
    setBlunder(null);
    setCoach("Good — reassess the position. Find a move that keeps every piece defended.");
  };

  // Player overrides the coach and plays the flagged move anyway.
  const playAnyway = () => {
    if (!blunder) return;
    const { from, to } = blunder;
    setBlunder(null);
    const mv = commitMove(from, to);
    setCoach(
      mv?.captured
        ? `Override accepted — you grabbed the ${PIECE_NAME[mv.captured]}. Bold; let's see if it holds up.`
        : "Override accepted — you played through the warning. Own the plan; the bot is thinking…"
    );
  };

  // Compute + show (or hide) the top best moves as arrows and coach text.
  const toggleBestMoves = () => {
    if (bestMoves.length) {
      setBestMoves([]);
      return;
    }
    if (!started || blunder || thinking) return;
    if (gameRef.current.turn() !== playerColor || gameRef.current.isGameOver()) return;
    const ranked = rankPlayerMoves(gameRef.current, playerColor).slice(0, 3);
    setBestMoves(ranked);
    if (ranked.length) {
      const top = ranked[0];
      setCoach(
        `Top candidates: ${ranked.map((r) => r.san).join(", ")}. I'd play ${top.san} — ${moveReason(top)}`
      );
    }
  };

  /* ---- Vision layers → per-square styles ---------------------------- */
  const squareStyles = useMemo(() => {
    if (!started) return {};
    const styles: Record<string, React.CSSProperties> = {};

    // Layer 1 — control heatmap: hue = dominant piece, tone = side, alpha = density.
    if (showControl) {
      const playerMap = buildAttackMap(gameRef.current, playerColor);
      const oppMap = buildAttackMap(gameRef.current, botColor);
      const all = new Set([...Object.keys(playerMap), ...Object.keys(oppMap)]);
      all.forEach((sq) => {
        const color = controlColor(playerMap[sq], oppMap[sq]);
        if (color) styles[sq] = { background: color };
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

    // Layer 3 — under-attack glow, pulsing in the hanging piece's own hue (wins).
    if (showAttacks) {
      findHangingPieces(gameRef.current, playerColor).forEach((h) => {
        const ring = pieceColor("you", h.type, 1); // your hanging piece, your palette
        styles[h.square] = {
          ...(styles[h.square] || {}),
          ["--atk" as string]: ring, // drives the ct-pulse keyframe
          boxShadow: `inset 0 0 0 3px ${ring}`,
          animation: "ct-pulse 1.4s ease-in-out infinite",
          borderRadius: "4px",
        } as React.CSSProperties;
      });
    }

    return styles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, showControl, showLast, showAttacks, started, playerColor, botColor]);

  // Opening-guide hint — the book move for the player, while still in book.
  const bookHint = useMemo<BookHint | null>(() => {
    if (!started || blunder || !openingGuide) return null;
    if (gameRef.current.isGameOver()) return null;
    if (gameRef.current.turn() !== playerColor) return null;
    return nextBookMove(gameRef.current, opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, started, blunder, openingGuide, playerColor, opening]);

  // Board arrows, unified to the piece-hue language: every arrow is colored by
  // its moving piece. Best-move rank is encoded by opacity; the book move is
  // drawn at full strength.
  const arrows = useMemo(() => {
    const list: [Square, Square, string][] = bestMoves
      .slice(0, 3)
      .map((m, i) => [m.from, m.to, arrowColor(m.piece, BEST_ARROW_ALPHA[i])]);
    if (bookHint) list.unshift([bookHint.from, bookHint.to, arrowColor(bookHint.piece)]);
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

  const status = gameRef.current.isCheckmate()
    ? "Checkmate"
    : gameRef.current.isDraw()
    ? "Draw"
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
      {/* Under-attack pulse — ring color comes from each square's --atk var. */}
      <style>{`
        @keyframes ct-pulse {
          0%, 100% { box-shadow: inset 0 0 0 3px var(--atk, #ff8a00); }
          50%      { box-shadow: inset 0 0 0 4px var(--atk, #ff8a00), 0 0 11px 1px var(--atk, #ff8a00); }
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
            <div className="w-full max-w-[560px] rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-2xl shadow-black/40">
              <Chessboard
                position={fen}
                onPieceDrop={onDrop}
                boardOrientation={orientation}
                arePiecesDraggable={
                  started && !blunder && !thinking && gameRef.current.turn() === playerColor
                }
                customSquareStyles={squareStyles}
                customArrows={arrows}
                customArrowColor="hsl(200, 16%, 66%)"
                customBoardStyle={{ borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                customLightSquareStyle={{ backgroundColor: "#c3ccda" }}
              />
            </div>

            {/* Vision legend — mirrors the active layers */}
            {started && (showControl || showAttacks || showLast || bestMoves.length > 0 || bookHint) && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-400">
                {showControl && (
                  <span className="flex items-center gap-3">
                    {(["you", "enemy"] as const).map((side) => (
                      <span key={side} className="flex items-center gap-1">
                        <span className="text-slate-500">{side === "you" ? "You" : "Bot"}</span>
                        {PIECE_ORDER.map((t) => (
                          <span
                            key={t}
                            title={`${side === "you" ? "Your" : "Bot"} ${PIECE_NAME[t]}`}
                            className="h-3 w-3 rounded-sm"
                            style={{ background: pieceColor(side, t, 0.95) }}
                          />
                        ))}
                      </span>
                    ))}
                    <span className="text-slate-500">P→K · brighter = more attackers</span>
                  </span>
                )}
                {showAttacks && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ boxShadow: "inset 0 0 0 2px hsl(0,0%,80%)" }}
                    />{" "}
                    Under attack (pulses in the piece's color)
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
                onChange={(e) => setOpening(e.target.value as keyof typeof OPENINGS)}
                className="mb-4 w-full rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                {Object.keys(OPENINGS).map((o) => (
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
                      { on: showControl, set: setShowControl, label: "Heatmap", dot: "linear-gradient(90deg,#00ff9c,#00e0ff)", ring: "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" },
                      { on: showAttacks, set: setShowAttacks, label: "Threats", dot: "#ff8a00", ring: "border-orange-400/50 bg-orange-400/10 text-orange-200" },
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
                  disabled={!started || !!blunder}
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
                    book (green arrow).
                  </span>
                </div>
              )}
              <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <Swords className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <p className="text-sm leading-relaxed text-slate-300">{coach}</p>
              </div>
            </section>

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
