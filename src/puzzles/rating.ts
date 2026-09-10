// localStorage-backed tactics progress store.
//
// Tracks the user's own tactics rating (Elo-style, updated against each
// puzzle's rating), plus streak / best-streak / solved / failed counters.
// Every localStorage access is wrapped in try/catch — Safari private mode
// throws on getItem/setItem, and corrupt data throws on JSON.parse — so the
// store always degrades gracefully to sane defaults and the UI renders fine.

const STORAGE_KEY = "gmv.tactics.progress.v1";

/** Persisted tactics progress for the local user. */
export interface TacticsProgress {
  /** Elo-style tactics rating. Starts at 1200. */
  rating: number;
  /** Current consecutive-solve streak. */
  streak: number;
  /** Best streak ever reached. */
  bestStreak: number;
  /** Total puzzles solved (first-attempt success). */
  solved: number;
  /** Total puzzles failed (first-attempt miss). */
  failed: number;
}

const DEFAULTS: TacticsProgress = {
  rating: 1200,
  streak: 0,
  bestStreak: 0,
  solved: 0,
  failed: 0,
};

// Elo tuning.
const K = 32;
const RATING_MIN = 400;
const RATING_MAX = 3000;

const clampRating = (r: number) => Math.max(RATING_MIN, Math.min(RATING_MAX, Math.round(r)));

/** Expected score for the user against a puzzle of `puzzleRating` (logistic). */
function expectedScore(userRating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - userRating) / 400));
}

/** Read the current progress, falling back to defaults on any failure. */
export function getProgress(): TacticsProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TacticsProgress>;
    return {
      rating: clampRating(Number(parsed.rating) || DEFAULTS.rating),
      streak: Math.max(0, Math.floor(Number(parsed.streak) || 0)),
      bestStreak: Math.max(0, Math.floor(Number(parsed.bestStreak) || 0)),
      solved: Math.max(0, Math.floor(Number(parsed.solved) || 0)),
      failed: Math.max(0, Math.floor(Number(parsed.failed) || 0)),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist progress, swallowing any storage failure (private mode, quota). */
function saveProgress(p: TacticsProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable — keep going with in-memory state only.
  }
}

/**
 * Apply one puzzle result and persist it. `solved` is the FIRST-attempt
 * outcome only — a retry that later succeeds must NOT be reported here, so the
 * rating and streak stay honest (unfarmable). Returns the new progress plus the
 * signed rating delta so the UI can show "+8 / -12".
 */
export function updateProgress(
  puzzleRating: number,
  solved: boolean
): { progress: TacticsProgress; delta: number } {
  const prev = getProgress();
  const score = solved ? 1 : 0;
  const expected = expectedScore(prev.rating, puzzleRating);
  const newRating = clampRating(prev.rating + K * (score - expected));
  const delta = newRating - prev.rating;

  const streak = solved ? prev.streak + 1 : 0;
  const next: TacticsProgress = {
    rating: newRating,
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    solved: prev.solved + (solved ? 1 : 0),
    failed: prev.failed + (solved ? 0 : 1),
  };
  saveProgress(next);
  return { progress: next, delta };
}

/** Reset all progress back to defaults. */
export function resetProgress(): TacticsProgress {
  const fresh = { ...DEFAULTS };
  saveProgress(fresh);
  return fresh;
}
