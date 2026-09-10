import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The Puzzles chunk bundles the ~900KB curated puzzle dataset; it's
    // code-split (lazy-loaded) so it never touches the initial load.
    chunkSizeWarningLimit: 1000,
  },
});
