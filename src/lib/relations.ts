/**
 * Typed paper relations (builds-on / extends / supersedes / contradicts /
 * impacts) — the end-of-run finalize pass.
 *
 * The analyze pass extracts relations against the PRE-run index; this pass
 * re-maps them against the FULL final index with one slim LLM call per paper,
 * mirroring remapPaperCitations: seeds are kept unless wrong, same-run papers
 * are discovered, and results are validated code-side.
 */
import { llmJson, type LLMProviderDef } from "./llm";
import { relationFinalizePrompt } from "./prompts";
import type { PaperRelation } from "./wiki";

export const RELATION_TYPES = ["builds-on", "extends", "supersedes", "contradicts", "impacts"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

/** Code-side validation: known slugs only, no self, allowed types, dedupe. */
export function validateRelations(
  raw: { relations?: unknown },
  knownSlugs: ReadonlySet<string>,
  selfSlug: string
): PaperRelation[] {
  if (!Array.isArray(raw.relations)) {
    throw new Error("relation finalize: missing relations array");
  }
  const out: PaperRelation[] = [];
  const seen = new Set<string>();
  for (const r of raw.relations) {
    if (typeof r !== "object" || r === null) continue;
    const entry = r as Record<string, unknown>;
    const relation = typeof entry.relation === "string" ? entry.relation : "";
    const slug = typeof entry.slug === "string" ? entry.slug : "";
    const note = typeof entry.note === "string" ? entry.note.trim() : "";
    if (!isRelationType(relation)) continue;
    if (!knownSlugs.has(slug) || slug === selfSlug) continue;
    const key = `${relation}|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ relation, slug, note: note.slice(0, 200) });
  }
  return out;
}

export async function finalizePaperRelations(opts: {
  provider: LLMProviderDef;
  model: string;
  language: string;
  title: string;
  seed: PaperRelation[];
  index: string;
  knownSlugs: ReadonlySet<string>;
  selfSlug: string;
}): Promise<PaperRelation[]> {
  const prompt = relationFinalizePrompt({
    title: opts.title,
    seedRelations: opts.seed,
    index: opts.index,
    language: opts.language,
  });
  const raw = await llmJson<{ relations?: unknown }>({
    provider: opts.provider,
    model: opts.model,
    ...prompt,
    maxTokens: 4000,
    temperature: 0.1,
  });
  return validateRelations(raw, opts.knownSlugs, opts.selfSlug);
}
