/* ------------------------------------------------------------------ */
/*  Coach Report — whole-history meta-analysis.                         */
/*                                                                      */
/*  Two tiers, both pure/deterministic:                                 */
/*   • Metadata tier (every imported game, no engine): record, colour,  */
/*     time-control, opening, opponent-strength, how-you-lose, rating   */
/*     trend — computed here.                                           */
/*   • Engine tier (analysed games): reused from insights.ts via        */
/*     engineInsights (error rate, blunders-by-phase, castling).        */
/*  The two are merged into one prioritized, actionable recommendation  */
/*  list, plus a headline profile and a summary stats row. Each pattern */
/*  is gated by a minimum sample so a few games isn't over-read.        */
/* ------------------------------------------------------------------ */

import { engineInsights, openingKey, slugify } from "./insights";
import type { CoachReport, ImportedGame, Insight, ReportStat } from "./types";

const SEVERITY_RANK: Record<Insight["severity"], number> = { strong: 3, warn: 2, info: 1 };
const MAX_RECOMMENDATIONS = 8;
/** Ignore rating gaps within this band when bucketing "vs stronger/weaker". */
const RATING_BAND = 25;

const playerRating = (g: ImportedGame): number => (g.playerColor === "w" ? g.white.rating : g.black.rating);
/** The player's raw Chess.com result string ("timeout", "resigned", "checkmated", …). */
const playerRawResult = (g: ImportedGame): string => (g.playerColor === "w" ? g.white.result : g.black.result);

const wins = (games: ImportedGame[]): number => games.filter((g) => g.playerResult === "win").length;
const winRate = (games: ImportedGame[]): number => (games.length ? wins(games) / games.length : 0);
const losses = (games: ImportedGame[]): ImportedGame[] => games.filter((g) => g.playerResult === "loss");
const pct = (x: number): number => Math.round(x * 100);
const uuidsOf = (games: ImportedGame[], n = 3): string[] => games.slice(0, n).map((g) => g.uuid);

function record(games: ImportedGame[]): { w: number; d: number; l: number } {
  let w = 0, d = 0, l = 0;
  for (const g of games) {
    if (g.playerResult === "win") w++;
    else if (g.playerResult === "draw") d++;
    else l++;
  }
  return { w, d, l };
}

/** The time class the player has the most games in (ties broken alphabetically). */
function dominantTimeClass(games: ImportedGame[]): string | null {
  const counts = new Map<string, number>();
  for (const g of games) counts.set(g.timeClass, (counts.get(g.timeClass) ?? 0) + 1);
  let best: { tc: string; n: number } | null = null;
  for (const [tc, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || n > best.n) best = { tc, n };
  }
  return best?.tc ?? null;
}

/* ---- Metadata-tier detectors --------------------------------------- */

function colorInsight(games: ImportedGame[]): Insight | null {
  const MIN = 8;
  const white = games.filter((g) => g.playerColor === "w");
  const black = games.filter((g) => g.playerColor === "b");
  if (white.length < MIN || black.length < MIN) return null;

  const wrW = winRate(white);
  const wrB = winRate(black);
  const gap = Math.abs(wrW - wrB);
  if (gap < 0.15) return null;

  const weak = wrW < wrB ? "White" : "Black";
  const weakGames = wrW < wrB ? white : black;
  return {
    id: `weak-color-${weak.toLowerCase()}`,
    severity: gap >= 0.25 ? "strong" : "warn",
    title: `You score noticeably worse with ${weak}`,
    detail: `White ${pct(wrW)}% (${white.length} games) vs Black ${pct(wrB)}% (${black.length}). A ${pct(gap)}-point gap.`,
    tip: `Put your prep into the ${weak} side — a repertoire you trust there should close most of that gap.`,
    tags: ["colour", weak.toLowerCase()],
    exampleUuids: uuidsOf(losses(weakGames)),
  };
}

function timeClassInsight(games: ImportedGame[]): Insight | null {
  const MIN = 6;
  const byClass = new Map<string, ImportedGame[]>();
  for (const g of games) {
    const arr = byClass.get(g.timeClass) ?? [];
    arr.push(g);
    byClass.set(g.timeClass, arr);
  }
  if (byClass.size < 2) return null;

  let worst: { tc: string; wr: number; games: ImportedGame[] } | null = null;
  for (const [tc, arr] of [...byClass].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (arr.length < MIN) continue;
    const wr = winRate(arr);
    if (!worst || wr < worst.wr) worst = { tc, wr, games: arr };
  }
  if (!worst || worst.wr >= 0.45) return null;

  return {
    id: `weak-time-class-${slugify(worst.tc)}`,
    severity: worst.wr < 0.3 ? "strong" : "warn",
    title: `${worst.tc} is your weakest time control`,
    detail: `You win ${pct(worst.wr)}% of ${worst.games.length} ${worst.tc} games — below your other controls.`,
    tip: `If you want a higher rating, spend more time in a control you play better, and treat ${worst.tc} as practice.`,
    tags: ["time-class", worst.tc],
    exampleUuids: uuidsOf(losses(worst.games)),
  };
}

function openingInsight(games: ImportedGame[]): Insight | null {
  const MIN = 5;
  const byOpening = new Map<string, ImportedGame[]>();
  for (const g of games) {
    const key = openingKey(g);
    if (!key) continue;
    const arr = byOpening.get(key) ?? [];
    arr.push(g);
    byOpening.set(key, arr);
  }

  let worst: { key: string; wr: number; games: ImportedGame[] } | null = null;
  for (const [key, arr] of [...byOpening].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (arr.length < MIN) continue;
    const wr = winRate(arr);
    if (!worst || wr < worst.wr) worst = { key, wr, games: arr };
  }
  if (!worst || worst.wr >= 0.4) return null;

  return {
    id: `weak-opening-${slugify(worst.key)}`,
    severity: worst.wr < 0.25 ? "strong" : "warn",
    title: `${worst.key} has been a weak opening for you`,
    detail: `Just ${pct(worst.wr)}% wins across ${worst.games.length} games in ${worst.key}.`,
    tip: `Rehearse ${worst.key} from the Play tab's Mid-opening trainer so you reach familiar middlegames.`,
    tags: ["opening", slugify(worst.key)],
    exampleUuids: uuidsOf(losses(worst.games)),
  };
}

function opponentStrengthInsight(games: ImportedGame[]): Insight | null {
  const MIN = 6;
  const lower = games.filter((g) => g.opponentRating <= playerRating(g) - RATING_BAND);
  if (lower.length < MIN) return null;
  const wr = winRate(lower);
  if (wr >= 0.6) return null; // converting fine against weaker players

  return {
    id: "drops-vs-weaker",
    severity: wr < 0.45 ? "strong" : "warn",
    title: "You drop points against lower-rated opponents",
    detail: `Only ${pct(wr)}% wins in ${lower.length} games versus opponents rated ${RATING_BAND}+ below you.`,
    tip: "When you're the favourite, keep converting — trade into simple winning positions instead of forcing it.",
    tags: ["conversion", "opponent-strength"],
    exampleUuids: uuidsOf(losses(lower)),
  };
}

function howYouLoseInsight(games: ImportedGame[]): Insight | null {
  const MIN = 6;
  const lost = losses(games);
  if (lost.length < MIN) return null;

  const byType = new Map<string, ImportedGame[]>();
  for (const g of lost) {
    const t = playerRawResult(g);
    const arr = byType.get(t) ?? [];
    arr.push(g);
    byType.set(t, arr);
  }

  const timeoutGames = byType.get("timeout") ?? [];
  const timeoutShare = timeoutGames.length / lost.length;
  if (timeoutShare >= 0.35) {
    return {
      id: "loses-on-time",
      severity: timeoutShare >= 0.5 ? "strong" : "warn",
      title: "A lot of your losses are on the clock",
      detail: `${timeoutGames.length} of your ${lost.length} losses (${pct(timeoutShare)}%) were timeouts.`,
      tip: "Manage the clock: play a slower control, lean on openings you know cold, and don't over-calculate won positions.",
      tags: ["time-management", "losses"],
      exampleUuids: uuidsOf(timeoutGames),
    };
  }

  const matedGames = byType.get("checkmated") ?? [];
  const matedShare = matedGames.length / lost.length;
  if (matedShare >= 0.4) {
    return {
      id: "gets-checkmated",
      severity: matedShare >= 0.55 ? "strong" : "warn",
      title: "You're getting checkmated rather than resigning lost games",
      detail: `${matedGames.length} of your ${lost.length} losses (${pct(matedShare)}%) ended in checkmate — often a king-safety lapse.`,
      tip: "Watch king safety: after castling, keep an escape square and answer direct threats before pushing your own plans.",
      tags: ["king-safety", "losses"],
      exampleUuids: uuidsOf(matedGames),
    };
  }
  return null;
}

function ratingTrendInsight(games: ImportedGame[]): Insight | null {
  const MIN = 12;
  const tc = dominantTimeClass(games);
  if (!tc) return null;
  const series = games
    .filter((g) => g.timeClass === tc)
    .slice()
    .sort((a, b) => a.endTime - b.endTime);
  if (series.length < MIN) return null;

  const third = Math.floor(series.length / 3);
  const early = series.slice(0, third);
  const late = series.slice(series.length - third);
  const avg = (arr: ImportedGame[]) => Math.round(arr.reduce((s, g) => s + playerRating(g), 0) / arr.length);
  const delta = avg(late) - avg(early);
  if (Math.abs(delta) < 30) return null;

  const up = delta > 0;
  return {
    id: `rating-trend-${up ? "up" : "down"}-${slugify(tc)}`,
    severity: "info",
    title: up ? `Your ${tc} rating is trending up` : `Your ${tc} rating has been sliding`,
    detail: `Over your last ${series.length} ${tc} games it moved ${delta > 0 ? "+" : ""}${delta} points.`,
    tip: up
      ? "Whatever you've changed lately is working — keep reviewing your games to sustain it."
      : "Take a breather between games and review your recent losses below to stop the slide.",
    tags: ["rating", "trend", tc],
    exampleUuids: [],
  };
}

/* ---- Summary stats + headline -------------------------------------- */

function buildStats(games: ImportedGame[], analysed: ImportedGame[]): ReportStat[] {
  const { w, d, l } = record(games);
  const white = games.filter((g) => g.playerColor === "w");
  const black = games.filter((g) => g.playerColor === "b");
  const stats: ReportStat[] = [
    { label: "Games", value: String(games.length) },
    { label: "Record", value: `${w}–${d}–${l}`, hint: "wins–draws–losses" },
    { label: "Win rate", value: `${pct(winRate(games))}%` },
    {
      label: "By colour",
      value: `${white.length ? pct(winRate(white)) : 0}% W · ${black.length ? pct(winRate(black)) : 0}% B`,
      hint: "win rate as White / Black",
    },
    { label: "Analyzed", value: `${analysed.length} / ${games.length}` },
  ];
  if (analysed.length) {
    const avgCp = Math.round(analysed.reduce((s, g) => s + (g.analysis!.avgCpLoss ?? 0), 0) / analysed.length);
    stats.push({ label: "Avg cp loss", value: String(avgCp), hint: "lower is more accurate" });
  }
  return stats;
}

function buildHeadline(games: ImportedGame[], top: Insight | undefined): string {
  const tc = dominantTimeClass(games);
  const tcGames = tc ? games.filter((g) => g.timeClass === tc) : [];
  const latestRating = tcGames.length
    ? playerRating([...tcGames].sort((a, b) => b.endTime - a.endTime)[0])
    : null;
  const ratingBit = latestRating && tc ? ` around ${latestRating} ${tc}` : "";
  const lead = `${games.length} games${ratingBit} · ${pct(winRate(games))}% wins.`;
  const focus = top ? ` Biggest opportunity: ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}.` : " A well-rounded record — keep reviewing your games to push higher.";
  return lead + focus;
}

/* ---- Entry point --------------------------------------------------- */

/** The whole-history Coach Report. Deterministic; safe on an empty list. */
export function buildCoachReport(games: ImportedGame[]): CoachReport {
  const analysed = games.filter((g) => g.analyzed && g.analysis);

  const metadata: (Insight | null)[] = [
    colorInsight(games),
    timeClassInsight(games),
    openingInsight(games),
    opponentStrengthInsight(games),
    howYouLoseInsight(games),
    ratingTrendInsight(games),
  ];
  const engine = engineInsights(games).map((i) => ({ ...i, needsAnalysis: true }));

  const recommendations = [...metadata.filter((i): i is Insight => i !== null), ...engine]
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, MAX_RECOMMENDATIONS);

  return {
    totalGames: games.length,
    analyzedGames: analysed.length,
    headline: buildHeadline(games, recommendations[0]),
    stats: buildStats(games, analysed),
    recommendations,
  };
}
