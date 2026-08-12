/**
 * Client-side LLM availability + catalog helpers.
 * Pure fetch/format code — no secrets, safe for browser bundles.
 */
import type { LlmErrorKind } from "./llm";

export interface LlmCatalogProvider {
  id: string;
  label: string;
  models: string[];
  defaultModel: string;
  /** Whether the provider's API key env var is set on the server. */
  keySet: boolean;
  /** Set when the live /models fetch failed or was skipped (no key). */
  modelsError: string | null;
}

export interface LlmCatalog {
  defaultProviderId: string;
  providers: LlmCatalogProvider[];
  fetchedAt: string;
}

export type AvailabilityState = "unknown" | "checking" | "available" | "unavailable";

export interface LlmAvailability {
  state: "available" | "unavailable";
  kind: LlmErrorKind | null;
  error: string | null;
  provider: string;
  model: string;
  checkedAt: string;
}

export interface ProviderModelPrefs {
  provider: string;
  model: string;
}

/** No client-side defaults — the server catalog decides. */
export const EMPTY_PREFS: ProviderModelPrefs = { provider: "", model: "" };

export async function fetchLlmCatalog(refresh = false): Promise<LlmCatalog> {
  const res = await fetch(refresh ? "/api/llm?refresh=1" : "/api/llm", { cache: "no-store" });
  if (!res.ok) throw new Error(`model catalog request failed with HTTP ${res.status}`);
  return (await res.json()) as LlmCatalog;
}

export async function fetchAvailability(provider: string, model: string): Promise<LlmAvailability> {
  const params = new URLSearchParams({ provider, model });
  const res = await fetch(`/api/llm/availability?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`availability request failed with HTTP ${res.status}`);
  return (await res.json()) as LlmAvailability;
}

/**
 * Validate a stored pair against the fetched catalog. Before the catalog
 * arrives (null) the prefs pass through untouched — nothing is defaulted
 * client-side. Once the catalog is present, invalid or missing values fall
 * back to the catalog's default provider + its default model.
 */
export function sanitizePrefs(prefs: ProviderModelPrefs, catalog: LlmCatalog | null): ProviderModelPrefs {
  if (!catalog) return prefs;
  const provider = catalog.providers.some((p) => p.id === prefs.provider)
    ? prefs.provider
    : catalog.defaultProviderId;
  const def = catalog.providers.find((p) => p.id === provider);
  const model = def && def.models.includes(prefs.model) ? prefs.model : def?.defaultModel ?? "";
  return { provider, model };
}

/** Human text for each failure kind. */
export function availabilityMessage(kind: LlmErrorKind | null, providerId: string, model: string): string {
  switch (kind) {
    case "missing-key":
      return `LLM unavailable — the ${providerId} provider has no API key configured on the server. Add it to .env.local and restart.`;
    case "auth":
      return `LLM unavailable — authentication failed for ${providerId} (${model}). Check the configured API key.`;
    case "quota":
      return `LLM unavailable — ${providerId} (${model}) quota or usage limit exceeded. Check the provider's usage console.`;
    case "unreachable":
      return `LLM unavailable — the ${providerId} gateway could not be reached (${model}). Check your network or the service status.`;
    default:
      return `LLM unavailable for ${providerId} (${model}).`;
  }
}
