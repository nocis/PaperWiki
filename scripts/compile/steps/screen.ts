/**
 * Screening phase: establish the paper's identity and decide whether it is
 * already compiled (title + essence, canonical slug, dedup screen).
 *
 * Step ids match COMPILE_STEP_CATALOG.paper exactly.
 */
import { llmJson } from "../../../src/lib/llm";
import { isGarbageName, historyRecordSlice, resolveCanonicalSlug } from "../helpers";
import { slugify, type DbPaper } from "../../../src/lib/wiki";
import { dedupScreenPrompt, titleEssencePrompt, type DedupScreen, type TitleEssence } from "../../../src/lib/prompts";
import { recordCompileEvent, runCompileStep } from "../../../src/lib/runs";
import { SCREEN_MAX_TOKENS, TITLE_ESSENCE_MAX_TOKENS } from "../budgets";
import type { PaperCompileContext } from "../context";

/**
 * LLM 1: title + essence (the dedup key, decided before deep analysis).
 * One slim call on the full text. A garbage title triggers ONE dedicated
 * retry (filename + metadata hint are already in the prompt). If both fail,
 * the resolve step falls back to metadata/filename and lint flags the result.
 */
export async function extractTitleEssence(
  ctx: PaperCompileContext
): Promise<{ title: string; essence: string; retriedTitle: string }> {
  return runCompileStep(
    "extract-title-essence",
    "Extract title and essence with LLM",
    async () => {
      const first = await llmJson<TitleEssence>({
        provider: ctx.provider,
        model: ctx.model,
        ...titleEssencePrompt({
          text: ctx.extracted.text,
          metaTitle: ctx.extracted.metaTitle,
          filename: ctx.basename,
          language: ctx.language,
        }),
        maxTokens: TITLE_ESSENCE_MAX_TOKENS,
        temperature: 0.2,
      });
      const title = first?.title ?? "";
      const essence = first?.essence ?? "";
      if (!isGarbageName(slugify(title)) || ctx.extracted.text.trim().length === 0) {
        return { title, essence, retriedTitle: "" };
      }
      const retried = await llmJson<TitleEssence>({
        provider: ctx.provider,
        model: ctx.model,
        ...titleEssencePrompt({
          text: ctx.extracted.text,
          metaTitle: ctx.extracted.metaTitle,
          filename: ctx.basename,
          language: ctx.language,
        }),
        maxTokens: TITLE_ESSENCE_MAX_TOKENS,
        temperature: 0,
      });
      const retriedTitle = !isGarbageName(slugify(retried?.title ?? "")) ? (retried?.title ?? "") : "";
      if (retriedTitle) {
        console.log(`  Title:        ${retried.title} (dedicated extraction)`);
      }
      return { title, essence, retriedTitle };
    },
    ctx.paperCtx
  );
}

/**
 * Canonical slug from the REAL title (code-only; the title is known).
 * Fallback chain: LLM title -> PDF metadata title -> retry title -> meaningful
 * filename -> "untitled-<filename>" (flagged by lint) only for garbage names.
 */
export async function resolveTitleSlug(
  ctx: PaperCompileContext
): Promise<{ titleSlug: string; collidingPaper: DbPaper | null }> {
  return runCompileStep(
    "resolve-title-slug",
    "Resolve canonical title slug",
    () => {
      const resolved = resolveCanonicalSlug(
        ctx.extraction.title,
        ctx.extracted.metaTitle ?? "",
        ctx.extraction.retriedTitle,
        ctx.filenameSlug
      );
      return { titleSlug: resolved, collidingPaper: ctx.db.papers.find((p) => p.slug === resolved) ?? null };
    },
    ctx.paperCtx
  );
}

/**
 * LLM 2: dedup screen (title+essence vs compiled history). The screen is the
 * SINGLE duplicate decision: score >= DEDUP_SAME_SCORE means "same document"
 * (conservative — below it, the paper compiles). Colliding slugs are
 * force-included in the record so the screen always sees the collision
 * candidate. An inconclusive screen (invalid response) proceeds — a logged
 * note, never a silent skip. No title/essence (scanned PDF?) records a
 * skipped event instead.
 */
export async function dedupScreen(ctx: PaperCompileContext): Promise<{ slug: string | null; score: number }> {
  if (!ctx.extraction.title.trim() && !ctx.extraction.essence.trim()) {
    await recordCompileEvent({
      ...ctx.paperCtx,
      slug: ctx.slug,
      step: "dedup-screen",
      label: "Screen against compiled papers with LLM",
      status: "skipped",
      message: "No title or essence extracted (scanned PDF?)",
    });
    return { slug: null, score: 0 };
  }
  return runCompileStep(
    "dedup-screen",
    "Screen against compiled papers with LLM",
    async () => {
      const forced = ctx.collidingPaper ? [ctx.collidingPaper.slug] : [];
      const record = historyRecordSlice(ctx.db, ctx.extraction.title, forced);
      const raw = await llmJson<DedupScreen>({
        provider: ctx.provider,
        model: ctx.model,
        ...dedupScreenPrompt({ title: ctx.extraction.title, essence: ctx.extraction.essence, record }),
        maxTokens: SCREEN_MAX_TOKENS,
        temperature: 0,
      });
      const valid =
        !!raw &&
        typeof raw === "object" &&
        (raw.slug === null ||
          (typeof raw.slug === "string" &&
            typeof raw.score === "number" &&
            raw.score >= 0 &&
            raw.score <= 1 &&
            ctx.db.papers.some((p) => p.slug === raw.slug)));
      if (!valid) {
        console.log("  ! dedup screen inconclusive (invalid response) — proceeding");
        return { slug: null as string | null, score: 0 };
      }
      return { slug: raw.slug, score: raw.score };
    },
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}
