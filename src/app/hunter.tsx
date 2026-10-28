"use client";

import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { CallRecord } from "@/lib/llm";
import type { ArticleView, Claim, Finding, HuntEvent, HuntStats, Verdict } from "@/lib/hunter";

const EXAMPLES = ["Burj Khalifa", "Tesla, Inc.", "Manchester United F.C.", "Indian Premier League", "OpenAI"];

const STAGES = [
  { key: "fetch", label: "Fetch" },
  { key: "scan", label: "Scan" },
  { key: "research", label: "Research" },
  { key: "judge", label: "Judge" },
  { key: "done", label: "Done" },
] as const;

const VERDICT: Record<Verdict, { label: string; badge: string; mark: string }> = {
  outdated: {
    label: "Outdated",
    badge: "bg-red-600 text-white",
    mark: "bg-red-100 decoration-red-600 underline decoration-2 underline-offset-4",
  },
  current: {
    label: "Still current",
    badge: "bg-emerald-600 text-white",
    mark: "decoration-emerald-600 underline decoration-2 underline-offset-4",
  },
  unverifiable: {
    label: "Unverified",
    badge: "bg-stone-500 text-white",
    mark: "decoration-stone-400 underline decoration-dashed decoration-2 underline-offset-4",
  },
};

export default function Hunter({ backlog }: { backlog: number | null }) {
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<string>("");
  const [article, setArticle] = useState<ArticleView | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [researched, setResearched] = useState<Set<string>>(new Set());
  const [findings, setFindings] = useState<Record<string, Finding>>({});
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [stats, setStats] = useState<HuntStats | null>(null);
  const [active, setActive] = useState<string>("");

  async function run(target: string) {
    if (!target.trim() || running) return;
    setInput(target);
    setRunning(true);
    setError("");
    setStage("fetch");
    setArticle(null);
    setClaims([]);
    setResearched(new Set());
    setFindings({});
    setCalls([]);
    setStats(null);
    setActive("");

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
    switch (e.type) {
      case "step":
        setStage(e.stage);
        break;
      case "article":
        setArticle(e.article);
        break;
      case "claims":
        setClaims(e.claims);
        break;
      case "research":
        setResearched((s) => new Set(s).add(e.claimId));
        break;
      case "finding":
        setFindings((f) => ({ ...f, [e.finding.claimId]: e.finding }));
        break;
      case "call":
        setCalls((c) => [...c, e.call]);
        break;
      case "done":
        setStats(e.stats);
        setStage("done");
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
  const outdated = judged.filter((f) => f.verdict === "outdated").length;
  const started = stage !== "";

  function focus(claimId: string, target: "card" | "sentence") {
    setActive(claimId);
    document.getElementById(`${target}-${claimId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <button onClick={() => window.location.reload()} className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-sm text-background">S</span>
          Stale Hunter
        </button>
        <span className="text-xs text-stone-500">NVIDIA Nemotron · Nebius Token Factory · Tavily</span>
      </nav>

      <header className={`mx-auto max-w-3xl px-4 text-center ${started ? "py-6" : "py-14 sm:py-20"}`}>
        {!started && (
          <>
            <p className="mb-4 inline-block rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-600">
              {backlog ? `${backlog.toLocaleString()} Wikipedia articles are officially tagged “needs updating” right now` : "Wikipedia freshness checker"}
            </p>
            <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
              Every AI learns from Wikipedia.
              <br />
              <span className="text-red-700">Some of it stopped being true.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-stone-600">
              Stale Hunter reads an article, checks every time-sensitive fact against the live web, and drafts sourced
              corrections that a Wikipedia editor can paste in.
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
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-4 py-3 outline-none focus:border-stone-600"
          />
          <button
            disabled={running || !input.trim()}
            className="rounded-lg bg-foreground px-5 py-3 font-medium text-background disabled:opacity-40"
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
                className="rounded-full border border-stone-300 px-3 py-1 text-stone-700 hover:bg-white"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mx-auto mt-4 max-w-xl rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </header>

      {started && (
        <main className="mx-auto max-w-6xl px-4 pb-20">
          <Stepper stage={stage} running={running} />

          {article && (
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-stone-300 pb-4">
              <div>
                <a href={article.url} target="_blank" rel="noreferrer" className="font-serif text-3xl hover:underline">
                  {article.title}
                </a>
                <p className="mt-1 text-sm text-stone-500">
                  Last edited {article.lastEdited ? new Date(article.lastEdited).toLocaleDateString() : "unknown"} ·{" "}
                  {Object.keys(article.sentences).length.toLocaleString()} sentences scanned
                </p>
              </div>
              <Score total={claims.length} judged={judged.length} outdated={outdated} findings={judged} />
            </div>
          )}

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-500">
                Time-sensitive passages
              </h2>
              {article && claims.length > 0 ? (
                <Reader
                  article={article}
                  claimBySid={claimBySid}
                  findings={findings}
                  researched={researched}
                  active={active}
                  onPick={(id) => focus(id, "card")}
                />
              ) : (
                <p className="font-serif text-stone-500">
                  {stage === "done"
                    ? "No time-sensitive statements found in this article."
                    : running
                      ? "Reading the article…"
                      : "The hunt stopped before any facts were flagged."}
                </p>
              )}
            </section>

            <aside className="space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Findings</h2>
              {ordered.map((c) => (
                <FindingCard
                  key={c.id}
                  claim={c}
                  sentence={article?.sentences[c.sid] ?? ""}
                  finding={findings[c.id]}
                  researched={researched.has(c.id)}
                  active={active === c.id}
                  articleUrl={article?.url ?? ""}
                  onPick={() => focus(c.id, "sentence")}
                />
              ))}
            </aside>
          </div>

          {calls.length > 0 && <Router calls={calls} stats={stats} />}
        </main>
      )}

      <footer className="mx-auto max-w-6xl border-t border-stone-300 px-4 py-6 text-xs text-stone-500">
        Stale Hunter suggests edits; humans decide. Always review sources before editing Wikipedia. Article text from
        Wikipedia under CC BY-SA 4.0.
      </footer>
    </div>
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

function Score({
  total,
  judged,
  outdated,
  findings,
}: {
  total: number;
  judged: number;
  outdated: number;
  findings: Finding[];
}) {
  const current = findings.filter((f) => f.verdict === "current").length;
  const unverified = findings.filter((f) => f.verdict === "unverifiable").length;
  return (
    <div className="flex gap-6 text-right">
      <Stat n={outdated} label="outdated" className="text-red-700" />
      <Stat n={current} label="still current" className="text-emerald-700" />
      <Stat n={unverified} label="unverified" className="text-stone-500" />
      <Stat n={`${judged}/${total}`} label="checked" className="text-foreground" />
    </div>
  );
}

function Stat({ n, label, className }: { n: number | string; label: string; className: string }) {
  return (
    <div>
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
  // Only show paragraphs that contain a flagged sentence, grouped by section.
  const blocks = article.sections
    .map((s) => ({ heading: s.heading, paragraphs: s.paragraphs.filter((p) => p.some((sid) => claimBySid.has(sid))) }))
    .filter((s) => s.paragraphs.length > 0);

  return (
    <div className="space-y-6 rounded-xl border border-stone-200 bg-white p-6 font-serif text-[17px] leading-8 shadow-sm">
      {blocks.map((b, i) => (
        <div key={i}>
          <h3 className="mb-1 border-b border-stone-200 font-serif text-lg font-semibold">{b.heading}</h3>
          {b.paragraphs.map((p, j) => (
            <p key={j} className="mb-3">
              {p.map((sid) => {
                const claim = claimBySid.get(sid);
                const text = article.sentences[sid] + " ";
                if (!claim) return <span key={sid} className="text-stone-500">{text}</span>;
                const f = findings[claim.id];
                const cls = f ? VERDICT[f.verdict].mark : researched.has(claim.id) ? "checking" : "bg-amber-50";
                return (
                  <span
                    key={sid}
                    id={`sentence-${claim.id}`}
                    onClick={() => onPick(claim.id)}
                    className={`cursor-pointer rounded px-0.5 transition ${cls} ${active === claim.id ? "ring-2 ring-foreground" : ""}`}
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
  );
}

function FindingCard({
  claim,
  sentence,
  finding,
  researched,
  active,
  articleUrl,
  onPick,
}: {
  claim: Claim;
  sentence: string;
  finding?: Finding;
  researched: boolean;
  active: boolean;
  articleUrl: string;
  onPick: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!finding) {
    return (
      <div id={`card-${claim.id}`} className="rounded-xl border border-dashed border-stone-300 p-4 text-sm">
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
      className={`cursor-pointer rounded-xl border bg-white p-4 text-sm shadow-sm transition ${
        active ? "border-foreground" : finding.verdict === "outdated" ? "border-red-300" : "border-stone-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.badge}`}>{v.label}</span>
        <span className="text-xs text-stone-500">{Math.round(finding.confidence * 100)}% confident</span>
      </div>
      <p className="mt-2 font-medium">{claim.claim}</p>

      {finding.verdict === "outdated" && (
        <dl className="mt-3 space-y-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-stone-500">Wikipedia says</dt>
            <dd className="font-serif text-stone-600 line-through decoration-red-400">{sentence}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-stone-500">Now</dt>
            <dd className="font-medium text-red-800">{finding.currentFact}</dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-stone-700">{finding.reason}</p>

      {finding.rewrite && (
        <div className="mt-3 rounded-lg bg-stone-50 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Suggested edit</p>
          <p className="mt-1 font-serif">{finding.rewrite}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(finding.wikitext);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-md bg-foreground px-2.5 py-1 text-xs text-background"
            >
              {copied ? "Copied" : "Copy wikitext + citations"}
            </button>
            <a
              href={`${articleUrl}${articleUrl.includes("?") ? "&" : "?"}action=edit`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-md border border-stone-300 px-2.5 py-1 text-xs"
            >
              Open editor ↗
            </a>
          </div>
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

function Router({ calls, stats }: { calls: CallRecord[]; stats: HuntStats | null }) {
  const byModel = new Map<string, { calls: number; ms: number; tokens: number; stages: Set<string> }>();
  for (const c of calls) {
    const m = byModel.get(c.model) ?? { calls: 0, ms: 0, tokens: 0, stages: new Set<string>() };
    m.calls++;
    m.ms += c.ms;
    m.tokens += c.promptTokens + c.completionTokens;
    m.stages.add(c.stage);
    byModel.set(c.model, m);
  }
  return (
    <section className="mt-12 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">How Nemotron did the work</h2>
        {stats && (
          <span className="text-sm text-stone-500">
            Whole hunt: {(stats.ms / 1000).toFixed(1)}s · {calls.length} model calls
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-stone-500">
        A fast model scans every sentence in parallel; a reasoning model only weighs the facts that matter.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Model</th>
              <th className="py-2 pr-4 font-medium">Job</th>
              <th className="py-2 pr-4 font-medium">Calls</th>
              <th className="py-2 pr-4 font-medium">Avg latency</th>
              <th className="py-2 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {[...byModel].map(([model, m]) => (
              <tr key={model} className="border-t border-stone-100">
                <td className="py-2 pr-4">{model}</td>
                <td className="py-2 pr-4 font-sans">{[...m.stages].join(", ")}</td>
                <td className="py-2 pr-4">{m.calls}</td>
                <td className="py-2 pr-4">{(m.ms / m.calls / 1000).toFixed(1)}s</td>
                <td className="py-2">{m.tokens.toLocaleString()}</td>
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
