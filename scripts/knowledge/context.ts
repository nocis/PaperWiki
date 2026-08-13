/**
 * Mutable per-run state for the knowledge compile pipeline steps.
 */
import type { LLMProviderDef } from "../../src/lib/llm";
import type { KnowledgeArticle, KnowledgePiece } from "../../src/lib/knowledge";
import type { WikiDb } from "../../src/lib/wiki";

export interface KnowledgeCompileContext {
  provider: LLMProviderDef;
  model: string;
  language: string;
  pieces: KnowledgePiece[];
  wikiDb: WikiDb;
  pieceBySlug: Map<string, KnowledgePiece>;
  papersText: string;
  topicsText: string;
  existingArticles: KnowledgeArticle[];
  existingFavoriteSlugs: Set<string>;
}
