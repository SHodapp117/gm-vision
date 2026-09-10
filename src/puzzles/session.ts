// Puzzle selection for the tactics session.
//
// Picks a random puzzle near the user's current tactics rating, honoring an
// optional theme filter and rating band, while avoiding immediate repeats.
// Reuses the helpers in ../data/puzzles.ts.

import { puzzles, puzzlesByTheme, type Puzzle } from "../data/puzzles";

/** Curated set of tactical themes worth surfacing in the theme dropdown. */
export const TACTIC_THEMES: string[] = [
  "fork",
  "pin",
  "skewer",
  "discoveredAttack",
  "doubleCheck",
  "backRankMate",
  "hangingPiece",
  "sacrifice",
  "deflection",
  "mateIn1",
  "mateIn2",
  "mateIn3",
];

/** Predefined rating bands the user can filter by. */
export interface RatingBand {
  label: string;
  min: number;
  max: number;
}

export const RATING_BANDS: RatingBand[] = [
  { label: "600–999", min: 600, max: 999 },
  { label: "1000–1249", min: 1000, max: 1249 },
  { label: "1250–1499", min: 1250, max: 1499 },
  { label: "1500–1749", min: 1500, max: 1749 },
  { label: "1750–1999", min: 1750, max: 1999 },
  { label: "2000–2299", min: 2000, max: 2299 },
  { label: "2300+", min: 2300, max: 9999 },
];

// Remember the last N ids so a narrow filter doesn't replay the same handful.
const RECENT_LIMIT = 20;
const recentIds: string[] = [];

function rememberId(id: string): void {
  recentIds.push(id);
  while (recentIds.length > RECENT_LIMIT) recentIds.shift();
}

/** Reset the recent-id memory (e.g. when the filter changes materially). */
export function clearRecent(): void {
  recentIds.length = 0;
}

export interface SelectOptions {
  /** Exact Lichess theme tag, or null/undefined for any theme. */
  theme?: string | null;
  /** Optional hard rating band the puzzle must fall inside. */
  band?: RatingBand | null;
  /** The user's current tactics rating — puzzles are picked near this. */
  userRating: number;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Select the next puzzle:
 *  1. Start from the theme pool (or all puzzles).
 *  2. If a band is set, restrict to it.
 *  3. Prefer puzzles within ±150 of the user's rating, widening by 150 until
 *     some candidate exists.
 *  4. If the theme+band combination yields nothing at any width, drop the band
 *     (keep the theme). If even the theme alone is empty, fall back to all.
 *  5. Avoid the recently served ids where possible.
 */
export function selectPuzzle(opts: SelectOptions): Puzzle {
  const { theme, band, userRating } = opts;

  const themePool = theme ? puzzlesByTheme(theme) : puzzles;
  const bandPool =
    band && themePool.length
      ? themePool.filter((p) => p.rating >= band.min && p.rating <= band.max)
      : themePool;

  // Ordered fallbacks: theme+band, then theme-only, then everything.
  const fallbacks: Puzzle[][] = [];
  if (bandPool.length) fallbacks.push(bandPool);
  if (themePool.length) fallbacks.push(themePool);
  fallbacks.push(puzzles);

  for (const pool of fallbacks) {
    // Widen the rating window until we find candidates.
    for (let width = 150; width <= 2600; width += 150) {
      const near = pool.filter(
        (p) => Math.abs(p.rating - userRating) <= width && !recentIds.includes(p.id)
      );
      if (near.length) {
        const chosen = pickRandom(near);
        rememberId(chosen.id);
        return chosen;
      }
    }
    // Rating window exhausted for this pool — take anything not-recent in it.
    const fresh = pool.filter((p) => !recentIds.includes(p.id));
    if (fresh.length) {
      const chosen = pickRandom(fresh);
      rememberId(chosen.id);
      return chosen;
    }
    // Everything in this pool is "recent" (tiny pool). Allow a repeat rather
    // than failing — pick the nearest by rating.
    if (pool.length) {
      const chosen = pool
        .slice()
        .sort((a, b) => Math.abs(a.rating - userRating) - Math.abs(b.rating - userRating))[0];
      rememberId(chosen.id);
      return chosen;
    }
  }

  // Unreachable (puzzles is non-empty), but satisfy the type checker.
  const chosen = pickRandom(puzzles);
  rememberId(chosen.id);
  return chosen;
}
