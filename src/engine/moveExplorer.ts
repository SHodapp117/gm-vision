/* ------------------------------------------------------------------ */
/*  Move Explorer — the Coach's "what can I do?" layer.                 */
/*                                                                     */
/*  Given a clicked piece, rank ITS legal moves best→worst with a       */
/*  one-line reason each. Uses a single MultiPV search at the root (one  */
/*  eval per root move) rather than a separate search per move, then     */
/*  filters to the selected square and categorises by mate-aware        */
/*  eval-loss vs the best move. Unlike the Tactical Radar this is meant  */
/*  to show options, so it ranks openly — but it still leaves the        */
/*  playing to you.                                                     */
/* ------------------------------------------------------------------ */

import { Chess, type Square } from "chess.js";
import { type AnalyzeOptions, type AnalyzeResult, type EngineLine } from "./stockfish";
import { PIECE_NAME, PIECE_VALUE, findHangingPieces } from "../game/boardAnalysis";

export type MoveCategory =
  | "best"
  | "excellent"
  | "good"
  | "playable"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export const CATEGORY_LABEL: Record<MoveCategory, string> = {
  best: "Best",
  excellent: "Excellent",
  good: "Good",
  playable: "Playable",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** Eval-loss (centipawns, vs the best move) at or below which each tier applies. */
export const LOSS_THRESHOLDS: { category: MoveCategory; maxLoss: number }[] = [
  { category: "best", maxLoss: 20 }, // equivalence band — near-equal moves aren't split
  { category: "excellent", maxLoss: 45 },
  { category: "good", maxLoss: 90 },
  { category: "playable", maxLoss: 150 },
  { category: "inaccuracy", maxLoss: 250 },
  { category: "mistake", maxLoss: 500 },
];

export interface ExploredMove {
  san: string;
  from: Square;
  to: Square;
  uci: string;
  category: MoveCategory;
  /** Eval after the move from the mover's POV (mate encoded as a large value). */
  scoreCp: number;
  /** Eval loss vs the best available move (>= 0). */
  lossCp: number;
  reason: string;
}

export interface RankPieceMovesArgs {
  analyze: (fen: string, opts: AnalyzeOptions) => Promise<AnalyzeResult>;
  fen: string;
  square: Square;
  movetime?: number;
  /** Cap on MultiPV lines requested (defaults high enough to cover every root move). */
  multipvCap?: number;
}

/** Collapse a cp/mate engine score to one comparable centipawn scale (mover POV). */
function scoreOf(line: Pick<EngineLine, "cp" | "mate">): number {
  if (line.mate !== undefined) {
    // Faster mates rank further from 0; being mated (mate<0) is deeply negative.
    return line.mate > 0 ? 100000 - line.mate : -100000 - line.mate;
  }
  return line.cp ?? 0;
}

function categorise(lossCp: number): MoveCategory {
  for (const { category, maxLoss } of LOSS_THRESHOLDS) {
    if (lossCp <= maxLoss) return category;
  }
  return "blunder";
}

const CENTER = new Set(["d4", "e4", "d5", "e5"]);
const hangValue = (game: Chess, color: "w" | "b") =>
  findHangingPieces(game, color).reduce((sum, h) => sum + PIECE_VALUE[h.type], 0);

/** One human reason for a move, from board features + its category. */
function explain(
  fen: string,
  move: { from: string; to: string; san: string; piece: string; captured?: string; promotion?: string; color: "w" | "b" },
  category: MoveCategory
): string {
  if (move.san.includes("#")) return "Checkmate — the game ends here.";

  const winning = category === "best" || category === "excellent" || category === "good";
  if (move.captured) {
    return winning
      ? `Wins the ${PIECE_NAME[move.captured]}.`
      : `Captures the ${PIECE_NAME[move.captured]}, but weigh the reply.`;
  }
  if (move.promotion) return `Promotes to a ${PIECE_NAME[move.promotion] ?? "Queen"}.`;
  if (move.san === "O-O" || move.san === "O-O-O") return "Castles — tucks the king to safety.";

  // Did this move create a new threat (opponent piece newly hanging)?
  const opp: "w" | "b" = move.color === "w" ? "b" : "w";
  const before = new Chess(fen);
  const after = new Chess(fen);
  try {
    after.move({ from: move.from, to: move.to, promotion: move.promotion });
  } catch {
    // Should not happen (caller passes legal moves); fall through to eval phrasing.
  }
  const oppHangUp = hangValue(after, opp) - hangValue(before, opp);
  if (oppHangUp > 0) {
    const target = findHangingPieces(after, opp).sort((a, b) => PIECE_VALUE[b.type] - PIECE_VALUE[a.type])[0];
    if (target) return `Threatens the ${PIECE_NAME[target.type]} on ${target.square}.`;
  }
  // Did it rescue one of our own pieces that was under attack?
  if (hangValue(before, move.color) - hangValue(after, move.color) > 0) {
    return "Defends a piece that was under attack.";
  }

  if (move.san.includes("+")) return "Checks the king and keeps the initiative.";

  const backRank = move.color === "w" ? "1" : "8";
  if (move.piece !== "p" && move.piece !== "k" && move.from[1] === backRank) {
    return `Develops the ${PIECE_NAME[move.piece]}.`;
  }
  if (move.piece === "p" && CENTER.has(move.to)) return "Fights for the center.";

  switch (category) {
    case "best":
    case "excellent":
      return "Keeps your position healthy and active.";
    case "good":
    case "playable":
      return "A safe, reasonable move.";
    case "inaccuracy":
      return "Slightly loosens your position.";
    case "mistake":
      return "Hands the bot the initiative.";
    default:
      return "Gives up material or worse.";
  }
}

/**
 * Rank the legal moves of the piece on `square`, best→worst. One MultiPV search
 * at the root gives an eval per root move; we filter to this piece and
 * categorise by eval-loss vs the best move on the board.
 */
export async function rankPieceMoves({
  analyze,
  fen,
  square,
  movetime = 800,
  multipvCap = 64,
}: RankPieceMovesArgs): Promise<ExploredMove[]> {
  const game = new Chess(fen);
  const allMoves = game.moves({ verbose: true });
  if (!allMoves.length) return [];
  const pieceMoves = allMoves.filter((m) => m.from === square);
  if (!pieceMoves.length) return [];

  const multipv = Math.min(multipvCap, allMoves.length);
  const result = await analyze(fen, { multipv, movetime, channel: "explorer" });

  // Map every returned root move (by uci) to its comparable score.
  const scoreByUci = new Map<string, number>();
  for (const line of result.lines) {
    if (line.moveUci) scoreByUci.set(line.moveUci, scoreOf(line));
  }
  // Best score across ALL root moves the engine surfaced (the yardstick for loss).
  const bestScore = result.lines.length ? Math.max(...result.lines.map((l) => scoreOf(l))) : 0;

  const explored: ExploredMove[] = pieceMoves.map((m) => {
    const uci = `${m.from}${m.to}${m.promotion ?? ""}`;
    const score = scoreByUci.get(uci) ?? scoreByUci.get(`${m.from}${m.to}`);
    // A move the engine didn't surface (rare: capped MultiPV) is treated as a
    // clear tail move rather than dropped, so the list still shows every option.
    const scoreCp = score ?? bestScore - 600;
    const lossCp = Math.max(0, bestScore - scoreCp);
    const category = categorise(lossCp);
    return {
      san: m.san,
      from: m.from,
      to: m.to,
      uci,
      category,
      scoreCp,
      lossCp,
      reason: explain(fen, { ...m }, category),
    };
  });

  return explored.sort((a, b) => b.scoreCp - a.scoreCp);
}
