/**
 * LLM response schemas for the wiki pipeline prompts.
 *
 * Types only — the prompt builders and policy constants live in prompts.ts.
 */

export interface DeepAnalysis {
  authors: string[];
  venue: string;
  publishedAt: string; // YYYY-MM or ""
  contributions: string[];
  /** Contrastive: prior = the field's received view; update = what this paper changes. */
  novelInsight: { prior: string; update: string };
  limitations: string;
  researchFrontier: string;
  references: string[];
  predecessors: { slug: string; relation: string; note: string }[];
  evolutionaryChain: { role: "origin" | "intermediate" | "terminal" | "fork"; note: string };
  crossDomainOrigin: string | null;
  crossTopicImpacts: { slug: string; note: string }[];
  contradictions: { slug: string; note: string }[];
  relationsContext: string;
}

export interface Classification {
  action: "assign" | "create";
  topicSlug?: string;
  subtopicSlug?: string | null;
  topic?: {
    slug: string;
    name: string;
    definition: string;
    parentSlug: string | null;
    tags: string[];
  };
  reason: string;
}

export interface PaperMergedResponse extends DeepAnalysis {
  classification: Classification;
}

export interface TitleEssence {
  title: string;
  essence: string;
}

export interface DedupScreen {
  /** Slug of the paper the incoming IS a duplicate of, or null when not a duplicate. */
  slug: string | null;
  /** 0-1 same-document confidence. 0 when nothing resembles. */
  score: number;
}

export interface TopicMergePair {
  slugA: string;
  slugB: string;
  reason: string;
}

export interface TopicSynthesis {
  definition: string;
  keyProperties: string[];
  chronologicalEvolution: string | null;
  subtopicNotes: Record<string, { definition: string; keyProperties: string[] }>;
}

export interface QueryRetrieval {
  pages: string[];
  papers: string[];
}

export interface CitationMapResponse {
  citations: {
    /** 1-based position of the entry in the numbered reference list. */
    entry: number;
    matchedSlug: string;
  }[];
}

export interface KnowledgeClusterArticle {
  slug: string;
  title: string;
  definition: string;
  pieceSlugs: string[];
  paperSlugs: string[];
  /** Code-side, overlap-derived after the cluster response is validated. */
  relatedArticleSlugs?: string[];
}

export interface KnowledgeClusterResponse {
  articles: KnowledgeClusterArticle[];
}

export interface KnowledgeArticleResponse {
  definition: string;
  /** Markdown body of the ## Synthesis section — claims cite [[piece-slug]]. */
  synthesis: string;
  /** Evidence mapping of the article's claims against wiki papers. */
  grounding: { slug: string; status: "supports" | "contradicts" | "unaddressed"; note: string }[];
  novelty: string;
  critique: string;
  limitations: string;
  frontier: string;
}

export interface RelationFinalizeResponse {
  relations: { relation: string; slug: string; note: string }[];
}
