/* ------------------------------------------------------------------ */
/*  Nemesis — a bot built from your own analysed games to hunt your      */
/*  specific weaknesses and force you to shore them up.                  */
/*                                                                       */
/*  Honest about what a Stockfish-backed bot can and can't do. It can't  */
/*  force which opening YOU play (you choose your own moves), so it       */
/*  doesn't pretend to. What it CAN do, it does:                         */
/*   • make you play your weaker COLOUR (lower win rate),                 */
/*   • ramp its strength in the PHASE you crumble in (opening/middle/     */
/*     endgame) — a fair fight where you're solid, a tougher one exactly  */
/*     where you fold, so the reps land on your weak spot.                */
/*  Your worst opening + most-missed tactic ride along as *intel* in the  */
/*  scouting report (labelled as such), not as forced play.               */
/*                                                                        */
/*  Pure/deterministic over stored games — same input, same plan. The     */
/*  runtime (Play tab) consumes `nemesisElo(plan, phaseOfFen(fen))`.       */
/* ------------------------------------------------------------------ */

import type { ImportedGame } from "./types";
import { openingKey } from "./insights";

export type Phase = "opening" | "middlegame" | "endgame";

/** Gate: Nemesis needs MORE than this many analysed games to read a pattern. */
export const NEMESIS_MIN_ANALYZED = 20;

/* Minimum-sample gates, consistent with the rest of the insight code. */
const COLOR_MIN = 8; // games per colour before a colour gap is trusted
const COLOR_GAP = 0.12; // win-rate gap that counts as a real weak colour
const PHASE_MIN_ERRORS = 5; // mistakes+blunders before a weak phase is named
const MOTIF_MIN = 3;
const OPENING_MIN = 4;

const PHASE_BOOST_ELO = 250; // how much stronger the bot plays in your weak phase
const ELO_MIN = 800;
const ELO_MAX = 2850;

/** One thing the Nemesis is built around, for the scouting-report UI. */
export interface NemesisTarget {
  /** "colour" | "phase" | "motif" | "opening" — drives the chip icon. */
  key: string;
  label: string; // short chip label, e.g. "Endgames"
  detail: string; // the numbers behind it
  /** true when the bot actively exploits this (colour, phase); false = intel only. */
  forced: boolean;
}

/** The built bot: how to configure the Play session + what it's hunting. */
export interface NemesisPlan {
  playerColor: "w" | "b"; // the colour YOU are made to play (your weaker side)
  weakPhase: Phase | null; // where the bot ramps up
  missedMotif: string | null; // intel: the tactic you miss most
  worstOpening: string | null; // intel: the opening you score worst in
  baseElo: number; // bot strength outside your weak phase
  phaseBoostElo: number; // added on top during your weak phase (0 if none)
  headline: string;
  targets: NemesisTarget[];
  analyzedGames: number;
}

const analysedOf = (games: ImportedGame[]): ImportedGame[] =>
  games.filter((g) => g.analyzed && g.analysis);

const playerRating = (g: ImportedGame): number => (g.playerColor === "w" ? g.white.rating : g.black.rating);
const winRate = (games: ImportedGame[]): number =>
  games.length ? games.filter((g) => g.playerResult === "win").length / games.length : 0;

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

const clampElo = (e: number): number => Math.max(ELO_MIN, Math.min(ELO_MAX, Math.round(e)));
const pct = (x: number): number => Math.round(x * 100);

/* ---- Weakness detectors (each gated by a minimum sample) ------------ */

/**
 * The colour you play worse. Prefer a real win-rate gap (both colours past
 * the sample floor); fall back to the colour with the higher average cp loss
 * among analysed games; then to White. Returns the colour + a reason string.
 */
function weakColor(games: ImportedGame[], analysed: ImportedGame[]): { color: "w" | "b"; detail: string } {
  const white = games.filter((g) => g.playerColor === "w");
  const black = games.filter((g) => g.playerColor === "b");

  if (white.length >= COLOR_MIN && black.length >= COLOR_MIN) {
    const wrW = winRate(white);
    const wrB = winRate(black);
    if (Math.abs(wrW - wrB) >= COLOR_GAP) {
      const weakW = wrW < wrB;
      return {
        color: weakW ? "w" : "b",
        detail: `${weakW ? pct(wrW) : pct(wrB)}% wins as ${weakW ? "White" : "Black"} vs ${
          weakW ? pct(wrB) : pct(wrW)
        }% the other side.`,
      };
    }
  }

  // Fallback: which colour do you play less accurately?
  const avgCp = (arr: ImportedGame[]): number | null => {
    const a = arr.filter((g) => g.analysis);
    if (!a.length) return null;
    return a.reduce((s, g) => s + (g.analysis!.avgCpLoss ?? 0), 0) / a.length;
  };
  const cpW = avgCp(analysed.filter((g) => g.playerColor === "w"));
  const cpB = avgCp(analysed.filter((g) => g.playerColor === "b"));
  if (cpW !== null && cpB !== null && Math.abs(cpW - cpB) >= 10) {
    const weakW = cpW > cpB;
    return {
      color: weakW ? "w" : "b",
      detail: `Higher average centipawn loss as ${weakW ? "White" : "Black"} (${Math.round(
        weakW ? cpW : cpB
      )} vs ${Math.round(weakW ? cpB : cpW)}).`,
    };
  }

  return { color: "w", detail: "No clear colour gap — defaulting to White." };
}

/** The phase where most of your mistakes + blunders land. null below the floor. */
function weakPhase(analysed: ImportedGame[]): { phase: Phase; detail: string } | null {
  const counts: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  let total = 0;
  for (const g of analysed) {
    for (const f of g.analysis!.findings) {
      if (f.quality !== "mistake" && f.quality !== "blunder") continue;
      counts[f.phase]++;
      total++;
    }
  }
  if (total < PHASE_MIN_ERRORS) return null;
  const [phase, n] = (Object.entries(counts) as [Phase, number][]).sort((a, b) => b[1] - a[1])[0];
  if (n === 0) return null;
  return {
    phase,
    detail: `${n} of ${total} of your mistakes & blunders (${pct(n / total)}%) come in the ${phase}.`,
  };
}

/** The tactical motif you miss most (intel only). */
function missedMotif(analysed: ImportedGame[]): { motif: string; detail: string } | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const g of analysed) {
    for (const f of g.analysis!.findings) {
      if (!f.motif) continue;
      counts.set(f.motif, (counts.get(f.motif) ?? 0) + 1);
      total++;
    }
  }
  if (total < MOTIF_MIN) return null;
  const [motif, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (n < MOTIF_MIN) return null;
  return { motif, detail: `${n} of ${total} missed tactics (${pct(n / total)}%) were ${motif}s.` };
}

/** The opening you score worst in, as the weak colour (intel only). */
function worstOpening(games: ImportedGame[], color: "w" | "b"): { name: string; detail: string } | null {
  const byOpening = new Map<string, ImportedGame[]>();
  for (const g of games) {
    if (g.playerColor !== color) continue;
    const key = openingKey(g);
    if (!key) continue;
    const arr = byOpening.get(key) ?? [];
    arr.push(g);
    byOpening.set(key, arr);
  }
  let worst: { name: string; wr: number; n: number } | null = null;
  for (const [name, arr] of [...byOpening].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (arr.length < OPENING_MIN) continue;
    const wr = winRate(arr);
    if (!worst || wr < worst.wr) worst = { name, wr, n: arr.length };
  }
  if (!worst || worst.wr >= 0.4) return null;
  return { name: worst.name, detail: `${pct(worst.wr)}% wins across ${worst.n} games as ${color === "w" ? "White" : "Black"}.` };
}

/* ---- Runtime helpers (Play tab) ------------------------------------- */

/**
 * Opening / middlegame / endgame from a bare FEN. The endgame test (few pieces
 * or no queens) is authoritative even at a low move number, so a pasted endgame
 * FEN with a small move counter is still classified as an endgame — exactly the
 * position an endgame-weak player would drill.
 */
export function phaseOfFen(fen: string): Phase {
  const parts = fen.split(" ");
  const board = parts[0] ?? "";
  let nonKingPieces = 0;
  let hasQueen = false;
  for (const ch of board) {
    if (/[pnbrqPNBRQ]/.test(ch)) nonKingPieces++;
    if (ch === "q" || ch === "Q") hasQueen = true;
  }
  if (nonKingPieces <= 12 || !hasQueen) return "endgame";
  const moveNo = parseInt(parts[5] ?? "1", 10) || 1;
  if (moveNo <= 10) return "opening";
  return "middlegame";
}

/** The bot's effective strength for a position: base, boosted in your weak phase. */
export function nemesisElo(plan: NemesisPlan, phase: Phase): number {
  const boost = plan.weakPhase && phase === plan.weakPhase ? plan.phaseBoostElo : 0;
  return clampElo(plan.baseElo + boost);
}

/* ---- Entry point ---------------------------------------------------- */

/**
 * Build a Nemesis from the player's games, or null if there aren't more than
 * NEMESIS_MIN_ANALYZED analysed games to read. Deterministic.
 */
export function buildNemesis(games: ImportedGame[]): NemesisPlan | null {
  const analysed = analysedOf(games);
  if (analysed.length <= NEMESIS_MIN_ANALYZED) return null;

  const color = weakColor(games, analysed);
  const phase = weakPhase(analysed);
  const motif = missedMotif(analysed);
  const opening = worstOpening(games, color.color);

  const colorGames = games.filter((g) => g.playerColor === color.color);
  const baseElo = clampElo(median(colorGames.map(playerRating)) ?? median(games.map(playerRating)) ?? 1200);
  const phaseBoostElo = phase ? PHASE_BOOST_ELO : 0;

  const targets: NemesisTarget[] = [];
  const colorWord = color.color === "w" ? "White" : "Black";
  targets.push({ key: "colour", label: `Play as ${colorWord}`, detail: color.detail, forced: true });
  if (phase) {
    targets.push({
      key: "phase",
      label: `${phase.phase[0].toUpperCase()}${phase.phase.slice(1)} pressure`,
      detail: `${phase.detail} The bot plays ~${clampElo(baseElo + phaseBoostElo)} strength here (vs ~${baseElo} elsewhere).`,
      forced: true,
    });
  }
  if (motif) targets.push({ key: "motif", label: `Misses ${motif.motif}s`, detail: motif.detail, forced: false });
  if (opening) targets.push({ key: "opening", label: opening.name, detail: opening.detail, forced: false });

  const phaseBit = phase ? ` and turns up the pressure in the ${phase.phase}` : "";
  const headline = `Built from your ${analysed.length} analysed games. You'll play ${colorWord} — your weaker side — against a bot calibrated to ~${baseElo}${phaseBit}.`;

  return {
    playerColor: color.color,
    weakPhase: phase?.phase ?? null,
    missedMotif: motif?.motif ?? null,
    worstOpening: opening?.name ?? null,
    baseElo,
    phaseBoostElo,
    headline,
    targets,
    analyzedGames: analysed.length,
  };
}
