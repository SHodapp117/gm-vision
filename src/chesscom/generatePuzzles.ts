/* ------------------------------------------------------------------ */
/*  Auto-generated puzzles — turn your own blunders into tactics.       */
/*                                                                      */
/*  Every analysed game's mistake/blunder finding becomes a one-move    */
/*  puzzle: "here is the position where you went wrong — find the move  */
/*  you missed." Output is the SAME `Puzzle` shape the Puzzles tab       */
/*  already solves (Lichess convention: `fen` is BEFORE a setup move,   */
/*  `moves[0]` is the opponent's move into the position, `moves[1]` is   */
/*  the solver's move), so it plugs straight into the existing solver.  */
/*  Pure/deterministic — derived on demand from stored games, no extra   */
/*  persistence. Source metadata rides along for the UI + drill-in.      */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";
import type { Puzzle } from "../data/puzzles";
import type { ImportedGame } from "./types";

/** A Puzzle built from one of the player's own analysed mistakes. */
export interface GeneratedPuzzle extends Puzzle {
  sourceUuid: string; // the imported game's uuid
  sourceUrl: string; // chess.com game URL
  opponent: string;
  moveNo: number; // full move number where the mistake happened
  playerColor: "w" | "b"; // side the solver plays
  playedSan: string; // the move you actually played (the error)
  bestSan?: string; // the move you should have found
  quality: "mistake" | "blunder";
}

const uciOf = (m: { from: string; to: string; promotion?: string }): string =>
  `${m.from}${m.to}${m.promotion ?? ""}`;

const playerRating = (g: ImportedGame): number => (g.playerColor === "w" ? g.white.rating : g.black.rating);

/** Difficulty proxy: the player's rating in that game, clamped to a sane band. */
function puzzleRating(g: ImportedGame): number {
  const r = Math.round(playerRating(g));
  if (!Number.isFinite(r) || r <= 0) return 1200;
  return Math.max(600, Math.min(2800, r));
}

/**
 * Build a single puzzle from a game + one finding, or null if it can't be
 * reconstructed (opening-move blunder with no prior setup move, illegal
 * replay, or a missing/illegal best move).
 */
function puzzleFromFinding(game: ImportedGame, ply: number, bestUci: string | undefined): GeneratedPuzzle | null {
  if (ply < 1 || !bestUci || bestUci.length < 4) return null;
  const finding = game.analysis!.findings.find((f) => f.ply === ply);
  if (!finding || (finding.quality !== "mistake" && finding.quality !== "blunder")) return null;

  try {
    const g = new Chess(game.startFen);
    for (let i = 0; i < ply - 1; i++) g.move(game.moves[i]);
    const setupFen = g.fen(); // opponent to move here
    const setupMove = g.move(game.moves[ply - 1]); // the opponent's move into the position
    if (!setupMove) return null;
    const setupUci = uciOf(setupMove);

    // The solver's move must be legal in the position now on the board.
    const solveClone = new Chess(g.fen());
    const solved = solveClone.move({
      from: bestUci.slice(0, 2),
      to: bestUci.slice(2, 4),
      promotion: bestUci.length > 4 ? bestUci.slice(4, 5) : undefined,
    });
    if (!solved) return null;

    const themes: string[] = [finding.quality, finding.phase];
    if (finding.allowsMateIn) themes.push("mate");

    return {
      id: `${game.uuid}-${ply}`,
      fen: setupFen,
      moves: `${setupUci} ${bestUci}`,
      rating: puzzleRating(game),
      themes,
      sourceUuid: game.uuid,
      sourceUrl: game.url,
      opponent: game.opponent,
      moveNo: finding.moveNo,
      playerColor: game.playerColor,
      playedSan: finding.playedSan,
      bestSan: finding.bestSan,
      quality: finding.quality,
    };
  } catch {
    return null;
  }
}

/**
 * All puzzles derivable from the player's analysed mistakes, hardest-error
 * first (blunders before mistakes, then by move number). Deduped by id.
 */
export function generatePuzzles(games: ImportedGame[]): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = [];
  const seen = new Set<string>();

  for (const game of games) {
    if (!game.analyzed || !game.analysis) continue;
    for (const f of game.analysis.findings) {
      if (f.quality !== "mistake" && f.quality !== "blunder") continue;
      const puzzle = puzzleFromFinding(game, f.ply, f.bestUci);
      if (!puzzle || seen.has(puzzle.id)) continue;
      seen.add(puzzle.id);
      out.push(puzzle);
    }
  }

  const rank = (p: GeneratedPuzzle) => (p.quality === "blunder" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.moveNo - b.moveNo);
}
