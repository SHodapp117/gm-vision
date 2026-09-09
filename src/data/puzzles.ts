// Typed loader for the curated Lichess CC0 puzzle subset.
//
// See PUZZLES.md (repo root) for the full source, license, and field
// documentation — including the important convention that `moves[0]` is
// the opponent's "setup" move that must be played BEFORE the solver's
// first move.

import rawPuzzles from './puzzles.json';

/** A single tactics puzzle curated from the Lichess open puzzle database. */
export interface Puzzle {
  /** Lichess PuzzleId, e.g. "00008". Stable, unique within this dataset. */
  id: string;
  /**
   * FEN of the position BEFORE the setup move (see `moves` below). This is
   * the raw Lichess convention — do NOT treat this as the position the
   * solver should be shown; play `moves[0]` first to reach it.
   */
  fen: string;
  /**
   * Space-separated UCI moves, e.g. "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1".
   * moves[0] is the opponent's move that creates the puzzle (auto-play
   * this to reach the actual puzzle position). moves[1] is the solver's
   * first move, moves[2] the engine's reply, and so on, alternating.
   */
  moves: string;
  /** Lichess puzzle rating (Glicko-2 based), roughly 600-3000+. */
  rating: number;
  /** Lichess theme tags, e.g. ["fork", "middlegame", "advantage"]. */
  themes: string[];
}

export const puzzles: Puzzle[] = rawPuzzles as Puzzle[];

/** Returns all puzzles tagged with the given theme (case-sensitive, exact match). */
export function puzzlesByTheme(theme: string): Puzzle[] {
  return puzzles.filter((p) => p.themes.includes(theme));
}

/** Returns all puzzles whose rating falls within [min, max] inclusive. */
export function puzzlesInRatingRange(min: number, max: number): Puzzle[] {
  return puzzles.filter((p) => p.rating >= min && p.rating <= max);
}
