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
 */
import * as fs from "fs/promises";
import * as path from "path";
import matter from "gray-matter";
import { llmHealthCheck, llmJson, resolveModel, resolveProvider, type LLMProviderDef } from "../src/lib/llm";
import {
  ensureKnowledgeDirs,
  appendKnowledgeLog,
  deriveKnowledgeDb,
  readPieces,

  regenKnowledgeIndex,
  writePiece,
  KNOWLEDGE_ARTICLES_DIR,
} from "../src/lib/knowledge";
import { deriveDb, loadDb } from "../src/lib/wiki";
import { renderKnowledgeArticleBody } from "../src/lib/templates";
import {
  knowledgeArticlePrompt,
  knowledgeClusterPrompt,
  type KnowledgeArticleResponse,
  type KnowledgeClusterArticle,
} from "../src/lib/prompts";
import {
  finishKnowledgeRun,
  recordKnowledgeEvent,
  resumeKnowledgeRun,
  startKnowledgeRun,
  updateKnowledgeRun,
} from "../src/lib/runs";

const LANGUAGE = "en";

function parseArgs(argv: string[]): { provider?: string; model?: string } {
  const out: { provider?: string; model?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider" && argv[i + 1]) out.provider = argv[i + 1];
    else if (argv[i].startsWith("--provider=")) out.provider = argv[i].slice("--provider=".length);
    else if (argv[i] === "--model" && argv[i + 1]) out.model = argv[i + 1];
    else if (argv[i].startsWith("--model=")) out.model = argv[i].slice("--model=".length);
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Compact wiki paper index for grounding prompts (bounded). */
function papersIndexText(papers: { slug: string; title: string; venue: string; publishedAt: string; essence: string }[]): string {
  return papers
    .slice(0, 60)
    .map((p) => `- [[${p.slug}]] — "${p.title}" (${p.venue}, ${p.publishedAt}): ${truncate(p.essence, 140)}`)
    .join("\n");
}

function topicsTreeText(topics: { slug: string; name: string; definition: string }[]): string {
  return topics
    .slice(0, 60)
    .map((t) => `- [[${t.slug}]] — ${t.name}: ${truncate(t.definition, 120)}`)
    .join("\n");
}

/** Validate + normalize the cluster response code-side. */
function validateCluster(
  raw: { articles?: unknown },
  pieceSlugs: Set<string>,
  paperSlugs: Set<string>
): KnowledgeClusterArticle[] {
  if (!Array.isArray(raw.articles)) throw new Error("knowledge cluster: missing articles array");
  const seenSlugs = new Set<string>();
  const articles: KnowledgeClusterArticle[] = [];

  for (const a of raw.articles) {
    if (typeof a !== "object" || a === null) continue;
    const entry = a as Record<string, unknown>;
    const slug = typeof entry.slug === "string" ? entry.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "";
    if (!slug || slug.length > 100 || seenSlugs.has(slug)) continue;
    const pieceList = Array.isArray(entry.pieceSlugs)
      ? (entry.pieceSlugs as unknown[]).filter((s): s is string => typeof s === "string" && pieceSlugs.has(s))
      : [];
    const paperList = Array.isArray(entry.paperSlugs)
      ? (entry.paperSlugs as unknown[]).filter((s): s is string => typeof s === "string" && paperSlugs.has(s))
      : [];
    if (pieceList.length === 0) continue; // empty articles are dropped
    seenSlugs.add(slug);
    articles.push({
      slug,
      title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : slug,
      definition: typeof entry.definition === "string" ? entry.definition.trim() : "",
      pieceSlugs: [...new Set(pieceList)],
      paperSlugs: [...new Set(paperList)],
    });
  }

  // Overlap-derived related-article links (deterministic).
  const related = new Map<string, string[]>();
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const sharesPiece = articles[i].pieceSlugs.some((s) => articles[j].pieceSlugs.includes(s));
      if (sharesPiece) {
        related.set(articles[i].slug, [...(related.get(articles[i].slug) ?? []), articles[j].slug]);
        related.set(articles[j].slug, [...(related.get(articles[j].slug) ?? []), articles[i].slug]);
      }
    }
  }

  return articles.map((a) => ({ ...a, relatedArticleSlugs: related.get(a.slug) ?? [] }));
}

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

    await recordKnowledgeEvent({ step: "prepare-dirs", label: "Prepare knowledge directories", status: "started" });
    await ensureKnowledgeDirs();
    await recordKnowledgeEvent({ step: "prepare-dirs", label: "Prepare knowledge directories", status: "completed" });

    await recordKnowledgeEvent({ step: "llm-preflight", label: "Check LLM connectivity", status: "started" });
    await llmHealthCheck(provider, model);
    await recordKnowledgeEvent({ step: "llm-preflight", label: "Check LLM connectivity", status: "completed" });
    console.log("LLM pre-flight check... ok");

    const pieces = await recordKnowledgeEventStep("read-pieces", "Read knowledge pieces", () => readPieces());

    if (pieces.length === 0) {
      const message = "knowledge/pieces/ is empty — nothing to compile.";
      console.log(message);
      await finishKnowledgeRun("completed", message);
      return;
    }

    const wikiDb = await recordKnowledgeEventStep("read-wiki", "Read wiki ground truth", () => deriveDb());
    await updateKnowledgeRun({ totals: { pieces: pieces.length } });
    console.log(`Pieces: ${pieces.length} · wiki: ${wikiDb.papers.length} paper(s), ${wikiDb.topics.length} topic(s)`);

    // --- LLM 1: cluster -------------------------------------------------------
    const cluster = await recordKnowledgeEventStep("cluster-pieces", "Cluster pieces into topics (LLM)", async () => {
      const prompt = knowledgeClusterPrompt({
        pieces: pieces.map((p) => ({ slug: p.fm.slug, kind: p.fm.kind, topics: p.fm.topics ?? [], body: p.body })),
        papers: papersIndexText(wikiDb.papers),
        topics: topicsTreeText(wikiDb.topics),
        language: LANGUAGE,
      });
      const raw = await llmJson<{ articles?: unknown }>({
        provider,
        model,
        ...prompt,
        maxTokens: 12000,
        temperature: 0.2,
      });
      return validateCluster(raw, new Set(pieces.map((p) => p.fm.slug)), new Set(wikiDb.papers.map((p) => p.slug)));
    });

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

    const pieceBySlug = new Map(pieces.map((p) => [p.fm.slug, p]));
    const papersText = papersIndexText(wikiDb.papers);
    const topicsText = topicsTreeText(wikiDb.topics);

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
        const response = await recordKnowledgeEventStep(
          "synthesize-review",
          "Synthesize and review article (LLM)",
          async () => {
            const prompt = knowledgeArticlePrompt({
              title: article.title,
              definition: article.definition,
              pieces: article.pieceSlugs.map((s) => ({ slug: s, body: pieceBySlug.get(s)?.body ?? "" })),
              papers: papersText,
              topics: topicsText,
              language: LANGUAGE,
            });
            const raw = await llmJson<KnowledgeArticleResponse>({
              provider,
              model,
              ...prompt,
              maxTokens: 14000,
              temperature: 0.2,
            });
            const grounding = Array.isArray(raw.grounding)
              ? raw.grounding
                  .filter((g) => g && typeof g.slug === "string" && wikiDb.papers.some((p) => p.slug === g.slug))
                  .map((g) => ({
                    slug: g.slug,
                    status: (["supports", "contradicts", "unaddressed"].includes(g.status)
                      ? g.status
                      : "unaddressed") as KnowledgeArticleResponse["grounding"][number]["status"],
                    note: typeof g.note === "string" ? g.note : "",
                  }))
              : [];
            return { ...raw, grounding };
          },
          { slug: article.slug }
        );

        const fm = {
          slug: article.slug,
          title: article.title,
          compiledAt,
          pieceSlugs: article.pieceSlugs,
          paperSlugs: article.paperSlugs,
          relatedArticles: article.relatedArticleSlugs ?? [],
        };
        const body = renderKnowledgeArticleBody({
          definition: response.definition || article.definition,
          synthesis: response.synthesis || `_No synthesis provided._`,
          grounding: response.grounding,
          novelty: response.novelty || "",
          critique: response.critique || "",
          limitations: response.limitations || "",
          frontier: response.frontier || "",
          relatedArticles: article.relatedArticleSlugs ?? [],
        });
        const filePath = path.join(KNOWLEDGE_ARTICLES_DIR, `${article.slug}.md`);
        const tmpPath = `${filePath}.tmp`;
        await fs.writeFile(tmpPath, matter.stringify(body.trim() + "\n", fm));
        await fs.rename(tmpPath, filePath);

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

    // --- Derived files -----------------------------------------------------------
    await recordKnowledgeEventStep("rebuild-derived", "Rebuild knowledge index and database", async () => {
      const db = await deriveKnowledgeDb();
      await regenKnowledgeIndex(db, wikiDb);

      await appendKnowledgeLog("knowledge-compile", `Compiled ${cluster.length} topic article(s) from ${pieces.length} piece(s)`, [
        `articles: ${cluster.map((a) => a.slug).join(", ")}`,
        `provider: ${provider.id} · model: ${model}`,
      ]);
    });

    await finishKnowledgeRun("completed", `Compiled ${cluster.length} article(s) from ${pieces.length} piece(s).`);
    console.log(`\nDone. ${cluster.length} article(s) compiled from ${pieces.length} piece(s).`);
  } catch (err) {
    await finishKnowledgeRun("failed", errorMessage(err));
    throw err;
  }
}

/** Wrap a step with started/completed/failed events (keeps the code lean). */
async function recordKnowledgeEventStep<T>(
  step: string,
  label: string,
  work: () => Promise<T>,
  ctx: { slug?: string } = {}
): Promise<T> {
  const startedAt = Date.now();
  await recordKnowledgeEvent({ step, label, status: "started", slug: ctx.slug });
  try {
    const result = await work();
    await recordKnowledgeEvent({ step, label, status: "completed", durationMs: Date.now() - startedAt, slug: ctx.slug });
    return result;
  } catch (err) {
    await recordKnowledgeEvent({
      step,
      label,
      status: "failed",
      durationMs: Date.now() - startedAt,
      slug: ctx.slug,
      message: errorMessage(err),
    });
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✗ knowledge compile failed: ${errorMessage(err)}`);
  process.exit(1);
});
