// Evaluation harness: runs a test set through a running Stale Hunter instance and writes
// a review report (eval/runs/<timestamp>/report.md) plus raw event logs per article.
//
// Usage:
//   node scripts/eval.mjs                      # full test set from eval/articles.json
//   node scripts/eval.mjs --only edge          # one group
//   node scripts/eval.mjs --repeat 2           # run each article twice to measure consistency
// Set STALE_HUNTER_URL to target a deployment (default http://localhost:3100).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.STALE_HUNTER_URL ?? "http://localhost:3100";
const UA = { "User-Agent": "StaleHunter/0.2 (https://github.com/Pookieboi/stalehunter) eval script" };
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const ONLY = arg("--only");
const REPEAT = Number(arg("--repeat", 1));
const CONCURRENCY = Number(arg("--concurrency", 2));

const spec = JSON.parse(readFileSync(new URL("../eval/articles.json", import.meta.url), "utf8"));

async function backlogSample(n) {
  const qs = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", list: "categorymembers",
    cmtitle: "Category:All Wikipedia articles in need of updating", cmnamespace: "0", cmlimit: "500",
    cmsort: "timestamp", cmdir: "desc",
  });
  const data = await (await fetch(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: UA })).json();
  return data.query.categorymembers.map((m) => m.title).sort(() => Math.random() - 0.5).slice(0, n);
}

const jobs = [];
for (const [group, titles] of Object.entries(spec.groups)) {
  if (ONLY && ONLY !== group) continue;
  for (const t of titles) for (let r = 0; r < REPEAT; r++) jobs.push({ group, title: t, run: r });
}
if (!ONLY || ONLY === "backlog") {
  for (const t of await backlogSample(spec.backlogSample ?? 0))
    for (let r = 0; r < REPEAT; r++) jobs.push({ group: "backlog", title: t, run: r });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = new URL(`../eval/runs/${stamp}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const slug = (s) => s.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);

async function runJob(job) {
  const t = Date.now();
  let events = [];
  try {
    const res = await fetch(`${BASE}/api/hunt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article: job.title }),
    });
    const text = await res.text();
    events = res.ok ? text.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [{ type: "error", message: `${res.status} ${text}` }];
  } catch (e) {
    events = [{ type: "error", message: String(e.message ?? e) }];
  }
  writeFileSync(new URL(`${slug(job.title)}.${job.run}.ndjson`, dir), events.map((e) => JSON.stringify(e)).join("\n"));
  const article = events.find((e) => e.type === "article")?.article;
  const claims = events.find((e) => e.type === "claims")?.claims ?? [];
  const findings = events.filter((e) => e.type === "finding").map((e) => e.finding);
  const calls = events.filter((e) => e.type === "call").map((e) => e.call);
  return {
    ...job,
    ms: Date.now() - t,
    error: events.find((e) => e.type === "error")?.message,
    title: article?.title ?? job.title,
    sentences: article ? Object.keys(article.sentences).length : 0,
    sids: claims.map((c) => c.sid),
    tokens: calls.reduce((n, c) => n + c.promptTokens + c.completionTokens, 0),
    failedCalls: calls.filter((c) => !c.ok).length,
    calls: calls.length,
    verdicts: Object.fromEntries(["outdated", "current", "unverifiable"].map((v) => [v, findings.filter((f) => f.verdict === v).length])),
    findings: findings.map((f) => {
      const c = claims.find((c) => c.id === f.claimId);
      return { ...f, claim: c?.claim, sentence: article?.sentences[c?.sid] };
    }),
  };
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const r = await runJob(job);
      results.push(r);
      const v = r.verdicts;
      console.log(
        `[${results.length}/${jobs.length}] ${job.group.padEnd(10)} ${r.title.slice(0, 40).padEnd(40)} ` +
          (r.error ? `ERROR ${r.error.slice(0, 80)}` : `${v.outdated}✗ ${v.current}✓ ${v.unverifiable}? in ${(r.ms / 1000).toFixed(0)}s, ${r.tokens} tok`),
      );
    }
  }),
);

// ---- Report -------------------------------------------------------------------
const ok = results.filter((r) => !r.error);
const sum = (f) => ok.reduce((n, r) => n + f(r), 0);
const lines = [];
lines.push(`# Stale Hunter eval — ${stamp}`, "");
lines.push(`Target: ${BASE} · ${results.length} runs · ${results.length - ok.length} errors`, "");
lines.push(
  `Verdicts: **${sum((r) => r.verdicts.outdated)} outdated**, ${sum((r) => r.verdicts.current)} current, ${sum((r) => r.verdicts.unverifiable)} unverifiable`,
  `Avg time ${(sum((r) => r.ms) / Math.max(ok.length, 1) / 1000).toFixed(1)}s · avg tokens ${Math.round(sum((r) => r.tokens) / Math.max(ok.length, 1))} · failed model calls ${sum((r) => r.failedCalls)}/${sum((r) => r.calls)}`,
  "",
);

lines.push("## Per article", "", "| Group | Article | Sentences | Claims | ✗ | ✓ | ? | Time | Tokens | Error |", "|---|---|---|---|---|---|---|---|---|---|");
for (const r of [...results].sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title)))
  lines.push(`| ${r.group} | ${r.title} | ${r.sentences} | ${r.sids.length} | ${r.verdicts.outdated} | ${r.verdicts.current} | ${r.verdicts.unverifiable} | ${(r.ms / 1000).toFixed(0)}s | ${r.tokens} | ${r.error ? r.error.slice(0, 60) : ""} |`);

if (REPEAT > 1) {
  lines.push("", "## Consistency (same article, repeated runs)", "", "| Article | Claims per run | Sentence overlap (Jaccard) | Outdated per run |", "|---|---|---|---|");
  const byTitle = Object.groupBy ? Object.groupBy(ok, (r) => r.title) : ok.reduce((m, r) => ((m[r.title] ??= []).push(r), m), {});
  for (const [title, runs] of Object.entries(byTitle)) {
    if (runs.length < 2) continue;
    const [a, b] = runs.map((r) => new Set(r.sids));
    const inter = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size || 1;
    lines.push(`| ${title} | ${runs.map((r) => r.sids.length).join(" / ")} | ${(inter / union).toFixed(2)} | ${runs.map((r) => r.verdicts.outdated).join(" / ")} |`);
  }
}

lines.push("", "## Every \"outdated\" verdict — review these by hand", "");
for (const r of ok)
  for (const f of r.findings.filter((f) => f.verdict === "outdated")) {
    lines.push(`### ${r.title} (${Math.round(f.confidence * 100)}%)`);
    lines.push(`- **Wikipedia:** ${f.sentence}`, `- **Now:** ${f.currentFact}`, `- **Why:** ${f.reason}`);
    if (f.rewrite) lines.push(`- **Rewrite:** ${f.rewrite}`);
    lines.push(`- **Sources:** ${f.sources.map((s) => s.url).join(" , ") || "none"}`, `- **Verdict correct?** [ ] yes  [ ] no  [ ] partly`, "");
  }

lines.push("", "## Overruled by the second opinion — check these weren't real catches", "");
for (const r of ok)
  for (const f of r.findings.filter((f) => f.secondOpinion && !f.secondOpinion.agree)) {
    lines.push(`### ${r.title}`, `- **Wikipedia:** ${f.sentence}`, `- **Reason:** ${f.reason}`, "");
  }

writeFileSync(new URL("report.md", dir), lines.join("\n"));
writeFileSync(new URL("summary.json", dir), JSON.stringify(results, null, 2));
console.log(`\nReport: eval/runs/${stamp}/report.md`);
