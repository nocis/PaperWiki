/**
 * Knowledge compile steps: cluster pieces into topics (LLM 1), synthesize +
 * review each article (LLM 2), write it atomically, wipe stale articles, and
 * rebuild the derived files.
 *
 * Step ids match the knowledge run catalog (runKnowledgeStep events).
 */
import * as fs from "fs/promises";
import * as path from "path";
import matter from "gray-matter";
import { llmJson } from "../../src/lib/llm";
import {
  appendKnowledgeLog,
  deriveKnowledgeDb,
  KNOWLEDGE_ARTICLES_DIR,
  regenKnowledgeIndex,
  type KnowledgeArticleFrontmatter,
} from "../../src/lib/knowledge";
import { renderKnowledgeArticleBody } from "../../src/lib/templates";
import {
  knowledgeArticlePrompt,
  knowledgeClusterPrompt,
  type KnowledgeArticleResponse,
  type KnowledgeClusterArticle,
} from "../../src/lib/prompts";
import { runKnowledgeStep } from "../../src/lib/runs";
import { validateCluster } from "./helpers";
import type { KnowledgeCompileContext } from "./context";

/** Cluster pass output bound. */
const CLUSTER_MAX_TOKENS = 12_000;
/** Per-article synthesize + review output bound. */
const ARTICLE_MAX_TOKENS = 14_000;

/** LLM 1: cluster pieces into overlapping topics. */
export async function clusterPieces(ctx: KnowledgeCompileContext): Promise<KnowledgeClusterArticle[]> {
  return runKnowledgeStep("cluster-pieces", "Cluster pieces into topics (LLM)", async () => {
    const prompt = knowledgeClusterPrompt({
      pieces: ctx.pieces.map((p) => ({ slug: p.fm.slug, kind: p.fm.kind, topics: p.fm.topics ?? [], body: p.body })),
      papers: ctx.papersText,
      topics: ctx.topicsText,
      language: ctx.language,
    });
    const raw = await llmJson<{ articles?: unknown }>({
      provider: ctx.provider,
      model: ctx.model,
      ...prompt,
      maxTokens: CLUSTER_MAX_TOKENS,
      temperature: 0.2,
    });
    return validateCluster(raw, new Set(ctx.pieces.map((p) => p.fm.slug)), new Set(ctx.wikiDb.papers.map((p) => p.slug)));
  });
}

/**
 * LLM 2 per article: synthesize + academic review against wiki truth.
 * Grounding entries are code-side filtered to known wiki papers.
 */
export async function synthesizeReview(
  ctx: KnowledgeCompileContext,
  article: KnowledgeClusterArticle
): Promise<KnowledgeArticleResponse> {
  return runKnowledgeStep(
    "synthesize-review",
    "Synthesize and review article (LLM)",
    async () => {
      const prompt = knowledgeArticlePrompt({
        title: article.title,
        definition: article.definition,
        pieces: article.pieceSlugs.map((s) => ({ slug: s, body: ctx.pieceBySlug.get(s)?.body ?? "" })),
        papers: ctx.papersText,
        topics: ctx.topicsText,
        language: ctx.language,
      });
      const raw = await llmJson<KnowledgeArticleResponse>({
        provider: ctx.provider,
        model: ctx.model,
        ...prompt,
        maxTokens: ARTICLE_MAX_TOKENS,
        temperature: 0.2,
      });
      const grounding = Array.isArray(raw.grounding)
        ? raw.grounding
            .filter((g) => g && typeof g.slug === "string" && ctx.wikiDb.papers.some((p) => p.slug === g.slug))
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
}

/** Persist one article atomically (tmp + rename). Favorites keep their flag. */
export async function writeArticle(
  ctx: KnowledgeCompileContext,
  article: KnowledgeClusterArticle,
  response: KnowledgeArticleResponse,
  compiledAt: string
): Promise<void> {
  const fm: KnowledgeArticleFrontmatter = {
    slug: article.slug,
    title: article.title,
    compiledAt,
    pieceSlugs: article.pieceSlugs,
    paperSlugs: article.paperSlugs,
    relatedArticles: article.relatedArticleSlugs ?? [],
    ...(ctx.existingFavoriteSlugs.has(article.slug) ? { favorite: true } : {}),
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
}

/** Wipe previously compiled articles not in this run's cluster (favorites kept). */
export async function wipeStaleArticles(
  ctx: KnowledgeCompileContext,
  writtenSlugs: Set<string>
): Promise<string[]> {
  const candidates = ctx.existingArticles.filter(
    (a) => !writtenSlugs.has(a.fm.slug) && a.fm.favorite !== true
  );
  if (candidates.length === 0) return [];
  return runKnowledgeStep(
    "wipe-stale-articles",
    `Wipe stale compiled articles (${candidates.length}) — favorites kept`,
    async () => {
      for (const a of candidates) {
        await fs.rm(a.filePath, { force: true });
      }
      return candidates.map((a) => a.fm.slug);
    }
  );
}

/** Rebuild the derived index + log from the fresh state. */
export async function rebuildDerived(
  ctx: KnowledgeCompileContext,
  cluster: KnowledgeClusterArticle[],
  removed: string[]
): Promise<void> {
  return runKnowledgeStep("rebuild-derived", "Rebuild knowledge index and database", async () => {
    const db = await deriveKnowledgeDb();
    await regenKnowledgeIndex(db, ctx.wikiDb);

    const details = [
      `articles: ${cluster.map((a) => a.slug).join(", ")}`,
      `provider: ${ctx.provider.id} · model: ${ctx.model}`,
    ];
    if (removed.length > 0) details.push(`wiped stale: ${removed.join(", ")}`);
    await appendKnowledgeLog(
      "knowledge-compile",
      `Compiled ${cluster.length} topic article(s) from ${ctx.pieces.length} piece(s)`,
      details
    );
  });
}
