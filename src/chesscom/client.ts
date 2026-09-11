/* ------------------------------------------------------------------ */
/*  Chess.com Public API client — thin, retrying fetch wrapper.         */
/*                                                                      */
/*  No API key: chess.com's "pub" API is unauthenticated and read-only. */
/*  We validate usernames before ever building a URL, retry transient   */
/*  failures (429 / 5xx) with exponential backoff, and normalise every  */
/*  failure mode into a typed ChessComError so callers can branch on    */
/*  `.kind` instead of parsing messages. `fetchFn` is injectable so     */
/*  tests can run without a network or a DOM `fetch`.                   */
/* ------------------------------------------------------------------ */

import type { ChessComApiGame, ChessComArchivesResponse, ChessComMonthResponse, ChessComProfile } from "./types";

const BASE_URL = "https://api.chess.com/pub";
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 3;
const RETRY_BASE_MS = 500;

/** Usernames chess.com allows: 3–25 chars of letters, digits, underscore, hyphen. */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u.trim());
}

export type ChessComErrorKind = "invalid-username" | "rate-limited" | "network" | "http" | "not-found";

export class ChessComError extends Error {
  kind: ChessComErrorKind;
  status?: number;

  constructor(kind: ChessComErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ChessComError";
    this.kind = kind;
    this.status = status;
  }
}

export interface ChessComClient {
  getProfile(username: string): Promise<ChessComProfile>;
  getArchives(username: string): Promise<string[]>;
  getMonthGames(archiveUrl: string): Promise<ChessComApiGame[]>;
}

export interface CreateClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

/** Sleep, but let callers await it inline in the retry loop below. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClient(opts?: CreateClientOptions): ChessComClient {
  const fetchFn = opts?.fetchFn ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;

  /** GET `url` as JSON, retrying 429/5xx with exponential backoff. */
  async function getJson<T>(url: string): Promise<T> {
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      } catch {
        clearTimeout(timer);
        // Network failure or abort — not retried, since a hung/unreachable
        // host is unlikely to recover within this call.
        throw new ChessComError("network", `Network error fetching ${url}`);
      }
      clearTimeout(timer);

      if (res.ok) {
        return (await res.json()) as T;
      }

      if (res.status === 404) {
        throw new ChessComError("not-found", `Not found: ${url}`, 404);
      }

      lastStatus = res.status;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        await delay(RETRY_BASE_MS * 2 ** attempt);
        continue;
      }
      if (res.status === 429) {
        throw new ChessComError("rate-limited", `Rate limited fetching ${url}`, res.status);
      }
      throw new ChessComError("http", `HTTP ${res.status} fetching ${url}`, res.status);
    }
    // Unreachable in practice (the loop always returns or throws), but keeps
    // control flow analysis happy.
    throw new ChessComError("http", `HTTP ${lastStatus ?? "error"} fetching ${url}`, lastStatus);
  }

  function requireValidUsername(username: string): string {
    if (!isValidUsername(username)) {
      throw new ChessComError("invalid-username", `Invalid chess.com username: "${username}"`);
    }
    return username.trim();
  }

  return {
    async getProfile(username) {
      const u = requireValidUsername(username);
      return getJson<ChessComProfile>(`${BASE_URL}/player/${u}`);
    },

    async getArchives(username) {
      const u = requireValidUsername(username);
      const res = await getJson<ChessComArchivesResponse>(`${BASE_URL}/player/${u}/games/archives`);
      return res.archives;
    },

    async getMonthGames(archiveUrl) {
      const res = await getJson<ChessComMonthResponse>(archiveUrl);
      return res.games ?? [];
    },
  };
}
