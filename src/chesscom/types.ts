/* ------------------------------------------------------------------ */
/*  Chess.com integration — shared types (the authoritative contract).  */
/*                                                                     */
/*  Client, PGN normaliser, store, import service, and analysis all     */
/*  build against these. Chess.com is only a SOURCE of games: raw API   */
/*  shapes are normalised into ImportedGame and everything downstream    */
/*  (viewer, analysis, coach, "play from here") works off that.         */
/* ------------------------------------------------------------------ */

import type { MoveQuality } from "../engine/classify";

export type GameSource = "chess.com";

/* ---- Raw Chess.com Public API shapes (only the fields we use) ------ */

export interface ChessComProfile {
  username: string;
  player_id: number;
  url: string;
  name?: string;
  country?: string;
  joined?: number;
  last_online?: number;
}

export interface ChessComApiPlayerSide {
  username: string;
  rating: number;
  result: string; // "win" | "resigned" | "checkmated" | "timeout" | "agreed" | ...
  "@id"?: string;
  uuid?: string;
}

export interface ChessComApiGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  uuid: string;
  fen: string; // final position FEN
  time_class: string; // "rapid" | "blitz" | "bullet" | "daily"
  rules: string; // "chess" | "chess960" | ...
  white: ChessComApiPlayerSide;
  black: ChessComApiPlayerSide;
  eco?: string; // an ECO opening URL in this API (e.g. .../openings/Sicilian-Defense...)
}

export interface ChessComArchivesResponse {
  archives: string[]; // monthly archive URLs, chronological
}

export interface ChessComMonthResponse {
  games: ChessComApiGame[];
}

/* ---- Normalised, app-native game ----------------------------------- */

export interface PlayerSide {
  username: string;
  rating: number;
  result: string;
}

export type PlayerOutcome = "win" | "loss" | "draw";

/** One flagged move from a game's engine analysis. */
export interface GameFinding {
  /** 0-based half-move index of the player's move within the game. */
  ply: number;
  /** Full move number as shown in notation. */
  moveNo: number;
  fenBefore: string;
  playedSan: string;
  playedUci: string;
  bestSan?: string;
  bestUci?: string;
  quality: MoveQuality;
  cpLoss: number;
  phase: "opening" | "middlegame" | "endgame";
  /** Set when the played move allowed the opponent a forced mate. */
  allowsMateIn?: number;
  /** A strong move that gives up material and is still the engine's top choice. */
  brilliant?: boolean;
}

/** Every analysed player move's quality — drives per-move badges and counts. */
export interface MoveQualityEntry {
  ply: number;
  quality: MoveQuality;
  brilliant?: boolean;
}

export interface GameAnalysis {
  /** Notable errors (inaccuracy/mistake/blunder) — also what the coach insights read. */
  findings: GameFinding[];
  /** Brilliant moves (best + a material sacrifice), highlighted alongside findings. */
  brilliancies: GameFinding[];
  /** Quality of every analysed player move, for move-list badges. */
  moveQualities: MoveQualityEntry[];
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  good: number;
  best: number;
  brilliant: number;
  /** Average centipawn loss across the player's analysed moves. */
  avgCpLoss: number;
  analyzedAt: number; // unix ms
}

export interface ImportedGame {
  uuid: string; // stable Chess.com id — the dedup key
  url: string; // chess.com game URL
  source: GameSource;
  account: string; // the imported username, lowercased
  pgn: string;
  moves: string[]; // SAN, in order
  startFen: string; // starting position (standard unless the PGN says otherwise)
  finalFen: string;
  timeControl: string;
  timeClass: string;
  rated: boolean;
  eco?: string; // ECO code if derivable, else the opening name/URL tail
  ecoUrl?: string;
  white: PlayerSide;
  black: PlayerSide;
  endTime: number; // unix seconds
  playerColor: "w" | "b"; // which side the imported account played
  playerResult: PlayerOutcome; // from the imported account's perspective
  opponent: string;
  opponentRating: number;
  analyzed: boolean;
  analysis?: GameAnalysis;
}

/* ---- Import bookkeeping -------------------------------------------- */

export interface ImportSummary {
  fetched: number; // games seen across processed archives
  inserted: number; // new games stored
  duplicates: number; // already present (by uuid)
  failedToParse: number;
  archivesProcessed: number;
  lastImport: number; // unix ms
}

export interface ImportRecord {
  username: string; // lowercased
  lastImport: number; // unix ms
  archivesProcessed: string[]; // archive URLs fully imported (skip on re-run unless forced)
  total: number; // games stored for this account
}

/* ---- Storage seam (IndexedDB in prod, in-memory fake in tests) ----- */

export interface GameStore {
  getGame(uuid: string): Promise<ImportedGame | undefined>;
  hasGame(uuid: string): Promise<boolean>;
  putGame(game: ImportedGame): Promise<void>;
  putGames(games: ImportedGame[]): Promise<void>;
  gamesByAccount(account: string): Promise<ImportedGame[]>;
  allGames(): Promise<ImportedGame[]>;
  getImportRecord(username: string): Promise<ImportRecord | undefined>;
  putImportRecord(rec: ImportRecord): Promise<void>;
}

/* ---- Coach-facing insight ----------------------------------------- */

export interface Insight {
  id: string;
  severity: "info" | "warn" | "strong";
  title: string;
  detail: string;
  tags: string[];
}
