import { errorMessage } from "@/lib/errors";
import { overLimit } from "@/lib/guard";
import { checkStatement } from "@/lib/hunter";

export const runtime = "nodejs";
export const maxDuration = 120;

// Freshness check for other AI agents.
//   POST /api/check  { "statement": "Parag Agrawal is the CEO of Twitter.", "context": "optional topic" }
//   GET  /api/check?statement=...
// Returns { verdict: "outdated" | "current" | "unverifiable", current_fact, suggested_rewrite, sources, ... }
async function handle(statement: unknown, context: unknown, req: Request) {
  if (typeof statement !== "string" || statement.trim().length < 8 || statement.length > 500) {
    return Response.json({ error: "Send a `statement` of 8–500 characters." }, { status: 400 });
  }
  if (process.env.NODE_ENV === "production") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const limited = overLimit(ip);
    if (limited) return Response.json({ error: limited }, { status: 429 });
  }
  try {
    const result = await checkStatement(statement.trim(), typeof context === "string" ? context.slice(0, 200) : "");
    return Response.json(result, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return handle(body.statement, body.context, req);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(q.get("statement"), q.get("context"), req);
}
