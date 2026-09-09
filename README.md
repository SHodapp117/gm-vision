# ♛ GM Vision — Chess Trainer

A modern, browser-based React chess training app that visualizes **board control** and corrects **blunders in real time** — built to train players from beginner to Grandmaster.

![Tech](https://img.shields.io/badge/React-18-149eca) ![Vite](https://img.shields.io/badge/Vite-5-646cff) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

- **Pre-game setup** — play as White or Black, a bot ELO slider (600–3200), and a 15-opening selector (Ruy Lopez, Italian, Scotch, Vienna, Sicilian Najdorf, French, Caro-Kann, Scandinavian, Pirc, Queen's Gambit Declined, Slav, King's Indian, Nimzo-Indian, London, English). Every main line is validated move-by-move against chess.js.
- **Opening Guide** — a toggle that walks *you* through the chosen opening: while you're still on the main line, a green arrow shows your book move (for either color), a banner names it, and the coach tells you when you follow it — or which move you missed when you leave book. The bot follows the same lines, so you can rehearse a full opening against it.
- **Electric vision layers** — three independently toggleable overlays in high-voltage neon:
  - **Heatmap** — a piece-aware control map built on HSL color theory: each square is tinted by its *dominant* (lowest-value) attacker, where **hue = piece type** (pawn→queen across a harmonious wheel), **lightness = side** (bright = you, deep = enemy), and **opacity = control density** (more attackers → more vivid). Value ties between sides read as neutral silver.
  - **Threats** — any of your hanging pieces (attacked by a lower-value piece, or undefended) gets a pulsing electric-orange glow.
  - **Last move** — the from/to squares of the most recent move, ringed in violet.
- **Best Moves** — one click ranks the position's top three candidate moves and draws them as distinct neon arrows (violet → cyan → amber), with a short reason in the coach panel. (Heuristic for now — see the Stockfish note below.)
- **Blunder correction, with player override** — if a move hangs material the game pauses and a modal explains *why* (e.g. "this leaves your Knight hanging"). You decide: **Undo & Retry**, or **Play it anyway** — the coach only advises, the player always has the final word.
- **Coach's feedback** panel, PGN-style move history, and a glassmorphism control panel with a dark-mode-first, Vercel/Linear-inspired aesthetic.

## Tech stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [chess.js](https://github.com/jhlywa/chess.js) — game logic & move validation
- [react-chessboard](https://github.com/Clariity/react-chessboard) — board rendering
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [lucide-react](https://lucide.dev/) — icons

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (default http://localhost:5173).

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
```

## Plugging in a real engine (Stockfish)

The bot is a **mock async stub**, isolated in `getBotMove()` inside
[`src/ChessTrainer.tsx`](src/ChessTrainer.tsx). It currently follows the selected
opening book, then falls back to an ELO-weighted heuristic. To use a real engine,
replace the body of `getBotMove()` with a Stockfish Web Worker:

```ts
const worker = new Worker("/stockfish.js");
worker.postMessage(`position fen ${fen}`);
worker.postMessage(`go depth ${eloToDepth(elo)}`);
// resolve the promise on the 'bestmove ...' message
```

The function already returns a valid `chess.js` verbose move, so the rest of the
app needs no changes.

## Project structure

```
src/
  ChessTrainer.tsx   # the full trainer component (board, vision, blunder logic, bot stub)
  main.tsx           # React entry point
  index.css          # Tailwind directives + base styles
```

## License

MIT
