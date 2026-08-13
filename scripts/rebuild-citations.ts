/**
 * PaperWiki citation map rebuilder.
 *
 * Usage: yarn citations [--provider <id>] [--model <id>] [--slug <slug> ...]
 *
 * Semantics:
 * - Reads every compiled paper (or only the --slug ones); for each paper the
 *   reference list extracted by the analyze LLM at compile time (persisted in
 *   the map entry) is re-parsed + re-matched against the compiled index in ONE
 *   dedicated LLM call (per-paper, bounded context). The PDF is never re-read;
 *   the reference list is LLM-extracted only.
 * - Papers with no persisted reference list are skipped.
 * - Fail-hard on LLM errors (mirrors compile): the run aborts, map + pages
 *   updated so far persist.
 * - After the per-paper pass, citedBy[] is recomputed globally so
 *   cites/citedBy reciprocity holds; paper pages' ## Citations sections and
 *   cites[] frontmatter are rewritten from the map.
 *
 * The pipeline lives in scripts/citations/pipeline.ts; this file is the CLI
 * driver (run lifecycle + preflight).
 */
import { errorMessage, parseCitationsArgs } from "./lib/cli-utils";
import { llmHealthCheck, resolveModel, resolveProvider } from "../src/lib/llm";
import { readPaperPages } from "../src/lib/wiki";
import {
  finishCitationsRun,
  resumeCitationsRun,
  runCitationsStep,
  startCitationsRun,
  updateCitationsRun,
} from "../src/lib/runs";
import { rebuildCitations } from "./citations/pipeline";

async function main(): Promise<void> {
  const args = parseCitationsArgs(process.argv.slice(2));
  const provider = resolveProvider(args.provider);
  const model = resolveModel(provider, args.model);

  const pages = await readPaperPages();
  const bySlug = new Map(pages.map((p) => [p.fm.slug, p]));
  const allSlugs = pages.map((p) => p.fm.slug).sort();
  const slugs =
    args.slugs.length > 0
      ? [...new Set(args.slugs.filter((s) => bySlug.has(s)))].sort()
      : allSlugs;
  const scope = args.slugs.length > 0 ? args.slugs.join(",") : "all";
  const index = pages.map((p) => ({ slug: p.fm.slug, title: p.fm.title, publishedAt: p.fm.publishedAt }));

  const uiRunId = process.env.PAPERWIKI_CITATIONS_RUN_ID;
  if (uiRunId) {
    // The API route already recorded run-started and wrote the snapshot.
    resumeCitationsRun(uiRunId);
  } else {
    await startCitationsRun({
      source: "cli",
      provider: provider.id,
      model,
      scope,
    });
  }
  await updateCitationsRun({ totals: { papers: slugs.length } });

  // Pre-flight: fail before touching anything if the LLM is unreachable.
  try {
    await runCitationsStep("llm-preflight", "Check LLM connectivity", () => llmHealthCheck(provider, model));
    console.log("LLM pre-flight check... ok");
  } catch (err) {
    const message = errorMessage(err);
    console.error(`\n✗ LLM pre-flight failed: ${message}`);
    await finishCitationsRun("failed", `LLM pre-flight failed: ${message}`);
    throw err;
  }

  if (slugs.length === 0) {
    const message = "no compiled papers to rebuild citations for.";
    console.log(message);
    await finishCitationsRun("completed", message);
    return;
  }

  console.log(`Citation rebuild — provider: ${provider.id} · model: ${model} · papers: ${slugs.length}`);

  try {
    const result = await rebuildCitations({ slugs, allSlugs, pages, pagesBySlug: bySlug, provider, model, index });
    await finishCitationsRun("completed", `Rebuilt ${result.rebuilt} paper(s); ${result.matched}/${result.total} citations linked.`);
  } catch (err) {
    await finishCitationsRun("failed", errorMessage(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✗ citation rebuild failed: ${errorMessage(err)}`);
  process.exit(1);
});
