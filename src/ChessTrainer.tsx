import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  Eye,
  EyeOff,
  Crown,
  Swords,
  RotateCcw,
  Play,
  AlertTriangle,
  Sparkles,
  Gauge,
  BookOpen,
  MessageSquareText,
  ShieldAlert,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Static config                                                      */
/* ------------------------------------------------------------------ */

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const OPENINGS: Record<string, string[]> = {
  "Ruy Lopez": ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"],
  "Sicilian Defense": ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"],
  "Queen's Gambit": ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O"],
  "Caro-Kann": ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6"],
  "Italian Game": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6"],
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

const PIECE_NAME: Record<string, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

/* ------------------------------------------------------------------ */
/*  Board-control / attack helpers (geometry, not legal-move based)    */
/*                                                                     */
/*  Returns a map: squareName -> array of attacker piece types.        */
/*  "Control" includes defended own pieces (sliders stop AT the first  */
/*  occupied square, which is still counted as controlled).            */
/* ------------------------------------------------------------------ */

type AttackMap = Record<string, string[]>;

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const sqName = (r: number, c: number) => `${FILES[c]}${8 - r}`;
const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

function buildAttackMap(game: Chess, color: "w" | "b"): AttackMap {
  const board = game.board(); // board[0] = rank 8, [7] = rank 1
  const map: AttackMap = {};
  const add = (r: number, c: number, type: string) => {
    if (!inBounds(r, c)) return;
    const key = sqName(r, c);
    (map[key] ||= []).push(type);
  };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;

      switch (piece.type) {
        case "p": {
          const dir = color === "w" ? -1 : 1; // white advances toward rank 8 (lower r)
          add(r + dir, c - 1, "p");
          add(r + dir, c + 1, "p");
          break;
        }
        case "n":
          KNIGHT_OFFSETS.forEach(([dr, dc]) => add(r + dr, c + dc, "n"));
          break;
        case "k":
          KING_OFFSETS.forEach(([dr, dc]) => add(r + dr, c + dc, "k"));
          break;
        case "b":
        case "r":
        case "q": {
          const dirs =
            piece.type === "b"
              ? BISHOP_DIRS
              : piece.type === "r"
              ? ROOK_DIRS
              : [...BISHOP_DIRS, ...ROOK_DIRS];
          dirs.forEach(([dr, dc]) => {
            let nr = r + dr;
            let nc = c + dc;
            while (inBounds(nr, nc)) {
              add(nr, nc, piece.type);
              if (board[nr][nc]) break; // stop at first occupied square (still controlled)
              nr += dr;
              nc += dc;
            }
          });
          break;
        }
      }
    }
  }
  return map;
}

/** Squares where `color` has a hanging piece (attacked & (undefended OR by lower value)). */
function findHangingPieces(game: Chess, color: "w" | "b") {
  const board = game.board();
  const oppMap = buildAttackMap(game, color === "w" ? "b" : "w");
  const ownMap = buildAttackMap(game, color);
  const hanging: { square: string; type: string; minAttacker: number; defended: boolean }[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color || piece.type === "k") continue;
      const name = sqName(r, c);
      const attackers = oppMap[name];
      if (!attackers?.length) continue;

      const minAttacker = Math.min(...attackers.map((t) => PIECE_VALUE[t]));
      const defended = !!ownMap[name]?.length;
      const pieceVal = PIECE_VALUE[piece.type];

      if (!defended || minAttacker < pieceVal) {
        hanging.push({ square: name, type: piece.type, minAttacker, defended });
      }
    }
  }
  return hanging;
}

/* ------------------------------------------------------------------ */
/*  Bot engine — MOCK ASYNC STUB.                                      */
/*                                                                     */
/*  Replace the body of getBotMove() with a Stockfish Web Worker:      */
/*    const worker = new Worker('/stockfish.js');                      */
/*    worker.postMessage(`position fen ${fen}`);                       */
/*    worker.postMessage(`go depth ${eloToDepth(elo)}`);               */
/*    // resolve on 'bestmove ...'                                     */
/*  It already returns a valid chess.js verbose move, so the plug-in   */
/*  point is fully isolated here.                                      */
/* ------------------------------------------------------------------ */

type VerboseMove = ReturnType<Chess["moves"]> extends (infer T)[] ? T : never;

function pickMove(game: Chess, elo: number, opening: string): VerboseMove | null {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;

  // 1) Follow the selected opening book. Book index (ply) is derived from the
  //    FEN so it survives reconstructing the game from a bare FEN string.
  const parts = game.fen().split(" ");
  const fullmove = parseInt(parts[5] || "1", 10);
  const turn = parts[1];
  const ply = (fullmove - 1) * 2 + (turn === "b" ? 1 : 0);

  const book = OPENINGS[opening] || [];
  if (ply < book.length) {
    const nextSan = book[ply];
    const bookMove = moves.find((m) => m.san === nextSan);
    if (bookMove) return bookMove;
  }

  // 2) Weighted heuristic scaled by ELO (higher ELO = sharper, less noise).
  const skill = Math.min(1, Math.max(0, (elo - 600) / 2600));
  const centerSquares = new Set(["d4", "e4", "d5", "e5", "c4", "f4", "c5", "f5"]);

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    let score = 0;
    if (m.captured) score += PIECE_VALUE[m.captured] * 10;
    if (m.san.includes("+")) score += 5;
    if (m.san.includes("#")) score += 1000;
    if (m.promotion) score += 8;
    if (centerSquares.has(m.to)) score += 2;
    const noise = (1 - skill) * Math.random() * 22;
    const total = skill * score + noise;
    if (total > bestScore) {
      bestScore = total;
      best = m;
    }
  }
  return best;
}

function getBotMove(fen: string, elo: number, opening: string): Promise<VerboseMove | null> {
  return new Promise((resolve) => {
    // Simulated engine "think time" — swap for a real Web Worker later.
    const think = 300 + Math.random() * 500;
    setTimeout(() => {
      const g = new Chess(fen);
      resolve(pickMove(g, elo, opening));
    }, think);
  });
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ChessTrainer() {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);

  // Setup / config
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [elo, setElo] = useState(1500);
  const [opening, setOpening] = useState<keyof typeof OPENINGS>("Ruy Lopez");
  const [started, setStarted] = useState(false);

  // Training visuals
  const [visionMode, setVisionMode] = useState(true);

  // Coach + blunder flow
  const [coach, setCoach] = useState("Configure your session and press Start Training.");
  const [thinking, setThinking] = useState(false);
  const [blunder, setBlunder] = useState<{ reason: string } | null>(null);

  const botColor = playerColor === "w" ? "b" : "w";
  const orientation = playerColor === "w" ? "white" : "black";

  const syncState = useCallback(() => {
    setFen(gameRef.current.fen());
    setHistory(gameRef.current.history());
  }, []);

  /* ---- Start / restart --------------------------------------------- */
  const startGame = useCallback(() => {
    gameRef.current = new Chess();
    setBlunder(null);
    setThinking(false);
    setStarted(true);
    setCoach(
      `Playing the ${opening} as ${playerColor === "w" ? "White" : "Black"}. Bot rated ${elo}. Watch the Vision map — control the center.`
    );
    syncState();
  }, [opening, playerColor, elo, syncState]);

  /* ---- Bot move ---------------------------------------------------- */
  const runBot = useCallback(async () => {
    if (thinking) return;
    setThinking(true);
    const move = await getBotMove(gameRef.current.fen(), elo, opening);
    if (move) {
      gameRef.current.move({ from: move.from, to: move.to, promotion: move.promotion });
      syncState();
      const threats = findHangingPieces(gameRef.current, playerColor);
      if (threats.length) {
        const t = threats[0];
        setCoach(
          `⚠ Careful — your ${PIECE_NAME[t.type]} on ${t.square} is now under pressure. Defend it or move it.`
        );
      } else {
        setCoach("Your move. Look for undefended enemy pieces on the red squares.");
      }
    }
    setThinking(false);
  }, [thinking, elo, opening, playerColor, syncState]);

  // Trigger the bot whenever it is its turn.
  useEffect(() => {
    if (!started || blunder) return;
    if (gameRef.current.isGameOver()) return;
    if (gameRef.current.turn() === botColor) {
      runBot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, started, blunder, botColor]);

  /* ---- User move + blunder correction ------------------------------ */
  const onDrop = useCallback(
    (sourceSquare: string, targetSquare: string) => {
      if (!started || blunder || thinking) return false;
      if (gameRef.current.turn() !== playerColor) return false;

      // Validate on a clone first so an illegal move never mutates state.
      const clone = new Chess(gameRef.current.fen());
      let result;
      try {
        result = clone.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      } catch {
        return false; // illegal move
      }
      if (!result) return false;

      // ---- Blunder detection: does this move hang material? ----
      const hangingAfter = findHangingPieces(clone, playerColor);
      const seriousHang = hangingAfter.find(
        (h) => PIECE_VALUE[h.type] >= 3 && (!h.defended || h.minAttacker < PIECE_VALUE[h.type])
      );
      const randomBlunder = Math.random() < 0.05 && result.captured === undefined;

      if (seriousHang || randomBlunder) {
        const reason = seriousHang
          ? `That move leaves your ${PIECE_NAME[seriousHang.type]} on ${seriousHang.square} hanging — it's attacked by a ${
              seriousHang.minAttacker < PIECE_VALUE[seriousHang.type] ? "lower-value piece" : "piece"
            } and ${seriousHang.defended ? "under-defended" : "completely undefended"}.`
          : "This drops the evaluation. There's a stronger, safer continuation here.";
        setBlunder({ reason });
        setCoach("Move blocked by your coach — review the warning and try a different idea.");
        return false; // snap the piece back; move never commits
      }

      // Commit the good move.
      gameRef.current.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      syncState();
      setCoach(
        result.captured
          ? `Nice — you won a ${PIECE_NAME[result.captured]}. Keep your pieces coordinated.`
          : "Solid. The bot is thinking…"
      );
      return true;
    },
    [started, blunder, thinking, playerColor, syncState]
  );

  const undoAndRetry = () => {
    setBlunder(null);
    setCoach("Good — reassess the position. Find a move that keeps every piece defended.");
  };

  /* ---- Threat-map + under-attack square styles --------------------- */
  const squareStyles = useMemo(() => {
    if (!started) return {};
    const styles: Record<string, React.CSSProperties> = {};

    if (visionMode) {
      const playerMap = buildAttackMap(gameRef.current, playerColor);
      const oppMap = buildAttackMap(gameRef.current, botColor);
      const all = new Set([...Object.keys(playerMap), ...Object.keys(oppMap)]);
      all.forEach((sq) => {
        const p = !!playerMap[sq];
        const o = !!oppMap[sq];
        if (p && o) styles[sq] = { background: "rgba(234,179,8,0.20)" };
        else if (o) styles[sq] = { background: "rgba(239,68,68,0.20)" };
        else if (p) styles[sq] = { background: "rgba(34,197,94,0.18)" };
      });
    }

    // Last-move highlight (from + to squares), layered under the attack glow.
    const verbose = gameRef.current.history({ verbose: true });
    const last = verbose[verbose.length - 1];
    if (last) {
      [last.from, last.to].forEach((sq) => {
        styles[sq] = {
          ...(styles[sq] || {}),
          background: styles[sq]?.background ?? "rgba(129,140,248,0.16)",
          boxShadow: "inset 0 0 0 2px rgba(129,140,248,0.55)",
        };
      });
    }

    // Under-attack glow on the player's own hanging pieces.
    findHangingPieces(gameRef.current, playerColor).forEach((h) => {
      styles[h.square] = {
        ...(styles[h.square] || {}),
        boxShadow: "inset 0 0 0 3px rgba(249,115,22,0.9)",
        animation: "ct-pulse 1.4s ease-in-out infinite",
        borderRadius: "4px",
      };
    });

    return styles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, visionMode, started, playerColor, botColor]);

  /* ---- Derived UI data --------------------------------------------- */
  const pairedHistory = useMemo(() => {
    const rows: { no: number; w?: string; b?: string }[] = [];
    for (let i = 0; i < history.length; i += 2) {
      rows.push({ no: i / 2 + 1, w: history[i], b: history[i + 1] });
    }
    return rows;
  }, [history]);

  const status = gameRef.current.isCheckmate()
    ? "Checkmate"
    : gameRef.current.isDraw()
    ? "Draw"
    : gameRef.current.isCheck()
    ? "Check"
    : started
    ? gameRef.current.turn() === playerColor
      ? "Your move"
      : "Bot thinking…"
    : "Not started";

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="min-h-screen w-full bg-slate-950 font-sans text-slate-100 antialiased">
      {/* keyframes for the under-attack pulse */}
      <style>{`
        @keyframes ct-pulse {
          0%, 100% { box-shadow: inset 0 0 0 3px rgba(249,115,22,0.35); }
          50%      { box-shadow: inset 0 0 0 4px rgba(249,115,22,1); }
        }
      `}</style>

      {/* ambient background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8 md:px-8">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-indigo-500 shadow-lg shadow-emerald-500/20">
              <Crown className="h-6 w-6 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">GM Vision</h1>
              <p className="text-xs text-slate-400">Board control &amp; blunder-correction trainer</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs font-medium text-slate-400">
            {status}
          </span>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          {/* -------- Board column -------- */}
          <div className="flex flex-col items-center">
            <div className="w-full max-w-[560px] rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <Chessboard
                position={fen}
                onPieceDrop={onDrop}
                boardOrientation={orientation}
                arePiecesDraggable={
                  started && !blunder && !thinking && gameRef.current.turn() === playerColor
                }
                customSquareStyles={squareStyles}
                customBoardStyle={{ borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}
                customDarkSquareStyle={{ backgroundColor: "#334155" }}
                customLightSquareStyle={{ backgroundColor: "#cbd5e1" }}
              />
            </div>

            {/* Vision legend */}
            {started && visionMode && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm bg-emerald-500/50" /> Your control
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm bg-red-500/50" /> Enemy control
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm bg-yellow-500/50" /> Contested
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm ring-2 ring-orange-500" /> Under attack
                </span>
              </div>
            )}
          </div>

          {/* -------- Control panel column -------- */}
          <div className="flex flex-col gap-5">
            {/* Setup card */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Sparkles className="h-4 w-4 text-emerald-400" /> Session Setup
              </h2>

              {/* Color toggle */}
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Play as</label>
              <div className="mb-4 grid grid-cols-2 gap-2">
                {(["w", "b"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setPlayerColor(c)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                      playerColor === c
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-inner"
                        : "border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {c === "w" ? "♔ White" : "♚ Black"}
                  </button>
                ))}
              </div>

              {/* ELO slider */}
              <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" /> Bot ELO
                </span>
                <span className="font-mono text-emerald-300">{elo}</span>
              </label>
              <input
                type="range"
                min={600}
                max={3200}
                step={50}
                value={elo}
                onChange={(e) => setElo(Number(e.target.value))}
                className="mb-4 w-full cursor-pointer accent-emerald-500"
              />

              {/* Opening dropdown */}
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <BookOpen className="h-3.5 w-3.5" /> Opening
              </label>
              <select
                value={opening}
                onChange={(e) => setOpening(e.target.value as keyof typeof OPENINGS)}
                className="mb-4 w-full rounded-lg border border-slate-800 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-emerald-500/50"
              >
                {Object.keys(OPENINGS).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <button
                  onClick={startGame}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  <Play className="h-4 w-4" /> {started ? "Restart" : "Start Training"}
                </button>
                <button
                  onClick={() => setVisionMode((v) => !v)}
                  title="Toggle Vision"
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    visionMode
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-800 bg-slate-800/40 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  {visionMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
            </section>

            {/* Coach feedback */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <MessageSquareText className="h-4 w-4 text-indigo-400" /> Coach's Feedback
              </h2>
              <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <Swords className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <p className="text-sm leading-relaxed text-slate-300">{coach}</p>
              </div>
            </section>

            {/* Move history */}
            <section className="flex-1 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur-xl">
              <h2 className="mb-3 text-sm font-semibold text-slate-200">Move History</h2>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
                {pairedHistory.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-500">No moves yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {pairedHistory.map((row) => (
                        <tr key={row.no} className="border-b border-slate-800/50 last:border-0">
                          <td className="w-10 px-3 py-1.5 font-mono text-xs text-slate-500">{row.no}.</td>
                          <td className="px-2 py-1.5 font-mono text-slate-200">{row.w}</td>
                          <td className="px-2 py-1.5 font-mono text-slate-400">{row.b ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* -------- Blunder modal -------- */}
      {blunder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-orange-500/30 bg-slate-900 p-6 shadow-2xl shadow-orange-500/10 duration-200 animate-in fade-in zoom-in">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/15">
                <AlertTriangle className="h-6 w-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-orange-300">Inaccuracy / Blunder</h3>
                <p className="text-xs text-slate-400">Your coach stopped the clock.</p>
              </div>
            </div>

            <div className="mb-5 flex gap-3 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
              <p className="text-sm leading-relaxed text-slate-200">{blunder.reason}</p>
            </div>

            <button
              onClick={undoAndRetry}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-400 to-orange-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4" /> Undo &amp; Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
