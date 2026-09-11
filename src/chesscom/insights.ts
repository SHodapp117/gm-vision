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

/** Games with a completed analysis — the only ones any insight may use. */
function analysedGames(games: ImportedGame[]): ImportedGame[] {
  return games.filter((g) => g.analyzed && g.analysis);
}

function otherColor(c: "w" | "b"): "w" | "b" {
  return c === "w" ? "b" : "w";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
  return {
    id: "overall-error-rate",
    severity,
    title: perGame >= 1.5 ? "Mistakes and blunders are frequent" : "A steady trickle of mistakes and blunders",
    detail: `Across ${games.length} analysed games you average ${perGame.toFixed(1)} mistakes/blunders per game (${blunders} blunders, ${mistakes} mistakes total).`,
    tags: ["accuracy", "overview"],
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

  return {
    id: `blunders-phase-${topPhase}`,
    severity: share >= 0.66 ? "strong" : "warn",
    title: `Most of your blunders happen in the ${topPhase}`,
    detail: `${topCount} of your ${total} analysed blunders (${Math.round(share * 100)}%) occurred in the ${topPhase}.`,
    tags: ["blunders", "phase", topPhase],
  };
}

/* ---- Loses material shortly after castling --------------------------- */

/** Half-move index -> mover color, for a game's own move list (colors always alternate). */
function moverColors(game: ImportedGame): ("w" | "b")[] {
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

  let matchingGames = 0;
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
    if (hit) matchingGames++;
  }

  if (matchingGames < 2) return null;
  const rate = matchingGames / games.length;
  if (rate < 0.25) return null;

  return {
    id: "castle-then-blunder",
    severity: rate >= 0.4 ? "strong" : "warn",
    title: "You often lose material shortly after castling",
    detail: `In ${matchingGames} of your ${games.length} analysed games, a mistake or blunder landed within 6 half-moves of castling.`,
    tags: ["pattern", "king-safety", "castling"],
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

function openingKey(g: ImportedGame): string | undefined {
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
