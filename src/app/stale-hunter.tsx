"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { SentenceAge } from "@/lib/history";
import type { ArticleView, Claim, Finding, HuntEvent, HuntStats, Verdict } from "@/lib/hunter";
import type { CallRecord } from "@/lib/llm";

const EXAMPLES = ["Mobius Motors", "Manchester United F.C.", "ISRO", "List of tallest buildings", "NewJeans"];

// Real catches from our evaluation runs, cycled on the landing page.
const CATCHES = [
  { article: "Manchester United F.C.", was: "is ranked third in the Deloitte Football Money League", now: "ranked 8th in the 2026 edition" },
  { article: "ISRO", was: "a mission to Venus is scheduled for 2025", now: "launch now planned for March 2028" },
  { article: "US Airline Pilots Association", was: "currently under the jurisdiction of Judge Roslyn Silver", now: "her ruling was vacated on appeal in 2015" },
  { article: "List of tallest buildings", was: "this list includes all 98 buildings of 350 m or more", now: "105 buildings as of October 2026" },
  { article: "Mobius Motors", was: "Joel Jackson is the founder and CEO", now: "Nicolas Guibert is CEO after the 2025 acquisition" },
];

const STAGES = [
  { key: "fetch", label: "Read" },
  { key: "scan", label: "Scan" },
  { key: "research", label: "Research" },
  { key: "judge", label: "Judge + verify" },
  { key: "done", label: "Report" },
] as const;

const VERDICT: Record<Verdict, { label: string; badge: string; mark: string; dot: string }> = {
  outdated: {
    label: "Outdated",
    badge: "bg-red-500 text-white shadow-[0_0_20px_-4px_rgb(239_68_68)]",
    mark: "bg-red-500/20 text-red-950 underline decoration-red-600 decoration-2 underline-offset-4 shadow-[0_0_0_2px_rgb(239_68_68/0.25)]",
    dot: "bg-red-500 shadow-[0_0_10px_rgb(239_68_68)]",
  },
  current: {
    label: "Still current",
    badge: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
    mark: "underline decoration-emerald-600 decoration-2 underline-offset-4",
    dot: "bg-emerald-400",
  },
  unverifiable: {
    label: "Unverified",
    badge: "bg-white/10 text-stone-300",
    mark: "underline decoration-stone-400 decoration-dashed decoration-2 underline-offset-4",
    dot: "bg-stone-500",
  },
};

type LogLine = { t: number; text: string; tone?: "red" | "green" | "muted" | "amber" };

export default function StaleHunter({ backlog }: { backlog: number | null }) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [article, setArticle] = useState<ArticleView | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [researched, setResearched] = useState<Set<string>>(new Set());
  const [findings, setFindings] = useState<Record<string, Finding>>({});
  const [ages, setAges] = useState<Record<string, SentenceAge>>({});
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [stats, setStats] = useState<HuntStats | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [active, setActive] = useState("");
  const startedAt = useRef(0);
  const claimsRef = useRef<Claim[]>([]);

  const say = (text: string, tone?: LogLine["tone"]) =>
    setLog((l) => [...l, { t: (Date.now() - startedAt.current) / 1000, text, tone }]);

  // Deep links: /?article=Mobius_Motors starts a hunt straight away (used by the leaderboard).
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("article");
    if (a) run(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(target: string) {
    if (!target.trim() || running) return;
    setInput(target);
    setRunning(true);
    setError("");
    setStage("fetch");
    setArticle(null);
    setClaims([]);
    claimsRef.current = [];
    setResearched(new Set());
    setFindings({});
    setAges({});
    setCalls([]);
    setStats(null);
    setLog([]);
    setActive("");
    startedAt.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: target }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as HuntEvent);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  function handle(e: HuntEvent) {
    const claimText = (id: string) => claimsRef.current.find((c) => c.id === id)?.claim ?? "";
    switch (e.type) {
      case "step":
        setStage(e.stage);
        if (e.stage !== "done") say(e.message);
        break;
      case "article":
        setArticle(e.article);
        say(`Read “${e.article.title}”: ${Object.keys(e.article.sentences).length} sentences`, "muted");
        break;
      case "claims":
        setClaims(e.claims);
        claimsRef.current = e.claims;
        say(`Flagged ${e.claims.length} time-sensitive facts`, "amber");
        break;
      case "research":
        setResearched((s) => new Set(s).add(e.claimId));
        say(`${e.sources.length} sources · ${claimText(e.claimId)}`, "muted");
        break;
      case "dig":
        say(`Evidence too thin, digging deeper: “${e.query}”`, "amber");
        break;
      case "age":
        setAges((a) => ({ ...a, [e.claimId]: e.age }));
        break;
      case "finding":
        setFindings((f) => ({ ...f, [e.finding.claimId]: e.finding }));
        say(
          `${VERDICT[e.finding.verdict].label}${e.finding.secondOpinion?.agree ? " (confirmed by 2nd model)" : ""} · ${claimText(e.finding.claimId)}`,
          e.finding.verdict === "outdated" ? "red" : e.finding.verdict === "current" ? "green" : "muted",
        );
        break;
      case "call":
        setCalls((c) => [...c, e.call]);
        break;
      case "done":
        setStats(e.stats);
        setStage("done");
        say(`Done in ${(e.stats.ms / 1000).toFixed(0)}s`);
        break;
      case "error":
        setError(e.message);
        break;
    }
  }

  async function surprise() {
    setError("");
    try {
      const r = await fetch("/api/surprise").then((r) => r.json());
      if (r.title) run(r.title);
      else throw new Error(r.error ?? "Couldn't pick an article");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const claimBySid = useMemo(() => new Map(claims.map((c) => [c.sid, c])), [claims]);
  const ordered = useMemo(() => {
    const rank: Record<Verdict, number> = { outdated: 0, unverifiable: 1, current: 2 };
    return [...claims].sort((a, b) => {
      const fa = findings[a.id];
      const fb = findings[b.id];
      if (!fa || !fb) return fa ? -1 : fb ? 1 : 0;
      return rank[fa.verdict] - rank[fb.verdict] || fb.confidence - fa.confidence;
    });
  }, [claims, findings]);

  const judged = Object.values(findings);
  const started = stage !== "";

  function focus(claimId: string, target: "card" | "sentence") {
    setActive(claimId);
    document.getElementById(`${target}-${claimId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const searchBox = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(input);
      }}
      className="mx-auto flex w-full max-w-2xl gap-2 rounded-2xl p-1.5 glass focus-within:ring-2 focus-within:ring-red-500/50"
    >
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Wikipedia article title or URL"
        className="min-w-0 flex-1 bg-transparent px-4 py-3 text-foreground placeholder:text-stone-500 outline-none"
      />
      <button
        disabled={running || !input.trim()}
        className="rounded-xl bg-gradient-to-b from-red-500 to-red-600 px-6 py-3 font-medium text-white shadow-[0_8px_30px_-8px_rgb(239_68_68)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
      >
        {running ? "Hunting…" : "Hunt"}
      </button>
    </form>
  );

  return (
    <div className="min-h-screen">
      <Nav />

      {!started ? (
        <Landing backlog={backlog} searchBox={searchBox} onExample={run} onSurprise={surprise} error={error} />
      ) : (
        <main className="mx-auto max-w-7xl px-4 pb-20">
          <div className="pt-2">{searchBox}</div>
          {error && <p className="mx-auto mt-4 max-w-2xl rounded-xl bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/30">{error}</p>}

          <Stepper stage={stage} running={running} />

          {article && <ResultHeader article={article} total={claims.length} findings={judged} done={!!stats} />}

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
            <section className="min-w-0 lg:sticky lg:top-4 lg:self-start">
              {article ? (
                <Reader
                  article={article}
                  claimBySid={claimBySid}
                  findings={findings}
                  researched={researched}
                  active={active}
                  scanning={running && (stage === "fetch" || stage === "scan")}
                  onPick={(id) => focus(id, "card")}
                />
              ) : (
                <div className="relative h-80 overflow-hidden rounded-2xl bg-paper/90">
                  <div className="scan-beam" />
                </div>
              )}
            </section>

            <aside className="min-w-0 space-y-4">
              <AgentLog log={log} running={running} />
              {stage === "done" && claims.length === 0 && (
                <p className="rounded-2xl p-4 text-sm text-stone-300 glass">
                  No time-sensitive statements found. This article looks timeless.
                </p>
              )}
              {ordered
                .filter((c) => findings[c.id]?.verdict !== "unverifiable")
                .map((c) => (
                  <FindingCard
                    key={c.id}
                    claim={c}
                    sentence={article?.sentences[c.sid] ?? ""}
                    finding={findings[c.id]}
                    age={ages[c.id]}
                    researched={researched.has(c.id)}
                    active={active === c.id}
                    articleUrl={article?.url ?? ""}
                    onPick={() => focus(c.id, "sentence")}
                  />
                ))}
              <UnverifiedGroup
                claims={ordered.filter((c) => findings[c.id]?.verdict === "unverifiable")}
                findings={findings}
                sentences={article?.sentences ?? {}}
                onPick={(id) => focus(id, "sentence")}
              />
            </aside>
          </div>

          {calls.length > 0 && <Router calls={calls} stats={stats} />}
        </main>
      )}

      <footer className="mx-auto max-w-7xl border-t border-white/10 px-4 py-6 text-xs text-stone-500">
        Stale Hunter suggests edits; humans decide. Always review sources before editing Wikipedia. Article text from
        Wikipedia under CC BY-SA 4.0. Built with NVIDIA Nemotron on Nebius Token Factory, Tavily and WikiWho.
      </footer>
    </div>
  );
}

export function Nav() {
  return (
    <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
      {/* Full page load on purpose: clicking the logo should reset any hunt in progress. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
        <Logo />
        Stale Hunter
      </a>
      <div className="flex items-center gap-5 text-sm">
        <Link href="/leaderboard" className="text-stone-300 hover:text-white">
          Hall of Stale
        </Link>
        <span className="hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs text-stone-400 glass md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#76b900]" />
          NVIDIA Nemotron on Nebius
        </span>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-red-500 to-red-700 text-white shadow-[0_6px_20px_-6px_rgb(239_68_68)]">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Landing({
  backlog,
  searchBox,
  onExample,
  onSurprise,
  error,
}: {
  backlog: number | null;
  searchBox: React.ReactNode;
  onExample: (t: string) => void;
  onSurprise: () => void;
  error: string;
}) {
  return (
    <>
      <section className="relative mx-auto max-w-5xl px-4 pb-10 pt-10 text-center sm:pt-16">
        <div className="grid-lines absolute inset-0 -z-10" />
        <p className="fade-up mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-stone-300 glass">
          <span className="pulse-ring h-2 w-2 rounded-full bg-red-500" />
          {backlog
            ? `${backlog.toLocaleString()} Wikipedia articles are officially tagged “needs updating” right now`
            : "Wikipedia freshness checker"}
        </p>
        <h1 className="fade-up font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl md:text-8xl">
          Every AI learns from Wikipedia.
          <br />
          <span className="text-gradient italic">Some of it stopped being true.</span>
        </h1>
        <p className="fade-up mx-auto mt-6 max-w-2xl text-lg text-stone-400" style={{ animationDelay: "120ms" }}>
          Stale Hunter reads an article, checks every time-sensitive fact against the live web, has two NVIDIA
          Nemotron models agree on what&apos;s outdated, and drafts sourced fixes an editor can paste in.
        </p>
        <div className="fade-up mt-9" style={{ animationDelay: "200ms" }}>
          {searchBox}
        </div>
        <div className="fade-up mt-4 flex flex-wrap justify-center gap-2 text-sm" style={{ animationDelay: "260ms" }}>
          <button
            onClick={onSurprise}
            className="rounded-full bg-red-500/15 px-3.5 py-1.5 text-red-200 ring-1 ring-red-500/40 transition hover:bg-red-500/25"
          >
            🎲 Random article from the backlog
          </button>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onExample(ex)}
              className="rounded-full px-3.5 py-1.5 text-stone-300 transition glass hover:bg-white/10 hover:text-white"
            >
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="mx-auto mt-4 max-w-xl rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </section>

      <Ticker />
      <Pipeline />
    </>
  );
}

/** Cycles through real stale facts we found, with an animated strike-through. */
function Ticker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % CATCHES.length), 4200);
    return () => clearInterval(id);
  }, []);
  const c = CATCHES[i];
  return (
    <section className="mx-auto max-w-4xl px-4">
      <div key={i} className="fade-up relative overflow-hidden rounded-2xl bg-paper p-6 text-ink shadow-2xl sm:p-8">
        <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-widest text-stone-500">
          <span>Found by Stale Hunter · {c.article}</span>
          <span className="flex gap-1">
            {CATCHES.map((_, k) => (
              <span key={k} className={`h-1.5 w-4 rounded-full ${k === i ? "bg-red-600" : "bg-stone-300"}`} />
            ))}
          </span>
        </div>
        <p className="font-serif text-2xl leading-snug sm:text-3xl">
          “…<span className="strike text-stone-500">{c.was}</span>…”
        </p>
        <p className="mt-3 flex items-center gap-2 font-medium text-red-700">
          <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">Now</span>
          {c.now}
        </p>
      </div>
    </section>
  );
}

function Pipeline() {
  const steps = [
    ["Scan", "Nemotron 3 Super reads every sentence and flags facts that drift: office holders, rankings, “as of” figures, plans.", "text-amber-300"],
    ["Research", "Tavily searches the live web for the current state of each fact, skipping Wikipedia and its mirrors.", "text-sky-300"],
    ["Judge", "Nemotron 3 Ultra separates facts that changed over time from mere disagreements, and digs deeper when evidence is thin.", "text-violet-300"],
    ["Verify", "A second Nemotron model must independently agree before anything is marked outdated.", "text-red-300"],
    ["Fix", "Each confirmed issue gets a rewritten sentence with {{cite web}} references, and when it was last edited.", "text-emerald-300"],
  ] as const;
  return (
    <section className="mx-auto my-16 max-w-6xl px-4">
      <h2 className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">How the agent works</h2>
      <div className="grid gap-3 sm:grid-cols-5">
        {steps.map(([title, body, color], i) => (
          <div key={title} className="fade-up rounded-2xl p-5 glass" style={{ animationDelay: `${i * 70}ms` }}>
            <div className={`font-mono text-xs ${color}`}>0{i + 1}</div>
            <div className="mt-2 font-semibold">{title}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-400">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stepper({ stage, running }: { stage: string; running: boolean }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="mt-6 grid grid-cols-5 gap-1.5 text-xs sm:text-sm">
      {STAGES.map((s, i) => {
        const state = i < idx || stage === "done" ? "done" : i === idx && running ? "active" : "todo";
        return (
          <li key={s.key} className="min-w-0">
            <div
              className={`h-1 rounded-full transition-all ${
                state === "done" ? "bg-red-500" : state === "active" ? "checking bg-white/10" : "bg-white/10"
              }`}
            />
            <div className={`mt-2 truncate ${state === "todo" ? "text-stone-600" : state === "active" ? "text-amber-300" : "text-stone-300"}`}>
              {state === "done" ? "✓ " : ""}
              {s.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A–F grade from the share of decided facts that are outdated. Unverified facts don't count against. */
export function grade(outdated: number, current: number) {
  const decided = outdated + current;
  const score = decided ? Math.round(100 * (1 - outdated / decided)) : 100;
  const letter = score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
  const color = { A: "#34d399", B: "#6ee7b7", C: "#fbbf24", D: "#fb923c", F: "#ef4444" }[letter];
  return { score, letter, color };
}

export function GradeRing({ outdated, current, size = 84, pending }: { outdated: number; current: number; size?: number; pending?: boolean }) {
  // Nothing decided yet: show a neutral ring rather than a misleading "A".
  const empty = outdated + current === 0;
  const g = empty ? { score: 0, letter: "–", color: "#57534e" } : grade(outdated, current);
  const deg = (g.score / 100) * 360;
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-full ${pending ? "animate-pulse" : ""}`}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${g.color} ${deg}deg, rgb(255 255 255 / 0.08) ${deg}deg)`,
        boxShadow: `0 0 40px -10px ${g.color}`,
        transition: "background 0.6s",
      }}
    >
      <div className="absolute inset-[5px] rounded-full bg-surface" />
      <span className="relative font-display text-4xl" style={{ color: g.color, fontSize: size * 0.45 }}>
        {g.letter}
      </span>
    </div>
  );
}

function ResultHeader({ article, total, findings, done }: { article: ArticleView; total: number; findings: Finding[]; done: boolean }) {
  const n = (v: Verdict) => findings.filter((f) => f.verdict === v).length;
  const g = grade(n("outdated"), n("current"));
  return (
    <div className="fade-up mt-6 flex flex-wrap items-center justify-between gap-6 rounded-2xl p-5 glass sm:p-6">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-widest text-stone-500">Freshness report</div>
        <a href={article.url} target="_blank" rel="noreferrer" className="mt-1 block font-display text-4xl hover:underline">
          {article.title}
        </a>
        <p className="mt-1 text-sm text-stone-400">
          Last edited {article.lastEdited ? new Date(article.lastEdited).toLocaleDateString() : "unknown"} ·{" "}
          {Object.keys(article.sentences).length.toLocaleString()} sentences read · {total} {total === 1 ? "fact" : "facts"} checked
        </p>
      </div>
      <div className="flex items-center gap-6 sm:gap-8">
        <Stat n={n("outdated")} label="outdated" className="text-red-400" />
        <Stat n={n("current")} label="still current" className="text-emerald-400" />
        <Stat n={n("unverifiable")} label="unverified" className="text-stone-500" />
        <div className="flex items-center gap-3 border-l border-white/10 pl-6">
          <GradeRing outdated={n("outdated")} current={n("current")} pending={!done} />
          <div className="text-xs text-stone-500">
            Freshness
            <div className="text-xl font-semibold tabular-nums text-foreground">
              {n("outdated") + n("current") ? `${g.score}/100` : "…"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <div className="text-center">
      <div className={`text-3xl font-semibold tabular-nums ${className}`}>{n}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
}

function Reader({
  article,
  claimBySid,
  findings,
  researched,
  active,
  scanning,
  onPick,
}: {
  article: ArticleView;
  claimBySid: Map<string, Claim>;
  findings: Record<string, Finding>;
  researched: Set<string>;
  active: string;
  scanning: boolean;
  onPick: (claimId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const total = Object.keys(article.sentences).length;
  const marks = [...claimBySid.values()].map((c) => ({
    claim: c,
    pos: (Number(c.sid.slice(1)) - 1) / Math.max(total - 1, 1),
    verdict: findings[c.id]?.verdict,
  }));

  function jump(claimId: string) {
    const el = document.getElementById(`sentence-${claimId}`);
    const box = scroller.current;
    if (el && box) box.scrollTo({ top: el.offsetTop - box.clientHeight / 3, behavior: "smooth" });
    onPick(claimId);
  }

  return (
    <div className="flex min-w-0 gap-3">
      {/* Staleness heatmap: where in the article the flagged facts sit */}
      <div className="relative w-2.5 shrink-0 rounded-full bg-white/10" title="Where the flagged facts are">
        {marks.map((m) => (
          <button
            key={m.claim.id}
            onClick={() => jump(m.claim.id)}
            style={{ top: `calc(${(m.pos * 100).toFixed(2)}% - 4px)` }}
            className={`absolute -left-0.5 h-2 w-3.5 rounded-full transition ${
              m.verdict ? VERDICT[m.verdict].dot : "animate-pulse bg-amber-400"
            } ${active === m.claim.id ? "ring-2 ring-white" : ""}`}
            aria-label={m.claim.claim}
          />
        ))}
      </div>

      <div
        ref={scroller}
        className="relative max-h-[72vh] min-w-0 flex-1 overflow-y-auto overflow-x-hidden break-words rounded-2xl bg-paper px-7 py-6 font-serif text-[17px] leading-8 text-ink shadow-2xl lg:max-h-[calc(100vh-2rem)]"
      >
        {scanning && <div className="scan-beam" />}
        {article.sections.map((s, i) => (
          <div key={i} className="mb-5">
            <h3 className={`mb-2 border-b border-stone-300 pb-1 font-serif font-semibold ${i === 0 ? "text-3xl" : "text-xl"}`}>
              {i === 0 ? article.title : s.heading}
            </h3>
            {s.paragraphs.map((p, j) => (
              <p key={j} className="mb-3 text-stone-700">
                {p.map((sid) => {
                  const claim = claimBySid.get(sid);
                  const text = article.sentences[sid] + " ";
                  if (!claim) return <span key={sid}>{text}</span>;
                  const f = findings[claim.id];
                  const cls = f ? VERDICT[f.verdict].mark : researched.has(claim.id) ? "checking" : "bg-amber-200/60";
                  return (
                    <span
                      key={sid}
                      id={`sentence-${claim.id}`}
                      onClick={() => onPick(claim.id)}
                      className={`cursor-pointer rounded px-0.5 text-ink transition ${cls} ${active === claim.id ? "ring-2 ring-ink" : ""}`}
                    >
                      {text}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentLog({ log, running }: { log: LogLine[]; running: boolean }) {
  const [open, setOpen] = useState(true);
  if (!log.length) return null;
  const visible = open ? log.slice(-9) : [];
  const tone = { red: "text-red-400", green: "text-emerald-400", muted: "text-stone-500", amber: "text-amber-300" };
  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-xs text-stone-200 shadow-xl">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-stone-400">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
          agent.log
        </span>
        <span>{open ? "hide" : `show (${log.length})`}</span>
      </button>
      {open && (
        <ol className="mt-3 space-y-1">
          {visible.map((l, i) => (
            <li key={log.length - visible.length + i} className="fade-up flex gap-3">
              <span className="w-11 shrink-0 text-right text-stone-600">{l.t.toFixed(1)}s</span>
              <span className={`min-w-0 truncate ${l.tone ? tone[l.tone] : ""}`}>{l.text}</span>
            </li>
          ))}
          {running && <li className="pl-14 text-stone-500">▍</li>}
        </ol>
      )}
    </div>
  );
}

function FindingCard({
  claim,
  sentence,
  finding,
  age,
  researched,
  active,
  articleUrl,
  onPick,
}: {
  claim: Claim;
  sentence: string;
  finding?: Finding;
  age?: SentenceAge;
  researched: boolean;
  active: boolean;
  articleUrl: string;
  onPick: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!finding) {
    return (
      <div id={`card-${claim.id}`} className="rounded-2xl border border-dashed border-white/15 p-4 text-sm">
        <p className="font-medium text-stone-200">{claim.claim}</p>
        <p className="mt-1 flex items-center gap-2 text-stone-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          {researched ? "Weighing the evidence…" : "Searching the web…"}
        </p>
      </div>
    );
  }

  const v = VERDICT[finding.verdict];
  const outdated = finding.verdict === "outdated";
  return (
    <article
      id={`card-${claim.id}`}
      onClick={onPick}
      className={`fade-up cursor-pointer rounded-2xl p-4 text-sm transition ${
        outdated ? "border border-red-500/40 bg-red-950/30 glow-red" : "glass"
      } ${active ? "ring-2 ring-white/70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.badge}`}>{v.label}</span>
        {finding.secondOpinion?.agree && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-red-200 ring-1 ring-red-500/30" title={finding.secondOpinion.reason}>
            ✓✓ confirmed by 2 models
          </span>
        )}
        <span className="ml-auto text-xs text-stone-500">{Math.round(finding.confidence * 100)}% confident</span>
      </div>
      <p className="mt-2.5 font-medium text-stone-100">{claim.claim}</p>
      {age && <AgeLine age={age} />}

      {outdated && (
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2 text-red-200">
            <span className="mt-0.5 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Now</span>
            <span className="font-medium">{finding.currentFact}</span>
          </div>
          {finding.rewrite && <Diff before={sentence} after={finding.rewrite} />}
        </div>
      )}
      <p className="mt-2.5 leading-relaxed text-stone-400">{finding.reason}</p>

      {finding.wikitext && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(finding.wikitext);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-black hover:bg-stone-200"
          >
            {copied ? "Copied ✓" : "Copy wikitext + citations"}
          </button>
          <a
            href={`${articleUrl}${articleUrl.includes("?") ? "&" : "?"}action=edit`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg px-2.5 py-1 text-xs text-stone-200 glass hover:bg-white/10"
          >
            Open editor ↗
          </a>
        </div>
      )}

      {finding.sources.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {finding.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-block max-w-[230px] truncate rounded-md bg-white/5 px-2 py-0.5 text-xs text-stone-300 ring-1 ring-white/10 hover:bg-white/10"
                title={s.title}
              >
                {hostname(s.url)}
                {s.published ? ` · ${new Date(s.published).toLocaleDateString()}` : ""}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function UnverifiedGroup({
  claims,
  findings,
  sentences,
  onPick,
}: {
  claims: Claim[];
  findings: Record<string, Finding>;
  sentences: Record<string, string>;
  onPick: (claimId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!claims.length) return null;
  return (
    <div className="rounded-2xl p-4 text-sm glass">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="font-medium text-stone-200">{claims.length} couldn&apos;t be verified</span>
          <span className="text-stone-500"> · not enough reliable evidence either way</span>
        </span>
        <span className="text-stone-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {claims.map((c) => (
            <li key={c.id} id={`card-${c.id}`} onClick={() => onPick(c.id)} className="cursor-pointer border-t border-white/10 pt-3">
              <p className="font-serif text-stone-300">{sentences[c.sid]}</p>
              <p className="mt-1 text-xs text-stone-500">{findings[c.id]?.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgeLine({ age }: { age: SentenceAge }) {
  const years = (Date.now() - new Date(age.lastTouched).getTime()) / (365.25 * 864e5);
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const untouched = years >= 1 ? `untouched for ${Math.floor(years)} year${years >= 2 ? "s" : ""}` : "edited this year";
  return (
    <p className={`mt-1 text-xs ${years >= 3 ? "text-amber-300" : "text-stone-500"}`}>
      ✎ Written {fmt(age.written)} · {untouched}
    </p>
  );
}

/** Word-level diff (LCS) between the Wikipedia sentence and the suggested rewrite. */
function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split(/\s+/);
  const b = after.split(/\s+/);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: "same" | "del" | "add"; w: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ t: "same", w: a[i++] });
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", w: a[i++] });
    else out.push({ t: "add", w: b[j++] });
  }
  while (i < a.length) out.push({ t: "del", w: a[i++] });
  while (j < b.length) out.push({ t: "add", w: b[j++] });
  return (
    <div className="rounded-xl bg-paper p-3 font-serif leading-7 text-ink">
      <div className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-widest text-stone-500">Suggested edit</div>
      {out.map((o, k) => (
        <span
          key={k}
          className={o.t === "del" ? "bg-red-200 text-red-900 line-through decoration-red-600" : o.t === "add" ? "bg-emerald-200 text-emerald-950" : ""}
        >
          {o.w}{" "}
        </span>
      ))}
    </div>
  );
}

function Router({ calls, stats }: { calls: CallRecord[]; stats: HuntStats | null }) {
  const rows = new Map<string, { model: string; stage: string; calls: number; ms: number; tokens: number }>();
  for (const c of calls) {
    const key = `${c.stage}|${c.model}`;
    const r = rows.get(key) ?? { model: c.model, stage: c.stage, calls: 0, ms: 0, tokens: 0 };
    r.calls++;
    r.ms += c.ms;
    r.tokens += c.promptTokens + c.completionTokens;
    rows.set(key, r);
  }
  const order = ["scan", "judge", "verify"];
  const jobs: Record<string, [string, string]> = {
    scan: ["Scan every sentence", "thinking off, parallel chunks"],
    judge: ["Weigh the evidence", "full reasoning, digs deeper when needed"],
    verify: ["Independent second opinion", "must agree before anything turns red"],
  };
  const maxTokens = Math.max(...[...rows.values()].map((r) => r.tokens), 1);
  return (
    <section className="mt-12 rounded-2xl p-6 glass">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-3xl">How Nemotron did the work</h2>
        {stats && (
          <span className="text-sm text-stone-400">
            {(stats.ms / 1000).toFixed(1)}s · {calls.length} model calls ·{" "}
            {[...rows.values()].reduce((n, r) => n + r.tokens, 0).toLocaleString()} tokens
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-stone-400">
        Each model does the job it&apos;s best at: a fast model reads everything, the largest reasons about the few facts
        that matter, and a different model double-checks every red flag.
      </p>
      <div className="mt-5 space-y-3">
        {[...rows.values()]
          .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
          .map((r) => (
            <div key={`${r.stage}${r.model}`} className="grid items-center gap-2 sm:grid-cols-[240px_1fr_auto]">
              <div>
                <div className="text-sm font-medium">{jobs[r.stage]?.[0] ?? r.stage}</div>
                <div className="text-xs text-stone-500">{jobs[r.stage]?.[1]}</div>
              </div>
              <div>
                <div className="font-mono text-xs text-[#a3e635]">{r.model}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#76b900] to-[#a3e635]" style={{ width: `${(r.tokens / maxTokens) * 100}%` }} />
                </div>
              </div>
              <div className="font-mono text-xs text-stone-400 sm:text-right">
                {r.calls} calls · {(r.ms / r.calls / 1000).toFixed(1)}s avg · {r.tokens.toLocaleString()} tok
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
