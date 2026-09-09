# Puzzle Dataset

## Source & license

**Primary data**: the official [Lichess open puzzle database](https://database.lichess.org/#puzzles), released under **CC0 1.0** (public domain — no attribution legally required, but credited here anyway). Home page: https://database.lichess.org/

**Access path actually used**: this sandbox's network policy blocks `lichess.org` / `database.lichess.org` outright (verified — TLS interception / plain-HTTP both return a corporate content-filter "ACCESS DENIED" page, not a Lichess response). Per the task's documented fallback, the same CC0 data was pulled instead from the official HuggingFace mirror **[`Lichess/chess-puzzles`](https://huggingface.co/datasets/Lichess/chess-puzzles)** (parquet format, license `cc0-1.0`, regenerated monthly straight from the Lichess database — last updated 2026-09-07, 6,100,960 puzzles total). Row-range HTTP requests (via the pure-JS [`hyparquet`](https://www.npmjs.com/package/hyparquet) reader) were used to fetch only the row groups needed, rather than downloading the full ~876MB/3-shard dataset — in practice a single row group (~490k rows, of which only the first ~8,900 needed to be scanned) was enough to fill every rating band.

Both sources carry identical fields (`PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl/GameId, OpeningTags`) — the HuggingFace copy is a straight parquet re-encoding of the CSV, not a derived/altered dataset.

No raw downloaded file (`.csv.zst` or `.parquet`) is committed to this repo — only the curated subset below.

## Files

- `src/data/puzzles.json` — curated array of 5,005 puzzles (~905KB).
- `src/data/puzzles.ts` — typed loader (`Puzzle` interface, `puzzles: Puzzle[]`, plus `puzzlesByTheme()` / `puzzlesInRatingRange()` helpers).

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

- Balanced across 7 rating bands, target ~715 puzzles each (5,005 total):

  | Band | Count |
  |------|-------|
  | 600–999 | 715 |
  | 1000–1249 | 715 |
  | 1250–1499 | 715 |
  | 1500–1749 | 715 |
  | 1750–1999 | 715 |
  | 2000–2299 | 715 |
  | 2300+ | 715 |
  | **Total** | **5,005** |

- Deduplicated by `PuzzleId` (all 5,005 ids are unique).
- Sampling order: the Lichess/HuggingFace dataset is ordered by `PuzzleId` (a hash-like identifier), not by rating, game date, or theme — so reading sequentially from the start of the file gives an effectively random sample with respect to rating and theme. Bands were filled greedily in that scan order and the read stopped as soon as all 7 bands hit target.

## Theme coverage manifest (puzzle counts per theme, dataset may tag multiple themes per puzzle)

All of the explicitly-required tactical themes are present with solid sample sizes:

| Theme | Count | | Theme | Count |
|---|---|---|---|---|
| fork | 624 | | mateIn1 | 520 |
| pin | 340 | | mateIn2 | 557 |
| skewer | 100 | | mateIn3 | 148 |
| discoveredAttack | 256 | | mateIn4 | 20 |
| doubleCheck | 31 | | mateIn5 | 1 |
| backRankMate | 80 | | sacrifice | 429 |
| hangingPiece | 178 | | deflection | 219 |

Full breakdown of every theme tag present in the curated set (a puzzle can carry several tags, so these sum to more than 5,005):

```
endgame 2503        long 1495           advancedPawn 333    zugzwang 65
short 2416          mate 1246           rookEndgame 291     masterVsMaster 65
middlegame 2277     master 727          quietMove 288       intermezzo 61
crushing 2155       fork 624            discoveredAttack 256 trappedPiece 52
advantage 1547      mateIn2 557         opening 225         operaMate 49
veryLong 532        deflection 219      knightEndgame 47    queenRookEndgame 39
oneMove 522         pawnEndgame 205     pillsburysMate 33   attackingF2F7 32
mateIn1 520         exposedKing 181     doubleCheck 31       capturingDefender 26
sacrifice 429       hangingPiece 178    smotheredMate 24     interference 23
defensiveMove 397   mateIn3 148         mateIn4 20           equality 17
kingsideAttack 372  promotion 123       epauletteMate 15     cornerMate 13
pin 340             skewer 100          enPassant 13         hookMate 10
                    discoveredCheck 100 collinearMove 9      xRayAttack 8
                    clearance 88        morphysMate 7        arabianMate 7
                    backRankMate 80     anastasiaMate 6      swallowstailMate 5
                    bishopEndgame 78    castling 4           bodenMate 3
                    queensideAttack 76  doubleBishopMate 3   vukovicMate 3
                    queenEndgame 70     triangleMate 3       blindSwineMate 3
                                        dovetailMate 2       killBoxMate 2
                                        superGM 1            balestraMate 1
                                        mateIn5 1            underPromotion 1
```

(Raw counts regenerated directly from the committed `src/data/puzzles.json` — see the curation script notes below if you need to reproduce or expand this set.)

## Reproducing / expanding this dataset

The one-off curation script used to build this file is **not** committed (temporary tooling, deleted after use per this task's scope). To regenerate or pull a larger/different sample:

1. `npm install hyparquet` (pure-JS parquet reader, supports HTTP range requests — no native deps).
2. Use `asyncBufferFromUrl` + `parquetMetadataAsync` + `parquetReadObjects` against the HuggingFace shards at `https://huggingface.co/datasets/Lichess/chess-puzzles/resolve/main/data/train-0000{0,1,2}-of-00003.parquet`, reading row-group by row-group (only fetching the columns you need: `PuzzleId, FEN, Moves, Rating, Themes`) until your target bucket counts are full.
3. If `lichess.org` is reachable in your environment, the more direct route is the original CSV: `https://database.lichess.org/lichess_db_puzzle.csv.zst`, streamed and decompressed incrementally with the pure-JS [`fzstd`](https://www.npmjs.com/package/fzstd) package (`new fzstd.Decompress(...)`, feeding it chunks from a streamed `curl`/`fetch` response) — do not buffer the whole ~300MB compressed / ~1GB+ decompressed CSV in memory.
