import type { Metadata } from "next";
import Link from "next/link";
import data from "../../../data/leaderboard.json";
import { GradeRing, Nav } from "../stale-hunter";

export const metadata: Metadata = {
  title: "Hall of Stale · Stale Hunter",
  description: "Outdated facts Stale Hunter found on Wikipedia, each confirmed by two Nemotron models and reviewed by hand.",
};

type Entry = (typeof data.results)[number];

const years = (iso: string) => (Date.now() - new Date(iso).getTime()) / (365.25 * 864e5);
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", year: "numeric" });

export default function Leaderboard() {
  const stale = data.results.filter((r) => r.stats.outdated > 0);
  const clean = data.results.filter((r) => r.stats.outdated === 0);
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 pb-20">
        <header className="py-10 text-center sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">Hall of Stale</p>
          <h1 className="mt-3 font-display text-5xl leading-tight sm:text-7xl">
            Facts Wikipedia <span className="text-gradient italic">forgot to update</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-stone-400">
            Every fact below was flagged by Stale Hunter, confirmed by a second Nemotron model, and checked by a human
            before it was listed here.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-4">
          <BigStat value={data.articles} label="articles audited" />
          <BigStat value={data.checked} label="time-sensitive facts checked" />
          <BigStat value={data.outdated} label="confirmed outdated" accent />
          <BigStat
            value={data.avgYearsUntouched ? `${data.avgYearsUntouched.toFixed(1)} yrs` : "–"}
            label="average time those sentences sat untouched"
            accent
          />
        </section>

        <ol className="mt-10 space-y-4">
          {stale.map((r, i) => (
            <Row key={r.title} entry={r} rank={i + 1} />
          ))}
        </ol>

        {clean.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Audited and clean</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {clean.map((r) => (
                <Link
                  key={r.title}
                  href={`/?article=${encodeURIComponent(r.title)}`}
                  className="rounded-full px-3 py-1 text-sm text-stone-300 glass hover:bg-white/10"
                >
                  <span className="mr-1.5 text-emerald-400">✓</span>
                  {r.title}
                  <span className="ml-1.5 text-stone-500">{r.stats.checked} checked</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 text-center text-xs text-stone-600">
          Generated {new Date(data.generatedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })} from
          real hunts. Results can change as the web changes. Re-run any article live.
        </p>
      </main>
    </div>
  );
}

function BigStat({ value, label, accent }: { value: string | number; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${accent ? "border border-red-500/30 bg-red-950/30" : "glass"}`}>
      <div className={`font-display text-5xl tabular-nums ${accent ? "text-red-400" : ""}`}>{value}</div>
      <div className="mt-1 text-sm text-stone-400">{label}</div>
    </div>
  );
}

function Row({ entry: r, rank }: { entry: Entry; rank: number }) {
  return (
    <li className="fade-up rounded-2xl p-5 glass sm:p-6" style={{ animationDelay: `${rank * 60}ms` }}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="hidden font-display text-4xl text-stone-600 sm:inline">#{rank}</span>
        <GradeRing outdated={r.stats.outdated} current={r.stats.current} size={56} />
        <div className="min-w-[12rem] flex-1">
          <a href={r.url} target="_blank" rel="noreferrer" className="font-display text-3xl hover:underline">
            <span className="text-stone-600 sm:hidden">#{rank} </span>
            {r.title}
          </a>
          <div className="text-sm text-stone-400">
            {r.stats.outdated} outdated of {r.stats.checked} facts checked
            {r.oldestYears >= 1 && (
              <span className="text-amber-300"> · oldest sat untouched {Math.floor(r.oldestYears)} years</span>
            )}
          </div>
        </div>
        <Link
          href={`/?article=${encodeURIComponent(r.title)}`}
          className="w-full rounded-xl bg-gradient-to-b text-center sm:w-auto from-red-500 to-red-600 px-4 py-2 text-sm font-medium text-white shadow-[0_8px_30px_-10px_rgb(239_68_68)] hover:brightness-110"
        >
          Re-run live →
        </Link>
      </div>

      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {r.outdated.map((o, k) => (
          <li key={k} className="rounded-xl bg-paper p-4 text-ink">
            <p className="font-serif leading-relaxed text-stone-500 line-through decoration-red-500/70">{o.sentence}</p>
            <p className="mt-2 flex items-start gap-2 text-sm font-medium text-red-700">
              <span className="mt-0.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Now</span>
              {o.currentFact}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              {o.age && (
                <span className={years(o.age.lastTouched) >= 3 ? "font-medium text-amber-700" : ""}>
                  ✎ written {monthYear(o.age.written)}, untouched {Math.floor(years(o.age.lastTouched))}y
                </span>
              )}
              {o.confirmed && <span className="text-red-700">✓✓ 2 models agreed</span>}
              {o.sources.slice(0, 2).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline decoration-stone-300 hover:text-ink">
                  {new URL(s.url).hostname.replace(/^www\./, "")}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}
