import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal ambient declaration so we can read the deploy env var without pulling
// in @types/node just for the config file.
declare const process: { env: Record<string, string | undefined> };

// https://vite.dev/config/
// `base` is "/" for local dev and normal builds, but the GitHub Pages deploy
// workflow sets BASE_PATH="/gm-vision/" so assets (and the bundled Stockfish
// engine, which resolves via import.meta.env.BASE_URL) load from the project
// subpath. Kept env-driven so a future root-domain host still works unchanged.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  build: {
    // The curated puzzle dataset is no longer bundled — it's served as a static
    // asset from public/data/puzzles.json and fetched at runtime (see
    // src/data/puzzles.ts), so nothing here needs a raised size limit.
    chunkSizeWarningLimit: 1000,
  },
});
