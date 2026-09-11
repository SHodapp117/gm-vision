/* ------------------------------------------------------------------ */
/*  Game analysis — replay an ImportedGame move-by-move and classify    */
/*  every move the tracked player made with the engine.                 */
/*                                                                      */
/*  Classification itself is not reimplemented here: for each of the    */
/*  player's moves we hand fenBefore/fenAfter/playedMoveUci off to       */
/*  `evaluateMove` (src/engine/classify.ts), which does the two-sided    */
/*  engine comparison and returns a quality + centipawn loss. This       */
/*  module's job is just the replay, the player/opponent-ply split, the  */
/*  opening/middlegame/endgame phase heuristic, and rolling the per-move  */
/*  evaluations up into a GameAnalysis. `analyze` is injected (never      */
/*  imported from ./stockfish directly) so this stays engine-agnostic     */
/*  and trivially testable with a stub.                                  */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";
import { evaluateMove } from "../engine/classify";
import type { AnalyzeFn } from "../engine/classify";
import { PIECE_VALUE, findHangingPieces } from "../game/boardAnalysis";
import { detectPatternTactics } from "../engine/tactics";
import type { GameAnalysis, GameFinding, ImportedGame, MoveQualityEntry } from "./types";

export type { AnalyzeFn };

export interface AnalyzeGameOptions {
  movetime?: number;
  onProgress?: (p: { done: number; total: number }) => void;
  signal?: AbortSignal;
}

const DEFAULT_MOVETIME = 300;
const FLAGGED_QUALITIES = new Set(["inaccuracy", "mistake", "blunder"]);
// A "brilliant" move is the engine's top choice that also gives up at least a
// minor piece's worth of material (a real sacrifice) while keeping the player
// out of a losing position. BRILLIANT_SAC is the minimum material handed over;
// BRILLIANT_MIN_CP is how bad the resulting eval may be (from the player's POV).
const BRILLIANT_SAC = 3;
const BRILLIANT_MIN_CP = -50;

/** Total value of `color`'s pieces currently hanging in `fen`. */
function hangingValue(fen: string, color: "w" | "b"): number {
  return findHangingPieces(new Chess(fen), color).reduce((sum, h) => sum + PIECE_VALUE[h.type], 0);
}

/** The tactic on the board here — i.e. what the player likely missed. */
function detectMotif(fenBefore: string, color: "w" | "b", bestLineMate: number | undefined): string | undefined {
  if (bestLineMate !== undefined && bestLineMate > 0) return "mate";
  try {
    const pats = detectPatternTactics(fenBefore, color);
    if (pats.some((p) => p.type === "fork")) return "fork";
    if (pats.some((p) => p.type === "pin")) return "pin";
  } catch {
    /* geometry hiccup — no motif */
  }
  return undefined;
}
// Cap each move's contribution to the AVERAGE centipawn loss. classify.ts encodes
// forced mates as a ~100000cp swing, so without a ceiling a single mate-in-N move
// dwarfs a whole game's average. Individual findings still record the true cpLoss;
// this only keeps the headline ACPL meaningful (a few pawns, like other sites).
const AVG_CP_LOSS_CAP = 1000;

/** Opposite color, for walking the alternating mover sequence without a full replay. */
function otherColor(c: "w" | "b"): "w" | "b" {
  return c === "w" ? "b" : "w";
}

/**
 * Split a raw UCI move ("e2e4", "e7e8q") into chess.js move-input shape.
 * Duplicated from engine/stockfish.ts (rather than imported) so this module
 * never pulls in the Stockfish worker/env-dependent module graph.
 */
function splitUci(uci: string): { from: string; to: string; promotion?: string } {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  return { from, to, promotion };
}

/**
 * Opening/middlegame/endgame heuristic from the position before the move.
 * Deliberately simple and deterministic: move number decides "opening",
 * then piece count / queen presence decides "endgame", else "middlegame".
 */
function classifyPhase(fenBefore: string, moveNo: number): "opening" | "middlegame" | "endgame" {
  if (moveNo <= 10) return "opening";

  const boardPart = fenBefore.split(" ")[0];
  let nonKingPieces = 0;
  let hasQueen = false;
  for (const ch of boardPart) {
    if (/[pnbrqPNBRQ]/.test(ch)) nonKingPieces++;
    if (ch === "q" || ch === "Q") hasQueen = true;
  }
  if (nonKingPieces <= 12 || !hasQueen) return "endgame";
  return "middlegame";
}

/** Convert a best-move UCI (from the position at fenBefore) into SAN. Undefined on any failure. */
function bestMoveToSan(fenBefore: string, bestMoveUci: string | undefined): string | undefined {
  if (!bestMoveUci) return undefined;
  try {
    const probe = new Chess(fenBefore);
    const { from, to, promotion } = splitUci(bestMoveUci);
    const move = probe.move({ from, to, promotion });
    return move?.san;
  } catch {
    return undefined;
  }
}

/** How many of the game's half-moves belong to `playerColor`, without a full replay. */
function countPlayerMoves(game: ImportedGame): number {
  const startTurn = new Chess(game.startFen).turn();
  let count = 0;
  let mover = startTurn;
  for (let ply = 0; ply < game.moves.length; ply++) {
    if (mover === game.playerColor) count++;
    mover = otherColor(mover);
  }
  return count;
}

/**
 * Replay `game.moves` from `game.startFen`, engine-classify every move the
 * tracked player made, and roll the results up into a GameAnalysis. Never
 * mutates `game` and never persists anything — the caller owns storage.
 */
export async function analyzeGame(
  game: ImportedGame,
  analyze: AnalyzeFn,
  opts?: AnalyzeGameOptions
): Promise<GameAnalysis> {
  const movetime = opts?.movetime ?? DEFAULT_MOVETIME;
  const totalPlayerMoves = countPlayerMoves(game);

  const chess = new Chess(game.startFen);
  const findings: GameFinding[] = [];
  const brilliancies: GameFinding[] = [];
  const moveQualities: MoveQualityEntry[] = [];
  let totalCpLoss = 0;
  let analysedCount = 0;
  let doneCount = 0;

  for (let ply = 0; ply < game.moves.length; ply++) {
    if (opts?.signal?.aborted) break;

    const san = game.moves[ply];
    const moverColor = chess.turn();
    const isPlayerMove = moverColor === game.playerColor;
    const fenBefore = chess.fen();

    let verboseMove;
    try {
      verboseMove = chess.move(san);
    } catch {
      break; // can't trust the rest of the move list if replay desyncs
    }
    if (!verboseMove) break;

    if (!isPlayerMove) continue;

    const fenAfter = chess.fen();
    const playedUci = `${verboseMove.from}${verboseMove.to}${verboseMove.promotion ?? ""}`;

    try {
      const evaluation = await evaluateMove({
        analyze,
        fenBefore,
        fenAfter,
        playedMoveUci: playedUci,
        movetime,
      });

      totalCpLoss += Math.min(evaluation.cpLoss, AVG_CP_LOSS_CAP);
      analysedCount++;

      // A brilliant move: the engine's top choice AND a genuine material
      // sacrifice (the player is left materially down here) that doesn't lose.
      const isBest = evaluation.quality === "best" && evaluation.allowsMateIn === undefined;
      const sacrificed = isBest ? hangingValue(fenAfter, game.playerColor) - hangingValue(fenBefore, game.playerColor) : 0;
      const notLosing =
        evaluation.bestLineMate !== undefined ? evaluation.bestLineMate > 0 : (evaluation.bestLineCp ?? 0) >= BRILLIANT_MIN_CP;
      const brilliant = isBest && sacrificed >= BRILLIANT_SAC && notLosing;

      moveQualities.push({ ply, quality: evaluation.quality, brilliant });

      const flagged = FLAGGED_QUALITIES.has(evaluation.quality) || evaluation.allowsMateIn !== undefined;
      // Only the moves we keep (errors + brilliancies) get the extra, pricier
      // labelling: the tactic that was on the board, and the clock at the time.
      const motif = flagged || brilliant ? detectMotif(fenBefore, game.playerColor, evaluation.bestLineMate) : undefined;
      const secondsLeft = game.clocks && ply < game.clocks.length ? game.clocks[ply] : undefined;

      const finding: GameFinding = {
        ply,
        moveNo: Math.floor(ply / 2) + 1,
        fenBefore,
        playedSan: verboseMove.san,
        playedUci,
        bestSan: bestMoveToSan(fenBefore, evaluation.bestMoveUci),
        bestUci: evaluation.bestMoveUci,
        quality: evaluation.quality,
        cpLoss: evaluation.cpLoss,
        phase: classifyPhase(fenBefore, Math.floor(ply / 2) + 1),
        allowsMateIn: evaluation.allowsMateIn,
        brilliant,
        motif,
        secondsLeft,
      };

      if (brilliant) {
        brilliancies.push(finding);
      } else if (flagged) {
        findings.push(finding);
      }
    } catch {
      // A single move's engine call failing shouldn't sink the whole game.
    }

    doneCount++;
    opts?.onProgress?.({ done: doneCount, total: totalPlayerMoves });
  }

  const count = (q: string) => moveQualities.filter((m) => !m.brilliant && m.quality === q).length;
  const avgCpLoss = analysedCount > 0 ? Math.round(totalCpLoss / analysedCount) : 0;

  return {
    findings,
    brilliancies,
    moveQualities,
    inaccuracies: count("inaccuracy"),
    mistakes: count("mistake"),
    blunders: count("blunder"),
    good: count("good"),
    best: count("best"),
    brilliant: brilliancies.length,
    avgCpLoss,
    analyzedAt: Date.now(),
  };
}

export interface AnalyzeBatchOptions {
  movetime?: number;
  /** Persist each game once its analysis completes (e.g. store.putGame). */
  onGame?: (game: ImportedGame) => void | Promise<void>;
  onProgress?: (p: { done: number; total: number; game: ImportedGame }) => void;
  signal?: AbortSignal;
}

/**
 * Analyze a list of games one after another, persisting each via `onGame` as it
 * finishes. Cancellable through `signal` — a game interrupted mid-analysis is
 * NOT persisted (so we never store a half-finished analysis as complete). This
 * powers the Coach Report's "Analyze N games" batch; it stays responsive because
 * each move's engine call is awaited (the event loop is never blocked).
 */
export async function analyzeGames(
  games: ImportedGame[],
  analyze: AnalyzeFn,
  opts?: AnalyzeBatchOptions
): Promise<{ analyzed: number; cancelled: boolean }> {
  let done = 0;
  for (const game of games) {
    if (opts?.signal?.aborted) return { analyzed: done, cancelled: true };
    const analysis = await analyzeGame(game, analyze, { movetime: opts?.movetime, signal: opts?.signal });
    if (opts?.signal?.aborted) return { analyzed: done, cancelled: true };
    const updated: ImportedGame = { ...game, analyzed: true, analysis };
    await opts?.onGame?.(updated);
    done++;
    opts?.onProgress?.({ done, total: games.length, game: updated });
  }
  return { analyzed: done, cancelled: false };
}
