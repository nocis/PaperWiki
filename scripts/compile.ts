/**
 * PaperWiki incremental compiler.
 *
 * Usage: yarn compile [--provider <id>] [--model <id>]
 *
 * Semantics (see wiki/SCHEMA.md):
 * - papers/new/ is the work queue: every PDF in it is this run's goal.
 * - Sequential, fail-hard, incremental: each paper compiles against the FULL
 *   state left by the previous one; the first LLM failure aborts the run.
 * - Per PDF (in order): (1) slim title+essence call — the dedup key;
 *   (2) slim dedup screen — title+essence vs the compiled-history record; a
 *   same-document score >= DEDUP_SAME_SCORE moves the PDF to
 *   papers/duplicates/ (or restores an interrupted paper's compiled PDF);
 *   below it the paper compiles, disambiguated if its slug collides. Only
 *   then: (3) the deep analysis + classification call on the full text
 *   (title+essence are passed in as fixed facts, bibliography included),
 *   then (4) topic synthesis.
 * - Citations: the reference list extracted by the deep call is persisted to
 *   data/citations/map.json mid-run. After ALL papers of the run are
 *   compiled, an end-of-run finalize pass runs ONE slim citation call per
 *   paper against the FULL final index (see remapPaperCitations) — the map
 *   entry, the ## Citations section, cites[] and the global citedBy[] are
 *   derived from that pass, so the citation relation is built at compile
 *   time with no manual rebuild.
 * - Inputs are window-bounded: full paper text (FULL_MAX_CHARS), KB context
 *   (KB_BUDGET_CHARS, relevance-ordered), topic tree (TOPIC_TREE_BUDGET_CHARS).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { errorMessage, parseArgs, truncate } from "./lib/cli-utils";
import {
  llmHealthCheck,
  resolveModel,
  resolveProvider,
  type LLMProviderDef,
} from "../src/lib/llm";
import { extractPdf } from "../src/lib/extract";
import {
  PAPERS_NEW,
  PAPERS_COMPILED,
  COMMENTS_DIR,
  assertRemovedFromInbox,
  deriveDb,
  ensureDirs,
  findInboxPdfs,
  slugify,
  uniqueSlug,
  writeDbAtomic,
  type DbPaper,
} from "../src/lib/wiki";
import { appendWikiJournal } from "../src/lib/wiki-journal";
import {
  finishCompileRun,
  recordCompileEvent,
  resumeCompileRun,
  runCompileStep,
  startCompileRun,
  updateCompileRun,
} from "../src/lib/runs";
import { DEDUP_SAME_SCORE } from "../src/lib/prompts";
import { enqueuePaperKnowledge } from "../src/lib/paper-knowledge";
import { runPaperKnowledgeAmend } from "./paper-knowledge/amend";
import { runPaperKnowledgeDiagramPlan } from "./paper-knowledge/plan";
import { finalizeCitations, finalizeRelations, consolidationChecks } from "./compile/finalize";
import { moveToDuplicates } from "./compile/helpers";
import { analyzeClassify, extractFigures, writeCitationMap } from "./compile/steps/analyze";
import { applyTopicClassification, rebuildDerivedFiles, synthesizeTopic, writePaperPage, writeTopicPage } from "./compile/steps/persist";
import { dedupScreen, extractTitleEssence, resolveTitleSlug } from "./compile/steps/screen";
import type { PaperCompileContext, PaperEventCtx } from "./compile/context";

const LANGUAGE = "en";

// ---------------------------------------------------------------------------
// Per-paper pipeline
// ---------------------------------------------------------------------------

/**
 * Returns the compiled paper, or null when the file was skipped as a duplicate.
 */
async function processPdf(
  pdfPath: string,
  provider: LLMProviderDef,
  model: string,
  index: number,
  total: number
): Promise<DbPaper | null> {
  const basename = path.basename(pdfPath);
  const relativeFile = path.relative(PAPERS_NEW, pdfPath) || basename;
  const filenameSlug = slugify(basename);
  const paperCtx: PaperEventCtx = {
    scope: "paper",
    paperIndex: index + 1,
    paperTotal: total,
    file: relativeFile,
  };
  console.log(`\n[${index + 1}/${total}] ${basename}`);

  await recordCompileEvent({
    ...paperCtx,
    step: "paper-started",
    label: `Compile paper ${index + 1} of ${total}`,
    status: "started",
  });

  // --- Load current state -------------------------------------------------
  const db = await runCompileStep("load-state", "Load current wiki state", () => deriveDb(), paperCtx);

  // --- Cheap pre-analysis duplicate guard (exact filename re-drops) ----------
  const preAnalysisDuplicate = await runCompileStep(
    "duplicate-check",
    "Check for duplicate paper (filename)",
    async () => db.papers.find((p) => p.slug === filenameSlug)?.slug ?? null,
    paperCtx
  );
  if (preAnalysisDuplicate) {
    await runCompileStep(
      "move-to-duplicates",
      "Move duplicate PDF aside",
      () => moveToDuplicates(pdfPath, `slug "${preAnalysisDuplicate}" is already compiled`),
      paperCtx
    );
    await recordCompileEvent({
      ...paperCtx,
      step: "paper-finished",
      label: "Paper skipped as duplicate",
      status: "skipped",
      message: `Already compiled as "${preAnalysisDuplicate}"`,
    });
    return null;
  }

  // --- Extract (full text, all pages) ---------------------------------------
  const extracted = await runCompileStep("extract-pdf", "Extract PDF text", () => extractPdf(pdfPath), paperCtx);
  console.log(`  extracted ${extracted.numPages} pages`);

  // Per-paper pipeline state. The fields below are filled in catalog order by
  // the step calls that follow: extraction, slug/collidingPaper, analysis,
  // rawReferences, figures, topicPage/milestone/subtopic.
  const ctx = {
    provider,
    model,
    pdfPath,
    basename,
    filenameSlug,
    language: LANGUAGE,
    paperCtx,
    db,
    extracted,
  } as PaperCompileContext;

  // --- Screening phase (LLM 1-2): identity + duplicate decision --------------
  ctx.extraction = await extractTitleEssence(ctx);

  const { titleSlug, collidingPaper } = await resolveTitleSlug(ctx);
  ctx.slug = titleSlug;
  ctx.collidingPaper = collidingPaper;

  const screenMatch = await dedupScreen(ctx);

  // --- Duplicate verdict ------------------------------------------------------
  const duplicateOf = screenMatch.slug !== null && screenMatch.score >= DEDUP_SAME_SCORE ? screenMatch.slug : null;
  if (duplicateOf) {
    const why = `duplicate of "${duplicateOf}" (screen score ${screenMatch.score.toFixed(2)})`;
    await runCompileStep(
      "move-to-duplicates",
      "Move duplicate PDF aside",
      async () => {
        // Interrupted-run recovery: the matched page may exist without its
        // compiled PDF (a crash between write-paper-page and move-pdf) —
        // restoring the inbox PDF completes that paper instead of misfiling it.
        const target = path.join(PAPERS_COMPILED, `${duplicateOf}.pdf`);
        if (!(await fs.stat(target).catch(() => null))) {
          await fs.rename(pdfPath, target);
          console.log(`  ! ${why} — restored compiled PDF for interrupted paper "${duplicateOf}"`);
        } else {
          await moveToDuplicates(pdfPath, why);
        }
      },
      { ...paperCtx, slug: ctx.slug }
    );
    await recordCompileEvent({
      ...paperCtx,
      slug: ctx.slug,
      step: "paper-finished",
      label: "Paper skipped as duplicate",
      status: "skipped",
      message: `Screen confirmed ${why}`,
    });
    return null;
  }

  // Not a duplicate. A slug collision now means a DISTINCT paper sharing the
  // name — compile it under a disambiguated slug; never overwrite the
  // colliding paper's files.
  if (collidingPaper && ctx.slug === titleSlug) {
    ctx.slug = uniqueSlug(titleSlug, new Set(ctx.db.papers.map((p) => p.slug)));
    if (ctx.slug !== titleSlug) {
      console.log(`  Title collision with "${titleSlug}" — distinct paper, compiled as "${ctx.slug}"`);
    }
  }

  if (ctx.slug !== filenameSlug) {
    console.log(`  Renamed:      ${basename} -> ${ctx.slug}.pdf`);
  }

  // --- Analysis phase (LLM 3) -------------------------------------------------
  ctx.analysis = await analyzeClassify(ctx);

  console.log(`  Title:        ${ctx.extraction.title}`);
  console.log(`  Lead:         ${truncate(ctx.extraction.essence, 300)}`);
  console.log(`  Positioning:  ${ctx.analysis.evolutionaryChain?.role ?? "?"} — ${truncate(ctx.analysis.evolutionaryChain?.note ?? "", 160)}`);
  console.log(`  Contribution: ${truncate(ctx.analysis.contributions[0] ?? "(none)", 200)}`);
  console.log(`  Limitation:   ${truncate(ctx.analysis.limitations, 160)}`);
  console.log(
    `  Topic:        ${ctx.analysis.classification.action === "create" ? `(new) ${ctx.analysis.classification.topic!.slug}` : ctx.analysis.classification.topicSlug}${ctx.analysis.classification.subtopicSlug ? ` / ${ctx.analysis.classification.subtopicSlug}` : ""} — ${truncate(ctx.analysis.classification.reason, 140)}`
  );

  ctx.rawReferences = ctx.analysis.references ?? [];
  console.log(`  References:   ${ctx.rawReferences.length} bibliography entr${ctx.rawReferences.length === 1 ? "y" : "ies"} extracted`);

  await writeCitationMap(ctx);

  ctx.figures = await extractFigures(ctx);
  if (ctx.figures.length > 0) {
    console.log(`  Figures:      ${ctx.figures.map((f) => f.file).join(", ")}`);
  }

  // --- Persist phase ----------------------------------------------------------
  const { topicPage, milestone, subtopic } = await applyTopicClassification(ctx);
  ctx.topicPage = topicPage;
  ctx.milestone = milestone;
  ctx.subtopic = subtopic;

  await writePaperPage(ctx);

  const synthesis = await synthesizeTopic(ctx);
  await writeTopicPage(ctx, synthesis);

  // --- Move PDF (Phase 3 + hard gate) ------------------------------------------
  await runCompileStep(
    "move-pdf",
    "Move PDF to compiled archive",
    async () => {
      const targetPath = path.join(PAPERS_COMPILED, `${ctx.slug}.pdf`);
      await fs.rename(pdfPath, targetPath);
      await assertRemovedFromInbox(basename);
    },
    { ...paperCtx, slug: ctx.slug }
  );

  await runCompileStep(
    "create-comments-dir",
    "Create comments directory",
    () => fs.mkdir(path.join(COMMENTS_DIR, ctx.slug), { recursive: true }).then(() => undefined),
    { ...paperCtx, slug: ctx.slug }
  );

  const compiledPaper = await rebuildDerivedFiles(ctx);

  // Paper Knowledge: queue the structured-knowledge pass for this paper. The
  // entry is created here (at persist time) so an aborted run still leaves a
  // pending entry that the next amend pass picks up.
  await enqueuePaperKnowledge([ctx.slug]);

  await recordCompileEvent({
    ...paperCtx,
    slug: ctx.slug,
    step: "paper-finished",
    label: "Paper compiled",
    status: "completed",
    message: `wiki/papers/${ctx.slug}.md`,
  });
  console.log(`  ✓ compiled -> wiki/papers/${ctx.slug}.md`);
  return compiledPaper;
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const provider = resolveProvider(args.provider);
  const model = resolveModel(provider, args.model);

  const uiRunId = process.env.PAPERWIKI_COMPILE_RUN_ID;
  if (uiRunId) {
    // The API route already recorded run-started and wrote the snapshot.
    resumeCompileRun(uiRunId);
  } else {
    await startCompileRun({
      source: "cli",
      provider: provider.id,
      model,
    });
  }

  try {
    console.log(`PaperWiki compile — provider: ${provider.id} · model: ${model}`);

    await runCompileStep("prepare-dirs", "Prepare workspace directories", () => ensureDirs());

    // Pre-flight: fail before touching anything if the LLM is unreachable.
    await runCompileStep("llm-preflight", "Check LLM connectivity", () => llmHealthCheck(provider, model));
    console.log("LLM pre-flight check... ok");

    const inbox = await runCompileStep("scan-inbox", "Scan papers/new inbox", () => findInboxPdfs());
    await updateCompileRun({ totals: { papers: inbox.length, compiled: 0, duplicates: 0, failed: 0 } });

    if (inbox.length === 0) {
      console.log("papers/new/ is empty — nothing new to compile.");
    } else {
      console.log(`Inbox: ${inbox.length} PDF(s)`);
    }

    const compiled: DbPaper[] = [];
    const skipped: string[] = [];
    const topicsBefore = new Set((await deriveDb()).topics.map((t) => t.slug));

    // Sequential, fail-hard, incremental: each paper compiles against the FULL
    // state left by the previous one, so the knowledge base grows one paper at
    // a time. The first failure aborts the run; processed papers persist and
    // the rest stay in the inbox for the next run.
    for (const [i, pdfPath] of inbox.entries()) {
      const basename = path.basename(pdfPath);
      try {
        const result = await processPdf(pdfPath, provider, model, i, inbox.length);
        if (result) compiled.push(result);
        else skipped.push(basename);
        await updateCompileRun({
          totals: { papers: inbox.length, compiled: compiled.length, duplicates: skipped.length, failed: 0 },
        });
      } catch (err) {
        const message = errorMessage(err);
        await recordCompileEvent({
          scope: "paper",
          paperIndex: i + 1,
          paperTotal: inbox.length,
          file: path.relative(PAPERS_NEW, pdfPath) || basename,
          step: "paper-finished",
          label: "Paper failed",
          status: "failed",
          message,
        });
        await updateCompileRun({
          totals: { papers: inbox.length, compiled: compiled.length, duplicates: skipped.length, failed: 1 },
        });
        console.error(`\n✗ ABORT: ${basename} — ${message}`);
        console.error(
          `${compiled.length} paper(s) compiled this run; ${inbox.length - compiled.length - skipped.length} remain in papers/new/ for the next run.`
        );
        throw err;
      }
    }

    // --- Citation finalize ------------------------------------------------------
    // The citation relation is built at compile time: ONE slim call per paper
    // against the FULL final index, then global citedBy recompute. Targets are
    // every map entry with a persisted reference list but no records yet —
    // this covers papers compiled this run AND pending entries left by an
    // interrupted earlier run (compile self-heals; no separate rebuild needed).
    const citationStats = await runCompileStep(
      "finalize-citations",
      "Finalize citation relations (LLM)",
      () => finalizeCitations(compiled, provider, model)
    );
    for (const s of citationStats) {
      console.log(`  citations: ${s.slug} → ${s.matched}/${s.total} linked`);
    }

    // End-of-run: re-map typed relations against the FULL final index. The
    // analyze pass saw only the pre-run index, so same-run papers are missed
    // and stale seeds are never corrected. One slim call per compiled paper.
    const relationStats = await runCompileStep(
      "finalize-relations",
      "Finalize typed relations (LLM)",
      () => finalizeRelations(compiled, provider, model, LANGUAGE)
    );
    for (const s of relationStats) {
      console.log(`  relations: ${s.slug} → ${s.before} → ${s.after} finalized`);
    }
    await updateCompileRun({
      totals: { papers: inbox.length, compiled: compiled.length, duplicates: skipped.length, failed: 0 },
    });

    // Post-run: consolidation detection (Confirm-tier proposals only).
    const proposals = await runCompileStep(
      "consolidation-checks",
      "Check topic consolidation proposals",
      async () => {
        const finalDb = await deriveDb();
        const newTopicSlugs = finalDb.topics.filter((t) => !topicsBefore.has(t.slug)).map((t) => t.slug);
        const count = await consolidationChecks(finalDb, provider, model, newTopicSlugs);
        if (count > 0) {
          const freshDb = await deriveDb();
          await writeDbAtomic(freshDb);
        }
        return count;
      }
    );
    if (proposals > 0) {
      console.log(`\n${proposals} reorganization proposal(s) queued in wiki/proposals.md`);
    }

    // Paper Knowledge amend: parallel structured-knowledge pass over THIS
    // run's papers (pending entries only). The web compile path defers it —
    // the compile API route spawns a dedicated background job after the
    // compiler child exits (PAPERWIKI_DEFER_AMEND=1), so the compile run
    // itself finishes before the amend starts.
    let knowledgeStats: { attempted: number; ready: number; failed: number } | null = null;
    if (compiled.length > 0) {
      if (process.env.PAPERWIKI_DEFER_AMEND) {
        console.log(
          `\nPaper Knowledge amend deferred — ${compiled.length} paper(s) queued, background job will pick them up.`
        );
      } else {
        try {
          knowledgeStats = await runPaperKnowledgeAmend({ provider, model, language: LANGUAGE });
          // Phase 2: diagram planning — decides diagram placement from the
          // persisted knowledge. Its own try/catch: a plan failure marks the
          // entry's diagramPlan phase failed (amend stays ready; retry
          // re-runs only the plan) and must not fail the compile run.
          try {
            await runPaperKnowledgeDiagramPlan({ provider, model, language: LANGUAGE });
          } catch (planErr) {
            console.error(`Diagram plan failed: ${errorMessage(planErr)}`);
          }
        } catch (err) {
          // The amend is supplementary — a bug in it must not fail the compile run.
          console.error(`Paper Knowledge amend failed: ${errorMessage(err)}`);
        }
      }
    }

    console.log(`\nDone. ${compiled.length} paper(s) compiled:`);
    for (const p of compiled) {
      console.log(`  - ${p.slug} → topic ${p.milestone}`);
    }
    if (skipped.length > 0) {
      console.log(`${skipped.length} duplicate(s) moved to papers/duplicates/:`);
      for (const s of skipped) console.log(`  - ${s}`);
    }

    const duplicateText = skipped.length > 0 ? `, ${skipped.length} duplicate(s) skipped` : "";

    // Cognitive timeline: one dated journal entry per run.
    const citationsTotal = citationStats.reduce((s, c) => s + c.total, 0);
    const citationsMatched = citationStats.reduce((s, c) => s + c.matched, 0);
    const topicsTouched = [...new Set(compiled.map((p) => p.milestone))];
    await appendWikiJournal("compile", `Compiled ${compiled.length} paper(s)${duplicateText}`, [
      ...(compiled.length > 0
        ? [`papers: ${compiled.map((p) => p.slug).join(", ")}`, `topics touched: ${topicsTouched.join(", ")}`]
        : ["papers: (none)"]),
      `citations linked: ${citationsMatched}/${citationsTotal}`,
      ...(proposals > 0 ? [`proposals queued: ${proposals}`] : []),
      ...(skipped.length > 0 ? [`duplicates skipped: ${skipped.join(", ")}`] : []),
      ...(knowledgeStats
        ? [`paper knowledge: ${knowledgeStats.ready}/${knowledgeStats.attempted} ready${knowledgeStats.failed > 0 ? ` (${knowledgeStats.failed} failed)` : ""}`]
        : process.env.PAPERWIKI_DEFER_AMEND && compiled.length > 0
          ? [`paper knowledge: ${compiled.length} queued (background amend deferred)`]
          : []),
      `provider: ${provider.id} · model: ${model}`,
    ]);

    await finishCompileRun("completed", `Compiled ${compiled.length} paper(s)${duplicateText}.`);
  } catch (err) {
    await appendWikiJournal("compile", "Compile failed", [errorMessage(err)]);
    await finishCompileRun("failed", errorMessage(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✗ compile failed: ${errorMessage(err)}`);
  process.exit(1);
});
