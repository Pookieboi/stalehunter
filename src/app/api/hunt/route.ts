import { errorMessage } from "@/lib/errors";
import { cached, cacheKey, overLimit, remember } from "@/lib/guard";
import { hunt, type HuntEvent } from "@/lib/hunter";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { article: "title or Wikipedia URL" } → newline-delimited JSON HuntEvents.
export async function POST(req: Request) {
  const { article } = await req.json().catch(() => ({}));
  if (typeof article !== "string" || !article.trim() || article.length > 300) {
    return Response.json({ error: "Enter a Wikipedia article title or URL." }, { status: 400 });
  }

  // Guards only apply to the public deployment; local runs (evals, development) are always fresh.
  const guarded = process.env.NODE_ENV === "production";
  const key = cacheKey(article);
  const replay = guarded ? cached(key) : null;
  if (guarded && !replay) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const limited = overLimit(ip);
    if (limited) return Response.json({ error: limited }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: HuntEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        if (replay) {
          // Recently checked: replay the saved report quickly instead of spending credits again.
          for (const e of replay) {
            send(e);
            if (e.type === "finding" || e.type === "step") await new Promise((r) => setTimeout(r, 120));
          }
          return;
        }
        const events: HuntEvent[] = [];
        await hunt(article, (e) => {
          events.push(e);
          send(e);
        });
        if (guarded) remember(key, events);
      } catch (e) {
        send({ type: "error", message: errorMessage(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Stale-Hunter-Cache": replay ? "hit" : "miss" },
  });
}
