/* ------------------------------------------------------------------ */
/*  Move classification — centipawn-loss of the played move vs the      */
/*  engine's best move in the position before it.                       */
/*                                                                      */
/*  Approach: analyze the position BEFORE the move (gives the engine's  */
/*  top choice and its score, from the mover's POV) and the position    */
/*  AFTER the played move (gives the resulting score, from the          */
/*  opponent's POV — negate it to compare apples to apples). The gap    */
/*  between the two is the played move's centipawn loss. This needs no  */
/*  search of the played move specifically, so it's just two ordinary   */
/*  analyze() calls.                                                    */
/* ------------------------------------------------------------------ */

import type { AnalyzeOptions, AnalyzeResult, EngineLine } from "./stockfish";

export type MoveQuality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

/** A large-but-finite stand-in so mate scores still compare sanely against cp scores. */
const MATE_CP_EQUIVALENT = 100000;

export interface MoveEvaluation {
  quality: MoveQuality;
  /** Always >= 0. */
  cpLoss: number;
  bestMoveUci?: string;
  bestLineCp?: number;
  bestLineMate?: number;
  /** If the played move allows the opponent a forced mate, the mate distance (in moves, > 0). */
  allowsMateIn?: number;
}

function lineToCp(line: EngineLine | undefined): number {
  if (!line) return 0;
  if (line.mate !== undefined) {
    return line.mate > 0 ? MATE_CP_EQUIVALENT - line.mate : -MATE_CP_EQUIVALENT - line.mate;
  }
  return line.cp ?? 0;
}

function normalizeUci(uci: string): string {
  return uci.trim().toLowerCase();
}

export function classifyByCpLoss(cpLoss: number): MoveQuality {
  if (cpLoss >= 300) return "blunder";
  if (cpLoss >= 100) return "mistake";
  if (cpLoss >= 50) return "inaccuracy";
  if (cpLoss <= 10) return "best";
  return "good";
}

export type AnalyzeFn = (fen: string, opts?: AnalyzeOptions) => Promise<AnalyzeResult>;

export interface EvaluateMoveParams {
  analyze: AnalyzeFn;
  fenBefore: string;
  fenAfter: string;
  /** The move actually played, in raw UCI form (e.g. "e2e4", "e7e8q"). */
  playedMoveUci: string;
  movetime?: number;
  depth?: number;
}

export async function evaluateMove({
  analyze,
  fenBefore,
  fenAfter,
  playedMoveUci,
  movetime = 500,
  depth,
}: EvaluateMoveParams): Promise<MoveEvaluation> {
  const [beforeResult, afterResult] = await Promise.all([
    analyze(fenBefore, { multipv: 1, movetime, depth, channel: "classify-before" }),
    analyze(fenAfter, { multipv: 1, movetime, depth, channel: "classify-after" }),
  ]);

  const bestLine = beforeResult.lines[0];
  const bestScore = lineToCp(bestLine);
  const playedIsBest = !!bestLine && normalizeUci(bestLine.moveUci) === normalizeUci(playedMoveUci);

  const afterLine = afterResult.lines[0];
  const scoreAfterFromMoverPov = -lineToCp(afterLine);

  const cpLoss = playedIsBest ? 0 : Math.max(0, Math.round(bestScore - scoreAfterFromMoverPov));
  // afterLine.mate is from the side-to-move-next's POV (the opponent) — positive
  // means THEY have a forced mate, i.e. the played move just allowed one.
  const allowsMateIn = afterLine?.mate !== undefined && afterLine.mate > 0 ? afterLine.mate : undefined;

  return {
    quality: playedIsBest ? "best" : classifyByCpLoss(cpLoss),
    cpLoss,
    bestMoveUci: bestLine?.moveUci,
    bestLineCp: bestLine?.cp,
    bestLineMate: bestLine?.mate,
    allowsMateIn,
  };
}
