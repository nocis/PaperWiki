/**
 * Citation rebuild pipeline: per-paper re-mapping of the persisted reference
 * lists against the compiled index, then the global citedBy recompute.
 *
 * The run lifecycle (events, totals, finish) lives in
 * scripts/rebuild-citations.ts — this module contains only pipeline work.
 */
import { errorMessage } from "../lib/cli-utils";
import type { LLMProviderDef } from "../../src/lib/llm";
import {
  citationCoverage,
  readCitationMap,
  recomputeCitedBy,
  remapPaperCitations,
} from "../../src/lib/citations";
import { appendLog, type PaperPage } from "../../src/lib/wiki";
import { recordCitationsEvent, updateCitationsRun } from "../../src/lib/runs";

/**
 * Per-paper: re-map the reference list the analyze LLM extracted at compile
 * time (persisted in the map entry). The PDF is never re-read. Papers with no
 * persisted reference list are skipped.
 */
async function processPaper(
  slug: string,
  provider: LLMProviderDef,
  model: string,
  index: { slug: string; title: string; publishedAt: string }[],
  pagesBySlug: Map<string, PaperPage>
): Promise<"rebuilt" | "skipped"> {
  await recordCitationsEvent({
    step: "paper-started",
    label: `Rebuild citations of ${slug}`,
    status: "started",
    slug,
  });

  const map = await readCitationMap();
  const rawReferences = map.papers[slug]?.rawReferences ?? [];
  if (rawReferences.length === 0) {
    await recordCitationsEvent({
      step: "paper-finished",
      label: "Skipped — no extracted reference list",
      status: "skipped",
      message: `${slug}: no reference list extracted at compile time to remap`,
      slug,
    });
    return "skipped";
  }

  const result = await remapPaperCitations({
    slug,
    rawReferences,
    index,
    provider,
    model,
    pagesBySlug,
  });

  await appendLog("citations", pagesBySlug.get(slug)?.fm.title ?? slug, [
    `slug: ${slug}`,
    `linked: ${result.matched}/${result.total}`,
    `provider: ${provider.id} · model: ${model}`,
  ]);
  await recordCitationsEvent({
    step: "paper-finished",
    label: `Citation map rebuilt for ${slug}`,
    status: "completed",
    message: `${result.matched}/${result.total} linked`,
    slug,
  });
  return "rebuilt";
}

interface RebuildCitationsInput {
  slugs: string[];
  allSlugs: string[];
  pages: PaperPage[];
  pagesBySlug: Map<string, PaperPage>;
  provider: LLMProviderDef;
  model: string;
  index: { slug: string; title: string; publishedAt: string }[];
}

interface RebuildCitationsResult {
  rebuilt: number;
  matched: number;
  total: number;
  covered: number;
}

/**
 * Sequential, fail-hard per-paper pass, then global citedBy recompute and
 * coverage summary. The first failure aborts; rebuilt papers persist.
 */
export async function rebuildCitations(input: RebuildCitationsInput): Promise<RebuildCitationsResult> {
  const { slugs, allSlugs, pages, pagesBySlug, provider, model, index } = input;
  let rebuilt = 0;
  for (const slug of slugs) {
    try {
      if ((await processPaper(slug, provider, model, index, pagesBySlug)) === "rebuilt") {
        rebuilt += 1;
      }
    } catch (err) {
      const message = errorMessage(err);
      await recordCitationsEvent({
        step: "paper-finished",
        label: `Citation rebuild failed for ${slug}`,
        status: "failed",
        message,
        slug,
      });
      // Keep the event-driven rebuilt/skipped totals; mark the failure.
      await updateCitationsRun({ totals: { failed: 1 } });
      console.error(`\n✗ ABORT: ${slug} — ${message}`);
      console.error(
        `${rebuilt} paper(s) rebuilt; ${slugs.length - rebuilt} remain for the next run.`
      );
      throw err;
    }
  }

  const reciprocityChanges = await recomputeCitedBy(pages);
  if (reciprocityChanges > 0) {
    await appendLog("citations", "citedBy reciprocity", [`updated ${reciprocityChanges} paper(s)`]);
    console.log(`  citedBy reciprocity: ${reciprocityChanges} paper(s) updated`);
  }

  const coverage = citationCoverage(await readCitationMap(), allSlugs);
  const total = coverage.reduce((s, r) => s + r.total, 0);
  const matched = coverage.reduce((s, r) => s + r.matched, 0);
  const covered = coverage.filter((r) => !r.missing).length;
  console.log(`\nDone. ${rebuilt} paper(s) rebuilt; ${slugs.length - rebuilt} skipped (no bibliography).`);
  console.log(`Citation coverage: ${matched}/${total} linked across ${covered} papers.`);
  return { rebuilt, matched, total, covered };
}
