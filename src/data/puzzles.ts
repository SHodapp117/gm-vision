// Runtime loader for the curated Lichess CC0 puzzle set.
//
// The dataset (~25k puzzles, several MB) is NOT bundled into the JS — it's
// served as a static asset from `public/data/puzzles.json` and fetched on
// demand the first time the Puzzles tab needs it, so it never weighs down the
// app bundle and is cached by the browser after the first load.
//
// `puzzles` is a module-level array that starts empty and is filled in place by
// `loadPuzzles()`. Callers that run after the load (all UI interactions do) see
// the populated array; anything that might run earlier should `await
// loadPuzzles()` first (the Puzzles tab does this on mount).
//
// See PUZZLES.md (repo root) for the source, license, and field convention —
// notably that `moves[0]` is the opponent's setup move, played BEFORE the
// solver's first move.

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

/**
 * The loaded puzzle pool. Empty until `loadPuzzles()` resolves, then filled in
 * place (same array reference throughout, so importers never hold a stale copy).
 */
export const puzzles: Puzzle[] = [];

/** Where the static dataset lives — respects the deploy base path (e.g. /gm-vision/). */
const PUZZLES_URL = `${import.meta.env.BASE_URL}data/puzzles.json`;

let loadPromise: Promise<Puzzle[]> | null = null;

/**
 * Fetch and cache the puzzle dataset (idempotent — concurrent callers share one
 * request, and a completed load resolves immediately). Fills `puzzles` in place
 * and returns it. Throws if the asset can't be fetched or parsed.
 */
export function loadPuzzles(): Promise<Puzzle[]> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const res = await fetch(PUZZLES_URL);
    if (!res.ok) throw new Error(`Failed to load puzzles (${res.status})`);
    const data = (await res.json()) as Puzzle[];
    puzzles.length = 0;
    puzzles.push(...data);
    return puzzles;
  })().catch((err) => {
    loadPromise = null; // allow a retry on transient failure
    throw err;
  });
  return loadPromise;
}

/** True once the dataset has finished loading. */
export function puzzlesLoaded(): boolean {
  return puzzles.length > 0;
}

/** Returns all loaded puzzles tagged with the given theme (exact, case-sensitive). */
export function puzzlesByTheme(theme: string): Puzzle[] {
  return puzzles.filter((p) => p.themes.includes(theme));
}

/** Returns all loaded puzzles whose rating falls within [min, max] inclusive. */
export function puzzlesInRatingRange(min: number, max: number): Puzzle[] {
  return puzzles.filter((p) => p.rating >= min && p.rating <= max);
}
