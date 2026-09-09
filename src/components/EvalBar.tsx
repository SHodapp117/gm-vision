import { useEffect, useRef, useState } from "react";
import { getEngine, isSuperseded } from "../engine/stockfish";

interface EvalBarProps {
  fen: string;
  /** Only analyze once training has started — never fire on first paint. */
  active: boolean;
  /** Matches the board's orientation so the bar reads the same way round. */
  orientation: "white" | "black";
}

/** cp beyond this magnitude is treated as "clearly winning" for the fill %. */
const CP_CLAMP = 800;

/**
 * Slim vertical eval bar, always expressed from White's POV. Re-analyzes
 * (lightly — short movetime, low priority "evalbar" channel so it never
 * queues up stale positions) whenever the fen changes.
 */
export default function EvalBar({ fen, active, orientation }: EvalBarProps) {
  const [cp, setCp] = useState<number | null>(null);
  const [mate, setMate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!active) return;
    const id = ++requestId.current;
    setLoading(true);
    const turn = fen.split(" ")[1] === "b" ? "b" : "w";

    getEngine()
      .analyze(fen, { movetime: 250, multipv: 1, channel: "evalbar" })
      .then((result) => {
        if (requestId.current !== id) return; // a newer position superseded this
        const line = result.lines[0];
        if (!line) {
          setCp(0);
          setMate(null);
          return;
        }
        if (line.mate !== undefined) {
          setMate(turn === "w" ? line.mate : -line.mate);
          setCp(null);
        } else {
          const value = line.cp ?? 0;
          setCp(turn === "w" ? value : -value);
          setMate(null);
        }
      })
      .catch((err: unknown) => {
        if (isSuperseded(err) || requestId.current !== id) return;
        // Engine unavailable/failed — leave the bar at its last-known value.
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
  }, [fen, active]);

  const whitePercent =
    mate !== null
      ? mate > 0
        ? 100
        : 0
      : cp !== null
      ? 50 + (Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp)) / CP_CLAMP) * 50
      : 50;

  const label =
    !active || (cp === null && mate === null)
      ? "—"
      : mate !== null
      ? `M${Math.abs(mate)}`
      : `${cp! > 0 ? "+" : cp! < 0 ? "" : "±"}${(cp! / 100).toFixed(1)}`;

  return (
    <div className="flex w-7 shrink-0 flex-col items-center gap-1.5" title="Evaluation (White's POV)">
      <div
        className="relative flex w-5 flex-1 overflow-hidden rounded-full border border-slate-800 bg-slate-950"
        style={{ flexDirection: orientation === "white" ? "column-reverse" : "column" }}
      >
        <div
          className="w-full bg-slate-200 transition-[height] duration-500 ease-out"
          style={{ height: `${whitePercent}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-slate-400">
        {loading && cp === null && mate === null ? "…" : label}
      </span>
    </div>
  );
}
