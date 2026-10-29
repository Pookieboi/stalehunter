# Stale Hunter

**Every AI learns from Wikipedia. Some of it stopped being true.**

Stale Hunter is an agent that keeps knowledge fresh. Give it a Wikipedia article (or any web page) and it:

- finds every statement that may have gone out of date, checks it against the live web, and drafts a sourced fix;
- finds **recent developments the article doesn't mention at all**, and drafts the sentence to add;
- shows its work: when each sentence was written, which sources it used, and which NVIDIA Nemotron model did what.

Wikipedia already knows it has this problem. Right now **45,000+ articles are tagged "in need of updating"** and **87,000+ contain statements marked "potentially dated"**, some for over a decade. Volunteers flag stale facts by hand; no approved bot can check whether a fact is still true. Meanwhile those pages flow into search results, AI training sets and chatbot answers.

Built for the [Nebius × NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Best Apps and Agents track.

## What it does

| | |
|---|---|
| **Outdated statements** | Office holders, rankings, "as of" figures, statuses and plans with past dates, each judged *outdated / still current / unverified*, with sources and a ready-to-paste rewrite including `{{cite web}}` references |
| **What the article doesn't know yet** | Notable events from the past year that never made it into the article (acquisitions, new CEOs, closures, launches), each with a draft sentence and the section it belongs in |
| **Sentence age** | When each flagged sentence was written and how long it has sat untouched, from Wikipedia's edit history (WikiWho) |
| **Freshness grade** | A–F per article |
| **Editor tools** | Copy all fixes as wikitext, a ready Talk-page note, an edit summary |
| **Any web page** | Paste a docs page, help centre or blog URL; it's read with Tavily Extract and checked the same way |
| **API for AI agents** | `POST /api/check {"statement": "..."}` → verdict, current fact, rewrite and sources in about 10 s |
| **Hall of Stale** | `/leaderboard`: outdated facts found across 32 articles, each confirmed by two models and reviewed by hand |

## How the agent works

```
Wikipedia article ──► MediaWiki API → numbered sentences
                      │
                      ├─► WikiWho edit history (prefetched in parallel)
                      ├─► "What's missing": Tavily news + structural-change search → Nemotron 3 Ultra → second opinion
                      │
1. Scan       Nemotron 3 Super, thinking OFF, parallel chunks → time-sensitive candidates (present / as-of / future)
2. Prioritise risk + years untouched + kind → top 10 facts (stable across runs)
3. Research   Tavily advanced search per fact (Wikipedia mirrors, social media and the page's own site excluded)
4. Judge      Nemotron 3 Ultra, full reasoning: classifies change type (time / error / none);
              only a change over time can be "outdated"; digs deeper with a sharper search when evidence is thin
5. Verify     Nemotron 3 Super (reasoning) must independently agree before anything turns red
6. Fix        rewrite using only facts in the sources + {{cite web}} references
```

Design choices:

- **Each model does the job it's best at.** The fast model with thinking off reads everything (about 2 s per chunk); the largest model reasons only about the facts that matter; a different model double-checks every red flag. The UI shows every call, its latency and its tokens.
- **No hallucinated quotes.** The scanner returns sentence IDs rather than copying text, so every flagged passage exists verbatim in the article.
- **Evidence-only verdicts, rules enforced in code.** Past-anchored statements ("in 2017…") can't be "outdated"; rounding and definitional differences don't count; the judge must cite its sources.
- **Human in the loop.** Stale Hunter never edits Wikipedia. It drafts; editors decide.
- **Prompt-injection aware.** Article text and web results are treated as untrusted data in every prompt.
- **Public-demo safe.** Recent results are replayed from cache; fresh hunts are rate-limited per visitor and per day.

## Evaluation

`scripts/eval.mjs` runs a 29-article test set (well-maintained pages, Indian topics, stale-prone pages, edge cases, random backlog articles) and writes a report with every verdict for hand review.

| | First version | Current |
|---|---|---|
| "Outdated" verdicts that hold up in hand review | ~2–3 of 10 | ~8–9 of 11 |
| Facts left unverified | 106 | 47 |
| Failed model calls | 2 | 0 of 340 |
| Same sentences picked on a repeat run | ~0.5 overlap | 0.67–0.82 |

## Run it yourself

Requirements: Node 18.18+, a [Nebius Token Factory](https://tokenfactory.nebius.com) API key, a [Tavily](https://tavily.com) API key.

```bash
git clone https://github.com/Pookieboi/stalehunter && cd stalehunter
npm install
cp .env.example .env.local      # fill in NEBIUS_API_KEY and TAVILY_API_KEY
node scripts/models.mjs         # lists the Nemotron models your key can use and pings the configured ones
npm run dev                     # http://localhost:3000
```

No keys yet? Set `MOCK_AI=1` in `.env.local` to click through the UI with placeholder responses.

Scripts: `scripts/eval.mjs` (evaluation), `scripts/leaderboard.mjs` (rebuild the Hall of Stale from eval logs, excluding verdicts rejected in `eval/review.json`), `scripts/batch.mjs` (bulk runs).

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEBIUS_API_KEY` | none | Token Factory key |
| `FAST_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | scanning |
| `REASON_MODEL` | `nvidia/Nemotron-3-Ultra-550b-a55b` | judging, missing developments |
| `VERIFY_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | second opinion |
| `TAVILY_API_KEY` | none | search and page extraction |
| `MAX_CLAIMS` | `10` | facts checked per article |
| `JUDGE_CONCURRENCY` | `6` | parallel judge calls |
| `HUNTS_PER_IP_PER_HOUR` / `HUNTS_PER_DAY` | `6` / `300` | public demo limits |
| `MOCK_AI` | unset | `1` = fake model responses for UI development |

## Tech

Next.js 15 · TypeScript · Tailwind CSS · NVIDIA Nemotron 3 (Super, Ultra) on Nebius Token Factory · Tavily Search and Extract · WikiWho · MediaWiki API · Vercel

## License

MIT. See [LICENSE](LICENSE). Article text shown in the app comes from Wikipedia under CC BY-SA 4.0.
