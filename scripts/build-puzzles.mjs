// Curate the bundled tactics puzzles from the Lichess CC0 open puzzle database.
//
// Source: the official HuggingFace mirror `Lichess/chess-puzzles` (CC0 1.0),
// read through the datasets-server JSON `rows` API — no parquet tooling needed.
// See PUZZLES.md for the field convention (moves[0] is the opponent setup move).
//
// This script is ADDITIVE and idempotent-friendly: it keeps every puzzle already
// in src/data/puzzles.json and tops each rating band up to TARGET_PER_BAND,
// deduping by id. Re-running with a higher target only fetches what's missing.
//
//   node scripts/build-puzzles.mjs [targetPerBand] [startOffset]
//
// Defaults: 1430 per band (~10k total), scanning from a high offset so the new
// puzzles don't overlap the original sample taken from the top of the dataset.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Served as a static asset (fetched at runtime, not bundled) — lives in public/.
const OUT = join(__dirname, "..", "public", "data", "puzzles.json");

const BANDS = [
  [600, 999],
  [1000, 1249],
  [1250, 1499],
  [1500, 1749],
  [1750, 1999],
  [2000, 2299],
  [2300, 99999],
];
const bandOf = (r) => BANDS.findIndex(([lo, hi]) => r >= lo && r <= hi);

const TARGET_PER_BAND = Number(process.argv[2]) || 1430;
const START_OFFSET = Number(process.argv[3]) || 500000;
const PAGE = 100; // datasets-server hard cap per request
const CONCURRENCY = 6;
const MAX_SCAN = 120000; // safety cap on rows scanned
const MAX_RETRIES = 5;
const BASE =
  "https://datasets-server.huggingface.co/rows?dataset=Lichess%2Fchess-puzzles&config=default&split=train";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A page fetch resolves to one of these — a transient give-up is deliberately
// NOT the same as a genuine end-of-split, so a flaky endpoint can't be
// misread as "no more data".
const END = Symbol("end"); // HTTP 404 → past the end of the split
const FAILED = Symbol("failed"); // retries exhausted (network/5xx) — transient

/** Fetch one page of rows; returns an array, END (404), or FAILED (gave up). */
async function fetchPage(offset) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE}&offset=${offset}&length=${PAGE}`);
      if (res.ok) return (await res.json()).rows.map((r) => r.row);
      if (res.status === 404) return END; // genuine end of the split
    } catch {
      /* network blip — retry */
    }
    await sleep(500 * (attempt + 1));
  }
  return FAILED;
}

/** Map a raw Lichess row to the app's compact Puzzle shape, or null if invalid. */
function toPuzzle(row) {
  const rating = Number(row.Rating);
  if (!Number.isFinite(rating) || rating < 600) return null;
  const fen = row.FEN;
  const moves = row.Moves;
  if (typeof fen !== "string" || fen.split(" ").length !== 6) return null;
  if (typeof moves !== "string" || moves.trim().split(/\s+/).length < 2) return null;
  const themes = Array.isArray(row.Themes) ? row.Themes : [];
  return { id: String(row.PuzzleId), fen, moves: moves.trim(), rating, themes };
}

async function main() {
  const existing = JSON.parse(readFileSync(OUT, "utf8"));
  const byId = new Map(existing.map((p) => [p.id, p]));
  const perBand = new Array(BANDS.length).fill(0);
  for (const p of existing) {
    const b = bandOf(p.rating);
    if (b >= 0) perBand[b]++;
  }
  console.log(`Loaded ${existing.length} existing puzzles.`);
  console.log("Per band:", perBand.join(" / "), `→ target ${TARGET_PER_BAND}/band`);

  const bandsFull = () => perBand.every((c) => c >= TARGET_PER_BAND);
  let offset = START_OFFSET;
  let scanned = 0;
  let added = 0;
  let reachedEnd = false;
  let deadBatches = 0; // consecutive batches where every page failed

  while (!bandsFull() && scanned < MAX_SCAN && !reachedEnd) {
    const batch = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => fetchPage(offset + i * PAGE))
    );
    offset += CONCURRENCY * PAGE;

    let batchRows = 0;
    let anyOk = false;
    for (const page of batch) {
      if (page === END) {
        reachedEnd = true;
        continue;
      }
      if (page === FAILED) continue; // transient — skip, do NOT treat as end
      anyOk = true;
      batchRows += page.length;
      for (const row of page) {
        const p = toPuzzle(row);
        if (!p || byId.has(p.id)) continue;
        const b = bandOf(p.rating);
        if (b < 0 || perBand[b] >= TARGET_PER_BAND) continue;
        byId.set(p.id, p);
        perBand[b]++;
        added++;
      }
    }
    scanned += batchRows;

    // A whole batch of failures is a transient outage, not the end. Back off and
    // retry the SAME offsets a few times before giving up entirely.
    if (!anyOk && !reachedEnd) {
      deadBatches++;
      if (deadBatches >= 6) {
        console.warn("  ! endpoint unreachable for too long — stopping early.");
        break;
      }
      offset -= CONCURRENCY * PAGE; // rewind and retry these pages
      await sleep(2000 * deadBatches);
      continue;
    }
    deadBatches = 0;

    if (scanned % 3000 < CONCURRENCY * PAGE) {
      console.log(`  scanned ~${scanned}, added ${added}, bands: ${perBand.join("/")}`);
    }
  }
  if (reachedEnd) console.log("Reached the genuine end of the dataset split.");

  // Sort by id — the dataset's natural (hash-like) order, matching the loader's
  // documented convention and keeping diffs stable across re-runs.
  const out = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  writeFileSync(OUT, JSON.stringify(out));

  console.log(`\nDone. ${existing.length} → ${out.length} puzzles (+${added}).`);
  console.log("Final per band:");
  BANDS.forEach(([lo, hi], i) => console.log(`  ${lo}-${hi === 99999 ? "∞" : hi}: ${perBand[i]}`));

  // Theme manifest for the key tactical themes (for PUZZLES.md).
  const KEY = ["fork","pin","skewer","discoveredAttack","doubleCheck","backRankMate","hangingPiece","sacrifice","deflection","mateIn1","mateIn2","mateIn3"];
  const tcount = {};
  for (const p of out) for (const t of p.themes) if (KEY.includes(t)) tcount[t] = (tcount[t] || 0) + 1;
  console.log("Key themes:", KEY.map((t) => `${t}=${tcount[t] || 0}`).join(" "));
}

main();
