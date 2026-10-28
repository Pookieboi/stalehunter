// Dev-only stand-ins for Token Factory and Tavily, enabled with MOCK_AI=1.
// Lets the UI be built and tested before API keys exist. Never enabled in production.
// Search is only faked when no Tavily key is set, so real search can be tested on its own.

import type { Msg } from "./llm";
import type { Source } from "./tavily";

export const MOCK = process.env.MOCK_AI === "1";
export const MOCK_SEARCH = MOCK && !process.env.TAVILY_API_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIME_SENSITIVE = /\b(as of|currently|current|is the (largest|tallest|highest|biggest)|population|employees|users|record|most recent|upcoming|will be|plans? to|under construction)\b/i;

export async function mockChat(stage: string, messages: Msg[]): Promise<{ content: string; usage: object }> {
  await sleep(stage === "scan" ? 1200 : 2500 + Math.random() * 2500);
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  let content: string;

  if (stage === "scan") {
    const claims = [...user.matchAll(/\[(s\d+)\] ([^[]+)/g)]
      .filter(([, , text]) => TIME_SENSITIVE.test(text))
      .slice(0, 5)
      .map(([, sid, text], i) => ({
        sid,
        claim: text.slice(0, 80),
        query: text.slice(0, 80) + " 2026",
        risk: 5 - i,
      }));
    content = JSON.stringify({ claims });
  } else {
    const roll = Math.random();
    const verdict = roll < 0.45 ? "outdated" : roll < 0.8 ? "current" : "unverifiable";
    content = JSON.stringify({
      verdict,
      confidence: 0.6 + Math.random() * 0.35,
      current_fact: verdict === "outdated" ? "[mock] The figure changed in 2025 according to newer sources." : "[mock] Confirmed by recent sources.",
      reason: "[mock] Placeholder verdict — set NEBIUS_API_KEY to get real fact-checks.",
      rewrite: verdict === "outdated" ? "[mock] As of 2026, the updated figure is reported by the source." : "",
      cited: [1, 2],
    });
  }
  return { content, usage: { prompt_tokens: Math.round(user.length / 4), completion_tokens: 180 } };
}

export async function mockSearch(query: string): Promise<Source[]> {
  await sleep(600 + Math.random() * 900);
  return [1, 2].map((n) => ({
    title: `[mock] Result ${n} for ${query.slice(0, 40)}`,
    url: `https://example.com/mock-${n}`,
    content: "Mock search result.",
    published: "2026-06-01",
  }));
}
