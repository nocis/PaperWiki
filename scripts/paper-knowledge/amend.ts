/**
 * Paper Knowledge amend worker pool (scripts-only — imports pdfjs extraction,
 * never app code).
 *
 * One paper slug per unit of work. Workers atomically claim the next pending
 * entry from .log/paper-knowledge-status.json (cross-process safe, so a retry
 * runner can run alongside the post-compile job), process it in parallel, and
 * write the structured `## Paper Knowledge` block into each paper page.
 * `ready` is terminal; failures leave the page body untouched (the block is
 * only written on success, so no half-failed leftovers survive a retry).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { extractPdf } from "../../src/lib/extract";
import { FIGURES_DIR_FOR } from "../../src/lib/extract-figures";
import { llmJson, type LLMProviderDef } from "../../src/lib/llm";
import {
  claimNextPaperKnowledge,
  setPaperKnowledgeEntry,
  sleep,
  validatePaperKnowledge,
} from "../../src/lib/paper-knowledge";
import {
  PAPER_KNOWLEDGE_MAX_TOKENS,
  paperKnowledgePrompt,
  type PaperKnowledge,
  type PaperKnowledgeFigureContext,
  type PaperKnowledgeSeed,
} from "../../src/lib/prompts";
import { patchPaperKnowledgeBlock } from "../../src/lib/templates";
import {
  PAPERS_COMPILED,
  deriveDb,
  readPaperPages,
  writeDbAtomic,
  writePage,
} from "../../src/lib/wiki";
import { errorMessage, truncate } from "../lib/cli-utils";

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;

function concurrencyFromEnv(): number {
  const raw = Number(process.env.PAPERWIKI_KNOWLEDGE_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), MAX_CONCURRENCY);
  return DEFAULT_CONCURRENCY;
}

// ---------------------------------------------------------------------------
// Seed extraction from the compiled paper page (template-owned section shapes)
// ---------------------------------------------------------------------------

function sectionFirstParagraph(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m");
  const match = body.match(re);
  if (!match) return "";
  return match[1].split(/\n\s*\n/)[0].trim();
}

function sectionBullets(body: string, heading: string): string[] {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m");
  const match = body.match(re);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

function lineAfterMarker(body: string, marker: string): string {
  const match = body.match(new RegExp(`${marker}:\\s*(.+)`));
  return match ? match[1].trim() : "";
}

function parseSeedFromPage(page: { fm: { title: string }; body: string }): PaperKnowledgeSeed {
  const body = page.body;
  const novelText = lineAfterMarker(body, "\\*\\*Novel Insight\\*\\*");
  const priorMatch = novelText.match(/\\\*prior:\\\*\s*([\s\S]*?)(?=\s*\/\s*\\\*update:\\\*\s*)/);
  const updateMatch = novelText.match(/\\\*update:\\\*\s*(.+)/);
  return {
    title: page.fm.title,
    essence: sectionFirstParagraph(body, "Essence"),
    contributions: sectionBullets(body, "Contributions"),
    novelInsight: {
      prior: priorMatch?.[1]?.trim() ?? novelText,
      update: updateMatch?.[1]?.trim() ?? "",
    },
    limitations: lineAfterMarker(body, "\\*\\*Fundamental Limitations\\*\\*"),
    researchFrontier: lineAfterMarker(body, "\\*\\*Research Frontier\\*\\*"),
  };
}

// ---------------------------------------------------------------------------
// Figure context (extraction manifest -> prompt input)
// ---------------------------------------------------------------------------

async function loadFigureContexts(slug: string): Promise<{ contexts: PaperKnowledgeFigureContext[]; files: Set<string> }> {
  const manifestPath = path.join(FIGURES_DIR_FOR(slug), "manifest.json");
  let raw: unknown[] = [];
  try {
    raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    return { contexts: [], files: new Set() };
  }
  const contexts: PaperKnowledgeFigureContext[] = [];
  for (const entry of raw) {
    const e = entry as { file?: unknown; page?: unknown; caption?: unknown; context?: unknown; kind?: unknown };
    if (typeof e.file !== "string" || !/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$/i.test(e.file)) continue;
    contexts.push({
      file: e.file,
      page: typeof e.page === "number" ? e.page : 0,
      caption: typeof e.caption === "string" ? e.caption : "",
      context: typeof e.context === "string" ? e.context : "",
      kind: typeof e.kind === "string" ? e.kind : "figure",
      url: `/figures/${slug}/${e.file}`,
    });
  }
  return { contexts, files: new Set(contexts.map((c) => c.file)) };
}

// ---------------------------------------------------------------------------
// Per-slug amend
// ---------------------------------------------------------------------------

async function amendOne(opts: {
  slug: string;
  provider: LLMProviderDef;
  model: string;
  language: string;
}): Promise<void> {
  const { slug } = opts;
  await setPaperKnowledgeEntry(slug, "running");

  const pages = await readPaperPages();
  const page = pages.find((p) => p.fm.slug === slug);
  if (!page) throw new Error(`paper page not found: ${slug}`);

  const extracted = await extractPdf(path.join(PAPERS_COMPILED, `${slug}.pdf`));
  const seed = parseSeedFromPage(page);
  const { contexts: figures, files: figureFiles } = await loadFigureContexts(slug);
  const { system, user } = paperKnowledgePrompt({
    text: extracted.text,
    seed,
    language: opts.language,
    figures,
  });
  const knowledge = await llmJson<PaperKnowledge>({
    provider: opts.provider,
    model: opts.model,
    system,
    user,
    maxTokens: PAPER_KNOWLEDGE_MAX_TOKENS,
  });

  const problems = validatePaperKnowledge(knowledge, { allowedFigureFiles: figureFiles });
  if (problems.length > 0) {
    throw new Error(`Paper Knowledge validation failed: ${problems.join("; ")}`);
  }

  const newBody = patchPaperKnowledgeBlock(page.body, slug, knowledge);
  await writePage(page.filePath, page.fm, newBody);

  // Rebuild the derived db: invariant validation + persist (essence is
  // unchanged, so the index itself is stable — this is a cheap safety net).
  const db = await deriveDb();
  await writeDbAtomic(db);

  await setPaperKnowledgeEntry(slug, "ready");
  console.log(`  ✓ knowledge ready -> ${slug}`);
}

// ---------------------------------------------------------------------------
// Worker pool (claim-based drain — concurrent runners are safe)
// ---------------------------------------------------------------------------

export async function runPaperKnowledgeAmend(opts: {
  provider: LLMProviderDef;
  model: string;
  language?: string;
  /** Optional scope: process only this slug. */
  slug?: string;
  concurrency?: number;
}): Promise<{ attempted: number; ready: number; failed: number }> {
  const language = opts.language ?? "en";
  const concurrency = opts.concurrency ?? concurrencyFromEnv();
  const summary = { attempted: 0, ready: 0, failed: 0 };
  const scopeNote = opts.slug ? ` (scope: ${opts.slug})` : "";

  const processSlug = async (slug: string): Promise<void> => {
    try {
      await amendOne({ slug, provider: opts.provider, model: opts.model, language });
      summary.attempted += 1;
      summary.ready += 1;
    } catch (err) {
      const message = errorMessage(err);
      await setPaperKnowledgeEntry(slug, "failed", truncate(message, 500));
      console.error(`  ✗ knowledge failed -> ${slug}: ${message}`);
      summary.attempted += 1;
      summary.failed += 1;
    }
  };

  // Drain loop: workers atomically claim the next pending entry (cross-process
  // safe), so a retry runner can run alongside the post-compile job without
  // ever double-processing a slug. A settle re-check closes the window where a
  // retry lands right as this runner was about to exit.
  let logged = false;
  while (true) {
    let passTotal = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const slug = await claimNextPaperKnowledge(opts.slug);
        if (!slug) return;
        passTotal += 1;
        await processSlug(slug);
      }
    };
    if (!logged) {
      console.log(`Paper Knowledge amend — processing pending papers, concurrency ${concurrency}${scopeNote}`);
      logged = true;
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (passTotal > 0) continue;
    await sleep(2000);
    const extra = await claimNextPaperKnowledge(opts.slug);
    if (!extra) break;
    await processSlug(extra);
  }

  if (summary.attempted === 0) {
    console.log(`Paper Knowledge amend — no pending papers${scopeNote}.`);
  } else {
    console.log(
      `Paper Knowledge amend done — attempted: ${summary.attempted}, ready: ${summary.ready}, failed: ${summary.failed}`
    );
  }
  return summary;
}
