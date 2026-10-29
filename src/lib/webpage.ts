// Any web page as input (company docs, help centres, blogs), via Tavily Extract.
// Turns the page's markdown into the same section/paragraph shape as a Wikipedia article.

import { fetchRetry } from "./http";
import type { Article } from "./wikipedia";

export const isWebUrl = (input: string) => /^https?:\/\//i.test(input.trim()) && !/wikipedia\.org\/wiki\//i.test(input);

export async function fetchWebPage(url: string): Promise<Article> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");
  const res = await fetchRetry("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ urls: [url.trim()], extract_depth: "advanced", format: "markdown" }),
  });
  if (!res.ok) throw new Error(`Couldn't read that page (Tavily ${res.status})`);
  const data = await res.json();
  const page = data.results?.[0];
  if (!page?.raw_content) throw new Error("Couldn't read any text from that page. Is it public?");

  const sections = toSections(String(page.raw_content));
  if (!sections.some((s) => s.paragraphs.length)) throw new Error("That page doesn't have enough readable text to check.");
  const host = new URL(url).hostname.replace(/^www\./, "");
  return {
    title: page.title?.trim() || sections.find((s) => s.heading !== "Introduction")?.heading || host,
    url: page.url ?? url,
    lastEdited: "",
    sections,
    source: "web",
  };
}

/** Markdown → sections of plain-text paragraphs, dropping navigation, images and code. */
function toSections(md: string) {
  const sections: { heading: string; paragraphs: string[] }[] = [];
  let current = { heading: "Introduction", paragraphs: [] as string[] };
  let inCode = false;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !line) continue;
    const h = line.match(/^#{1,4}\s+(.+)$/);
    if (h) {
      if (current.paragraphs.length) sections.push(current);
      current = { heading: plain(h[1]).slice(0, 120), paragraphs: [] };
      continue;
    }
    const text = plain(line.replace(/^([*+-]|\d+\.)\s+/, ""));
    // Navigation and link lists are mostly links; real prose has enough words.
    const linkShare = (line.match(/\]\(/g)?.length ?? 0) / Math.max(text.split(/\s+/).length, 1);
    if (text.split(/\s+/).length < 6 || linkShare > 0.25) continue;
    current.paragraphs.push(text);
  }
  if (current.paragraphs.length) sections.push(current);
  return sections.slice(0, 60);
}

function plain(s: string) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
