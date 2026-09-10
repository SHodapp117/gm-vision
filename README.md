# ♛ GM Vision — Chess Trainer

A modern, browser-based React chess training app that visualizes **board control** and corrects **blunders in real time** — built to train players from beginner to Grandmaster.

![Tech](https://img.shields.io/badge/React-18-149eca) ![Vite](https://img.shields.io/badge/Vite-5-646cff) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

- **Pre-game setup** — play as White or Black, a bot ELO slider (600–3200), and a 15-opening selector (Ruy Lopez, Italian, Scotch, Vienna, Sicilian Najdorf, French, Caro-Kann, Scandinavian, Pirc, Queen's Gambit Declined, Slav, King's Indian, Nimzo-Indian, London, English). Every main line is validated move-by-move against chess.js.
- **Opening Guide** — a toggle that walks *you* through the chosen opening: while you're still on the main line, a green arrow shows your book move (for either color), a banner names it, and the coach tells you when you follow it — or which move you missed when you leave book. The bot follows the same lines, so you can rehearse a full opening against it.
- **Electric vision layers** — three independently toggleable overlays in high-voltage neon:
  - **Heatmap** — a piece-aware, team-branded control map. Each square is tinted by its *dominant* (lowest-value) attacker. **You** always play a cool Pacific-NW ramp (Rave Green `#55cc21` → Heritage Aqua `#7cd3d3` → Pacific Blue `#3151bf`); the **bot** plays "Ultraviolet Plasma" — a synthetic neon ramp (Neon Violet `#6A00F4` → Neon Magenta `#C400E0` → Hot Pink `#FF2FB0`) that lives entirely outside your cool gamut and the danger red, so the two sides never read alike and the bot's hot-pink king can't be confused with your Pacific-Blue king. Within a side, piece type is mapped along that ramp (pawn→king), so **side = warm vs cool**, **color = which piece**, and **opacity = control density**. Value ties read as neutral silver. The under-attack ring and all suggestion arrows draw from your ramp too, so every cue speaks one color language.
  - **Threats** — any of your hanging pieces (attacked by a lower-value piece, or undefended) gets a Hong-Kong-neon-red ring (`#FF073A`) with a subtle heartbeat "beat" — danger reads as red, universally, and the motion draws the eye.
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

## Attribution & Licenses

GM Vision is built on open-source software and openly-licensed chess data. The
full breakdown — every component, its license identifier, and its source — lives
in **[CREDITS.md](CREDITS.md)** (and a concise **[NOTICE](NOTICE)** file at the
repo root). A few points that matter most:

- **Stockfish (bundled engine) — GPL-3.0.** This app bundles a WebAssembly build
  of [Stockfish](https://stockfishchess.org/), which is licensed under the
  [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html). Its complete license
  text ships at [`public/engine/LICENSE.stockfish.txt`](public/engine/LICENSE.stockfish.txt),
  and the corresponding source is at
  [official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish).
  This is a license obligation, not a courtesy.
- **Lichess puzzles — CC0 1.0.** The bundled puzzles come from the
  [Lichess open puzzle database](https://database.lichess.org/) (public domain,
  no attribution required — credited anyway). With thanks to
  [chessgo.in](https://chessgo.in/) for their collaboration around chess puzzle
  content.
- **Lichess Opening Explorer.** Opening statistics come from
  [explorer.lichess.org](https://explorer.lichess.org/). Thanks to Lichess.

## License

GM Vision's own source code is released under the **MIT License**. Bundled
third-party components remain under their own licenses — most notably Stockfish,
which stays under the **GNU GPL v3** (see above and [CREDITS.md](CREDITS.md)).
