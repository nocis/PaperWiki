import { NextRequest, NextResponse } from "next/server";
import { classifyLlmError, llmHealthCheck, resolveModel, resolveProvider } from "@/lib/llm";
import type { LlmErrorKind } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface LlmAvailability {
  state: "available" | "unavailable";
  kind: LlmErrorKind | null;
  error: string | null;
  provider: string;
  model: string;
  checkedAt: string;
}

// In-memory cache keyed "provider|model". Success is cached longer (the check
// is a real LLM call); failures expire sooner so recovery is picked up quickly.
const CACHE_TTL_OK_MS = 60_000;
const CACHE_TTL_BAD_MS = 20_000;
const cache = new Map<string, { at: number; value: LlmAvailability }>();

function cached(key: string): LlmAvailability | null {
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.value.state === "available" ? CACHE_TTL_OK_MS : CACHE_TTL_BAD_MS;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function store(key: string, value: LlmAvailability): void {
  cache.set(key, { at: Date.now(), value });
}

/** GET /api/llm/availability?provider=&model= — LLM Availability check. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const providerId = searchParams.get("provider") ?? undefined;

  let provider;
  try {
    provider = resolveProvider(providerId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown provider" },
      { status: 400 }
    );
  }

  const modelParam = searchParams.get("model");
  const model = resolveModel(provider, modelParam && modelParam.length > 0 ? modelParam : undefined);
  const key = `${provider.id}|${model}`;

  const hit = cached(key);
  if (hit) return NextResponse.json(hit);

  const checkedAt = new Date().toISOString();

  // Missing key short-circuits — no LLM call, no caching needed.
  if (!process.env[provider.apiKeyEnv]) {
    const value: LlmAvailability = {
      state: "unavailable",
      kind: "missing-key",
      error: `${provider.apiKeyEnv} is not set. Add it to .env.local and restart the server.`,
      provider: provider.id,
      model,
      checkedAt,
    };
    return NextResponse.json(value);
  }

  try {
    await llmHealthCheck(provider, model);
    const value: LlmAvailability = {
      state: "available",
      kind: null,
      error: null,
      provider: provider.id,
      model,
      checkedAt,
    };
    store(key, value);
    return NextResponse.json(value);
  } catch (err) {
    const { kind, message } = classifyLlmError(err);
    const value: LlmAvailability = {
      state: "unavailable",
      kind,
      error: message,
      provider: provider.id,
      model,
      checkedAt,
    };
    store(key, value);
    return NextResponse.json(value);
  }
}
