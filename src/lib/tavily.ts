// Tavily web search: grounds every verdict in current, citable sources.

import { fetchRetry } from "./http";
import { MOCK_SEARCH, mockSearch } from "./mock";

export type Source = { title: string; url: string; content: string; published?: string };

// Wikipedia and its mirrors would just echo the statement we're checking;
// social platforms are rarely citable on Wikipedia.
const EXCLUDE = [
  "wikipedia.org", "wikiwand.com", "wikimedia.org", "dbpedia.org", "wikidata.org", "alchetron.com",
  "facebook.com", "instagram.com", "pinterest.com", "tiktok.com", "quora.com", "youtube.com", "linkedin.com", "medium.com",
];

export async function search(
  query: string,
  opts: { maxResults?: number; deep?: boolean; topic?: "general" | "news"; timeRange?: "month" | "year" } = {},
) {
  if (MOCK_SEARCH) return mockSearch(query);
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");

  const res = await fetchRetry("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      search_depth: opts.deep === false ? "basic" : "advanced",
      max_results: opts.maxResults ?? 5,
      include_answer: false,
      exclude_domains: EXCLUDE,
      ...(opts.topic ? { topic: opts.topic } : {}),
      ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.results ?? []).map(
    (r: { title?: string; url: string; content?: string; published_date?: string }): Source => ({
      title: r.title ?? "",
      url: r.url,
      content: String(r.content ?? "").slice(0, 1200),
      published: r.published_date,
    }),
  ) as Source[];
}
