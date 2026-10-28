// Lists the NVIDIA models your Token Factory key can use, and pings the configured ones.
// Usage: node scripts/models.mjs
import "./env.mjs";

const BASE = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1";
const KEY = process.env.NEBIUS_API_KEY;
if (!KEY) {
  console.error("Set NEBIUS_API_KEY in .env.local first.");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const res = await fetch(`${BASE}/models`, { headers });
if (!res.ok) {
  console.error(`GET /models → ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const ids = (await res.json()).data.map((m) => m.id).sort();
console.log("NVIDIA / Nemotron models available:");
for (const id of ids.filter((id) => /nvidia|nemotron/i.test(id))) console.log("  " + id);

for (const name of ["FAST_MODEL", "REASON_MODEL"]) {
  const model = process.env[name];
  if (!model) continue;
  const t = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: "user", content: "Reply with: ok" }] }),
  });
  console.log(`\n${name}=${model} → ${r.status} in ${Date.now() - t}ms ${r.ok ? "" : (await r.text()).slice(0, 200)}`);
}
