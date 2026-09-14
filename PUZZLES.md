# Puzzle Dataset

## Source & license

**Primary data**: the official [Lichess open puzzle database](https://database.lichess.org/#puzzles), released under **CC0 1.0** (public domain — no attribution legally required, but credited here anyway). Home page: https://database.lichess.org/

**Access path actually used**: this sandbox's network policy blocks `lichess.org` / `database.lichess.org` outright (verified — TLS interception / plain-HTTP both return a corporate content-filter "ACCESS DENIED" page, not a Lichess response). Per the task's documented fallback, the same CC0 data was pulled instead from the official HuggingFace mirror **[`Lichess/chess-puzzles`](https://huggingface.co/datasets/Lichess/chess-puzzles)** (parquet format, license `cc0-1.0`, regenerated monthly straight from the Lichess database — last updated 2026-09-07, 6,100,960 puzzles total). Row-range HTTP requests (via the pure-JS [`hyparquet`](https://www.npmjs.com/package/hyparquet) reader) were used to fetch only the row groups needed, rather than downloading the full ~876MB/3-shard dataset — in practice a single row group (~490k rows, of which only the first ~8,900 needed to be scanned) was enough to fill every rating band.

Both sources carry identical fields (`PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl/GameId, OpeningTags`) — the HuggingFace copy is a straight parquet re-encoding of the CSV, not a derived/altered dataset.

No raw downloaded file (`.csv.zst` or `.parquet`) is committed to this repo — only the curated subset below.

## Files

- `public/data/puzzles.json` — curated array of 24,073 puzzles (~4.3MB). Served as a **static asset and fetched at runtime**, not bundled into the JS — so it never weighs down the app bundle and the browser caches it after the first load.
- `src/data/puzzles.ts` — the runtime loader: the `Puzzle` interface, an (initially empty) `puzzles: Puzzle[]` filled in place by `loadPuzzles()` (fetches `${BASE_URL}data/puzzles.json` once, idempotent), `puzzlesLoaded()`, plus `puzzlesByTheme()` / `puzzlesInRatingRange()` helpers. The Puzzles tab `await`s `loadPuzzles()` on mount (showing a loading state) before selecting.
- `scripts/build-puzzles.mjs` — the (re)builder, writing to `public/data/puzzles.json`. Additive: keeps every puzzle already there and tops each rating band up to a target, deduping by id. See **Rebuilding / expanding** below.

## Fields kept (renamed, everything else dropped)

| Field    | Type       | Description |
|----------|-----------|-------------|
| `id`     | `string`   | Lichess `PuzzleId`, e.g. `"00008"`. Unique within this dataset. |
| `fen`    | `string`   | FEN of the position **before** the setup move — see convention below. |
| `moves`  | `string`   | Space-separated UCI moves, e.g. `"f2g3 e6e7 b2b1 b3c1 b1c1 h6c1"`. |
| `rating` | `number`   | Lichess Glicko-2-derived puzzle rating. |
| `themes` | `string[]` | Lichess theme tags, e.g. `["fork", "middlegame", "advantage"]`. |

Dropped: `RatingDeviation`, `Popularity`, `NbPlays`, `GameUrl`/`GameId`, `OpeningTags`.

## ⚠️ Critical convention for the tactics UI

**The Lichess `FEN` is the position BEFORE the "setup" move, not the puzzle's starting position as shown to the solver.**

- `moves[0]` is the **opponent's move** that creates the tactic. Play this move first, automatically, before showing the board to the user.
- `moves[1]` is the **solver's first move** — this is what the user needs to find.
- `moves[2]` is the engine's reply, `moves[3]` the solver's second move, and so on, strictly alternating.

Example: `id: "00008"`, `fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24"`, `moves: "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1"`.
To present this puzzle: load the FEN, silently play `f2g3`, then prompt the solver to find `e6e7`. If they play it, auto-play the engine's `b2b1`, then prompt for `b3c1`, etc.

Getting this backwards (showing the raw FEN and asking for `moves[0]`) is a very common and very confusing bug — the "puzzle" would appear to be the opponent's move, not the solver's.

## Curation method

- Balanced across 7 rating bands, target ~3,500 puzzles each (24,073 total). The
  2300+ band is the rarest in the source (~7% of rows) and came up a little short
  at 3,073 when the datasets-server had a transient outage mid-scan — re-run the
  additive script (below) to top it off when the endpoint is healthy:

  | Band | Count |
  |------|-------|
  | 600–999 | 3,500 |
  | 1000–1249 | 3,500 |
  | 1250–1499 | 3,500 |
  | 1500–1749 | 3,500 |
  | 1750–1999 | 3,500 |
  | 2000–2299 | 3,500 |
  | 2300+ | 3,073 |
  | **Total** | **24,073** |

- Deduplicated by `PuzzleId` (all 24,073 ids are unique).
- Sampling order: the Lichess/HuggingFace dataset is ordered by `PuzzleId` (a hash-like identifier), not by rating, game date, or theme — so a sequential scan is an effectively random sample with respect to rating and theme. Bands are filled greedily in scan order and the read stops once all 7 bands hit target. The set was grown in additive passes (715 → 1,430 → 3,500 per band), each scanning from a different high offset so new puzzles don't overlap earlier samples (dedup by id guards against overlap regardless).

## Theme coverage manifest (puzzle counts per theme, dataset may tag multiple themes per puzzle)

All of the explicitly-required tactical themes are present with solid sample sizes:

| Theme | Count | | Theme | Count |
|---|---|---|---|---|
| fork | 2956 | | mateIn1 | 2559 |
| pin | 1598 | | mateIn2 | 2662 |
| skewer | 495 | | mateIn3 | 746 |
| discoveredAttack | 1279 | | sacrifice | 2018 |
| doubleCheck | 152 | | deflection | 1061 |
| backRankMate | 458 | | hangingPiece | 854 |

Full breakdown of the most common theme tags in the curated set (a puzzle can carry several tags, so these sum to more than 24,073):

```
endgame 11828       oneMove 2570        rookEndgame 1246    exposedKing 865
short 11763         mateIn1 2559        opening 1076        hangingPiece 854
middlegame 11169    veryLong 2459       deflection 1061     mateIn3 746
crushing 10139      sacrifice 2018      pawnEndgame 1022    promotion 595
advantage 7554      kingsideAttack 1913 attraction 962      skewer 495
long 7059           defensiveMove 1866  discoveredAttack 1279 discoveredCheck 484
mate 6100           advancedPawn 1621   quietMove 1322      backRankMate 458
master 3355         pin 1598            bishopEndgame 397
fork 2956           mateIn2 2662
```

(Top tags; raw counts regenerated directly from the committed `public/data/puzzles.json`.)

## Rebuilding / expanding this dataset

The curation script **is committed** now: `scripts/build-puzzles.mjs`. It reads the
same CC0 data through the HuggingFace **datasets-server** JSON `rows` API (no parquet
tooling, no extra deps — just `fetch`), so it runs anywhere the network allows.

```bash
node scripts/build-puzzles.mjs [targetPerBand] [startOffset]
# defaults: 1430 per band (~10k total), scanning from offset 500000
```

It is **additive**: it keeps every puzzle already in `puzzles.json` and only fetches
enough new rows to top each of the 7 rating bands up to `targetPerBand`, deduping by
`PuzzleId`. So `node scripts/build-puzzles.mjs 2000` grows the set to ~14k without
disturbing what's there. Rows are validated (FEN has 6 fields, ≥2 UCI moves,
rating ≥ 600) and the output is sorted by id for stable diffs.

If the datasets-server is unreachable, the same CC0 data lives at the
[HuggingFace parquet shards](https://huggingface.co/datasets/Lichess/chess-puzzles)
and, where `lichess.org` is reachable, the original
`https://database.lichess.org/lichess_db_puzzle.csv.zst`.
