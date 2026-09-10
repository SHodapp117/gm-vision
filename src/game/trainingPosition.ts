/* ------------------------------------------------------------------ */
/*  TrainingPosition — one shape for every way a game can start.        */
/*                                                                     */
/*  A standard game, N moves into an opening, a pasted FEN, or a puzzle */
/*  position all reduce to the same object: a validated FEN plus where  */
/*  it came from and which side the human plays. `ChessTrainer` starts  */
/*  a normal, fully-coached game from any of them — so there is one      */
/*  game engine, not one per source.                                    */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";
import { openingPositionFen } from "./openings";

export type TrainingSource = "standard" | "opening" | "fen" | "puzzle";

export interface TrainingPosition {
  fen: string;
  source: TrainingSource;
  /** Human-readable origin, shown in the coach intro. */
  label: string;
  /** Which side the human plays. */
  playerColor: "w" | "b";
  meta?: {
    opening?: string;
    depthMoves?: number;
    puzzleId?: string;
    themes?: string[];
    /** SAN history that produced the position (opening starts). */
    history?: string[];
  };
}

export interface FenValidation {
  ok: boolean;
  /** chess.js-normalised FEN when ok. */
  fen?: string;
  error?: string;
}

/** The standard initial array. */
export const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * Validate a pasted FEN by constructing a chess.js game from it (which throws
 * on anything illegal) and rejecting already-finished positions. Returns the
 * engine's canonical FEN so downstream code always works with a normalised one.
 */
export function validateFen(input: string): FenValidation {
  const fen = input.trim();
  if (!fen) return { ok: false, error: "Paste a FEN to start from." };
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Invalid FEN.";
    // chess.js messages are like "Invalid FEN: ...": keep them but tidy the prefix.
    return { ok: false, error: raw.replace(/^Error:\s*/, "") };
  }
  if (game.isGameOver()) {
    return { ok: false, error: "That position is already game-over — nothing to play." };
  }
  return { ok: true, fen: game.fen() };
}

/** A standard game from move one. */
export function standardPosition(playerColor: "w" | "b"): TrainingPosition {
  return { fen: STARTING_FEN, source: "standard", label: "a standard game", playerColor };
}

/**
 * A position `fullMoves` full moves into an opening's main line (mid-game
 * training). Returns null if the opening name is unknown. `meta.opening` is set
 * so the Play trainer's position-keyed book keeps guiding from here.
 */
export function openingPosition(
  name: string,
  fullMoves: number,
  playerColor: "w" | "b"
): TrainingPosition | null {
  const res = openingPositionFen(name, fullMoves);
  if (!res) return null;
  return {
    fen: res.fen,
    source: "opening",
    label: `${name}, ${fullMoves} ${fullMoves === 1 ? "move" : "moves"} in`,
    playerColor,
    meta: { opening: name, depthMoves: fullMoves, history: res.history },
  };
}

/** A game from a (pre-validated) FEN. */
export function fenPosition(fen: string, playerColor: "w" | "b"): TrainingPosition {
  return { fen, source: "fen", label: "a custom position", playerColor };
}

/**
 * A normal game starting from a puzzle position. The human plays the side to
 * move in that FEN, and the puzzle's metadata rides along for the coach intro.
 */
export function puzzlePosition(
  fen: string,
  meta: { puzzleId?: string; themes?: string[] } = {}
): TrainingPosition {
  const playerColor: "w" | "b" = new Chess(fen).turn();
  return {
    fen,
    source: "puzzle",
    label: meta.puzzleId ? `puzzle ${meta.puzzleId}` : "a puzzle position",
    playerColor,
    meta,
  };
}
