"use client";

import { useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { SentenceAge } from "@/lib/history";
import type { ArticleView, Claim, Finding, HuntEvent, HuntStats, Verdict } from "@/lib/hunter";
import type { CallRecord } from "@/lib/llm";

const EXAMPLES = ["Mobius Motors", "Manchester United F.C.", "Indian Institutes of Technology", "Tesla, Inc.", "Bengaluru"];

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
    badge: "bg-red-600 text-white",
    mark: "bg-red-100 text-red-950 underline decoration-red-600 decoration-2 underline-offset-4",
    dot: "bg-red-600",
  },
  current: {
    label: "Still current",
    badge: "bg-emerald-600 text-white",
    mark: "underline decoration-emerald-600 decoration-2 underline-offset-4",
    dot: "bg-emerald-500",
  },
  unverifiable: {
    label: "Unverified",
    badge: "bg-stone-500 text-white",
    mark: "underline decoration-stone-400 decoration-dashed decoration-2 underline-offset-4",
    dot: "bg-stone-400",
  },
};

type LogLine = { t: number; text: string; tone?: "red" | "green" | "muted" };

export default function Hunter({ backlog }: { backlog: number | null }) {
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
        say(`Flagged ${e.claims.length} time-sensitive facts`);
        break;
      case "research":
        setResearched((s) => new Set(s).add(e.claimId));
        say(`${e.sources.length} sources · ${claimText(e.claimId)}`, "muted");
        break;
      case "dig":
        say(`Evidence too thin, digging deeper: “${e.query}”`);
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

  return (
    <div className="min-h-screen">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <button onClick={() => window.location.reload()} className="flex items-center gap-2 font-semibold">
          <Logo />
          Stale Hunter
        </button>
        <span className="hidden text-xs text-stone-500 sm:block">NVIDIA Nemotron · Nebius Token Factory · Tavily</span>
      </nav>

      <header className={`mx-auto max-w-4xl px-4 text-center ${started ? "pb-4 pt-2" : "py-14 sm:py-20"}`}>
        {!started && (
          <>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
              {backlog
                ? `${backlog.toLocaleString()} Wikipedia articles are officially tagged “needs updating” right now`
                : "Wikipedia freshness checker"}
            </p>
            <h1 className="font-serif text-4xl leading-[1.1] tracking-tight sm:text-6xl">
              Every AI learns from Wikipedia.
              <br />
              <span className="text-red-700">Some of it stopped being true.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-lg text-stone-600">
              Stale Hunter reads an article, checks every time-sensitive fact against the live web, has two AI models
              agree on what&apos;s outdated, and drafts sourced fixes an editor can paste in.
            </p>
          </>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
          className={`mx-auto flex max-w-xl gap-2 ${started ? "" : "mt-8"}`}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Article title or Wikipedia URL"
            className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 shadow-sm outline-none focus:border-stone-600"
          />
          <button
            disabled={running || !input.trim()}
            className="rounded-xl bg-foreground px-6 py-3 font-medium text-background shadow-sm disabled:opacity-40"
          >
            {running ? "Hunting…" : "Hunt"}
          </button>
        </form>

        {!started && (
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
            <button onClick={surprise} className="rounded-full bg-red-700 px-3 py-1 text-white hover:bg-red-800">
              🎲 Random article from the backlog
            </button>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => run(ex)}
                className="rounded-full border border-stone-300 bg-white/60 px-3 py-1 text-stone-700 hover:bg-white"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mx-auto mt-4 max-w-xl rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </header>

      {!started && <HowItWorks />}

      {started && (
        <main className="mx-auto max-w-7xl px-4 pb-20">
          <Stepper stage={stage} running={running} />

          {article && (
            <ResultHeader article={article} total={claims.length} findings={judged} done={!!stats} />
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="lg:sticky lg:top-4 lg:self-start">
              {article ? (
                <Reader
                  article={article}
                  claimBySid={claimBySid}
                  findings={findings}
                  researched={researched}
                  active={active}
                  onPick={(id) => focus(id, "card")}
                />
              ) : (
                <div className="h-64 animate-pulse rounded-2xl border border-stone-200 bg-white" />
              )}
            </section>

            <aside className="space-y-4">
              <AgentLog log={log} running={running} />
              {stage === "done" && claims.length === 0 && (
                <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
                  No time-sensitive statements found. This article looks timeless.
                </p>
              )}
              {ordered.filter((c) => findings[c.id]?.verdict !== "unverifiable").map((c) => (
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

      <footer className="mx-auto max-w-7xl border-t border-stone-300 px-4 py-6 text-xs text-stone-500">
        Stale Hunter suggests edits; humans decide. Always review sources before editing Wikipedia. Article text from
        Wikipedia under CC BY-SA 4.0.
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <span className="relative grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5" strokeLinecap="round" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" />
    </span>
  );
}

function HowItWorks() {
  const steps = [
    ["Scan", "Nemotron 3 Super reads every sentence and flags facts that can go stale: office holders, rankings, statuses, “as of” figures."],
    ["Research", "Tavily searches the live web for the current state of each fact, skipping Wikipedia and its mirrors."],
    ["Judge", "Nemotron 3 Ultra weighs the evidence and separates facts that changed over time from mere disagreements."],
    ["Verify", "A second model must independently agree before anything is marked outdated."],
    ["Fix", "Each confirmed issue gets a rewritten sentence with {{cite web}} references, plus when it was last edited."],
  ];
  return (
    <section className="mx-auto mb-16 grid max-w-5xl gap-3 px-4 sm:grid-cols-5">
      {steps.map(([title, body], i) => (
        <div key={title} className="rounded-2xl border border-stone-200 bg-white/70 p-4">
          <div className="text-xs font-semibold text-stone-400">0{i + 1}</div>
          <div className="mt-1 font-semibold">{title}</div>
          <p className="mt-1 text-sm leading-relaxed text-stone-600">{body}</p>
        </div>
      ))}
    </section>
  );
}

function Stepper({ stage, running }: { stage: string; running: boolean }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {STAGES.map((s, i) => {
        const state = i < idx || stage === "done" ? "done" : i === idx && running ? "active" : "todo";
        return (
          <li
            key={s.key}
            className={`flex items-center gap-2 rounded-full px-3 py-1 ${
              state === "done"
                ? "bg-foreground text-background"
                : state === "active"
                  ? "checking border border-amber-400"
                  : "border border-stone-300 text-stone-400"
            }`}
          >
            {state === "done" ? "✓" : i + 1} {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/** A–F grade from the share of checked facts that are outdated. Unverified facts don't count against. */
function grade(findings: Finding[]) {
  const decided = findings.filter((f) => f.verdict !== "unverifiable").length;
  const outdated = findings.filter((f) => f.verdict === "outdated").length;
  if (!findings.length) return null;
  const score = decided ? Math.round(100 * (1 - outdated / decided)) : 100;
  const letter = score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
  const color = { A: "text-emerald-700", B: "text-emerald-600", C: "text-amber-600", D: "text-orange-600", F: "text-red-700" }[letter];
  return { score, letter, color };
}

function ResultHeader({
  article,
  total,
  findings,
  done,
}: {
  article: ArticleView;
  total: number;
  findings: Finding[];
  done: boolean;
}) {
  const g = grade(findings);
  const n = (v: Verdict) => findings.filter((f) => f.verdict === v).length;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <a href={article.url} target="_blank" rel="noreferrer" className="font-serif text-3xl hover:underline">
          {article.title}
        </a>
        <p className="mt-1 text-sm text-stone-500">
          Last edited {article.lastEdited ? new Date(article.lastEdited).toLocaleDateString() : "unknown"} ·{" "}
          {Object.keys(article.sentences).length.toLocaleString()} sentences read · {total} facts checked
        </p>
      </div>
      <div className="flex items-center gap-6">
        <Stat n={n("outdated")} label="outdated" className="text-red-700" />
        <Stat n={n("current")} label="still current" className="text-emerald-700" />
        <Stat n={n("unverifiable")} label="unverified" className="text-stone-500" />
        <div className="flex items-center gap-3 border-l border-stone-200 pl-6">
          <div
            className={`grid h-16 w-16 place-items-center rounded-full border-4 border-current font-serif text-4xl ${
              g ? g.color : "text-stone-300"
            } ${done ? "" : "animate-pulse"}`}
          >
            {g ? g.letter : "–"}
          </div>
          <div className="text-xs leading-tight text-stone-500">
            Freshness
            <div className="text-lg font-semibold text-foreground">{g ? `${g.score}/100` : "…"}</div>
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
  onPick,
}: {
  article: ArticleView;
  claimBySid: Map<string, Claim>;
  findings: Record<string, Finding>;
  researched: Set<string>;
  active: string;
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
    <div className="flex gap-3">
      {/* Staleness heatmap: where in the article the flagged facts sit */}
      <div className="relative w-3 shrink-0 rounded-full bg-stone-200" title="Where the flagged facts are">
        {marks.map((m) => (
          <button
            key={m.claim.id}
            onClick={() => jump(m.claim.id)}
            style={{ top: `calc(${(m.pos * 100).toFixed(2)}% - 4px)` }}
            className={`absolute left-0 h-2 w-3 rounded-full transition ${
              m.verdict ? VERDICT[m.verdict].dot : "animate-pulse bg-amber-400"
            } ${active === m.claim.id ? "ring-2 ring-foreground ring-offset-1" : ""}`}
            aria-label={m.claim.claim}
          />
        ))}
      </div>

      <div
        ref={scroller}
        className="relative max-h-[70vh] flex-1 overflow-y-auto rounded-2xl border border-stone-200 bg-white px-6 py-5 font-serif text-[17px] leading-8 shadow-sm lg:max-h-[calc(100vh-2rem)]"
      >
        {article.sections.map((s, i) => (
          <div key={i} className="mb-5">
            <h3 className={`mb-1 border-b border-stone-200 font-serif font-semibold ${i === 0 ? "text-2xl" : "text-lg"}`}>
              {i === 0 ? article.title : s.heading}
            </h3>
            {s.paragraphs.map((p, j) => (
              <p key={j} className="mb-3 text-stone-700">
                {p.map((sid) => {
                  const claim = claimBySid.get(sid);
                  const text = article.sentences[sid] + " ";
                  if (!claim) return <span key={sid}>{text}</span>;
                  const f = findings[claim.id];
                  const cls = f ? VERDICT[f.verdict].mark : researched.has(claim.id) ? "checking" : "bg-amber-50";
                  return (
                    <span
                      key={sid}
                      id={`sentence-${claim.id}`}
                      onClick={() => onPick(claim.id)}
                      className={`cursor-pointer rounded px-0.5 text-foreground transition ${cls} ${
                        active === claim.id ? "ring-2 ring-foreground" : ""
                      }`}
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
  const visible = open ? log.slice(-8) : [];
  return (
    <div className="rounded-2xl bg-stone-900 p-4 font-mono text-xs text-stone-300 shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-stone-400">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-amber-400" : "bg-emerald-500"}`} />
          Agent log
        </span>
        <span>{open ? "hide" : `show (${log.length})`}</span>
      </button>
      {open && (
        <ol className="mt-3 space-y-1">
          {visible.map((l, i) => (
            <li key={log.length - visible.length + i} className="flex gap-3">
              <span className="w-10 shrink-0 text-right text-stone-500">{l.t.toFixed(1)}s</span>
              <span
                className={`min-w-0 truncate ${
                  l.tone === "red" ? "text-red-400" : l.tone === "green" ? "text-emerald-400" : l.tone === "muted" ? "text-stone-500" : "text-stone-200"
                }`}
              >
                {l.text}
              </span>
            </li>
          ))}
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
      <div id={`card-${claim.id}`} className="rounded-2xl border border-dashed border-stone-300 p-4 text-sm">
        <p className="font-medium">{claim.claim}</p>
        <p className="mt-1 text-stone-500">{researched ? "Weighing the evidence…" : "Searching the web…"}</p>
      </div>
    );
  }

  const v = VERDICT[finding.verdict];
  return (
    <article
      id={`card-${claim.id}`}
      onClick={onPick}
      className={`cursor-pointer rounded-2xl border bg-white p-4 text-sm shadow-sm transition ${
        active ? "border-foreground" : finding.verdict === "outdated" ? "border-red-300" : "border-stone-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.badge}`}>{v.label}</span>
        {finding.secondOpinion?.agree && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800" title={finding.secondOpinion.reason}>
            ✓✓ confirmed by 2 models
          </span>
        )}
        <span className="ml-auto text-xs text-stone-500">{Math.round(finding.confidence * 100)}% confident</span>
      </div>
      <p className="mt-2 font-medium">{claim.claim}</p>
      {age && <AgeLine age={age} />}

      {finding.verdict === "outdated" ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-stone-500">Now</div>
          <p className="font-medium text-red-800">{finding.currentFact}</p>
          {finding.rewrite && (
            <>
              <div className="pt-1 text-xs uppercase tracking-wide text-stone-500">Suggested edit</div>
              <Diff before={sentence} after={finding.rewrite} />
            </>
          )}
        </div>
      ) : null}
      <p className="mt-2 text-stone-600">{finding.reason}</p>

      {finding.wikitext && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(finding.wikitext);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-lg bg-foreground px-2.5 py-1 text-xs text-background"
          >
            {copied ? "Copied" : "Copy wikitext + citations"}
          </button>
          <a
            href={`${articleUrl}${articleUrl.includes("?") ? "&" : "?"}action=edit`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs"
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
                className="inline-block max-w-[220px] truncate rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-200"
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
    <div className="rounded-2xl border border-stone-200 bg-white/60 p-4 text-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="font-medium">{claims.length} couldn&apos;t be verified</span>
          <span className="text-stone-500"> · not enough reliable evidence either way</span>
        </span>
        <span className="text-stone-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {claims.map((c) => (
            <li key={c.id} id={`card-${c.id}`} onClick={() => onPick(c.id)} className="cursor-pointer border-t border-stone-100 pt-3">
              <p className="font-serif text-stone-700">{sentences[c.sid]}</p>
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
    <p className={`mt-1 text-xs ${years >= 3 ? "text-red-700" : "text-stone-500"}`}>
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
    <p className="rounded-lg bg-stone-50 p-3 font-serif leading-7">
      {out.map((o, k) => (
        <span
          key={k}
          className={
            o.t === "del" ? "bg-red-100 text-red-800 line-through decoration-red-500" : o.t === "add" ? "bg-emerald-100 text-emerald-900" : ""
          }
        >
          {o.w}{" "}
        </span>
      ))}
    </p>
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
  const jobs: Record<string, string> = {
    scan: "Scan every sentence (thinking off, parallel)",
    judge: "Weigh evidence (reasoning)",
    verify: "Independent second opinion",
  };
  return (
    <section className="mt-12 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">How Nemotron did the work</h2>
        {stats && (
          <span className="text-sm text-stone-500">
            Whole hunt: {(stats.ms / 1000).toFixed(1)}s · {calls.length} model calls
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Each model does the job it&apos;s best at: a fast model reads everything, the largest reasons about the few facts
        that matter, and a different model double-checks every red flag.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Step</th>
              <th className="py-2 pr-4 font-medium">Model</th>
              <th className="py-2 pr-4 font-medium">Calls</th>
              <th className="py-2 pr-4 font-medium">Avg latency</th>
              <th className="py-2 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {[...rows.values()]
              .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
              .map((r) => (
                <tr key={`${r.stage}${r.model}`} className="border-t border-stone-100">
                  <td className="py-2 pr-4">{jobs[r.stage] ?? r.stage}</td>
                  <td className="py-2 pr-4 font-mono">{r.model}</td>
                  <td className="py-2 pr-4 font-mono">{r.calls}</td>
                  <td className="py-2 pr-4 font-mono">{(r.ms / r.calls / 1000).toFixed(1)}s</td>
                  <td className="py-2 font-mono">{r.tokens.toLocaleString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
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
