# Submission kit: Nebius × NVIDIA Global AI Hackathon

Deadline: **Fri 30 Oct 2026, 10:30 PM IST**. Aim to submit by ~8 PM.

Track: **Best Apps and Agents**

---

## Checklist

- [ ] Vercel deploy live (env: `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `FAST_MODEL`, `REASON_MODEL`)
- [ ] Warm the cache: run each landing-page example once on the live site
- [ ] Repo made **public** (GitHub → Settings → Danger zone → Change visibility)
- [ ] MIT license visible at top of the repo page (GitHub detects `LICENSE` automatically)
- [ ] README has the live URL
- [ ] 3-minute video uploaded to YouTube as **Public** (or Unlisted only if the rules allow; Public is safest)
- [ ] Devpost: description, track, demo URL, repo URL, video URL, feedback section, city (if you attended a Builders & Brews event; otherwise skip)

---

## Devpost: project name and tagline

**Stale Hunter**
*Every AI learns from Wikipedia. Some of it stopped being true. An agent that finds outdated facts, finds what's missing, and drafts sourced fixes.*

## Devpost: description (paste and edit)

### Inspiration
Wikipedia is the textbook every AI learns from, and the first source search engines and chatbots repeat. But facts drift: CEOs change, rankings move, planned launches slip or get cancelled. Wikipedia itself knows this. **Over 45,000 articles are officially tagged "in need of updating"** and **87,000+ contain statements marked "potentially dated"**, some of them for more than a decade. Volunteers flag stale facts by hand, and no approved bot checks whether a fact is still true. We wanted an agent that does the tedious part: find the stale facts, prove they're stale, and hand an editor a ready fix.

### What it does
Paste any Wikipedia article. Stale Hunter:
1. **Scans** every sentence and flags the ones that can go out of date: office holders, rankings, "as of" figures, statuses, plans with past dates.
2. **Dates** each candidate from Wikipedia's edit history (via WikiWho), so sentences nobody has touched in years are checked first.
3. **Researches** each fact on the live web with Tavily, skipping Wikipedia and its mirrors.
4. **Judges** each fact with a reasoning model that must separate *"the world changed"* from *"sources disagree"*, and **digs deeper** with a sharper search when the evidence is thin.
5. **Verifies**: a second, different Nemotron model must independently agree before anything is marked outdated.
6. **Fixes**: every confirmed issue gets a rewritten sentence plus `{{cite web}}` references, ready to paste into the Wikipedia editor, along with when the sentence was written and how long it has sat untouched.
7. **Finds what's missing**: in parallel, it reads the past year's news about the subject and surfaces notable developments the article never mentions (an acquisition, a new CEO, a closure), each with a draft sentence and the section it belongs in, also confirmed by a second model.

Beyond Wikipedia:
- **Any web page:** paste a docs page, help centre or blog URL. It's read with Tavily Extract and checked the same way, with the page's own site excluded from the evidence.
- **An API for AI agents:** `POST /api/check {"statement": "…"}` returns whether a fact is still true, the current fact and sources in about 10 seconds, so an agent can check before it repeats something.
- **Editor tools:** copy all fixes as wikitext, a ready Talk-page note, an edit summary and a share link.

You watch it happen: the article scrolls under a scan line, the reader follows each verdict as it lands, and the result collapses to an A–F freshness grade with only the flagged passages.

Real finds include Manchester United "ranked third" in the Deloitte Money League (8th in 2026; that sentence sat untouched **16 years**), ISRO's Venus mission "scheduled for 2025" (now 2028), and a Kenyan carmaker whose page still says production "will commence as soon as capital is raised" six years after it went into liquidation, and never mentions its 2025 rescue by new owners. On Infosys, it surfaced the July 2026 appointment of a CEO-designate the article didn't yet mention.

### How we built it
- **NVIDIA Nemotron on Nebius Token Factory**, each model doing the job it's best at:
  - **Nemotron 3 Super** with *thinking off* scans the article in parallel chunks: fast and cheap, about 2 s per chunk.
  - **Nemotron 3 Ultra** with full reasoning judges each fact against the evidence.
  - **Nemotron 3 Super** with reasoning gives an independent **second opinion** on every red flag.
  - The UI shows every model call, its latency and its tokens ("How Nemotron did the work").
- **Tavily**: advanced search for evidence, news search (past year) plus structural-change queries for missing developments, basic search for the dig-deeper loop, and **Tavily Extract** to read any web page.
- **WikiWho** (Wikimedia Cloud) for token-level edit history, which drives both prioritisation and "untouched for N years".
- **Next.js 15** on Vercel, streaming NDJSON events to a live UI.
- Guardrails: sentence-ID referencing (the model can't misquote the article), prompt-injection-aware prompts, verdict rules enforced in code, retry/backoff for rate limits, a result cache and per-visitor limits on the public demo.

### Challenges we ran into
Our first version was confidently wrong: only about 2–3 of 10 "outdated" verdicts were real. It confused *historical corrections* ("that happened in 2014, not 2015"), rounding and different definitions (metro vs. city GDP) with staleness. We built an evaluation harness (29 articles, hand-reviewed verdicts) and iterated: a change-type classification, a past-anchored-statement rule, a second-model verifier and a dig-deeper loop. **On the final run, about 8–9 of 11 outdated verdicts held up in hand review**, unverifiable results dropped from 106 to 47, and model-call failures went to 0 of 340.

We also hit Wikipedia rate limits (fixed with a Wikimedia-compliant User-Agent and backoff) and run-to-run variance (fixed by ranking candidates on edit-history age, which raised sentence overlap between repeat runs from about 0.5 to 0.67–0.82).

### Accomplishments we're proud of
- A **Hall of Stale**: 16 outdated facts across 32 audited articles, each confirmed by two models and reviewed by a human, sitting untouched for **5.7 years on average**.
- Turning a 2025 research idea (WiNELL, *Wikipedia Never-Ending Updating with LLM Agents*) into a usable tool.

### What we learned
Fact-checking is mostly about *what not to flag*. The hard part wasn't finding new information; it was teaching the agent the difference between "changed", "wrong" and "described differently", and making two models agree before raising an alarm.

### What's next
- A bulk backlog run over Wikipedia's 45,000 "needs updating" articles with Nebius Serverless Jobs
- Other languages. Smaller Wikipedias (Hindi, Marathi…) are far less maintained
- A browser extension and watchlists for editors and docs teams, re-checking pages on a schedule
- An MCP server wrapping `/api/check`, so any agent framework can call it as a tool

### Built with
nvidia-nemotron · nebius-token-factory · tavily · wikiwho · mediawiki-api · next.js · typescript · tailwindcss · vercel

---

## Devpost: feedback on Nebius / NVIDIA tools (required)

- **Token Factory's OpenAI-compatible API** made setup trivial: one base URL and key, no SDK.
- **`chat_template_kwargs: { enable_thinking: false }`** on Nemotron was the single biggest win: the scan step went from about 20 s to about 2 s per chunk with no truncation. It deserves more prominence in the docs; we found it by experiment.
- **Model IDs are case-sensitive** (`nvidia/Nemotron-3-Ultra-550b-a55b` vs. lowercase Super). A lowercase guess failed silently in our config. Consistent casing or case-insensitive matching would help.
- With reasoning on, **reasoning tokens count against `max_tokens`**. Long traces occasionally ate the whole budget and returned no JSON. A separate reasoning budget would help.
- We saw occasional **529 "worker overloaded"** responses on Super under parallel load. Retries handled it, but a documented `Retry-After` would be nice.
- `/v1/models` listing all available NVIDIA models made it easy to pick the right sizes.

---

## Video script (under 3:00)

Record at 1080p, browser full-screen, dark theme. Run each example once beforehand so the live site replays from cache instantly.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Landing page; the ticker cycles real catches | "Every AI learns from Wikipedia. Some of it stopped being true. Right now, over 45,000 Wikipedia articles are officially tagged as needing updates, and nobody checks whether those facts are still true." |
| 0:15–0:25 | Hover the live badge, scroll to "How the agent works" | "Stale Hunter is an agent that finds outdated facts, proves it, and drafts the fix, using NVIDIA Nemotron on Nebius Token Factory and Tavily." |
| 0:25–1:05 | Click **Mobius Motors**. Show the scan line and auto-scroll, the agent log, the reader jumping to each verdict | "It reads every sentence with Nemotron Super, thinking off, in parallel. It dates each candidate from Wikipedia's edit history, so sentences nobody has touched in years go first. Tavily searches the live web. Nemotron Ultra weighs the evidence, and digs deeper when it's thin. Watch the log: 'evidence too thin, digging deeper'." |
| 1:05–1:35 | Finished report: grade F, flagged-only view, an outdated card with diff and "✓✓ confirmed by 2 models", "untouched for 6 years" | "Before anything turns red, a second Nemotron model has to agree. This page still says production 'will commence as soon as capital is raised', written in 2020 and untouched for six years. The company went into liquidation in 2024." |
| 1:35–1:50 | Scroll to **What the article doesn't know yet**: the blue "Missing" card (2025 takeover) and the green inline addition in the reader | "It also reads this year's news. The article never mentions that the company was taken over and restarted in 2025, so Stale Hunter drafts that sentence too, and tells you which section it belongs in." |
| 1:50–2:00 | Click **Copy Talk-page note** / **Copy all fixes** | "Every fix comes with citations, ready to paste, plus a Talk-page note. Stale Hunter never edits Wikipedia itself. Humans decide." |
| 2:00–2:15 | Scroll to "How Nemotron did the work" | "Each model does what it's best at: a fast model reads everything, the largest reasons about the few facts that matter, and a different one double-checks every red flag." |
| 2:15–2:40 | Open **Hall of Stale**: stats, then the Man Utd card ("written Jun 2010, untouched 16y") | "We audited 32 articles. Every listed fact was confirmed by two models and checked by a human. On average those sentences had sat untouched for nearly six years. One, sixteen." |
| 2:40–2:55 | Landing: click **🌐 Any web page**, then show the **For AI agents** API box | "And it isn't just Wikipedia. Any web page, or one API call, so other AI agents can check a fact before they repeat it." |
| 2:55–3:00 | Logo / URL | "Stale Hunter. Keeping the internet's memory fresh." |

Tips: keep the cursor still while it scans; trim waiting time in the edit; show the URL bar once so judges see it's live.
