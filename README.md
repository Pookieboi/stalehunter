# Stale Hunter

**Every AI learns from Wikipedia. Some of it stopped being true.**

Stale Hunter reads a Wikipedia article, finds every statement that can go out of date ("the current CEO is…", "the population is…", "as of 2021…"), checks each one against the live web, and drafts a sourced correction an editor can paste straight into Wikipedia.

Wikipedia already knows it has this problem. Right now **45,000+ articles are officially tagged "in need of updating"** and **87,000+ contain statements marked "potentially dated"**. Some of those tags are more than a decade old. Volunteers flag stale facts by hand, and no approved bot can check whether a fact is still true. Meanwhile those pages flow into search results, AI training sets and chatbot answers.

Built for the [Nebius × NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Best Apps and Agents track.

## How it works

```
Wikipedia article
   │  MediaWiki API → split into ~200–2,000 numbered sentences
   ▼
1. Scan      Nemotron 3 Super (fast)    reads the article in parallel chunks and flags time-sensitive sentences, ranked by risk
   ▼
2. Research  Tavily (advanced search)   looks up the current state of each fact on the live web (Wikipedia mirrors excluded)
   ▼
3. Judge     Nemotron 3 Ultra (reasoning) weighs the evidence → outdated / still current / unverifiable, with confidence and cited sources
   ▼
4. Fix       for outdated facts: a rewritten sentence in encyclopedic style + {{cite web}} references, ready to paste
```

Design choices:

- **Two models, each used for what it's good at.** The fast model scans everything, and only the handful of facts that matter reach the expensive reasoning model. The UI shows every model call, its latency and its tokens.
- **No hallucinated quotes.** The scanner returns sentence IDs rather than copying text, so every flagged passage is guaranteed to exist verbatim in the article.
- **Evidence-only verdicts.** The judge can only use the retrieved sources, must cite them, and returns "unverifiable" when the evidence is thin rather than guessing.
- **Human in the loop.** Stale Hunter never edits Wikipedia. It produces a suggestion with citations, and an editor decides.
- **Prompt-injection aware.** Article text and web results are treated as untrusted data in every prompt.

## Bulk mode: the stalest pages on Wikipedia

`scripts/batch.mjs` runs the agent over many articles: a random sample of Wikipedia's own "needs updating" backlog, or yesterday's most-read pages. It writes a leaderboard to `data/leaderboard.json`.

```bash
node scripts/batch.mjs --backlog 20   # 20 random articles tagged "needs updating"
node scripts/batch.mjs --top 20       # the 20 most-read articles
```

## Run it yourself

Requirements: Node 18.18+, a [Nebius Token Factory](https://tokenfactory.nebius.com) API key, a [Tavily](https://tavily.com) API key.

```bash
git clone <this repo> && cd stalehunter
npm install
cp .env.example .env.local      # then fill in NEBIUS_API_KEY and TAVILY_API_KEY
node scripts/models.mjs         # lists the Nemotron models your key can use and pings the configured ones
npm run dev                     # http://localhost:3000
```

No keys yet? Set `MOCK_AI=1` in `.env.local` to click through the full UI with placeholder model and search responses.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEBIUS_API_KEY` | none | Token Factory key |
| `FAST_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | scanning model |
| `REASON_MODEL` | `nvidia/Nemotron-3-Ultra-550b-a55b` | judging model |
| `TAVILY_API_KEY` | none | web search |
| `MAX_CLAIMS` | `10` | facts checked per article |
| `MOCK_AI` | unset | `1` = fake model/search responses for UI development |

## Deploy

Deploys to Vercel as-is. Set the environment variables above in the project settings. The `/api/hunt` route streams results and allows up to 300 seconds per hunt.

## Tech

Next.js 15 (App Router) · TypeScript · Tailwind CSS · NVIDIA Nemotron on Nebius Token Factory (OpenAI-compatible API) · Tavily Search · MediaWiki API

## License

MIT. See [LICENSE](LICENSE). Article text shown in the app comes from Wikipedia under CC BY-SA 4.0.
