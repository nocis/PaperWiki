/**
 * PaperWiki knowledge compiler.
 *
 * Usage: tsx scripts/compile-knowledge.ts [--provider <id>] [--model <id>]
 *
 * Semantics (see wiki/SCHEMA.md — Knowledge layer):
 * - FROM-ZERO build: reads ALL knowledge/pieces/*.md + the latest wiki
 *   (literature ground truth) and regenerates knowledge/articles/*.md,
 *   knowledge/index.md and knowledge/log.md. The web UI derives its view
 *   live from the markdown; no separate db file.
 * - Two LLM passes: (1) cluster pieces into overlapping topics, then
 *   (2) per article, synthesize + academic review against wiki truth.
 * - Never writes wiki/ pages, never reads comments/.
 * - Fail-hard on LLM errors; articles are derived — no merge state.
 *
 * Steps live in scripts/knowledge/; this file is the CLI driver.
 */
import { errorMessage, parseArgs } from "./lib/cli-utils";
import { llmHealthCheck, resolveModel, resolveProvider } from "../src/lib/llm";
import { ensureKnowledgeDirs, readArticles, readPieces } from "../src/lib/knowledge";
import { deriveDb } from "../src/lib/wiki";
import {
  finishKnowledgeRun,
  recordKnowledgeEvent,
  resumeKnowledgeRun,
  runKnowledgeStep,
  startKnowledgeRun,
  updateKnowledgeRun,
} from "../src/lib/runs";
import { papersIndexText, topicsTreeText } from "./knowledge/helpers";
import type { KnowledgeCompileContext } from "./knowledge/context";
import {
  clusterPieces,
  rebuildDerived,
  synthesizeReview,
  wipeStaleArticles,
  writeArticle,
} from "./knowledge/steps";

const LANGUAGE = "en";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const provider = resolveProvider(args.provider);
  const model = resolveModel(provider, args.model);

  const uiRunId = process.env.PAPERWIKI_KNOWLEDGE_RUN_ID;
  if (uiRunId) {
    resumeKnowledgeRun(uiRunId);
  } else {
    await startKnowledgeRun({ source: "cli", provider: provider.id, model });
  }

  try {
    console.log(`PaperWiki knowledge compile — provider: ${provider.id} · model: ${model}`);

    await runKnowledgeStep("prepare-dirs", "Prepare knowledge directories", () => ensureKnowledgeDirs());

    await runKnowledgeStep("llm-preflight", "Check LLM connectivity", () => llmHealthCheck(provider, model));
    console.log("LLM pre-flight check... ok");

    const pieces = await runKnowledgeStep("read-pieces", "Read knowledge pieces", () => readPieces());

    if (pieces.length === 0) {
      const message = "knowledge/pieces/ is empty — nothing to compile.";
      console.log(message);
      await finishKnowledgeRun("completed", message);
      return;
    }

    const wikiDb = await runKnowledgeStep("read-wiki", "Read wiki ground truth", () => deriveDb());
    await updateKnowledgeRun({ totals: { pieces: pieces.length } });
    console.log(`Pieces: ${pieces.length} · wiki: ${wikiDb.papers.length} paper(s), ${wikiDb.topics.length} topic(s)`);

    const existingArticles = await readArticles();
    const ctx: KnowledgeCompileContext = {
      provider,
      model,
      language: LANGUAGE,
      pieces,
      wikiDb,
      pieceBySlug: new Map(pieces.map((p) => [p.fm.slug, p])),
      papersText: papersIndexText(wikiDb.papers),
      topicsText: topicsTreeText(wikiDb.topics),
      existingArticles,
      // Favorites are archived: they survive the wipe below, and a re-generated
      // article keeps its favorite flag.
      existingFavoriteSlugs: new Set(
        existingArticles.filter((a) => a.fm.favorite === true).map((a) => a.fm.slug)
      ),
    };

    // --- LLM 1: cluster -------------------------------------------------------
    const cluster = await clusterPieces(ctx);

    if (cluster.length === 0) {
      const message = "Clustering produced no articles — nothing to write.";
      console.log(message);
      await finishKnowledgeRun("completed", message);
      return;
    }

    await updateKnowledgeRun({ totals: { articles: cluster.length } });
    console.log(`Cluster: ${cluster.length} article(s)`);
    for (const a of cluster) {
      console.log(`  - ${a.slug} (${a.pieceSlugs.length} piece${a.pieceSlugs.length === 1 ? "" : "s"})${a.paperSlugs.length > 0 ? ` → ${a.paperSlugs.join(", ")}` : ""}`);
    }

    // --- LLM 2 per article: synthesize + review --------------------------------
    const compiledAt = new Date().toISOString();
    for (let i = 0; i < cluster.length; i++) {
      const article = cluster[i];
      console.log(`\n[${i + 1}/${cluster.length}] ${article.title}`);
      await recordKnowledgeEvent({
        step: "article-started",
        label: `Write article ${i + 1} of ${cluster.length}`,
        status: "started",
        slug: article.slug,
      });

      try {
        const response = await synthesizeReview(ctx, article);
        await writeArticle(ctx, article, response, compiledAt);

        await recordKnowledgeEvent({
          step: "article-finished",
          label: "Article written",
          status: "completed",
          slug: article.slug,
          message: `knowledge/articles/${article.slug}.md`,
        });
        console.log(`  ✓ written -> knowledge/articles/${article.slug}.md`);
      } catch (err) {
        await recordKnowledgeEvent({
          step: "article-finished",
          label: "Article failed",
          status: "failed",
          slug: article.slug,
          message: errorMessage(err),
        });
        throw err;
      }
    }

    // --- Wipe previously compiled articles (favorites kept) -------------------
    const removed = await wipeStaleArticles(ctx, new Set(cluster.map((a) => a.slug)));
    if (removed.length > 0) {
      console.log(`Wiped ${removed.length} stale article(s): ${removed.join(", ")}`);
    }

    // --- Derived files -----------------------------------------------------------
    await rebuildDerived(ctx, cluster, removed);

    await finishKnowledgeRun("completed", `Compiled ${cluster.length} article(s) from ${pieces.length} piece(s).`);
    console.log(`\nDone. ${cluster.length} article(s) compiled from ${pieces.length} piece(s).`);
  } catch (err) {
    await finishKnowledgeRun("failed", errorMessage(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✗ knowledge compile failed: ${errorMessage(err)}`);
  process.exit(1);
});
