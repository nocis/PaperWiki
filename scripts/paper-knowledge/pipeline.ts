/**
 * Paper Knowledge unified pipeline — drains BOTH phases (amend + diagram
 * plan) in ONE worker pool, so a paper's diagram plan starts the moment ITS
 * own amend succeeds instead of waiting for every other paper's amend to
 * finish. Each worker claims an amend entry first (a plan entry only becomes
 * claimable once its amend is ready), then a diagram-plan entry; per-slug
 * failures mark only their own phase, exactly like the standalone phase
 * runners.
 *
 * The standalone phase runners (runPaperKnowledgeAmend /
 * runPaperKnowledgeDiagramPlan) remain for callers that want one phase only
 * (e.g. `yarn compile`, which drains sequentially in-process).
 */
import type { LLMProviderDef } from "../../src/lib/llm";
import {
  claimNextDiagramPlan,
  claimNextPaperKnowledge,
  setDiagramPlanEntry,
  setPaperKnowledgeEntry,
  sleep,
} from "../../src/lib/paper-knowledge";
import { errorMessage, truncate } from "../lib/cli-utils";
import { amendOne } from "./amend";
import { planOne } from "./plan";

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;

function concurrencyFromEnv(): number {
  const raw = Number(process.env.PAPERWIKI_KNOWLEDGE_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), MAX_CONCURRENCY);
  return DEFAULT_CONCURRENCY;
}

export async function runPaperKnowledgePipeline(opts: {
  provider: LLMProviderDef;
  model: string;
  language?: string;
  /** Optional scope: process only this slug. */
  slug?: string;
  concurrency?: number;
}): Promise<{ attempted: number; amendReady: number; planReady: number; failed: number }> {
  const language = opts.language ?? "en";
  const concurrency = opts.concurrency ?? concurrencyFromEnv();
  const summary = { attempted: 0, amendReady: 0, planReady: 0, failed: 0 };
  const scopeNote = opts.slug ? ` (scope: ${opts.slug})` : "";

  /** Claim and process exactly one unit of work; false when nothing pending. */
  const processOne = async (): Promise<boolean> => {
    const amendSlug = await claimNextPaperKnowledge(opts.slug);
    if (amendSlug) {
      try {
        await amendOne({ slug: amendSlug, provider: opts.provider, model: opts.model, language });
        summary.attempted += 1;
        summary.amendReady += 1;
      } catch (err) {
        const message = errorMessage(err);
        await setPaperKnowledgeEntry(amendSlug, "failed", truncate(message, 500));
        console.error(`  ✗ knowledge failed -> ${amendSlug}: ${message}`);
        summary.attempted += 1;
        summary.failed += 1;
      }
      return true;
    }
    const planSlug = await claimNextDiagramPlan(opts.slug);
    if (planSlug) {
      try {
        await planOne({ slug: planSlug, provider: opts.provider, model: opts.model, language });
        summary.attempted += 1;
        summary.planReady += 1;
      } catch (err) {
        const message = errorMessage(err);
        await setDiagramPlanEntry(planSlug, "failed", truncate(message, 500));
        console.error(`  ✗ diagram plan failed -> ${planSlug}: ${message}`);
        summary.attempted += 1;
        summary.failed += 1;
      }
      return true;
    }
    return false;
  };

  // Drain loop (same settle re-check as the standalone runners).
  let logged = false;
  while (true) {
    let passTotal = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (!(await processOne())) return;
        passTotal += 1;
      }
    };
    if (!logged) {
      console.log(`Paper Knowledge pipeline — draining amends + diagram plans, concurrency ${concurrency}${scopeNote}`);
      logged = true;
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (passTotal > 0) continue;
    await sleep(2000);
    if (!(await processOne())) break;
  }

  if (summary.attempted === 0) {
    console.log(`Paper Knowledge pipeline — nothing pending${scopeNote}.`);
  } else {
    console.log(
      `Paper Knowledge pipeline done — attempted: ${summary.attempted}, amend ready: ${summary.amendReady}, plan ready: ${summary.planReady}, failed: ${summary.failed}`
    );
  }
  return summary;
}
