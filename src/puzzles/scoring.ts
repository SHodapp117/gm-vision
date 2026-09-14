// Per-puzzle countdown + scoring for the timed tactics session.
//
// Pure and deterministic so it can be unit-tested without a clock or a DOM.
// Each puzzle is scored out of 10 by how much of its countdown is left when it
// resolves; a miss or a timeout is 0. The clock length scales with the puzzle's
// rating so a hard puzzle gets more time than an easy one.

export const MAX_POINTS = 10;
export const SOLVE_FLOOR = 4; // a correct solve is always worth at least this

/** Seconds on the clock for a puzzle, scaled by rating (harder → more time). */
export function puzzleSeconds(rating: number): number {
  const t = Math.max(0, Math.min(1, (rating - 600) / 2600));
  return Math.round(15 + t * 45); // 15s at 600 → 60s at 3200+
}

/**
 * Points (out of 10) for an attempt. A miss/timeout is 0. A solve is scored on
 * the fraction of the clock left — but never below SOLVE_FLOOR, so slow-but-
 * correct calculation on a hard puzzle is still rewarded, not punished.
 */
export function scorePoints(solved: boolean, fractionLeft: number): number {
  if (!solved) return 0;
  const frac = Math.max(0, Math.min(1, fractionLeft));
  return Math.max(SOLVE_FLOOR, Math.round(SOLVE_FLOOR + (MAX_POINTS - SOLVE_FLOOR) * frac));
}
