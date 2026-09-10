/* ------------------------------------------------------------------ */
/*  Board-control / attack helpers (geometry, not legal-move based).   */
/*                                                                     */
/*  Shared by the Play trainer's vision layers and the Move Explorer's */
/*  explanations. `buildAttackMap` returns squareName -> attacker piece */
/*  types; "control" includes defended own pieces (sliders stop AT the  */
/*  first occupied square, which is still counted as controlled).       */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export const PIECE_NAME: Record<string, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export type AttackMap = Record<string, string[]>;

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const sqName = (r: number, c: number) => `${FILES[c]}${8 - r}`;
const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

export function buildAttackMap(game: Chess, color: "w" | "b"): AttackMap {
  const board = game.board(); // board[0] = rank 8, [7] = rank 1
  const map: AttackMap = {};
  const add = (r: number, c: number, type: string) => {
    if (!inBounds(r, c)) return;
    const key = sqName(r, c);
    (map[key] ||= []).push(type);
  };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;

      switch (piece.type) {
        case "p": {
          const dir = color === "w" ? -1 : 1; // white advances toward rank 8 (lower r)
          add(r + dir, c - 1, "p");
          add(r + dir, c + 1, "p");
          break;
        }
        case "n":
          KNIGHT_OFFSETS.forEach(([dr, dc]) => add(r + dr, c + dc, "n"));
          break;
        case "k":
          KING_OFFSETS.forEach(([dr, dc]) => add(r + dr, c + dc, "k"));
          break;
        case "b":
        case "r":
        case "q": {
          const dirs =
            piece.type === "b"
              ? BISHOP_DIRS
              : piece.type === "r"
              ? ROOK_DIRS
              : [...BISHOP_DIRS, ...ROOK_DIRS];
          dirs.forEach(([dr, dc]) => {
            let nr = r + dr;
            let nc = c + dc;
            while (inBounds(nr, nc)) {
              add(nr, nc, piece.type);
              if (board[nr][nc]) break; // stop at first occupied square (still controlled)
              nr += dr;
              nc += dc;
            }
          });
          break;
        }
      }
    }
  }
  return map;
}

/** Squares where `color` has a hanging piece (attacked & (undefended OR by lower value)). */
export function findHangingPieces(game: Chess, color: "w" | "b") {
  const board = game.board();
  const oppMap = buildAttackMap(game, color === "w" ? "b" : "w");
  const ownMap = buildAttackMap(game, color);
  const hanging: { square: string; type: string; minAttacker: number; defended: boolean }[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color || piece.type === "k") continue;
      const name = sqName(r, c);
      const attackers = oppMap[name];
      if (!attackers?.length) continue;

      const minAttacker = Math.min(...attackers.map((t) => PIECE_VALUE[t]));
      const defended = !!ownMap[name]?.length;
      const pieceVal = PIECE_VALUE[piece.type];

      if (!defended || minAttacker < pieceVal) {
        hanging.push({ square: name, type: piece.type, minAttacker, defended });
      }
    }
  }
  return hanging;
}
