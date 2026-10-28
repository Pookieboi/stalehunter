// NVIDIA Nemotron models served by Nebius Token Factory (OpenAI-compatible API).
// Docs: https://docs.tokenfactory.nebius.com/quickstart

import { fetchRetry } from "./http";
import { MOCK, mockChat } from "./mock";

const BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1";

// Fast model scans the article; reasoning model makes the fact-check judgement.
// List available IDs with `node scripts/models.mjs` and set them in .env.local.
export const FAST_MODEL = process.env.FAST_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
export const REASON_MODEL = process.env.REASON_MODEL ?? "nvidia/Nemotron-3-Ultra-550b-a55b";
// Independent second opinion on every "outdated" verdict: deliberately a different model from the judge.
export const VERIFY_MODEL = process.env.VERIFY_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";

export type Msg = { role: "system" | "user" | "assistant"; content: string };

/** One model call, reported to the UI's "model router" panel. */
export type CallRecord = {
  stage: string;
  model: string;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  ok: boolean;
};

type ChatOpts = {
  stage: string;
  onCall?: (c: CallRecord) => void;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** false turns off Nemotron's reasoning trace: much faster for simple extraction. */
  thinking?: boolean;
};

export async function chat(model: string, messages: Msg[], opts: ChatOpts): Promise<string> {
  const started = Date.now();
  const record = (ok: boolean, usage?: { prompt_tokens?: number; completion_tokens?: number }) =>
    opts.onCall?.({
      stage: opts.stage,
      model,
      ms: Date.now() - started,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      ok,
    });

  if (MOCK) {
    const { content, usage } = await mockChat(opts.stage, messages);
    record(true, usage);
    return content;
  }

  const key = process.env.NEBIUS_API_KEY;
  if (!key) throw new Error("NEBIUS_API_KEY is not set");

  let res: Response;
  try {
    res = await fetchRetry(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        // Deterministic by default: the same article should give the same report.
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        ...(opts.thinking === false ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
    });
  } catch (e) {
    record(false);
    throw e;
  }
  if (!res.ok) {
    record(false);
    throw new Error(`Token Factory ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  record(true, data.usage);
  return stripThinking(data.choices?.[0]?.message?.content ?? "");
}

/** Reasoning models may emit <think>…</think> before the answer. */
function stripThinking(s: string) {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
}

export async function chatJSON<T>(model: string, messages: Msg[], opts: ChatOpts): Promise<T> {
  const raw = await chat(model, messages, { ...opts, json: true });
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Fall back to the outermost {...} block if the model wrapped JSON in prose or fences.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T;
    throw new Error(`Model did not return JSON: ${raw.slice(0, 200)}`);
  }
}
