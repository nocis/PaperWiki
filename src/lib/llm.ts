/**
 * Shared LLM client for multiple OpenAI-compatible providers.
 * Used by the compile script, the citation rebuild script, and the web app's
 * API routes.
 *
 * Configuration:
 *   <PROVIDER>.apiKeyEnv  (required for that provider) — bearer token, e.g.
 *                          OPENCODE_API_KEY, DEEPSEEK_API_KEY
 *   WIKI_LLM_PROVIDER     (optional) — default provider id
 *   WIKI_LLM_MODEL        (optional) — default model when no CLI/per-request override
 *   WIKI_LLM_BASE_URL     (optional) — override the selected provider's base URL
 */
import { getProvider, LLM_PROVIDERS, DEFAULT_PROVIDER_ID, type LLMProviderDef } from "./llm-providers";
export type { LLMProviderDef };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Provider resolution order: explicit/per-request override > env
 * WIKI_LLM_PROVIDER > default. Throws on unknown ids (fail-hard).
 */
export function resolveProvider(override?: string): LLMProviderDef {
  const id = override ?? process.env.WIKI_LLM_PROVIDER ?? DEFAULT_PROVIDER_ID;
  const provider = getProvider(id);
  if (!provider) {
    throw new Error(`unknown LLM provider "${id}" — known providers: ${listProviderIds()}`);
  }
  return provider;
}

export function listProviderIds(): string {
  return LLM_PROVIDERS.map((p) => p.id).join(", ");
}

export type LlmErrorKind = "missing-key" | "auth" | "quota" | "unreachable" | "other";

/** Categorized LLM failure — lets callers (UI, API routes) react per kind. */
export class LlmError extends Error {
  kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
  }
}

/** Best-effort kind classification for any thrown error. */
export function classifyLlmError(err: unknown): { kind: LlmErrorKind; message: string } {
  if (err instanceof LlmError) return { kind: err.kind, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  if (/is not set|API_KEY/i.test(message)) return { kind: "missing-key", message };
  if (/(401|403)/.test(message)) return { kind: "auth", message };
  if (/(402|429|quota|rate limit)/i.test(message)) return { kind: "quota", message };
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|502|503|504/.test(message)) {
    return { kind: "unreachable", message };
  }
  return { kind: "other", message };
}

/**
 * Model resolution order: explicit CLI/per-request override > env
 * WIKI_LLM_MODEL > provider default.
 */
export function resolveModel(provider: LLMProviderDef, override?: string): string {
  return override ?? process.env.WIKI_LLM_MODEL ?? provider.defaultModel;
}

function apiKey(provider: LLMProviderDef): string {
  const key = process.env[provider.apiKeyEnv];
  if (!key) {
    throw new LlmError(
      "missing-key",
      `${provider.apiKeyEnv} is not set. Add it to .env.local and restart the server before using the LLM pipeline.`
    );
  }
  return key;
}

function baseUrl(provider: LLMProviderDef): string {
  return process.env.WIKI_LLM_BASE_URL ?? provider.baseUrl;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/** Transport-level POST. Throws LlmError on HTTP/network errors. */
async function postChat(provider: LLMProviderDef, body: Record<string, unknown>): Promise<ChatCompletionResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(provider)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey(provider)}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmError(
      "unreachable",
      `LLM gateway unreachable (provider ${provider.id}): ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    const kind: LlmErrorKind =
      res.status === 401 || res.status === 403
        ? "auth"
        : res.status === 402 || res.status === 429
          ? "quota"
          : res.status >= 500
            ? "unreachable"
            : "other";
    throw new LlmError(kind, `LLM request failed (provider ${provider.id}): HTTP ${res.status} — ${detail}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}

/** Chat completion with strict non-empty content validation (for real calls). */
async function postChatCompletion(provider: LLMProviderDef, body: Record<string, unknown>): Promise<string> {
  const data = await postChat(provider, body);
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
export async function llmHealthCheck(provider: LLMProviderDef, model: string): Promise<void> {
  const data = await postChat(provider, {
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
  provider: LLMProviderDef;
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
      return await postChatCompletion(opts.provider, { ...base, response_format: { type: "json_object" } });
    } catch (err) {
      // Some gateway models may reject response_format — retry once without it.
      if (err instanceof Error && /response_format|json_object/i.test(err.message)) {
        return postChatCompletion(opts.provider, base);
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
        content: `${opts.user}\n\nCRITICAL OUTPUT BUDGET:\n- Complete and close the entire JSON object.\n- Keep every prose string concise (under 800 characters).\n- Respect any per-field caps stated in the original prompt.\n- Omit no required fields.\n\nMALFORMED PREVIOUS RESPONSE (sample):\n${sample}`,
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
  provider: LLMProviderDef;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return postChatCompletion(opts.provider, {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
  });
}
