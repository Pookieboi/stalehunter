// Sentence age: when was each flagged sentence written, and when was it last touched?
// Uses WikiWho (Wikimedia Cloud), which attributes every token of the current wikitext
// to the revision that introduced it, plus the MediaWiki API for revision timestamps.

import { fetchRetry, WIKI_UA } from "./http";

export type SentenceAge = { written: string; lastTouched: string };

type Token = { str: string; o_rev_id: number };

const words = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Returns an age for each sentence (same order), or null where the sentence
 * couldn't be located in the wikitext. Never throws: ages are a nice-to-have.
 */
export async function sentenceAges(title: string, sentences: string[]): Promise<(SentenceAge | null)[]> {
  try {
    const url = `https://wikiwho-api.wmcloud.org/en/api/v1.0.0-beta/rev_content/${encodeURIComponent(
      title.replace(/ /g, "_"),
    )}/?o_rev_id=true&editor=false&token_id=false&out=false&in=false`;
    const res = await fetchRetry(url, { headers: { "User-Agent": WIKI_UA }, signal: AbortSignal.timeout(20_000) }, 1);
    if (!res.ok) return sentences.map(() => null);
    const data = await res.json();
    const rev = data.revisions?.[0];
    const raw: Token[] = rev ? (Object.values(rev)[0] as { tokens: Token[] }).tokens : [];
    // Keep only word-like tokens so they line up with the plain-text sentence.
    const tokens = raw.filter((t) => /[\p{L}\p{N}]/u.test(t.str)).map((t) => ({ w: t.str.toLowerCase(), rev: t.o_rev_id }));

    const revSets = sentences.map((s) => locate(words(s), tokens));
    const allRevs = [...new Set(revSets.flatMap((r) => r ?? []))];
    const times = await revisionTimes(allRevs);

    return revSets.map((revs) => {
      if (!revs) return null;
      const stamps = revs.map((r) => times.get(r)).filter((t): t is string => !!t).sort();
      if (!stamps.length) return null;
      // "Written" = when most of the sentence's words were added; "last touched" = newest word.
      return { written: mode(revs.map((r) => times.get(r)).filter((t): t is string => !!t)), lastTouched: stamps[stamps.length - 1] };
    });
  } catch {
    return sentences.map(() => null);
  }
}

/** Finds the sentence in the token stream; returns the revision ids of its matched words. */
function locate(target: string[], tokens: { w: string; rev: number }[]): number[] | null {
  if (target.length < 3) return null;
  let best: number[] | null = null;
  let bestScore = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].w !== target[0]) continue;
    // Greedy walk allowing small gaps for wiki markup (link targets, templates).
    const revs: number[] = [tokens[i].rev];
    let j = i + 1;
    for (let k = 1; k < target.length && j < tokens.length; k++) {
      const end = Math.min(j + 5, tokens.length);
      let hit = -1;
      for (let m = j; m < end; m++) if (tokens[m].w === target[k]) { hit = m; break; }
      if (hit >= 0) { revs.push(tokens[hit].rev); j = hit + 1; }
    }
    const score = revs.length / target.length;
    if (score > bestScore) { bestScore = score; best = revs; }
    if (score === 1) break;
  }
  return bestScore >= 0.7 ? best : null;
}

async function revisionTimes(revIds: number[]) {
  const times = new Map<number, string>();
  for (let i = 0; i < revIds.length; i += 50) {
    const qs = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "revisions",
      revids: revIds.slice(i, i + 50).join("|"), rvprop: "ids|timestamp",
    });
    const res = await fetchRetry(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: { "User-Agent": WIKI_UA } });
    if (!res.ok) continue;
    const data = await res.json();
    for (const p of data.query?.pages ?? []) for (const r of p.revisions ?? []) times.set(r.revid, r.timestamp);
  }
  return times;
}

function mode(xs: string[]) {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
