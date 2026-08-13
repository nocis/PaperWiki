/**
 * Mutable per-paper state threaded through the compile pipeline steps.
 *
 * Steps read and update this record in catalog order (see scripts/compile.ts);
 * the field names mirror the step results so the driver reads like the pipeline.
 */
import type { LLMProviderDef } from "../../src/lib/llm";
import type { ExtractedPaper } from "../../src/lib/extract";
import type { FigureInfo } from "../../src/lib/extract-figures";
import type { DbPaper, TopicPage, WikiDb } from "../../src/lib/wiki";
import type { PaperMergedResponse, TitleEssence } from "../../src/lib/prompts";

/** Event scope fields attached to every compile event of one paper. */
export type PaperEventCtx = {
  scope: "paper";
  paperIndex: number;
  paperTotal: number;
  file: string;
};

export interface PaperCompileContext {
  provider: LLMProviderDef;
  model: string;
  pdfPath: string;
  basename: string;
  filenameSlug: string;
  language: string;
  paperCtx: PaperEventCtx;
  db: WikiDb;
  extracted: ExtractedPaper;
  extraction: TitleEssence & { retriedTitle: string };
  slug: string;
  collidingPaper: DbPaper | null;
  analysis: PaperMergedResponse;
  rawReferences: string[];
  figures: FigureInfo[];
  topicPage: TopicPage;
  milestone: string;
  subtopic: string | null;
}
