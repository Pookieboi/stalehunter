// Builds data/leaderboard.json ("Hall of Stale") from saved hunt logs, without spending
// any more API credits. Reads the raw event logs that scripts/eval.mjs writes.
//
// Usage: node scripts/leaderboard.mjs [eval/runs/<run> ...]   (default: the latest run)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const runsDir = join(root, "eval/runs");
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2).map((d) => join(root, d))
  : [join(runsDir, readdirSync(runsDir).sort().at(-1))];

// Verdicts rejected in hand review (eval/review.json) never reach the public leaderboard.
const review = JSON.parse(readFileSync(join(root, "eval/review.json"), "utf8"));
const rejected = (title, sentence = "") =>
  review.rejected.some((r) => r.article === title && sentence.startsWith(r.startsWith));

const byTitle = new Map();
for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ndjson"))) {
    const events = readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const article = events.find((e) => e.type === "article")?.article;
    const stats = events.find((e) => e.type === "done")?.stats;
    if (!article || !stats || !stats.checked) continue;
    const claims = events.find((e) => e.type === "claims")?.claims ?? [];
    const ages = Object.fromEntries(events.filter((e) => e.type === "age").map((e) => [e.claimId, e.age]));
    const outdated = events
      .filter((e) => e.type === "finding" && e.finding.verdict === "outdated")
      .filter(({ finding: f }) => !rejected(article.title, article.sentences[claims.find((c) => c.id === f.claimId)?.sid]))
      .map(({ finding: f }) => {
        const c = claims.find((c) => c.id === f.claimId);
        return {
          claim: c?.claim,
          sentence: article.sentences[c?.sid],
          currentFact: f.currentFact,
          rewrite: f.rewrite,
          confidence: f.confidence,
          confirmed: !!f.secondOpinion?.agree,
          age: ages[f.claimId] ?? null,
          sources: f.sources.slice(0, 3),
        };
      });
    // Later runs of the same article win.
    const dropped = stats.outdated - outdated.length;
    byTitle.set(article.title, {
      title: article.title,
      url: article.url,
      lastEdited: article.lastEdited,
      stats: { ...stats, outdated: outdated.length, unverifiable: stats.unverifiable + dropped },
      outdated,
    });
  }
}

const years = (iso) => (Date.now() - new Date(iso).getTime()) / (365.25 * 864e5);
const results = [...byTitle.values()]
  .map((r) => ({
    ...r,
    oldestYears: Math.max(0, ...r.outdated.filter((o) => o.age).map((o) => years(o.age.lastTouched))),
  }))
  .sort((a, b) => b.stats.outdated - a.stats.outdated || b.oldestYears - a.oldestYears);

const allOutdated = results.flatMap((r) => r.outdated);
const aged = allOutdated.filter((o) => o.age);
const summary = {
  generatedAt: new Date().toISOString(),
  reviewed: true,
  articles: results.length,
  checked: results.reduce((n, r) => n + r.stats.checked, 0),
  outdated: allOutdated.length,
  avgYearsUntouched: aged.length ? aged.reduce((n, o) => n + years(o.age.lastTouched), 0) / aged.length : null,
  results,
};
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data/leaderboard.json"), JSON.stringify(summary, null, 2));
console.log(`${summary.outdated} outdated facts across ${summary.articles} articles (${summary.checked} checked). Wrote data/leaderboard.json`);
