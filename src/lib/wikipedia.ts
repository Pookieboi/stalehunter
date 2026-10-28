// Wikipedia access via the public MediaWiki API (no key needed).

import { fetchRetry, WIKI_UA } from "./http";

export type Section = { heading: string; paragraphs: string[] };

export type Article = {
  title: string;
  url: string;
  lastEdited: string;
  sections: Section[];
};

// Sections that hold references or navigation rather than claims.
const SKIP = /^(references|external links|see also|notes|further reading|bibliography|sources|citations|footnotes|works cited|explanatory notes)$/i;

/** Accepts a title ("Twitter") or a URL ("https://en.wikipedia.org/wiki/Twitter"). */
export function parseTitle(input: string) {
  const s = input.trim();
  const m = s.match(/wikipedia\.org\/wiki\/([^?#]+)/);
  return decodeURIComponent(m ? m[1] : s).replace(/_/g, " ");
}

async function api(params: Record<string, string>) {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const res = await fetchRetry(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: { "User-Agent": WIKI_UA } });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  return res.json();
}

// Articles change slowly; caching avoids hammering Wikipedia on repeated hunts.
const cache = new Map<string, { at: number; article: Article }>();
const CACHE_MS = 10 * 60 * 1000;

export async function fetchArticle(input: string): Promise<Article> {
  const key = parseTitle(input).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.article;
  const article = await loadArticle(input);
  cache.set(key, { at: Date.now(), article });
  return article;
}

async function loadArticle(input: string): Promise<Article> {
  const data = await api({
    action: "query",
    prop: "extracts|revisions|info",
    inprop: "url",
    rvprop: "timestamp",
    explaintext: "1",
    exsectionformat: "wiki",
    redirects: "1",
    titles: parseTitle(input),
  });
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.extract) throw new Error(`No Wikipedia article found for "${input}"`);

  const sections: Section[] = [];
  let current: Section = { heading: "Introduction", paragraphs: [] };
  let skipping = false;
  for (const raw of String(page.extract).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^(={2,})\s*(.+?)\s*\1$/);
    if (h) {
      if (current.paragraphs.length) sections.push(current);
      const level = h[1].length;
      // Skip reference-type sections and everything nested under them.
      if (level === 2) skipping = SKIP.test(h[2]);
      current = { heading: h[2], paragraphs: [] };
      continue;
    }
    if (!skipping) current.paragraphs.push(line);
  }
  if (current.paragraphs.length) sections.push(current);

  return {
    title: page.title,
    url: page.fullurl,
    lastEdited: page.revisions?.[0]?.timestamp ?? "",
    sections,
  };
}

/** A random article from Wikipedia's own "needs updating" backlog. */
export async function randomNeedsUpdate(): Promise<string> {
  const data = await api({
    action: "query",
    list: "categorymembers",
    cmtitle: "Category:All Wikipedia articles in need of updating",
    cmnamespace: "0",
    cmlimit: "500",
    cmsort: "timestamp",
    cmdir: "desc",
  });
  const members: { title: string }[] = data.query?.categorymembers ?? [];
  if (!members.length) throw new Error("Couldn't load the needs-updating list");
  return members[Math.floor(Math.random() * members.length)].title;
}

/** Live size of the backlog, for the landing page. */
export async function needsUpdateCount(): Promise<number | null> {
  try {
    const data = await api({
      action: "query",
      prop: "categoryinfo",
      titles: "Category:All Wikipedia articles in need of updating",
    });
    return data.query?.pages?.[0]?.categoryinfo?.pages ?? null;
  } catch {
    return null;
  }
}
