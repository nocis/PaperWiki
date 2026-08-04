/**
 * LLM provider registry (server-side only).
 *
 * Static provider metadata only — no hardcoded model lists. Model lists are
 * fetched live from each provider's OpenAI-compatible /models endpoint by the
 * server (see publicCatalog) and served to the client via GET /api/llm.
 * API keys are NEVER stored here; each provider declares which env var holds
 * its key, and only server-side code reads the actual value.
 */

export interface LLMProviderDef {
  /** Stable id used in URLs, storage, and CLI args. */
  id: string;
  /** Human label for the selector widget. */
  label: string;
  /** OpenAI-compatible base URL (server-side only). */
  baseUrl: string;
  /** Env var that holds the bearer token for this provider. */
  apiKeyEnv: string;
  /** Preferred default model id — used only when the live list contains it. */
  defaultModel: string;
}

export const DEFAULT_PROVIDER_ID = "opencode";

export const LLM_PROVIDERS: LLMProviderDef[] = [
  {
    id: "opencode",
    label: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiKeyEnv: "OPENCODE_API_KEY",
    defaultModel: "deepseek-v4-flash",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
  },
];

export function getProvider(id: string): LLMProviderDef | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

export interface CatalogProvider {
  id: string;
  label: string;
  models: string[];
  /** Preferred default if present in the live list, else the first model. */
  defaultModel: string;
  /** Whether the provider's key env var is set on the server. */
  keySet: boolean;
  /** Set when the live /models fetch failed (or was skipped — no key). */
  modelsError: string | null;
}

export interface LlmCatalogPayload {
  defaultProviderId: string;
  providers: CatalogProvider[];
  /** ISO time of the last live model fetch. */
  fetchedAt: string;
}

/** Fetch the provider's live model list from its OpenAI-compatible /models. */
async function fetchProviderModels(provider: LLMProviderDef, key: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const base = process.env.WIKI_LLM_BASE_URL ?? provider.baseUrl;
    const res = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    const models = (body.data ?? [])
      .map((m) => (typeof m.id === "string" ? m.id : null))
      .filter((id): id is string => id !== null && id.length > 0);
    return models.sort((a, b) => a.localeCompare(b));
  } finally {
    clearTimeout(timeout);
  }
}

// Catalog is cached server-side; the live fetch happens at most once per TTL.
const CATALOG_TTL_MS = 5 * 60_000;
let catalogCache: { at: number; value: LlmCatalogPayload } | null = null;

/**
 * Client-safe catalog payload for GET /api/llm. Model lists are fetched live
 * from each provider's /models endpoint (parallel, per-provider failures are
 * isolated); nothing is bundled client-side or assumed ahead of the fetch.
 */
export async function publicCatalog(): Promise<LlmCatalogPayload> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.value;
  }

  const providers = await Promise.all(
    LLM_PROVIDERS.map(async (p): Promise<CatalogProvider> => {
      const key = process.env[p.apiKeyEnv];
      if (!key) {
        return {
          id: p.id,
          label: p.label,
          models: [],
          defaultModel: "",
          keySet: false,
          modelsError: `${p.apiKeyEnv} is not set — add it to .env.local and restart.`,
        };
      }
      try {
        const models = await fetchProviderModels(p, key);
        const defaultModel = models.includes(p.defaultModel) ? p.defaultModel : (models[0] ?? "");
        return {
          id: p.id,
          label: p.label,
          models,
          defaultModel,
          keySet: true,
          modelsError: null,
        };
      } catch (err) {
        return {
          id: p.id,
          label: p.label,
          models: [],
          defaultModel: "",
          keySet: true,
          modelsError: `could not fetch models (${err instanceof Error ? err.message : String(err)})`,
        };
      }
    })
  );

  const value: LlmCatalogPayload = {
    defaultProviderId: DEFAULT_PROVIDER_ID,
    providers,
    fetchedAt: new Date().toISOString(),
  };
  catalogCache = { at: now, value };
  return value;
}
