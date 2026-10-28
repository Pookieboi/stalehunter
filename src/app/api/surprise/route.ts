import { errorMessage } from "@/lib/errors";
import { randomNeedsUpdate } from "@/lib/wikipedia";

export const dynamic = "force-dynamic";

// A random article from Wikipedia's own "needs updating" backlog.
export async function GET() {
  try {
    return Response.json({ title: await randomNeedsUpdate() });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 502 });
  }
}
