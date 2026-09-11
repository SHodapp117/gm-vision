/* ------------------------------------------------------------------ */
/*  Coach-facing insights — pattern mining over already-analysed games. */
/*                                                                      */
/*  Pure and deterministic: no engine calls, no storage, no side         */
/*  effects. Only games with `analyzed && analysis` are considered, and  */
/*  every pattern below requires a minimum sample before it's allowed to  */
/*  speak, so a handful of games never gets over-read into a "pattern".  */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";
import type { GameFinding, ImportedGame, Insight, PlayerOutcome } from "./types";

type Phase = "opening" | "middlegame" | "endgame";

const SEVERITY_RANK: Record<Insight["severity"], number> = { strong: 3, warn: 2, info: 1 };
const MAX_INSIGHTS = 5;

/** Games with a completed analysis — the only ones any engine insight may use. */
export function analysedGames(games: ImportedGame[]): ImportedGame[] {
  return games.filter((g) => g.analyzed && g.analysis);
}

function otherColor(c: "w" | "b"): "w" | "b" {
  return c === "w" ? "b" : "w";
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** First `n` game uuids, for the "example games" drill-in on a recommendation. */
function uuidsOf(games: ImportedGame[], n = 3): string[] {
  return games.slice(0, n).map((g) => g.uuid);
}

/* ---- Overall error rate --------------------------------------------- */

function overallErrorRateInsight(games: ImportedGame[]): Insight | null {
  const MIN_GAMES = 3;
  if (games.length < MIN_GAMES) return null;

  let blunders = 0;
  let mistakes = 0;
  for (const g of games) {
    blunders += g.analysis!.blunders;
    mistakes += g.analysis!.mistakes;
  }
  const perGame = (blunders + mistakes) / games.length;
  if (perGame < 1) return null; // not enough signal to say anything useful

  const severity: Insight["severity"] = perGame >= 3 ? "strong" : perGame >= 1.5 ? "warn" : "info";
  const examples = [...games].sort(
    (a, b) => b.analysis!.blunders + b.analysis!.mistakes - (a.analysis!.blunders + a.analysis!.mistakes)
  );
  return {
    id: "overall-error-rate",
    severity,
    title: perGame >= 1.5 ? "Mistakes and blunders are frequent" : "A steady trickle of mistakes and blunders",
    detail: `Across ${games.length} analysed games you average ${perGame.toFixed(1)} mistakes/blunders per game (${blunders} blunders, ${mistakes} mistakes total).`,
    tip: "Before each move, take a beat to check what your opponent's last move threatens — most of these are one-move oversights.",
    tags: ["accuracy", "overview"],
    exampleUuids: uuidsOf(examples),
    needsAnalysis: true,
  };
}

/* ---- Blunders concentrated in one phase ----------------------------- */

function blundersByPhaseInsight(games: ImportedGame[]): Insight | null {
  const MIN_BLUNDERS = 4;
  const counts: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  let total = 0;

  for (const g of games) {
    for (const f of g.analysis!.findings) {
      if (f.quality !== "blunder") continue;
      counts[f.phase]++;
      total++;
    }
  }
  if (total < MIN_BLUNDERS) return null;

  const [topPhase, topCount] = (Object.entries(counts) as [Phase, number][]).sort((a, b) => b[1] - a[1])[0];
  const share = topCount / total;
  if (share < 0.5) return null; // no clear plurality

  const examples = games.filter((g) => g.analysis!.findings.some((f) => f.quality === "blunder" && f.phase === topPhase));
  const PHASE_TIP: Record<Phase, string> = {
    opening: "Shore up your openings — rehearse your main lines in the Play tab's Mid-opening trainer.",
    middlegame: "Drill middlegame tactics in the Puzzles tab (fork, pin, skewer themes).",
    endgame: "Study basic endgames and slow down once material is reduced — endings reward calculation over speed.",
  };
  return {
    id: `blunders-phase-${topPhase}`,
    severity: share >= 0.66 ? "strong" : "warn",
    title: `Most of your blunders happen in the ${topPhase}`,
    detail: `${topCount} of your ${total} analysed blunders (${Math.round(share * 100)}%) occurred in the ${topPhase}.`,
    tip: PHASE_TIP[topPhase],
    tags: ["blunders", "phase", topPhase],
    exampleUuids: uuidsOf(examples),
    needsAnalysis: true,
  };
}

/* ---- Loses material shortly after castling --------------------------- */

/** Half-move index -> mover color, for a game's own move list (colors always alternate). */
export function moverColors(game: ImportedGame): ("w" | "b")[] {
  const startTurn = new Chess(game.startFen).turn();
  const movers: ("w" | "b")[] = [];
  let mover = startTurn;
  for (let i = 0; i < game.moves.length; i++) {
    movers.push(mover);
    mover = otherColor(mover);
  }
  return movers;
}

function castleThenLossInsight(games: ImportedGame[]): Insight | null {
  const MIN_GAMES = 3;
  const WINDOW_PLIES = 6;
  const BAD_QUALITIES = new Set(["mistake", "blunder"]);
  if (games.length < MIN_GAMES) return null;

  const matching: ImportedGame[] = [];
  for (const g of games) {
    const movers = moverColors(g);
    const findingsByPly = new Map<number, GameFinding>(g.analysis!.findings.map((f) => [f.ply, f]));
    let hit = false;

    for (let ply = 0; ply < g.moves.length && !hit; ply++) {
      if (movers[ply] !== g.playerColor) continue;
      const san = g.moves[ply];
      if (san !== "O-O" && san !== "O-O-O") continue;

      for (let p = ply + 1; p <= ply + WINDOW_PLIES && p < g.moves.length; p++) {
        const f = findingsByPly.get(p);
        if (f && BAD_QUALITIES.has(f.quality)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) matching.push(g);
  }

  if (matching.length < 2) return null;
  const rate = matching.length / games.length;
  if (rate < 0.25) return null;

  return {
    id: "castle-then-blunder",
    severity: rate >= 0.4 ? "strong" : "warn",
    title: "You often lose material shortly after castling",
    detail: `In ${matching.length} of your ${games.length} analysed games, a mistake or blunder landed within 6 half-moves of castling.`,
    tip: "Right after castling, pause to spot loose pieces and back-rank/f-file weaknesses before you push forward.",
    tags: ["pattern", "king-safety", "castling"],
    exampleUuids: uuidsOf(matching),
    needsAnalysis: true,
  };
}

/* ---- Weakest time class ------------------------------------------------ */

function weakestTimeClassInsight(games: ImportedGame[]): Insight | null {
  const MIN_PER_CLASS = 5;
  const byClass = new Map<string, { wins: number; total: number }>();

  for (const g of games) {
    const rec = byClass.get(g.timeClass) ?? { wins: 0, total: 0 };
    rec.total++;
    if (g.playerResult === "win") rec.wins++;
    byClass.set(g.timeClass, rec);
  }
  if (byClass.size < 2) return null; // no comparison possible with a single time class

  let worst: { timeClass: string; winRate: number; total: number } | null = null;
  for (const [timeClass, rec] of byClass) {
    if (rec.total < MIN_PER_CLASS) continue;
    const winRate = rec.wins / rec.total;
    if (!worst || winRate < worst.winRate) worst = { timeClass, winRate, total: rec.total };
  }
  if (!worst || worst.winRate >= 0.45) return null;

  return {
    id: `weak-time-class-${slugify(worst.timeClass)}`,
    severity: worst.winRate < 0.3 ? "strong" : "warn",
    title: `Your ${worst.timeClass} results lag your other time controls`,
    detail: `You've won ${Math.round(worst.winRate * 100)}% of ${worst.total} analysed ${worst.timeClass} games.`,
    tags: ["time-class", worst.timeClass, "results"],
  };
}

/* ---- Worst opening by result ------------------------------------------ */

export function openingKey(g: ImportedGame): string | undefined {
  if (g.eco) return g.eco;
  if (g.ecoUrl) {
    const tail = g.ecoUrl.split("/").filter(Boolean).pop();
    return tail ? tail.replace(/-/g, " ") : undefined;
  }
  return undefined;
}

function worstOpeningInsight(games: ImportedGame[]): Insight | null {
  const MIN_PER_OPENING = 4;
  const byOpening = new Map<string, { wins: number; total: number }>();

  for (const g of games) {
    const key = openingKey(g);
    if (!key) continue;
    const rec = byOpening.get(key) ?? { wins: 0, total: 0 };
    rec.total++;
    const result: PlayerOutcome = g.playerResult;
    if (result === "win") rec.wins++;
    byOpening.set(key, rec);
  }

  let worst: { key: string; winRate: number; total: number } | null = null;
  for (const [key, rec] of byOpening) {
    if (rec.total < MIN_PER_OPENING) continue;
    const winRate = rec.wins / rec.total;
    if (!worst || winRate < worst.winRate) worst = { key, winRate, total: rec.total };
  }
  if (!worst || worst.winRate >= 0.35) return null;

  return {
    id: `worst-opening-${slugify(worst.key)}`,
    severity: worst.winRate < 0.2 ? "strong" : "warn",
    title: `${worst.key} has been a weak opening for you`,
    detail: `You've won just ${Math.round(worst.winRate * 100)}% of ${worst.total} analysed games in ${worst.key}.`,
    tags: ["opening", slugify(worst.key)],
  };
}

/* ---- Entry point ------------------------------------------------------- */

/**
 * The engine-tier insights — patterns that genuinely require move-by-move
 * analysis. Uncapped/unsorted, each tagged `needsAnalysis`, for the Coach
 * Report to merge with its metadata-tier findings. (Time-class and opening
 * win-rate are metadata patterns and are computed over ALL games in
 * metaReport.ts, so they're intentionally not here.)
 */
export function engineInsights(games: ImportedGame[]): Insight[] {
  const analysed = analysedGames(games);
  return [
    overallErrorRateInsight(analysed),
    blundersByPhaseInsight(analysed),
    castleThenLossInsight(analysed),
  ].filter((i): i is Insight => i !== null);
}

/** Up to ~5 Insights, most severe first. Deterministic — same input, same output. */
export function buildInsights(games: ImportedGame[]): Insight[] {
  const analysed = analysedGames(games);

  const candidates: (Insight | null)[] = [
    overallErrorRateInsight(analysed),
    blundersByPhaseInsight(analysed),
    castleThenLossInsight(analysed),
    weakestTimeClassInsight(analysed),
    worstOpeningInsight(analysed),
  ];

  return candidates
    .filter((i): i is Insight => i !== null)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, MAX_INSIGHTS);
}
