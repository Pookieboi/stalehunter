// fetch with retries for rate limits and transient overloads (Wikipedia 429, Token Factory 529…).

const RETRY_ON = new Set([429, 500, 502, 503, 504, 529]);

export async function fetchRetry(url: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (!RETRY_ON.has(res.status) || attempt >= retries) return res;
    // Honour Retry-After when given; otherwise exponential backoff with jitter (1s, 2s, 4s…).
    const after = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : 1000 * 2 ** attempt + Math.random() * 500;
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * Wikimedia requires a descriptive User-Agent with contact info, and throttles
 * generic ones hard: https://meta.wikimedia.org/wiki/User-Agent_policy
 */
export const WIKI_UA = "StaleHunter/0.2 (https://github.com/Pookieboi/stalehunter) Next.js";
