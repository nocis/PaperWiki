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
 */
import { llmHealthCheck, resolveModel, resolveProvider, type LLMProviderDef } from "../src/lib/llm";
import {
  citationCoverage,
  readCitationMap,
  recomputeCitedBy,
  remapPaperCitations,
} from "../src/lib/citations";
import {
  appendLog,
  readPaperPages,
  type PaperPage,
} from "../src/lib/wiki";
import {
  finishCitationsRun,
  recordCitationsEvent,
  resumeCitationsRun,
  startCitationsRun,
  updateCitationsRun,
} from "../src/lib/runs";

function parseArgs(argv: string[]): { provider?: string; model?: string; slugs: string[] } {
  const out: { provider?: string; model?: string; slugs: string[] } = { slugs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider" && argv[i + 1]) {
      out.provider = argv[i + 1];
    } else if (argv[i].startsWith("--provider=")) {
      out.provider = argv[i].slice("--provider=".length);
    } else if (argv[i] === "--model" && argv[i + 1]) {
      out.model = argv[i + 1];
    } else if (argv[i].startsWith("--model=")) {
      out.model = argv[i].slice("--model=".length);
    } else if (argv[i] === "--slug" && argv[i + 1]) {
      out.slugs.push(argv[i + 1]);
    } else if (argv[i].startsWith("--slug=")) {
      out.slugs.push(argv[i].slice("--slug=".length));
    }
  }
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

  // Rebuild re-maps the reference list the analyze LLM extracted at compile
  // time (persisted in the map entry). The PDF is never re-read.
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
  await recordCitationsEvent({ step: "llm-preflight", label: "Check LLM connectivity", status: "started" });
  try {
    await llmHealthCheck(provider, model);
    await recordCitationsEvent({ step: "llm-preflight", label: "Check LLM connectivity", status: "completed" });
    console.log("LLM pre-flight check... ok");
  } catch (err) {
    const message = errorMessage(err);
    await recordCitationsEvent({
      step: "llm-preflight",
      label: "Check LLM connectivity",
      status: "failed",
      message,
    });
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
    let rebuilt = 0;
    for (const slug of slugs) {
      try {
        if ((await processPaper(slug, provider, model, index, bySlug)) === "rebuilt") {
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
    console.log(`\nDone. ${rebuilt} paper(s) rebuilt; ${slugs.length - rebuilt} skipped (no bibliography).`);
    console.log(`Citation coverage: ${matched}/${total} linked across ${coverage.filter((r) => !r.missing).length} papers.`);
    await finishCitationsRun("completed", `Rebuilt ${rebuilt} paper(s); ${matched}/${total} citations linked.`);
  } catch (err) {
    await finishCitationsRun("failed", errorMessage(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✗ citation rebuild failed: ${errorMessage(err)}`);
  process.exit(1);
});
