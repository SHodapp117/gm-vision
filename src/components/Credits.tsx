import { Cpu, Database, Globe, Package, Heart, ExternalLink } from "lucide-react";

/**
 * Attribution & licensing panel for GM Vision.
 *
 * Some of the content below is a legal obligation, not a courtesy:
 * the bundled Stockfish engine is GPL-3.0, which requires us to state
 * that Stockfish is used, that it is GPLv3, keep its license text
 * available, and link to its corresponding source. That section comes
 * first and most prominent for exactly that reason.
 *
 * Self-contained: no new dependencies, only lucide-react (already used
 * across the app) and Tailwind classes that match the app's glass cards.
 */

interface CreditLink {
  label: string;
  href: string;
}

/** A small external anchor that always opens safely in a new tab. */
function Link({ label, href }: CreditLink) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-slate-300 underline decoration-slate-600 underline-offset-2 transition-colors hover:text-emerald-300 hover:decoration-emerald-400/60"
    >
      {label}
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

interface Library {
  name: string;
  href: string;
  license: string;
}

const LIBRARIES: Library[] = [
  { name: "chess.js", href: "https://github.com/jhlywa/chess.js", license: "BSD-2-Clause" },
  { name: "react-chessboard", href: "https://github.com/Clariity/react-chessboard", license: "MIT" },
  { name: "React", href: "https://react.dev/", license: "MIT" },
  { name: "lucide-react", href: "https://lucide.dev/", license: "ISC" },
  { name: "Tailwind CSS", href: "https://tailwindcss.com/", license: "MIT" },
  { name: "Vite", href: "https://vite.dev/", license: "MIT" },
];

/** Section heading with a lucide icon, matching the app's muted label style. */
function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Cpu;
  children: React.ReactNode;
}) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
      <Icon className="h-3.5 w-3.5 text-emerald-400/80" aria-hidden="true" />
      {children}
    </h3>
  );
}

export default function Credits() {
  return (
    <section
      aria-label="Attribution and licenses"
      className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-sm text-slate-400 shadow-2xl shadow-black/40 backdrop-blur-xl"
    >
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-slate-200">Attribution &amp; licenses</h2>
        <p className="mt-1 text-xs text-slate-500">
          GM Vision stands on open-source software and open chess data. Full details in{" "}
          <Link label="CREDITS.md" href="https://github.com/" /> and{" "}
          <span className="text-slate-400">NOTICE</span> at the repo root.
        </p>
      </header>

      <div className="space-y-4">
        {/* Engine — GPL-3.0 obligation, kept first and prominent. */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <SectionTitle icon={Cpu}>Engine</SectionTitle>
          <p className="text-xs leading-relaxed text-slate-400">
            Analysis is powered by <Link label="Stockfish" href="https://stockfishchess.org/" />,
            a free and open-source chess engine, licensed under the{" "}
            <Link label="GNU GPL v3" href="https://www.gnu.org/licenses/gpl-3.0.html" />. The
            Stockfish WebAssembly build is bundled with this app; its complete license text is
            kept alongside it at{" "}
            <code className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-[11px] text-slate-300">
              public/engine/LICENSE.stockfish.txt
            </code>
            . Corresponding source:{" "}
            <Link
              label="github.com/official-stockfish/Stockfish"
              href="https://github.com/official-stockfish/Stockfish"
            />
            .
          </p>
        </div>

        {/* Puzzle data — Lichess CC0 + chessgo.in acknowledgment. */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <SectionTitle icon={Database}>Puzzle data</SectionTitle>
          <p className="text-xs leading-relaxed text-slate-400">
            The bundled ~5,005 curated puzzles come from the{" "}
            <Link label="Lichess open puzzle database" href="https://database.lichess.org/" />,
            dedicated to the public domain under{" "}
            <Link
              label="CC0 1.0"
              href="https://creativecommons.org/publicdomain/zero/1.0/"
            />{" "}
            (no attribution is legally required — we credit it gladly anyway).
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
            <Heart className="mt-0.5 h-3 w-3 shrink-0 text-pink-400/80" aria-hidden="true" />
            <span>
              With thanks to <Link label="chessgo.in" href="https://chessgo.in/" /> for their
              collaboration around chess puzzle content.
            </span>
          </p>
        </div>

        {/* Live data services. */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <SectionTitle icon={Globe}>Data services</SectionTitle>
          <p className="text-xs leading-relaxed text-slate-400">
            Opening statistics are provided by the{" "}
            <Link
              label="Lichess Opening Explorer"
              href="https://explorer.lichess.org/"
            />
            . With thanks to <Link label="Lichess" href="https://lichess.org/" /> for their free,
            open service.
          </p>
        </div>

        {/* Libraries. */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <SectionTitle icon={Package}>Built with</SectionTitle>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-400">
            {LIBRARIES.map((lib) => (
              <li key={lib.name} className="flex items-center gap-1.5">
                <Link label={lib.name} href={lib.href} />
                <span className="font-mono text-[10px] text-slate-500">{lib.license}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
        GM Vision's own source is released under the MIT License. Bundled third-party components
        remain under their respective licenses — most notably Stockfish, which stays under the GNU
        GPL v3.
      </p>
    </section>
  );
}
