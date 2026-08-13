/**
 * Analysis phase: the deep LLM pass over the full text, the citation-map
 * persistence, and best-effort figure extraction.
 *
 * Step ids match COMPILE_STEP_CATALOG.paper exactly.
 */
import { llmJson } from "../../../src/lib/llm";
import { extractFigures as extractPdfFigures, type FigureInfo } from "../../../src/lib/extract-figures";
import { kbIndexText, topicTreeText, validateClassification } from "../helpers";
import { updatePaperCitations } from "../../../src/lib/citations";
import { paperMergedPrompt, type PaperMergedResponse } from "../../../src/lib/prompts";
import { runCompileStep } from "../../../src/lib/runs";
import { DEEP_MAX_TOKENS } from "../budgets";
import type { PaperCompileContext } from "../context";

/**
 * LLM 3: deep analysis + classification (full text). Title + essence are
 * fixed facts from phase A — the deep call builds on them and never re-derives
 * them. Everything else (contributions, relations, bibliography,
 * classification) is grounded in the full paper text.
 */
export async function analyzeClassify(ctx: PaperCompileContext): Promise<PaperMergedResponse> {
  return runCompileStep(
    "analyze-classify",
    "Analyze and classify with LLM",
    async () => {
      const prompt = paperMergedPrompt({
        text: ctx.extracted.text,
        metaTitle: ctx.extracted.metaTitle,
        kbIndex: kbIndexText(ctx.db, ctx.extraction.title),
        topicTree: topicTreeText(ctx.db),
        language: ctx.language,
        knownTitle: ctx.extraction.title,
        knownEssence: ctx.extraction.essence,
      });
      const raw = await llmJson<PaperMergedResponse>({
        provider: ctx.provider,
        model: ctx.model,
        ...prompt,
        // Reasoning models spend budget on reasoning_content first — headroom
        // is required or long-reasoning runs truncate to an empty content.
        maxTokens: DEEP_MAX_TOKENS,
        temperature: 0.2,
      });
      return {
        ...raw,
        classification: validateClassification(raw.classification, ctx.db),
      };
    },
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}

/**
 * Citation records: persisted raw list, records built at end-of-run. The deep
 * call extracts the FULL bibliography; normalization + matching against the
 * (complete) final index happens in the end-of-run finalize pass
 * (remapPaperCitations) so relations exist at compile time.
 */
export async function writeCitationMap(ctx: PaperCompileContext): Promise<void> {
  return runCompileStep(
    "write-citation-map",
    "Persist reference list to citation map",
    async () => {
      await updatePaperCitations(ctx.slug, {
        rawReferences: ctx.rawReferences,
        provider: ctx.provider.id,
        model: ctx.model,
        citations: [],
      });
    },
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}

/** Figure extraction (best-effort, never aborts the run). */
export async function extractFigures(ctx: PaperCompileContext): Promise<FigureInfo[]> {
  return runCompileStep(
    "extract-figures",
    "Extract figures",
    () => extractPdfFigures(ctx.pdfPath, ctx.slug),
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}
