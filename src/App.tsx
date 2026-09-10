import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Crown, Swords, Puzzle as PuzzleIcon } from "lucide-react";
import ChessTrainer from "./ChessTrainer";
import Credits from "./components/Credits";

// Lazy-loaded so the ~900KB bundled puzzle dataset isn't pulled into the
// initial (Play) bundle — only when the user opens the Puzzles tab.
const PuzzleTrainer = lazy(() => import("./PuzzleTrainer"));

type Tab = "play" | "puzzles";

const TAB_KEY = "gmv.activeTab.v1";

function readTab(): Tab {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    return raw === "puzzles" ? "puzzles" : "play";
  } catch {
    return "play";
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => readTab());

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Storage unavailable (private mode) — the tab just won't persist.
    }
  }, [tab]);

  const NavButton = useCallback(
    ({ id, label, icon }: { id: Tab; label: string; icon: React.ReactNode }) => (
      <button
        onClick={() => setTab(id)}
        aria-pressed={tab === id}
        className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${
          tab === id
            ? "bg-emerald-500/15 text-emerald-300 shadow-inner ring-1 ring-emerald-500/40"
            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        }`}
      >
        {icon}
        {label}
      </button>
    ),
    [tab]
  );

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100">
      {/* Global top nav — the mode switcher. */}
      <nav className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-indigo-500 shadow-lg shadow-emerald-500/20">
              <Crown className="h-5 w-5 text-slate-950" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-100">GM Vision</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
            <NavButton id="play" label="Play" icon={<Swords className="h-4 w-4" />} />
            <NavButton id="puzzles" label="Puzzles" icon={<PuzzleIcon className="h-4 w-4" />} />
          </div>
        </div>
      </nav>

      {tab === "play" ? (
        <ChessTrainer />
      ) : (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-32 text-sm text-slate-500">
              Loading puzzles…
            </div>
          }
        >
          <PuzzleTrainer />
        </Suspense>
      )}

      <Credits />
    </div>
  );
}
