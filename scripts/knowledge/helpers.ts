/**
 * Knowledge-compile helpers: bounded context slices for the LLM prompts and
 * the code-side cluster validation.
 */
import { truncate } from "../lib/cli-utils";
import type { KnowledgeClusterArticle } from "../../src/lib/prompts";

/** Compact wiki paper index for grounding prompts (bounded). */
export function papersIndexText(
  papers: { slug: string; title: string; venue: string; publishedAt: string; essence: string }[]
): string {
  return papers
    .slice(0, 60)
    .map((p) => `- [[${p.slug}]] — "${p.title}" (${p.venue}, ${p.publishedAt}): ${truncate(p.essence, 140)}`)
    .join("\n");
}

export function topicsTreeText(topics: { slug: string; name: string; definition: string }[]): string {
  return topics
    .slice(0, 60)
    .map((t) => `- [[${t.slug}]] — ${t.name}: ${truncate(t.definition, 120)}`)
    .join("\n");
}

/** Validate + normalize the cluster response code-side. */
export function validateCluster(
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
