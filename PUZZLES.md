# Puzzle Dataset

## Source & license

**Primary data**: the official [Lichess open puzzle database](https://database.lichess.org/#puzzles), released under **CC0 1.0** (public domain — no attribution legally required, but credited here anyway). Home page: https://database.lichess.org/

**Access path actually used**: this sandbox's network policy blocks `lichess.org` / `database.lichess.org` outright (verified — TLS interception / plain-HTTP both return a corporate content-filter "ACCESS DENIED" page, not a Lichess response). Per the task's documented fallback, the same CC0 data was pulled instead from the official HuggingFace mirror **[`Lichess/chess-puzzles`](https://huggingface.co/datasets/Lichess/chess-puzzles)** (parquet format, license `cc0-1.0`, regenerated monthly straight from the Lichess database — last updated 2026-09-07, 6,100,960 puzzles total). Row-range HTTP requests (via the pure-JS [`hyparquet`](https://www.npmjs.com/package/hyparquet) reader) were used to fetch only the row groups needed, rather than downloading the full ~876MB/3-shard dataset — in practice a single row group (~490k rows, of which only the first ~8,900 needed to be scanned) was enough to fill every rating band.

Both sources carry identical fields (`PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl/GameId, OpeningTags`) — the HuggingFace copy is a straight parquet re-encoding of the CSV, not a derived/altered dataset.

No raw downloaded file (`.csv.zst` or `.parquet`) is committed to this repo — only the curated subset below.

## Files

- `src/data/puzzles.json` — curated array of 10,010 puzzles (~1.8MB).
- `src/data/puzzles.ts` — typed loader (`Puzzle` interface, `puzzles: Puzzle[]`, plus `puzzlesByTheme()` / `puzzlesInRatingRange()` helpers).
- `scripts/build-puzzles.mjs` — the (re)builder. Additive: keeps every puzzle already in `puzzles.json` and tops each rating band up to a target, deduping by id. See **Rebuilding / expanding** below.

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

- Balanced across 7 rating bands, target ~1,430 puzzles each (10,010 total):

  | Band | Count |
  |------|-------|
  | 600–999 | 1,430 |
  | 1000–1249 | 1,430 |
  | 1250–1499 | 1,430 |
  | 1500–1749 | 1,430 |
  | 1750–1999 | 1,430 |
  | 2000–2299 | 1,430 |
  | 2300+ | 1,430 |
  | **Total** | **10,010** |

- Deduplicated by `PuzzleId` (all 10,010 ids are unique).
- Sampling order: the Lichess/HuggingFace dataset is ordered by `PuzzleId` (a hash-like identifier), not by rating, game date, or theme — so a sequential scan is an effectively random sample with respect to rating and theme. Bands are filled greedily in scan order and the read stops once all 7 bands hit target. The original ~715/band came from the top of the dataset; the expansion to ~1,430/band scanned from a high offset (default 500,000) so the added puzzles don't overlap the original sample (dedup by id guards against overlap regardless).

## Theme coverage manifest (puzzle counts per theme, dataset may tag multiple themes per puzzle)

All of the explicitly-required tactical themes are present with solid sample sizes:

| Theme | Count | | Theme | Count |
|---|---|---|---|---|
| fork | 1207 | | mateIn1 | 1021 |
| pin | 673 | | mateIn2 | 1130 |
| skewer | 207 | | mateIn3 | 285 |
| discoveredAttack | 527 | | sacrifice | 848 |
| doubleCheck | 72 | | deflection | 443 |
| backRankMate | 174 | | hangingPiece | 341 |

Full breakdown of the most common theme tags in the curated set (a puzzle can carry several tags, so these sum to more than 10,010):

```
endgame 4962        oneMove 1027        opening 430         intermezzo 129
short 4904          mateIn1 1021        attraction 398      trappedPiece 101
middlegame 4618     sacrifice 848       exposedKing 355     knightEndgame 98
crushing 4293       defensiveMove 817   hangingPiece 341    operaMate 94
advantage 3109      kingsideAttack 771  mateIn3 285         doubleCheck 72
long 2923           advancedPawn 681    promotion 246      pillsburysMate 67
mate 2501           pin 673             discoveredCheck 217 zugzwang 133
master 1414         quietMove 561       skewer 207         masterVsMaster 129
fork 1207           rookEndgame 551     backRankMate 174   queenEndgame 129
mateIn2 1130        discoveredAttack 527 bishopEndgame 159
veryLong 1077       deflection 443      clearance 146
```

(Top tags; raw counts regenerated directly from the committed `src/data/puzzles.json`.)

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
