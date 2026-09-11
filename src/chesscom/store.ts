/* ------------------------------------------------------------------ */
/*  GameStore implementations — IndexedDB for the app, an in-memory      */
/*  Map for tests (and as a graceful fallback where IndexedDB is         */
/*  unavailable, e.g. some test/embedded environments).                  */
/*                                                                       */
/*  Both implementations satisfy the same `GameStore` contract from      */
/*  ./types, so the import service and UI never need to know which one   */
/*  they're talking to.                                                  */
/* ------------------------------------------------------------------ */

import type { GameStore, ImportRecord, ImportedGame } from "./types";

const GAMES_STORE = "games";
const IMPORTS_STORE = "imports";
const DB_VERSION = 1;

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GAMES_STORE)) {
          db.createObjectStore(GAMES_STORE, { keyPath: "uuid" });
        }
        if (!db.objectStoreNames.contains(IMPORTS_STORE)) {
          db.createObjectStore(IMPORTS_STORE, { keyPath: "username" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    } catch (err) {
      reject(err);
    }
  });
}

/** IndexedDB-backed GameStore — the production store. */
export function createIndexedDbStore(dbName = "gmvision"): GameStore {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const getDb = (): Promise<IDBDatabase> => (dbPromise ??= openDb(dbName));

  async function withStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await getDb();
    return new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error(`IndexedDB ${storeName} request failed`));
        tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB ${storeName} transaction failed`));
      } catch (err) {
        reject(err);
      }
    });
  }

  return {
    async getGame(uuid) {
      return withStore<ImportedGame | undefined>(GAMES_STORE, "readonly", (s) => s.get(uuid));
    },

    async hasGame(uuid) {
      const game = await withStore<ImportedGame | undefined>(GAMES_STORE, "readonly", (s) => s.get(uuid));
      return game !== undefined;
    },

    async putGame(game) {
      await withStore<IDBValidKey>(GAMES_STORE, "readwrite", (s) => s.put(game));
    },

    async putGames(games) {
      const db = await getDb();
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(GAMES_STORE, "readwrite");
          const store = tx.objectStore(GAMES_STORE);
          for (const game of games) store.put(game);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("IndexedDB putGames failed"));
        } catch (err) {
          reject(err);
        }
      });
    },

    async gamesByAccount(account) {
      const all = await withStore<ImportedGame[]>(GAMES_STORE, "readonly", (s) => s.getAll());
      return all.filter((g) => g.account === account);
    },

    async allGames() {
      return withStore<ImportedGame[]>(GAMES_STORE, "readonly", (s) => s.getAll());
    },

    async getImportRecord(username) {
      return withStore<ImportRecord | undefined>(IMPORTS_STORE, "readonly", (s) => s.get(username));
    },

    async putImportRecord(rec) {
      await withStore<IDBValidKey>(IMPORTS_STORE, "readwrite", (s) => s.put(rec));
    },
  };
}

/** In-memory GameStore — used by tests and as a fallback when IndexedDB isn't available. */
export function createMemoryStore(): GameStore {
  const games = new Map<string, ImportedGame>();
  const imports = new Map<string, ImportRecord>();

  return {
    async getGame(uuid) {
      return games.get(uuid);
    },

    async hasGame(uuid) {
      return games.has(uuid);
    },

    async putGame(game) {
      games.set(game.uuid, game);
    },

    async putGames(list) {
      for (const game of list) games.set(game.uuid, game);
    },

    async gamesByAccount(account) {
      return [...games.values()].filter((g) => g.account === account);
    },

    async allGames() {
      return [...games.values()];
    },

    async getImportRecord(username) {
      return imports.get(username);
    },

    async putImportRecord(rec) {
      imports.set(rec.username, rec);
    },
  };
}
