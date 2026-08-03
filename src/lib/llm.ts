/**
 * Shared LLM client for the OpenCode Go gateway (OpenAI-compatible API).
 * Used by both the compile script and the web app's API routes.
 *
 * Configuration:
 *   OPENCODE_API_KEY   (required) — bearer token for the gateway
 *   WIKI_LLM_BASE_URL  (optional) — override the gateway base URL
 *   WIKI_LLM_MODEL     (optional) — default model when no CLI/per-request override
 */

const BASE_URL = process.env.WIKI_LLM_BASE_URL ?? "https://opencode.ai/zen/go/v1";
export const DEFAULT_MODEL = "deepseek-v4-flash";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Model resolution order: explicit CLI/per-request override > env > default. */
export function resolveModel(override?: string): string {
  return override ?? process.env.WIKI_LLM_MODEL ?? DEFAULT_MODEL;
}

function apiKey(): string {
  const key = process.env.OPENCODE_API_KEY;
  if (!key) {
    throw new Error(
      "OPENCODE_API_KEY is not set. Export it (or add it to .env.local) before running the LLM pipeline."
    );
  }
  return key;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/** Transport-level POST. Throws on HTTP errors; returns the parsed response. */
async function postChat(body: Record<string, unknown>): Promise<ChatCompletionResponse> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new Error(`LLM request failed: HTTP ${res.status} — ${detail}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}

/** Chat completion with strict non-empty content validation (for real calls). */
async function postChatCompletion(body: Record<string, unknown>): Promise<string> {
  const data = await postChat(body);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("LLM returned an empty response");
  }
  return content;
}

/**
 * Pre-flight check: verifies connectivity, auth, and model availability.
 * Transport-level only — a 2xx with a choices array is enough. Content may
 * legitimately be empty here (reasoning models can spend a tiny max_tokens
 * budget on reasoning_content), so it is intentionally not inspected.
 */
export async function llmHealthCheck(model: string): Promise<void> {
  const data = await postChat({
    model,
    messages: [{ role: "user", content: "Reply with the word: ok" }],
    max_tokens: 32,
  });
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error("LLM health check returned a malformed response (no choices)");
  }
}

/** Extract a JSON object from an LLM response, tolerating code fences and prose. */
export function extractJson<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Failed to parse LLM JSON response: ${text.slice(0, 300)}`);
  }
}

/** Structured JSON completion with defensive parsing and one malformed-output retry. */
export async function llmJson<T>(opts: {
  model: string;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const requestContent = async (requestMessages: ChatMessage[]): Promise<string> => {
    const base = {
      model: opts.model,
      messages: requestMessages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 8192,
    };

    try {
      return await postChatCompletion({ ...base, response_format: { type: "json_object" } });
    } catch (err) {
      // Some gateway models may reject response_format — retry once without it.
      if (err instanceof Error && /response_format|json_object/i.test(err.message)) {
        return postChatCompletion(base);
      }
      throw err;
    }
  };

  const content = await requestContent(messages);
  try {
    return extractJson<T>(content);
  } catch (firstError) {
    // Reasoning models can occasionally exhaust their output budget and emit
    // truncated JSON. Retry the same task with an explicit compact-output
    // budget and show a bounded sample of the malformed response for repair.
    const sample =
      content.length > 2000
        ? `${content.slice(0, 1000)}\n...[truncated sample]...\n${content.slice(-1000)}`
        : content;
    const retryMessages: ChatMessage[] = [
      {
        role: "system",
        content: `${opts.system ?? "You return structured JSON."}\n\nYour previous response was malformed or truncated JSON. Return exactly one complete, syntactically valid JSON object. No markdown fences, prose, comments, or trailing commas.`,
      },
      {
        role: "user",
        content: `${opts.user}\n\nCRITICAL OUTPUT BUDGET:\n- Complete and close the entire JSON object.\n- Keep every prose string concise (under 800 characters).\n- Use at most 6 contributions and at most 20 references when those fields are requested.\n- Omit no required fields.\n\nMALFORMED PREVIOUS RESPONSE (sample):\n${sample}`,
      },
    ];

    const retryContent = await requestContent(retryMessages);
    try {
      return extractJson<T>(retryContent);
    } catch (retryError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`LLM JSON parse failed after compact retry. First: ${firstMessage}. Retry: ${retryMessage}`);
    }
  }
}

/** Plain chat completion (used by the /chat hub). */
export async function llmChat(opts: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return postChatCompletion({
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
  });
}
