# ♛ GM Vision — Chess Trainer

A modern, browser-based React chess training app that visualizes **board control** and corrects **blunders in real time** — built to train players from beginner to Grandmaster.

![Tech](https://img.shields.io/badge/React-18-149eca) ![Vite](https://img.shields.io/badge/Vite-5-646cff) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

## Features

- **Pre-game setup** — play as White or Black, a bot ELO slider (600–3200), and a 15-opening selector (Ruy Lopez, Italian, Scotch, Vienna, Sicilian Najdorf, French, Caro-Kann, Scandinavian, Pirc, Queen's Gambit Declined, Slav, King's Indian, Nimzo-Indian, London, English). Every main line is validated move-by-move against chess.js.
- **Training positions — start anywhere.** A game doesn't have to begin from move one. Pick a **start position**: *Standard*, *Mid-opening* (seed the board 3/5/7/9 full moves into the chosen opening's main line, then play on — the position-keyed guide keeps working from there), or *From FEN* (paste any position; it's validated before you start). All entry points flow through one `TrainingPosition` abstraction into the *same* game engine, so coaching, vision, and the bot all work identically no matter where you started.
- **Opening Guide with variation trees** — a toggle that walks *you* through the chosen opening. Each opening is a **branching tree** (a main line plus real variations), compiled into a position-keyed book — so a green arrow shows your book move (for either color), the banner counts how many book sidelines exist here, and playing a valid sideline keeps you *in book* instead of dead-ending. Transpositions resolve automatically (the book is keyed by position, not move order). The bot follows the same tree, so you can rehearse full lines — and their sidelines — against it.
- **Electric vision layers** — three independently toggleable overlays in high-voltage neon:
  - **Control heatmap** — a neon cyberpunk triad showing who controls each square: **your control = electric blue** (`#00B3FF`), **CPU control = electric pink** (`#FF2DD2`), and **contested squares = electric green** (`#39FF14`). Opacity scales with control density (more attackers → more vivid). The three colors are **independent toggles** (You / CPU / Contested), all on by default, so you can isolate, say, just the CPU's coverage to spot where it's pressing.
  - **Threats** — any of your hanging pieces (attacked by a lower-value piece, or undefended) gets a Hong-Kong-neon-red ring (`#FF073A`) with a subtle heartbeat "beat" — danger reads as red, universally, and the motion draws the eye.
  - **Last move** — the from/to squares of the most recent move, ringed in violet.
- **Real Stockfish engine** — the bot, the eval bar, best-moves, and blunder detection are all powered by a bundled Stockfish WASM engine (see below).
- **Best Moves** — one click asks the engine for its top three lines and draws them as electric-blue arrows (the "you" color; top pick brightest), with a short reason + evaluation in the coach panel.
- **Tactical Radar** — on your turn the coach scans the position and *names* the tactics available to you — a **forced mate in 1/2/3** (confirmed by the engine, never guessed), a **fork** (a move that hits two valuable targets and stays safe), or a **pin** (an enemy piece pinned to its king or a bigger piece) — **without revealing the move**. It's a discovery aid ("You have a forced mate in 2 — can you find it?"), not a solver: the pattern is flagged, you find the move. It also warns when the *bot* has a forced mate against you, and can be toggled off.
- **Blunder correction, with player override** — the engine flags real mistakes/blunders (by centipawn loss); the game pauses and a modal explains *why*. You decide: **Undo & Retry**, or **Play it anyway** — the coach only advises, the player always has the final word.
- **Tactics trainer** — a Puzzles mode with ~5,000 curated Lichess puzzles, a local tactics rating, streaks, theme/difficulty filters, and hints (see below).
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

## Chess engine (Stockfish)

The bot and all position evaluation are powered by a real **Stockfish** engine
(single-threaded WebAssembly) running in a Web Worker — no server or special
COOP/COEP headers required, so it works on any static host. The engine ships as
static assets in [`public/engine/`](public/engine/) and is wrapped by
[`src/engine/stockfish.ts`](src/engine/stockfish.ts)
(`analyze(fen, { movetime, depth, multipv, elo })`).

- **Bot strength** follows the ELO slider via `UCI_LimitStrength` / `UCI_Elo`
  (and `Skill Level` below 1320). Off the opening book it asks the engine; if the
  engine isn't ready it falls back to a heuristic so play never stalls.
- **Eval bar** ([`src/components/EvalBar.tsx`](src/components/EvalBar.tsx)) shows the live evaluation.
- **Move classification** ([`src/engine/classify.ts`](src/engine/classify.ts)) flags
  real inaccuracies / mistakes / blunders by centipawn loss, feeding the blunder/override modal.
- **Best Moves** uses the engine's MultiPV lines.

> Stockfish is GPL-3.0 — see [Attribution & Licenses](#attribution--licenses).

## Tactics trainer

A second mode (the **Puzzles** tab) drills tactics from ~5,000 curated
[Lichess](https://database.lichess.org/) puzzles (CC0), balanced across rating
bands and themes. It tracks an Elo-style tactics rating and streak in
`localStorage`, filters by theme and difficulty, and offers hints.

## Project structure

```
src/
  App.tsx            # top-level shell + Play/Puzzles mode switcher
  ChessTrainer.tsx   # the Play trainer (board, vision, opening guide, blunder logic)
  PuzzleTrainer.tsx  # the tactics/puzzle mode
  engine/            # Stockfish worker wrapper + move classification
  components/        # EvalBar, Credits
  puzzles/           # puzzle selection + rating store
  data/puzzles.json  # curated CC0 puzzle dataset
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
