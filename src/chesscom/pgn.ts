/* ------------------------------------------------------------------ */
/*  PGN normaliser — turns a raw Chess.com API game into an ImportedGame. */
/*                                                                      */
/*  Chess.com PGNs sometimes carry clock/eval comments or NAG glyphs     */
/*  that trip older PGN parsers; chess.js v1 is usually fine with them,  */
/*  but if `loadPgn` throws we strip that annotation noise and retry     */
/*  once before giving up. Everything downstream (viewer, analysis,      */
/*  coach) only ever sees the normalised ImportedGame shape.             */
/* ------------------------------------------------------------------ */

import { Chess } from "chess.js";
import type { ChessComApiGame, ImportedGame, PlayerOutcome, PlayerSide } from "./types";

const STANDARD_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const LOSS_RESULTS = new Set([
  "checkmated",
  "resigned",
  "timeout",
  "abandoned",
  "lose",
  "kingofthehill",
  "threecheck",
  "bughousepartnerlose",
]);

const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

/** Strip `{...}` comments (clock/eval annotations) and NAG `$n` tokens. */
function stripAnnotations(pgn: string): string {
  return pgn.replace(/\{[^}]*\}/g, "").replace(/\$\d+/g, "");
}

/** Load a PGN with chess.js, retrying once with annotations stripped. */
function loadPgnLeniently(pgn: string): Chess {
  const g = new Chess();
  try {
    g.loadPgn(pgn);
    return g;
  } catch {
    const stripped = new Chess();
    stripped.loadPgn(stripAnnotations(pgn));
    return stripped;
  }
}

/** Map a raw Chess.com `result` string to a win/loss/draw outcome. */
function outcomeFromResult(result: string): PlayerOutcome | undefined {
  if (result === "win") return "win";
  if (LOSS_RESULTS.has(result)) return "loss";
  if (DRAW_RESULTS.has(result)) return "draw";
  return undefined;
}

const OPPOSITE: Record<PlayerOutcome, PlayerOutcome> = { win: "loss", loss: "win", draw: "draw" };

/** The player's outcome, falling back to the opponent's (inverted) result, then "draw". */
function resolveOutcome(playerResult: string, opponentResult: string): PlayerOutcome {
  const direct = outcomeFromResult(playerResult);
  if (direct) return direct;
  const opponent = outcomeFromResult(opponentResult);
  if (opponent) return OPPOSITE[opponent];
  return "draw";
}

/** Last URL path segment, hyphens turned into spaces, for a readable opening name. */
function ecoNameFromUrl(url: string): string | undefined {
  const tail = url.split("/").filter(Boolean).pop();
  if (!tail) return undefined;
  return tail.replace(/-/g, " ");
}

export function normalizeGame(apiGame: ChessComApiGame, account: string): ImportedGame {
  const g = loadPgnLeniently(apiGame.pgn);
  const moves = g.history();
  const header = g.header();

  const white: PlayerSide = {
    username: apiGame.white.username,
    rating: apiGame.white.rating,
    result: apiGame.white.result,
  };
  const black: PlayerSide = {
    username: apiGame.black.username,
    rating: apiGame.black.rating,
    result: apiGame.black.result,
  };

  const playerColor: "w" | "b" = apiGame.white.username.toLowerCase() === account.toLowerCase() ? "w" : "b";
  const playerSide = playerColor === "w" ? apiGame.white : apiGame.black;
  const opponentSide = playerColor === "w" ? apiGame.black : apiGame.white;
  const playerResult = resolveOutcome(playerSide.result, opponentSide.result);

  return {
    uuid: apiGame.uuid,
    url: apiGame.url,
    source: "chess.com",
    account: account.toLowerCase(),
    pgn: apiGame.pgn,
    moves,
    startFen: header.FEN ?? STANDARD_START_FEN,
    finalFen: apiGame.fen,
    timeControl: apiGame.time_control,
    timeClass: apiGame.time_class,
    rated: apiGame.rated,
    eco: apiGame.eco ? ecoNameFromUrl(apiGame.eco) : undefined,
    ecoUrl: apiGame.eco,
    white,
    black,
    endTime: apiGame.end_time,
    playerColor,
    playerResult,
    opponent: opponentSide.username,
    opponentRating: opponentSide.rating,
    analyzed: false,
  };
}
