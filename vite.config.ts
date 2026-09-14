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
    // The curated puzzle dataset (~1.8MB / ~510KB gzip for ~10k puzzles) is
    // pulled into its OWN lazy chunk, separate from the Puzzles UI code, so it
    // caches independently — editing the trainer never re-downloads the data,
    // and the data never touches the initial load. The limit is raised past the
    // data chunk's size since that heft is data-by-design, not un-split code.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("src/data/puzzles.json")) return "puzzles-data";
        },
      },
    },
  },
});
