// localStorage-backed spaced-repetition store for the "My mistakes" trainer.
//
// The Games tab turns your analysed blunders into puzzles; this layer decides
// *which one to drill next and when to bring it back*. It is a Leitner-lite
// scheduler: every puzzle lives in a box (0..N); solving it first-try promotes
// it (longer interval before it's due again), missing it demotes it to box 0
// (due immediately). Per-motif accuracy + an overall streak ride along so the
// trainer can surface a "focus" weakness and a review summary.
//
// Same conventions as `rating.ts`: one versioned key, every storage access in
// try/catch (Safari private mode + corrupt data both throw), and a fresh
// default returned on any failure so the UI always renders. `now` is injectable
// on the write path so the scheduler is testable without a real clock.

const STORAGE_KEY = "gmv.review.v1";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interval (in days) that must pass before a card in each box is due again.
 * Box 0 = due immediately (new or just-missed). Promoting past the last box
 * keeps the longest interval. A card at or past `MASTERED_BOX` counts as
 * "mastered" for the summary.
 */
const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 16, 45];
const MAX_BOX = BOX_INTERVALS_DAYS.length - 1;
export const MASTERED_BOX = 4;

/** Minimum attempts on a motif before it can be named the "focus" weakness. */
const FOCUS_MIN_SAMPLE = 3;

/** One puzzle's scheduling state. */
export interface ReviewCard {
  /** Leitner box (0..MAX_BOX). Higher = better known, longer interval. */
  box: number;
  /** Epoch ms when this card next becomes due. */
  due: number;
  /** First-attempt attempts and successes on this specific card. */
  seen: number;
  correct: number;
}

/** Aggregate accuracy for one tactical motif (fork / pin / mate / …). */
export interface MotifStat {
  seen: number;
  correct: number;
}

/** The whole persisted SR state. */
export interface ReviewState {
  cards: Record<string, ReviewCard>;
  motifs: Record<string, MotifStat>;
  /** Current consecutive first-try solves in the mistakes trainer. */
  streak: number;
  bestStreak: number;
  /** Total first-attempt reviews recorded. */
  reviewedTotal: number;
}

const clampBox = (b: number) => Math.max(0, Math.min(MAX_BOX, Math.floor(b)));
const nonNeg = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));

/** Read the SR state, falling back to defaults on any failure. */
export function getReview(): ReviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredDefaults();
    const parsed = JSON.parse(raw) as Partial<ReviewState>;
    const cards: Record<string, ReviewCard> = {};
    if (parsed.cards && typeof parsed.cards === "object") {
      for (const [id, c] of Object.entries(parsed.cards)) {
        if (!c || typeof c !== "object") continue;
        cards[id] = {
          box: clampBox((c as ReviewCard).box),
          due: Number((c as ReviewCard).due) || 0,
          seen: nonNeg((c as ReviewCard).seen),
          correct: nonNeg((c as ReviewCard).correct),
        };
      }
    }
    const motifs: Record<string, MotifStat> = {};
    if (parsed.motifs && typeof parsed.motifs === "object") {
      for (const [m, s] of Object.entries(parsed.motifs)) {
        if (!s || typeof s !== "object") continue;
        motifs[m] = { seen: nonNeg((s as MotifStat).seen), correct: nonNeg((s as MotifStat).correct) };
      }
    }
    return {
      cards,
      motifs,
      streak: nonNeg(parsed.streak),
      bestStreak: nonNeg(parsed.bestStreak),
      reviewedTotal: nonNeg(parsed.reviewedTotal),
    };
  } catch {
    return structuredDefaults();
  }
}

/** A deep-ish clone of DEFAULTS so callers never share the frozen maps. */
function structuredDefaults(): ReviewState {
  return { cards: {}, motifs: {}, streak: 0, bestStreak: 0, reviewedTotal: 0 };
}

function saveReview(s: ReviewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable — keep going with in-memory state only.
  }
}

/**
 * Record one first-attempt result for a puzzle and persist it. `correct` is the
 * FIRST-attempt outcome only (retries must not be reported, mirroring the
 * rating store) so scheduling stays honest. A correct answer promotes the card
 * a box and pushes its due date out; a miss resets it to box 0, due now.
 * `motif`, when present, feeds the per-motif accuracy tally. `now` is injectable
 * for tests. Returns the new state.
 */
export function recordReview(
  id: string,
  correct: boolean,
  motif?: string,
  now: number = Date.now()
): ReviewState {
  const state = getReview();
  const prev = state.cards[id] ?? { box: 0, due: 0, seen: 0, correct: 0 };

  const box = correct ? clampBox(prev.box + 1) : 0;
  const due = now + BOX_INTERVALS_DAYS[box] * DAY_MS;
  state.cards[id] = {
    box,
    due,
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
  };

  if (motif) {
    const m = state.motifs[motif] ?? { seen: 0, correct: 0 };
    state.motifs[motif] = { seen: m.seen + 1, correct: m.correct + (correct ? 1 : 0) };
  }

  state.streak = correct ? state.streak + 1 : 0;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  state.reviewedTotal += 1;

  saveReview(state);
  return state;
}

/** A puzzle that can be scheduled — only its id and (optional) motif matter. */
interface Schedulable {
  id: string;
  motif?: string;
}

/**
 * Order puzzles for review: due cards first (never dropped — an all-scheduled
 * pool still returns everything so the trainer never dead-ends). Within the due
 * group, weakest box first, then the current focus motif is nudged to the front
 * so a displayed weakness is actually served. Not-yet-due cards follow, soonest
 * due first. Stable for equal keys via the original index. Pure — does not read
 * or write storage beyond one `getReview`.
 */
export function getDueOrder<T extends Schedulable>(puzzles: T[], now: number = Date.now()): T[] {
  const state = getReview();
  const focus = focusMotifOf(state);

  const keyed = puzzles.map((p, i) => {
    const card = state.cards[p.id];
    const box = card?.box ?? 0;
    const due = card?.due ?? 0;
    const isDue = due <= now;
    return { p, i, box, due, isDue, isFocus: !!focus && p.motif === focus };
  });

  keyed.sort((a, b) => {
    if (a.isDue !== b.isDue) return a.isDue ? -1 : 1; // due before scheduled
    if (a.isDue) {
      if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1; // focus weakness first
      if (a.box !== b.box) return a.box - b.box; // weakest first
      return a.i - b.i;
    }
    if (a.due !== b.due) return a.due - b.due; // soonest-due first
    return a.i - b.i;
  });

  return keyed.map((k) => k.p);
}

/** The motif with the lowest accuracy above the sample floor, or null. */
function focusMotifOf(state: ReviewState): string | null {
  let worst: { motif: string; acc: number } | null = null;
  for (const [motif, s] of Object.entries(state.motifs)) {
    if (s.seen < FOCUS_MIN_SAMPLE) continue;
    const acc = s.correct / s.seen;
    if (!worst || acc < worst.acc) worst = { motif, acc };
  }
  return worst?.motif ?? null;
}

/** Per-motif accuracy row for the summary UI. */
export interface MotifAccuracy {
  motif: string;
  seen: number;
  correct: number;
  pct: number; // 0..100
}

/** A snapshot for the review summary card. */
export interface ReviewSummary {
  total: number; // puzzles in the pool
  due: number; // how many are due now
  mastered: number; // cards at/above MASTERED_BOX
  streak: number;
  bestStreak: number;
  reviewedTotal: number;
  focusMotif: string | null;
  motifAccuracy: MotifAccuracy[]; // sorted worst-first
}

/**
 * Derive the summary over the current pool of puzzles. `total`/`due`/`mastered`
 * are relative to the puzzles actually available now (not stale ids), so the
 * card matches what the trainer can serve.
 */
export function summary<T extends Schedulable>(puzzles: T[], now: number = Date.now()): ReviewSummary {
  const state = getReview();
  let due = 0;
  let mastered = 0;
  for (const p of puzzles) {
    const card = state.cards[p.id];
    if (!card || card.due <= now) due++;
    if (card && card.box >= MASTERED_BOX) mastered++;
  }

  const motifAccuracy: MotifAccuracy[] = Object.entries(state.motifs)
    .map(([motif, s]) => ({
      motif,
      seen: s.seen,
      correct: s.correct,
      pct: s.seen ? Math.round((s.correct / s.seen) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct || b.seen - a.seen);

  return {
    total: puzzles.length,
    due,
    mastered,
    streak: state.streak,
    bestStreak: state.bestStreak,
    reviewedTotal: state.reviewedTotal,
    focusMotif: focusMotifOf(state),
    motifAccuracy,
  };
}

/** Wipe all SR state (mirrors `resetProgress`). */
export function resetReview(): ReviewState {
  const fresh = structuredDefaults();
  saveReview(fresh);
  return fresh;
}
