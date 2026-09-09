# ♛ GM Vision — Chess Trainer

A modern, browser-based React chess training app that visualizes **board control** and corrects **blunders in real time** — built to train players from beginner to Grandmaster.

![Tech](https://img.shields.io/badge/React-18-149eca) ![Vite](https://img.shields.io/badge/Vite-5-646cff) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

- **Pre-game setup** — play as White or Black, a bot ELO slider (600–3200), and an opening selector (Ruy Lopez, Sicilian, Queen's Gambit, Caro-Kann, Italian).
- **Threat Map ("Vision" mode)** — toggle a heatmap showing squares your pieces control (green), squares the opponent controls (red), and contested squares (yellow).
- **Under-attack indicator** — any of your pieces that is hanging (attacked by a lower-value piece, or undefended) gets a pulsing orange glow.
- **Blunder correction** — if a move hangs material, the game pauses, a modal explains *why* (e.g. "this leaves your Knight hanging"), and you're forced to undo and try again.
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
