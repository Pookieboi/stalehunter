import { errorMessage } from "@/lib/errors";
import { hunt, type HuntEvent } from "@/lib/hunter";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST { article: "title or Wikipedia URL" } → newline-delimited JSON HuntEvents.
export async function POST(req: Request) {
  const { article } = await req.json().catch(() => ({}));
  if (typeof article !== "string" || !article.trim() || article.length > 300) {
    return Response.json({ error: "Enter a Wikipedia article title or URL." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: HuntEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await hunt(article, emit);
      } catch (e) {
        emit({ type: "error", message: errorMessage(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
