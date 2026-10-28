// Bulk run: hunts a list of articles through a running Stale Hunter instance and
// writes a leaderboard of the stalest pages to data/leaderboard.json.
//
// Usage:
//   node scripts/batch.mjs --backlog 20             # 20 random articles from Wikipedia's "needs updating" list
//   node scripts/batch.mjs --top 20                 # yesterday's 20 most-read articles
//   node scripts/batch.mjs "Burj Khalifa" "OpenAI"  # specific articles
// Set STALE_HUNTER_URL to point at a deployment (default http://localhost:3000).
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.STALE_HUNTER_URL ?? "http://localhost:3000";
const UA = { "User-Agent": "StaleHunter/0.2 (https://github.com/Pookieboi/stalehunter) batch script" };
const args = process.argv.slice(2);

async function wiki(params) {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  return (await fetch(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: UA })).json();
}

async function backlog(n) {
  const data = await wiki({
    action: "query",
    list: "categorymembers",
    cmtitle: "Category:All Wikipedia articles in need of updating",
    cmnamespace: "0",
    cmlimit: "500",
    cmsort: "timestamp",
    cmdir: "desc",
  });
  const titles = data.query.categorymembers.map((m) => m.title);
  return titles.sort(() => Math.random() - 0.5).slice(0, n);
}

async function topViewed(n) {
  const d = new Date(Date.now() - 2 * 864e5);
  const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
  const r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${path}`, { headers: UA });
  const articles = (await r.json()).items[0].articles;
  return articles
    .map((a) => a.article.replace(/_/g, " "))
    .filter((t) => !/^(Main Page|Special:|Wikipedia:|Portal:|File:|Help:|Talk:)/.test(t))
    .slice(0, n);
}

async function huntOne(title) {
  const res = await fetch(`${BASE}/api/hunt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article: title }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const err = events.find((e) => e.type === "error");
  if (err) throw new Error(err.message);
  const article = events.find((e) => e.type === "article")?.article;
  const claims = events.find((e) => e.type === "claims")?.claims ?? [];
  const findings = events.filter((e) => e.type === "finding").map((e) => e.finding);
  const stats = events.find((e) => e.type === "done")?.stats;
  return {
    title: article?.title ?? title,
    url: article?.url,
    lastEdited: article?.lastEdited,
    stats,
    outdated: findings
      .filter((f) => f.verdict === "outdated")
      .map((f) => {
        const c = claims.find((c) => c.id === f.claimId);
        return { sentence: article?.sentences[c?.sid], currentFact: f.currentFact, rewrite: f.rewrite, sources: f.sources };
      }),
  };
}

const mode = args[0];
const titles =
  mode === "--backlog" ? await backlog(Number(args[1] ?? 20)) : mode === "--top" ? await topViewed(Number(args[1] ?? 20)) : args;
if (!titles.length) {
  console.error("Give article titles, --backlog N, or --top N");
  process.exit(1);
}

const results = [];
for (const [i, t] of titles.entries()) {
  process.stdout.write(`[${i + 1}/${titles.length}] ${t} … `);
  try {
    const r = await huntOne(t);
    results.push(r);
    console.log(`${r.stats?.outdated ?? 0} outdated / ${r.stats?.checked ?? 0} checked`);
  } catch (e) {
    console.log(`failed: ${e.message.slice(0, 120)}`);
  }
}

results.sort((a, b) => (b.stats?.outdated ?? 0) - (a.stats?.outdated ?? 0));
const total = results.reduce((n, r) => n + (r.stats?.outdated ?? 0), 0);
const checked = results.reduce((n, r) => n + (r.stats?.checked ?? 0), 0);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../data/leaderboard.json", import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), mode: mode ?? "list", articles: results.length, checked, outdated: total, results }, null, 2),
);
console.log(`\n${total} outdated facts found across ${results.length} articles (${checked} facts checked). Wrote data/leaderboard.json`);
