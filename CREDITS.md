# Credits, Attribution & Licenses

GM Vision is built on open-source software and openly-licensed chess data. This
file documents every third-party component we bundle or rely on, with its
license identifier and source. Some of what follows is a **legal obligation**
(the bundled Stockfish engine is GPL-3.0), not merely a courtesy.

GM Vision's own source code is released under the **MIT License**. The
third-party components below remain under their own respective licenses.

---

## Engine — Stockfish (GPL-3.0-or-later) — legal obligation

This app bundles a WebAssembly build of **Stockfish**, a free and open-source
chess engine, at `public/engine/stockfish.wasm` and `public/engine/stockfish.js`.

- **License:** GNU General Public License, version 3 (**GPL-3.0**).
  <https://www.gnu.org/licenses/gpl-3.0.html>
- **Bundled license text:** the complete, verbatim GPLv3 license text ships with
  the engine at [`public/engine/LICENSE.stockfish.txt`](public/engine/LICENSE.stockfish.txt).
- **Corresponding source:** <https://github.com/official-stockfish/Stockfish>
- **Project home:** <https://stockfishchess.org/>

Per the terms of the GPL, we state that Stockfish is used, that it is licensed
under GPLv3, we keep its full license text available in this repository, and we
link to the corresponding source above.

---

## Puzzle data — Lichess open puzzle database (CC0 1.0)

The app bundles approximately **5,005 curated puzzles** (in `src/data/`) drawn
from the **Lichess open puzzle database**.

- **License:** Creative Commons **CC0 1.0 Universal** (public domain dedication).
  <https://creativecommons.org/publicdomain/zero/1.0/>
- **Source / home:** <https://database.lichess.org/> (see the `#puzzles` section)
- **Access path used:** the same CC0 data was read from the official HuggingFace
  mirror of the database, [`Lichess/chess-puzzles`](https://huggingface.co/datasets/Lichess/chess-puzzles)
  (parquet, license `cc0-1.0`, regenerated monthly from the Lichess database).

Under CC0, **no attribution is legally required** — the data is dedicated to the
public domain. We credit Lichess here anyway, with thanks.

### With thanks to chessgo.in

With thanks to **[chessgo.in](https://chessgo.in/)** for their collaboration
around chess puzzle content. We acknowledge and appreciate their cooperation.

---

## Data services — Lichess Opening Explorer

The app queries the **Lichess Opening Explorer** API (`explorer.lichess.org`) for
opening statistics at runtime.

- **Service:** <https://explorer.lichess.org/>
- **Provider:** [Lichess](https://lichess.org/) — a free, open-source, ad-free
  chess platform. Our thanks to Lichess for making this service freely available.

---

## Built with (libraries)

| Library | License | Source |
| --- | --- | --- |
| [chess.js](https://github.com/jhlywa/chess.js) | BSD-2-Clause | game logic & move validation |
| [react-chessboard](https://github.com/Clariity/react-chessboard) | MIT | board rendering |
| [React](https://react.dev/) & react-dom | MIT | UI framework |
| [lucide-react](https://lucide.dev/) | ISC | icons |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | styling |
| [Vite](https://vite.dev/) | MIT | build tooling & dev server |

License identifiers use [SPDX](https://spdx.org/licenses/) short-form names.
Each library's full license text is distributed within its package under
`node_modules/<package>/` and in the published package on npm.

---

## Summary of license identifiers

| Component | SPDX / License | Obligation |
| --- | --- | --- |
| Stockfish (bundled engine) | GPL-3.0-or-later | **Yes** — stated, license kept, source linked |
| Lichess puzzle database | CC0-1.0 | None (public domain); credited as courtesy |
| Lichess Opening Explorer | Service (Lichess) | Courtesy credit |
| chess.js | BSD-2-Clause | Preserve copyright & license notice |
| react-chessboard | MIT | Preserve copyright & license notice |
| React / react-dom | MIT | Preserve copyright & license notice |
| lucide-react | ISC | Preserve copyright & license notice |
| Tailwind CSS | MIT | Preserve copyright & license notice |
| Vite | MIT | Preserve copyright & license notice |
| GM Vision (this project) | MIT | — |
