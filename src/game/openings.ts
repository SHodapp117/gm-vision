/* ------------------------------------------------------------------ */
/*  Opening book — authored lines compiled into a POSITION-KEYED book.  */
/*                                                                     */
/*  Each opening is a MAIN line (index 0) plus a few variation lines,   */
/*  all validated move-by-move against chess.js. They compile into a    */
/*  position-keyed book, so the guide and bot look up the current       */
/*  position rather than a linear line — sidelines and transpositions    */
/*  just work instead of dead-ending the guide. Shared by the Play       */
/*  trainer and the mid-game "start from an opening" setup.              */
/* ------------------------------------------------------------------ */

import { Chess, type Square } from "chess.js";

export const OPENING_LINES: Record<string, string[][]> = {
  "Ruy Lopez": [
    ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O"],
    ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "O-O", "f6", "d4", "exd4", "Qxd4", "Qxd4", "Nxd4"],
    ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "O-O", "Nxe4", "d4", "Nd6", "Bxc6", "dxc6", "dxe5", "Nf5", "Qxd8+", "Kxd8"],
    ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "O-O", "c3", "d5", "exd5", "Nxd5"],
  ],
  "Italian Game": [
    ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O", "a4", "a5"],
    ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5", "Bb5+", "c6", "dxc6", "bxc6", "Be2", "h6"],
    ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4", "Bxb4", "c3", "Ba5", "d4", "exd4", "O-O"],
    ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+", "Nc3", "Nxe4"],
  ],
  "Scotch Game": [
    ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4", "Nf6", "Nxc6", "bxc6", "e5", "Qe7", "Qe2", "Nd5"],
    ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4", "Bc5", "Be3", "Qf6", "c3", "Nge7", "Bc4", "Ne5"],
    ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4", "Nf6", "Nxc6", "bxc6", "e5", "Qe7", "Qe2", "Nd5", "c4", "Ba6"],
  ],
  "Vienna Game": [
    ["e4", "e5", "Nc3", "Nf6", "f4", "d5", "fxe5", "Nxe4", "Nf3", "Be7", "d3", "Nxc3"],
    ["e4", "e5", "Nc3", "Nf6", "f4", "d5", "fxe5", "Nxe4", "Nf3", "Bg4", "Qe2", "Nxc3", "dxc3"],
    ["e4", "e5", "Nc3", "Nf6", "Bc4", "Nc6", "d3", "Bb4", "Bg5", "h6"],
  ],
  "Sicilian Najdorf": [
    ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be2", "e5", "Nb3", "Be7", "O-O", "O-O"],
    ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be3", "e5", "Nb3", "Be6"],
    ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Bg5", "e6", "f4", "Be7"],
  ],
  "French Defense": [
    ["e4", "e6", "d4", "d5", "Nc3", "Nf6", "Bg5", "Be7", "e5", "Nfd7", "Bxe7", "Qxe7", "f4", "a6", "Nf3", "c5"],
    ["e4", "e6", "d4", "d5", "Nc3", "Bb4", "e5", "c5", "a3", "Bxc3+", "bxc3", "Ne7"],
    ["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6", "Nf3", "Qb6"],
    ["e4", "e6", "d4", "d5", "Nd2", "Nf6", "e5", "Nfd7", "Bd3", "c5", "c3", "Nc6"],
  ],
  "Caro-Kann": [
    ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6", "h4", "h6", "Nf3", "Nd7"],
    ["e4", "c6", "d4", "d5", "e5", "Bf5", "Nf3", "e6", "Be2", "c5"],
    ["e4", "c6", "d4", "d5", "exd5", "cxd5", "Bd3", "Nc6", "c3", "Nf6"],
    ["e4", "c6", "d4", "d5", "exd5", "cxd5", "c4", "Nf6", "Nc3", "e6"],
  ],
  "Scandinavian": [
    ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "Nf6", "Nf3", "c6", "Bc4", "Bf5", "Bd2", "e6"],
    ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qd6", "d4", "Nf6", "Nf3", "a6"],
    ["e4", "d5", "exd5", "Nf6", "d4", "Nxd5", "Nf3", "g6"],
  ],
  "Pirc Defense": [
    ["e4", "d6", "d4", "Nf6", "Nc3", "g6", "f4", "Bg7", "Nf3", "O-O", "Be2", "c5"],
    ["e4", "d6", "d4", "Nf6", "Nc3", "g6", "Nf3", "Bg7", "Be2", "O-O", "O-O"],
    ["e4", "d6", "d4", "Nf6", "Nc3", "g6", "Be3", "Bg7", "Qd2", "c6"],
  ],
  "Queen's Gambit Declined": [
    ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "h6", "Bh4", "b6"],
    ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5", "Bg5", "Be7", "e3", "O-O"],
    ["d4", "d5", "c4", "e6", "Nc3", "c5", "cxd5", "exd5", "Nf3", "Nc6"],
    ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Nf3", "c6", "Bg5", "h6", "Bh4", "dxc4"],
  ],
  "Slav Defense": [
    ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "dxc4", "a4", "Bf5", "e3", "e6", "Bxc4", "Bb4"],
    ["d4", "d5", "c4", "c6", "cxd5", "cxd5", "Nc3", "Nf6", "Nf3", "Nc6"],
    ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6", "e3", "Nbd7"],
  ],
  "King's Indian Defense": [
    ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6"],
    ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "Nf3", "O-O", "g3", "d6", "Bg2", "Nbd7"],
    ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f3", "O-O", "Be3", "e5"],
    ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f4", "O-O", "Nf3", "c5"],
  ],
  "Nimzo-Indian Defense": [
    ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "e3", "O-O", "Bd3", "d5", "Nf3", "c5", "O-O", "Nc6"],
    ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "Qc2", "O-O", "a3", "Bxc3+", "Qxc3", "b6"],
    ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "Nf3", "c5", "g3", "cxd4"],
    ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "Bg5", "h6", "Bh4", "c5"],
  ],
  "London System": [
    ["d4", "d5", "Nf3", "Nf6", "Bf4", "e6", "e3", "c5", "c3", "Nc6", "Nbd2", "Bd6", "Bg3", "O-O"],
    ["d4", "Nf6", "Nf3", "g6", "Bf4", "Bg7", "e3", "O-O", "Be2", "d6", "h3"],
    ["d4", "d5", "Nf3", "Nf6", "Bf4", "c5", "e3", "Qb6", "Nc3", "c4"],
  ],
  "English Opening": [
    ["c4", "e5", "Nc3", "Nf6", "Nf3", "Nc6", "g3", "d5", "cxd5", "Nxd5", "Bg2", "Nb6", "O-O", "Be7"],
    ["c4", "c5", "Nc3", "Nc6", "g3", "g6", "Bg2", "Bg7", "Nf3", "Nf6", "O-O", "O-O"],
    ["c4", "e5", "Nc3", "Nf6", "Nf3", "Nc6", "e3", "Bb4"],
    ["c4", "Nf6", "Nc3", "g6", "g3", "Bg7", "Bg2", "O-O"],
  ],
};

export type OpeningName = keyof typeof OPENING_LINES;

/** Position key: FEN without the half/full-move clocks, so transpositions match. */
export const posKey = (fen: string): string => fen.split(" ").slice(0, 4).join(" ");

export interface BookMove {
  san: string;
  from: Square;
  to: Square;
  piece: string; // moving piece type — drives the guide arrow hue
  main: boolean; // belongs to the opening's main line (line 0)
}
export type BookMap = Record<string, BookMove[]>;

/** Replay every authored line and index each position → the book moves from it. */
export function compileOpening(lines: string[][]): BookMap {
  const map: BookMap = {};
  lines.forEach((line, lineIdx) => {
    const g = new Chess();
    for (const san of line) {
      const key = posKey(g.fen());
      let mv;
      try {
        mv = g.move(san);
      } catch {
        break; // lines are pre-validated, but never trust — bail this line
      }
      if (!mv) break;
      const entry = (map[key] ||= []);
      if (!entry.some((e) => e.san === mv.san)) {
        entry.push({ san: mv.san, from: mv.from, to: mv.to, piece: mv.piece, main: lineIdx === 0 });
      }
    }
  });
  return map;
}

export const OPENING_BOOKS: Record<string, BookMap> = Object.fromEntries(
  Object.entries(OPENING_LINES).map(([name, lines]) => [name, compileOpening(lines)])
);

/** Book moves known at this position for the given opening ([] if out of book). */
export function bookMovesAtFen(fen: string, opening: string): BookMove[] {
  return OPENING_BOOKS[opening]?.[posKey(fen)] ?? [];
}

/** The main-preferred book move from a set of entries. */
export function pickBookMove(entries: BookMove[]): BookMove | null {
  if (!entries.length) return null;
  return entries.find((e) => e.main) ?? entries[0];
}

export interface BookHint {
  from: Square;
  to: Square;
  san: string;
  piece: string; // moving piece type — drives the arrow hue
  alts: number; // how many OTHER book moves exist at this position
}

/** The main-preferred book move at the CURRENT position (null if out of book). */
export function nextBookMove(game: Chess, openingName: string): BookHint | null {
  const entries = bookMovesAtFen(game.fen(), openingName);
  const pick = pickBookMove(entries);
  if (!pick) return null;
  return { from: pick.from, to: pick.to, san: pick.san, piece: pick.piece, alts: entries.length - 1 };
}

/**
 * Replay an opening's MAIN line `fullMoves` full moves deep (2·fullMoves plies,
 * clamped to the line length) for mid-game training. Returns the resulting FEN
 * and the SAN history that produced it, or null if the opening is unknown.
 */
export function openingPositionFen(
  name: string,
  fullMoves: number
): { fen: string; history: string[]; sideToMove: "w" | "b" } | null {
  const line = OPENING_LINES[name]?.[0];
  if (!line) return null;
  const plies = Math.max(0, Math.min(line.length, Math.round(fullMoves * 2)));
  const g = new Chess();
  const history: string[] = [];
  for (let i = 0; i < plies; i++) {
    try {
      const mv = g.move(line[i]);
      if (!mv) break;
      history.push(mv.san);
    } catch {
      break;
    }
  }
  return { fen: g.fen(), history, sideToMove: g.turn() };
}
