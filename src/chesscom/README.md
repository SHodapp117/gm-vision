# Chess.com integration (`src/chesscom/`)

Read-only import of a player's Chess.com games into GM Vision, using the
**[Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api)**
(the unauthenticated "pub" API). Chess.com is treated purely as a *source of
games* — everything downstream (viewer, engine analysis, coach, "Play from
here") runs on the normalised `ImportedGame` shape, not on anything
Chess.com-specific. The whole thing is **client-side**: GM Vision has no
backend, so the browser calls the API directly (CORS is allowed) and games are
stored in **IndexedDB**.

## Endpoints used
- `GET /pub/player/{username}` — profile / existence check.
- `GET /pub/player/{username}/games/archives` — list of monthly archive URLs.
- `GET {archiveUrl}` (`/pub/player/{username}/games/{YYYY}/{MM}`) — a month of games.

No API key is required or used. The browser forbids setting `User-Agent`, so we
don't; the pub API serves anonymous cross-origin requests fine.

## Module map
| File | Responsibility |
|------|----------------|
| `types.ts` | The authoritative contract: raw API shapes, `ImportedGame`, `GameAnalysis`, `Insight`, and the `GameStore` seam. |
| `client.ts` | `createClient()` — validates usernames (`isValidUsername`), timeouts (AbortController), retries 429/5xx with backoff, maps every failure to a typed `ChessComError` (`kind`: invalid-username / not-found / rate-limited / network / http). `fetchFn` is injectable for tests. |
| `pgn.ts` | `normalizeGame(apiGame, account)` — chess.js `loadPgn` (retries with clock/NAG comments stripped), derives SAN moves, the account's colour + win/loss/draw, opponent, ECO. |
| `store.ts` | `createIndexedDbStore()` (prod) and `createMemoryStore()` (tests) — both implement `GameStore`. DB `gmvision`, stores `games` (key `uuid`) and `imports` (key `username`). |
| `import.ts` | `importGames(client, store, username, opts)` — idempotent import (see below). |
| `analyzeGame.ts` | `analyzeGame(game, analyze, opts)` — replays the game and classifies the player's moves via `engine/classify.ts` (`evaluateMove`); returns a `GameAnalysis` (per-move qualities incl. good/best/brilliant). Each flagged finding is also tagged with the tactical **motif** it missed (mate/fork/pin, via `engine/tactics.ts`) and the **clock** at that move (parsed from the PGN's `%clk` tags in `pgn.ts`). `analyzeGames(games, analyze, {onGame,onProgress,signal})` batch-analyzes sequentially, persisting each, cancellable. Engine is injected. |
| `insights.ts` | Engine-tier pattern miners over analysed games. `engineInsights(games)` (error rate, blunders-by-phase, castling) feeds the Coach Report; `buildInsights(games)` is the capped 5-insight variant. Exports the shared helpers `openingKey`/`moverColors`/`analysedGames`/`slugify`. Pure. |
| `generatePuzzles.ts` | `generatePuzzles(games)` — turns each analysed mistake/blunder into a `GeneratedPuzzle` (the existing `Puzzle` shape + source metadata): setup FEN, `moves` = opponent's move + your best move, so it plugs straight into the Puzzles solver. Pure/derived-on-demand, no extra persistence. |
| `metaReport.ts` | `buildCoachReport(games)` — the whole-history meta-analysis. Metadata-tier detectors (win rate by colour / time control / opening / opponent strength, how-you-lose, rating trend) over ALL games, merged with `engineInsights` over analysed games, into a headline + stats + prioritized, actionable recommendations (each with a tip and example-game uuids). Pure/deterministic. |

UI lives in `src/GameLibrary.tsx` (the **Games** tab), wired in `src/App.tsx`.

## Import architecture & deduplication
```
username → getArchives → last N months (default 3) → getMonthGames
        → normalizeGame → dedup by game uuid → store.putGames → ImportRecord
```
- **Dedup key is the Chess.com game `uuid`** (stable), never timestamps.
- **Idempotent.** A past (ended) month, once imported, is recorded in
  `ImportRecord.archivesProcessed` and skipped on re-runs. The **current month is
  never marked processed** (it's still growing) — it's always re-scanned, and the
  uuid dedup makes that a no-op for games already stored. So "Import New Games"
  reliably picks up only new games. `force: true` re-scans everything.
- `maxGames` (default 300) caps insertions per run; a month cut off by the cap is
  left unmarked so the next run finishes it.

## Analysis
On-demand, per selected game (not bulk) — no server jobs. `analyzeGame` calls the
bundled Stockfish (`engine/stockfish.ts` `getEngine().analyze`) through the
existing `evaluateMove` classifier (~300 ms/move). The headline **avg cp loss caps
each move at 1000cp** so a single forced-mate swing (encoded as ~100000cp by
`classify.ts`) doesn't dominate the average; individual findings keep true values.

## Running / testing
- Use it: open the **Games** tab, enter a Chess.com username, pick a month range,
  **Import Games**. Select a game to replay it, **Analyze game**, or **Play from
  here** (loads the position into the Play tab).
- Logic tests (no DOM needed) live in the session scratchpad and run via the
  repo's esbuild → node harness (bundling drops the type-only `./types` import and
  inlines chess.js): core (client/pgn/import with an in-memory `GameStore`),
  analysis (stubbed `analyze`), and insights. IndexedDB (`store.ts`) is covered by
  the build + live use, since Node has no IndexedDB.

## Rate limits
The pub API is generous but can 429 under bursts; `client.ts` backs off and
retries, then surfaces a `rate-limited` error. Imports fetch one archive at a time.

## Future extension points (not built)
- **OAuth / private data**: `client.ts` is the only Chess.com-aware module — add
  an authenticated variant there without touching import/analysis/UI.
- **Other sources (Lichess)**: `ImportedGame.source` + the `GameStore` seam are
  source-agnostic; a second client + normaliser slots in behind the same store.
- **Auto puzzles from blunders**, **stats dashboard**, **periodic/auto import**:
  the `GameAnalysis.findings` already carry FEN/best-move/theme metadata for these.
