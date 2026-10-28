// Cost guards for a public demo: replay recent hunts from cache, and rate-limit fresh ones.
// In-memory per server instance, which is enough to stop casual credit burn on a hackathon demo.

import type { HuntEvent } from "./hunter";

const CACHE_MS = Number(process.env.CACHE_MINUTES ?? 60) * 60_000;
const PER_IP_PER_HOUR = Number(process.env.HUNTS_PER_IP_PER_HOUR ?? 6);
const PER_DAY = Number(process.env.HUNTS_PER_DAY ?? 300);

const cache = new Map<string, { at: number; events: HuntEvent[] }>();
const byIp = new Map<string, number[]>();
let day = { date: "", count: 0 };

export const cacheKey = (article: string) =>
  decodeURIComponent(article.trim().replace(/^.*wikipedia\.org\/wiki\//, "").split(/[?#]/)[0])
    .replace(/_/g, " ")
    .toLowerCase();

export function cached(key: string) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.events : null;
}

export function remember(key: string, events: HuntEvent[]) {
  // Only cache complete, successful hunts.
  if (!events.some((e) => e.type === "done") || events.some((e) => e.type === "error")) return;
  cache.set(key, { at: Date.now(), events });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
}

/** Returns an error message if this visitor or the whole site is over its limit. */
export function overLimit(ip: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  if (day.date !== today) day = { date: today, count: 0 };
  if (day.count >= PER_DAY) return "The demo has hit today's limit. Browse the Hall of Stale, or run it yourself from the repo.";

  const now = Date.now();
  const recent = (byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR)
    return `You've run ${PER_IP_PER_HOUR} fresh hunts this hour. Recently checked articles still load instantly; try again later for new ones.`;

  recent.push(now);
  byIp.set(ip, recent);
  day.count++;
  return null;
}
