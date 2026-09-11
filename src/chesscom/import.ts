/* ------------------------------------------------------------------ */
/*  Import service — pulls Chess.com monthly archives into a GameStore.  */
/*                                                                       */
/*  Idempotent by design: once an archive is fully imported its URL is   */
/*  recorded on the ImportRecord, so re-running the same import skips    */
/*  it entirely (unless `force`d); games within a processed archive are  */
/*  additionally deduped by uuid via `store.hasGame`. `maxGames` caps     */
/*  total INSERTIONS for a single run — if a month's games would blow    */
/*  the budget, we insert what fits and leave that archive unmarked so   */
/*  the next run picks up where this one left off.                       */
/* ------------------------------------------------------------------ */

import { ChessComError, isValidUsername, type ChessComClient } from "./client";
import { normalizeGame } from "./pgn";
import type { GameStore, ImportRecord, ImportSummary, ImportedGame } from "./types";

const DEFAULT_MONTHS = 3;
const DEFAULT_MAX_GAMES = 300;

export interface ImportOptions {
  months?: number;
  maxGames?: number;
  force?: boolean;
  onProgress?: (p: { archive: string; fetched: number; inserted: number }) => void;
}

export async function importGames(
  client: ChessComClient,
  store: GameStore,
  username: string,
  opts?: ImportOptions
): Promise<ImportSummary> {
  if (!isValidUsername(username)) {
    throw new ChessComError("invalid-username", `Invalid chess.com username: "${username}"`);
  }
  const account = username.trim().toLowerCase();
  const months = opts?.months ?? DEFAULT_MONTHS;
  const maxGames = opts?.maxGames ?? DEFAULT_MAX_GAMES;
  const force = opts?.force ?? false;

  const existingRecord = await store.getImportRecord(account);
  const processedSet = new Set(existingRecord?.archivesProcessed ?? []);
  const archivesProcessedList = [...processedSet];

  const archives = await client.getArchives(username); // chronological, oldest → newest
  const selected = archives.slice(-months).reverse(); // newest-first processing order
  // The most-recent archive is the CURRENT month — it's still growing, so it must
  // never be permanently skipped or marked processed, or "Import New Games" would
  // stop picking up games played later this month. Past months are immutable once
  // ended, so they stay skipped. Dedup by uuid keeps the re-fetch idempotent.
  const currentArchive = archives.length ? archives[archives.length - 1] : undefined;

  let fetched = 0;
  let inserted = 0;
  let duplicates = 0;
  let failedToParse = 0;
  let archivesProcessed = 0;

  for (const archiveUrl of selected) {
    const isCurrentMonth = archiveUrl === currentArchive;
    // Skip a fully-imported PAST month; always re-scan the current month.
    if (!force && !isCurrentMonth && processedSet.has(archiveUrl)) continue;
    if (inserted >= maxGames) break; // budget exhausted — leave remaining archives untouched

    const games = await client.getMonthGames(archiveUrl);
    const batch: ImportedGame[] = [];
    let cutOff = false;

    for (const apiGame of games) {
      fetched++;

      let normalized: ImportedGame;
      try {
        normalized = normalizeGame(apiGame, account);
      } catch {
        failedToParse++;
        continue;
      }

      if (await store.hasGame(normalized.uuid)) {
        duplicates++;
        continue;
      }

      if (inserted + batch.length >= maxGames) {
        cutOff = true;
        break; // hit the cap mid-archive — this archive is not "fully" processed
      }
      batch.push(normalized);
    }

    if (batch.length) {
      await store.putGames(batch);
      inserted += batch.length;
    }

    if (!cutOff) {
      archivesProcessed++;
      // Persist only immutable (past) months as processed; never the current one.
      if (!isCurrentMonth && !processedSet.has(archiveUrl)) {
        processedSet.add(archiveUrl);
        archivesProcessedList.push(archiveUrl);
      }
    }

    opts?.onProgress?.({ archive: archiveUrl, fetched, inserted });

    if (cutOff) break;
  }

  const total = (await store.gamesByAccount(account)).length;
  const record: ImportRecord = {
    username: account,
    lastImport: Date.now(),
    archivesProcessed: archivesProcessedList,
    total,
  };
  await store.putImportRecord(record);

  return { fetched, inserted, duplicates, failedToParse, archivesProcessed, lastImport: record.lastImport };
}
