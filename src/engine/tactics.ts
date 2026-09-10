/* ------------------------------------------------------------------ */
/*  Tactical opportunity detector — the Coach's "what can I do?" layer. */
/*                                                                      */
/*  Deliberately UI-free and engine-light: forks and pins are found by  */
/*  board geometry (chess.js), and mate-in-N is confirmed by the real   */
/*  engine's mate score (never guessed from a pattern). The output is a  */
/*  list of TacticalOpportunity objects that NAME the pattern for the    */
/*  player to discover — they never encode the solving move, so the      */
/*  Coach can nudge ("there's a fork available") without spoiling it.    */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";
import type { EngineLine } from "./stockfish";

export type TacticalType = "mate" | "fork" | "pin";
export type TacticalSide = "player" | "opponent";

export interface TacticalOpportunity {
  type: TacticalType;
  side: TacticalSide;
  /** For mates: the forced mate distance (in moves). */
  mateIn?: number;
  /** Coach sentence — names the pattern, never the move. */
  message: string;
  /** Higher = more urgent; drives ordering when several coexist. */
  severity: number;
  /** Squares involved, for optional (non-spoiling) reference. */
  squares: string[];
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PIECE_NAME: Record<string, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};
const FILES = "abcdefgh";

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

type Color = "w" | "b";
type Piece = { type: string; color: Color } | null;
type Board = Piece[][];

const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const sqName = (r: number, c: number) => `${FILES[c]}${8 - r}`;
const rowOf = (square: string) => 8 - Number(square[1]);
const colOf = (square: string) => FILES.indexOf(square[0]);

/** Piece types of `byColor` that attack `square` (defence counts as attack). */
function attackersOf(board: Board, square: string, byColor: Color): string[] {
  const r = rowOf(square);
  const c = colOf(square);
  const hits: string[] = [];

  // Pawns: a byColor pawn attacks `square` from one rank "behind" it (relative
  // to that pawn's advance direction). White advances toward rank 8 (lower r).
  const pawnRow = byColor === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (inB(pawnRow, c + dc)) {
      const p = board[pawnRow][c + dc];
      if (p && p.color === byColor && p.type === "p") hits.push("p");
    }
  }
  // Knights
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    if (inB(r + dr, c + dc)) {
      const p = board[r + dr][c + dc];
      if (p && p.color === byColor && p.type === "n") hits.push("n");
    }
  }
  // King
  for (const [dr, dc] of KING_OFFSETS) {
    if (inB(r + dr, c + dc)) {
      const p = board[r + dr][c + dc];
      if (p && p.color === byColor && p.type === "k") hits.push("k");
    }
  }
  // Sliders: first occupied square along each ray.
  const scan = (dirs: number[][], kinds: string[]) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (inB(nr, nc)) {
        const p = board[nr][nc];
        if (p) {
          if (p.color === byColor && kinds.includes(p.type)) hits.push(p.type);
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  };
  scan(BISHOP_DIRS, ["b", "q"]);
  scan(ROOK_DIRS, ["r", "q"]);
  return hits;
}

/** Enemy pieces attacked by the (friendly) piece standing on `from`. */
function targetsFrom(board: Board, from: string): { square: string; type: string }[] {
  const r = rowOf(from);
  const c = colOf(from);
  const piece = board[r][c];
  if (!piece) return [];
  const enemy: Color = piece.color === "w" ? "b" : "w";
  const out: { square: string; type: string }[] = [];
  const push = (nr: number, nc: number) => {
    if (!inB(nr, nc)) return false;
    const p = board[nr][nc];
    if (p) {
      if (p.color === enemy) out.push({ square: sqName(nr, nc), type: p.type });
      return true; // occupied — stop a slider ray here
    }
    return false;
  };

  switch (piece.type) {
    case "p": {
      const dir = piece.color === "w" ? -1 : 1;
      push(r + dir, c - 1);
      push(r + dir, c + 1);
      break;
    }
    case "n":
      for (const [dr, dc] of KNIGHT_OFFSETS) push(r + dr, c + dc);
      break;
    case "k":
      for (const [dr, dc] of KING_OFFSETS) push(r + dr, c + dc);
      break;
    default: {
      const dirs =
        piece.type === "b" ? BISHOP_DIRS : piece.type === "r" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
      for (const [dr, dc] of dirs) {
        let nr = r + dr;
        let nc = c + dc;
        while (inB(nr, nc)) {
          if (push(nr, nc)) break;
          nr += dr;
          nc += dc;
        }
      }
    }
  }
  return out;
}

/**
 * Fork opportunities: a legal move after which the moved piece attacks two or
 * more valuable enemy targets and is itself safe on its new square. We only
 * name that a fork exists — never which move makes it.
 */
function findForks(fen: string, color: Color): TacticalOpportunity[] {
  const game = new Chess(fen);
  if (game.turn() !== color) return [];
  const enemy: Color = color === "w" ? "b" : "w";
  const found: TacticalOpportunity[] = [];
  const seen = new Set<string>();

  for (const m of game.moves({ verbose: true })) {
    const clone = new Chess(fen);
    try {
      if (!clone.move({ from: m.from, to: m.to, promotion: m.promotion })) continue;
    } catch {
      continue;
    }
    const board = clone.board() as Board;
    const forker = board[rowOf(m.to)][colOf(m.to)];
    if (!forker) continue;
    const forkerVal = VALUE[forker.type];

    // Qualifying targets: the enemy king, a piece worth more than the forker,
    // or an undefended piece (a clean win).
    const targets = targetsFrom(board, m.to).filter((t) => {
      if (t.type === "k") return true;
      if (VALUE[t.type] > forkerVal) return true;
      return attackersOf(board, t.square, enemy).length === 0; // undefended
    });
    if (targets.length < 2) continue;
    // Require the fork to actually win material of a minor+ (skip "two pawns").
    const hasHeavyTarget = targets.some((t) => t.type === "k" || VALUE[t.type] >= 3);
    if (!hasHeavyTarget) continue;

    // Safety: the forker must not simply hang on its new square.
    const enemyAtt = attackersOf(board, m.to, enemy);
    if (enemyAtt.length) {
      const minEnemy = Math.min(...enemyAtt.map((t) => VALUE[t]));
      const defended = attackersOf(board, m.to, color).length > 0;
      if (minEnemy < forkerVal && !defended) continue; // captured for free / for profit
    }

    const key = targets.map((t) => t.square).sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      type: "fork",
      side: "player",
      message: "There's a fork available — one of your pieces can hit two targets at once. Can you spot it?",
      severity: 60,
      squares: targets.map((t) => t.square),
    });
  }
  return found;
}

/**
 * Pins already on the board: an enemy piece skewered against its king (absolute)
 * or against a more valuable enemy piece (relative) by one of `color`'s sliders.
 * Naming the pinned piece is a teaching cue, not the winning move.
 */
function findPins(fen: string, color: Color): TacticalOpportunity[] {
  const game = new Chess(fen);
  const board = game.board() as Board;
  const enemy: Color = color === "w" ? "b" : "w";
  const found: TacticalOpportunity[] = [];
  const seen = new Set<string>();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      if (piece.type !== "b" && piece.type !== "r" && piece.type !== "q") continue;
      const dirs =
        piece.type === "b" ? BISHOP_DIRS : piece.type === "r" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];

      for (const [dr, dc] of dirs) {
        let nr = r + dr;
        let nc = c + dc;
        let first: { square: string; type: string } | null = null;
        while (inB(nr, nc)) {
          const p = board[nr][nc];
          if (p) {
            if (!first) {
              if (p.color !== enemy) break; // own piece blocks — no pin on this ray
              first = { square: sqName(nr, nc), type: p.type };
            } else {
              // Second piece behind the first along the same ray.
              if (p.color === enemy && (p.type === "k" || VALUE[p.type] > VALUE[first.type])) {
                const absolute = p.type === "k";
                if (!seen.has(first.square)) {
                  seen.add(first.square);
                  found.push({
                    type: "pin",
                    side: "player",
                    message: absolute
                      ? `There's a pin on the board — the bot's ${PIECE_NAME[first.type]} on ${first.square} is pinned to its king and can't move. How can you pile on?`
                      : `There's a pin available — the bot's ${PIECE_NAME[first.type]} on ${first.square} is pinned to a bigger piece. Can you exploit it?`,
                    severity: absolute ? 50 : 40,
                    squares: [first.square, sqName(nr, nc)],
                  });
                }
              }
              break;
            }
          }
          nr += dr;
          nc += dc;
        }
      }
    }
  }
  return found;
}

/** Synchronous (chess.js only) tactical opportunities for `color` to move: forks + pins. */
export function detectPatternTactics(fen: string, color: Color): TacticalOpportunity[] {
  return prioritize([...findForks(fen, color), ...findPins(fen, color)]);
}

/**
 * Turn the engine's PV mate score into an opportunity/threat. The engine scores
 * from the side-to-move's perspective, so a positive mate ≤ 3 is the player's
 * forced mate; a negative one is the bot's mating threat against the player.
 */
export function mateHintFromLines(lines: EngineLine[]): TacticalOpportunity | null {
  const top = lines[0];
  if (!top || top.mate === undefined || top.mate === 0) return null;
  const n = Math.abs(top.mate);
  if (n > 3) return null;
  if (top.mate > 0) {
    return {
      type: "mate",
      side: "player",
      mateIn: n,
      message: `You have a forced mate in ${n} here — can you find it?`,
      severity: 100 - n, // shorter mate = more urgent
      squares: [],
    };
  }
  return {
    type: "mate",
    side: "opponent",
    mateIn: n,
    message: `⚠ Careful — the bot has a forced mate in ${n}. Look for the most stubborn defense.`,
    severity: 95 - n,
    squares: [],
  };
}

/** Sort by urgency and keep only the top couple, so the Coach never spams. */
export function prioritize(list: TacticalOpportunity[]): TacticalOpportunity[] {
  return [...list].sort((a, b) => b.severity - a.severity).slice(0, 2);
}
