/**
 * Paper Knowledge diagram-plan worker pool (scripts-only) — PHASE 2 of the
 * amend pipeline.
 *
 * Phase 1 (amend.ts) extracts the structured block, persists it together with
 * a capped paper-text excerpt (.log/paper-knowledge/<slug>.json), and writes
 * the `## Paper Knowledge` block WITHOUT diagram fences. This pass claims the
 * entry's `diagramPlan` phase, asks a dedicated LLM call to decide WHERE
 * diagrams are needed (from the persisted knowledge + excerpt — no PDF
 * re-extraction), and patches the diagram fences into the block.
 *
 * A plan failure marks ONLY `diagramPlan: "failed"` — the amend's `ready`
 * status is untouched, and retry re-runs this phase alone.
 */
import { llmJson, type LLMProviderDef } from "../../src/lib/llm";
import {
  claimNextDiagramPlan,
  readKnowledgeJson,
  setDiagramPlanEntry,
  sleep,
  validateDiagrams,
} from "../../src/lib/paper-knowledge";
import { paperDiagramPlanPrompt, type PaperDiagramPlan } from "../../src/lib/prompts";
import { patchDiagramFences } from "../../src/lib/templates";
import { deriveDb, readPaperPages, writeDbAtomic, writePage } from "../../src/lib/wiki";
import { errorMessage, truncate } from "../lib/cli-utils";

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;
const DIAGRAM_PLAN_MAX_TOKENS = 16_384;

function concurrencyFromEnv(): number {
  const raw = Number(process.env.PAPERWIKI_KNOWLEDGE_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), MAX_CONCURRENCY);
  return DEFAULT_CONCURRENCY;
}

// ---------------------------------------------------------------------------
// Per-slug plan
// ---------------------------------------------------------------------------

/** Per-slug plan — exported so the unified pipeline can drive it. */
export async function planOne(opts: { slug: string; provider: LLMProviderDef; model: string; language: string }): Promise<void> {
  const { slug } = opts;

  const store = await readKnowledgeJson(slug);
  if (!store) {
    throw new Error(`persisted knowledge JSON not found for ${slug} — re-run the amend first`);
  }

  const pages = await readPaperPages();
  const page = pages.find((p) => p.fm.slug === slug);
  if (!page) throw new Error(`paper page not found: ${slug}`);

  const { system, user } = paperDiagramPlanPrompt({
    knowledge: store.knowledge,
    textExcerpt: store.textExcerpt,
    language: opts.language,
  });
  const plan = await llmJson<PaperDiagramPlan>({
    provider: opts.provider,
    model: opts.model,
    system,
    user,
    maxTokens: DIAGRAM_PLAN_MAX_TOKENS,
  });

  const problems: string[] = [];
  const diagrams = plan?.diagrams;
  validateDiagrams(diagrams, problems);
  if (problems.length > 0) {
    throw new Error(`Diagram plan validation failed: ${problems.join("; ")}`);
  }

  const newBody = patchDiagramFences(page.body, diagrams ?? []);
  await writePage(page.filePath, page.fm, newBody);

  // Rebuild the derived db (same safety net as the amend phase).
  const db = await deriveDb();
  await writeDbAtomic(db);

  await setDiagramPlanEntry(slug, "ready");
  console.log(`  ✓ diagram plan ready -> ${slug} (${(plan.diagrams ?? []).length} diagrams)`);
}

// ---------------------------------------------------------------------------
// Worker pool (claim-based drain — concurrent runners are safe)
// ---------------------------------------------------------------------------

export async function runPaperKnowledgeDiagramPlan(opts: {
  provider: LLMProviderDef;
  model: string;
  language?: string;
  /** Optional scope: process only this slug. */
  slug?: string;
  concurrency?: number;
}): Promise<{ attempted: number; ready: number; failed: number }> {
  const language = opts.language ?? "en";
  const concurrency = opts.concurrency ?? concurrencyFromEnv();
  const summary = { attempted: 0, ready: 0, failed: 0 };
  const scopeNote = opts.slug ? ` (scope: ${opts.slug})` : "";

  const processSlug = async (slug: string): Promise<void> => {
    try {
      await planOne({ slug, provider: opts.provider, model: opts.model, language });
      summary.attempted += 1;
      summary.ready += 1;
    } catch (err) {
      const message = errorMessage(err);
      await setDiagramPlanEntry(slug, "failed", truncate(message, 500));
      console.error(`  ✗ diagram plan failed -> ${slug}: ${message}`);
      summary.attempted += 1;
      summary.failed += 1;
    }
  };

  let logged = false;
  while (true) {
    let passTotal = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const slug = await claimNextDiagramPlan(opts.slug);
        if (!slug) return;
        passTotal += 1;
        await processSlug(slug);
      }
    };
    if (!logged) {
      console.log(`Diagram plan — processing pending entries, concurrency ${concurrency}${scopeNote}`);
      logged = true;
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (passTotal > 0) continue;
    await sleep(2000);
    const extra = await claimNextDiagramPlan(opts.slug);
    if (!extra) break;
    await processSlug(extra);
  }

  if (summary.attempted === 0) {
    console.log(`Diagram plan — no pending entries${scopeNote}.`);
  } else {
    console.log(`Diagram plan done — attempted: ${summary.attempted}, ready: ${summary.ready}, failed: ${summary.failed}`);
  }
  return summary;
}
