/**
 * PaperWiki incremental compiler.
 *
 * Usage: yarn compile [--model <id>]
 *
 * Semantics (see wiki/SCHEMA.md):
 * - papers/new/ is the work queue: every PDF in it is this run's goal.
 * - Pre-flight LLM check; if unreachable, abort before touching anything.
 * - Per PDF: analyze (LLM) -> report -> classify (LLM) -> synthesize topic (LLM)
 *   -> write wiki pages -> move PDF out of the inbox (hard gate) -> derive db.
 * - Any LLM failure mid-run aborts the run: processed papers persist,
 *   unprocessed PDFs stay in the inbox for the next run.
 */
import * as fs from "fs/promises";
import * as path from "path";
import {
  llmHealthCheck,
  llmJson,
  resolveModel,
} from "../src/lib/llm";
import { extractPdf } from "../src/lib/extract";
import {
  PAPERS_NEW,
  PAPERS_COMPILED,
  PAPERS_DUPLICATES,
  PUBLIC_PDFS,
  COMMENTS_DIR,
  WIKI_PAPERS_DIR,
  WIKI_TOPICS_DIR,
  addCitedBy,
  appendLog,
  appendProposal,
  assertRemovedFromInbox,
  deriveDb,
  ensureDirs,
  findInboxPdfs,
  readProposals,
  readTopicPages,
  regenIndex,
  resolveReferences,
  slugify,
  today,
  uniqueSlug,
  writeDbAtomic,
  writePage,
  type DbPaper,
  type PaperFrontmatter,
  type TopicFrontmatter,
  type WikiDb,
} from "../src/lib/wiki";
import { renderPaperBody, renderTopicBody } from "../src/lib/templates";
import {
  finishCompileRun,
  recordCompileEvent,
  runCompileStep,
  startCompileRun,
  updateCompileRun,
} from "../src/lib/compile-progress";
import {
  milestoneClassifyPrompt,
  paperAnalysisPrompt,
  topicSynthesisPrompt,
  type Classification,
  type PaperAnalysis,
  type TopicSynthesis,
} from "../src/lib/prompts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANGUAGE = "en";

function parseArgs(argv: string[]): { model?: string } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model" && argv[i + 1]) return { model: argv[i + 1] };
    if (argv[i].startsWith("--model=")) return { model: argv[i].slice("--model=".length) };
  }
  return {};
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Compact KB context for the analysis prompt (bounded). */
function kbIndexText(db: WikiDb): string {
  const lines: string[] = [];
  for (const p of db.papers.slice(0, 40)) {
    lines.push(`- ${p.slug} — "${p.title}" (${p.venue}, ${p.publishedAt}): ${truncate(p.essence, 160)}`);
  }
  return lines.join("\n");
}

/** Compact topic tree for the classification prompt (bounded). */
function topicTreeText(db: WikiDb): string {
  const depth = (slug: string): number => {
    let d = 1;
    let cur = db.topics.find((t) => t.slug === slug);
    while (cur?.parentSlug) {
      d += 1;
      cur = db.topics.find((t) => t.slug === cur!.parentSlug);
    }
    return d;
  };
  return db.topics
    .map(
      (t) =>
        `- ${t.slug} (depth ${depth(t.slug)}, mode ${t.mode}${t.subtopics.length ? `, subtopics: ${t.subtopics.join(", ")}` : ""}) — ${truncate(t.definition, 140)}`
    )
    .join("\n");
}

function venueTag(venue: string): string | null {
  const v = venue.trim().replace(/\s+/g, "-");
  return v ? `venue/${v}` : null;
}

function validateClassification(c: Classification, db: WikiDb): Classification {
  if (c.action === "assign") {
    const topic = db.topics.find((t) => t.slug === c.topicSlug);
    if (!topic) throw new Error(`classify: cannot assign to unknown topic "${c.topicSlug}"`);
    if (c.subtopicSlug && !/^[a-z0-9][a-z0-9-]*$/.test(c.subtopicSlug)) {
      throw new Error(`classify: invalid subtopic slug "${c.subtopicSlug}"`);
    }
    return { ...c, subtopicSlug: c.subtopicSlug ?? null };
  }
  if (c.action === "create" && c.topic) {
    const slug = slugify(c.topic.slug);
    if (!slug) throw new Error("classify: create returned an empty topic slug");
    if (c.topic.parentSlug) {
      const parent = db.topics.find((t) => t.slug === c.topic!.parentSlug);
      if (!parent) throw new Error(`classify: unknown parent topic "${c.topic.parentSlug}"`);
      const grandparent = parent.parentSlug
        ? db.topics.find((t) => t.slug === parent.parentSlug)
        : undefined;
      if (grandparent?.parentSlug) {
        // parent is already at depth 3 — a child would exceed max depth.
        throw new Error(`classify: parent "${parent.slug}" is at depth 3 — cannot create a child under it`);
      }
    }
    if (db.topics.some((t) => t.slug === slug)) {
      throw new Error(`classify: create proposed existing topic slug "${slug}" — should have assigned`);
    }
    return { ...c, topic: { ...c.topic, slug } };
  }
  throw new Error(`classify: invalid response shape (action=${JSON.stringify(c.action)})`);
}

// ---------------------------------------------------------------------------
// Per-paper pipeline
// ---------------------------------------------------------------------------

/** Duplicates are non-fatal: move aside so the inbox drains, and continue the run. */
async function moveToDuplicates(pdfPath: string, reason: string): Promise<void> {
  await fs.mkdir(PAPERS_DUPLICATES, { recursive: true });
  const basename = path.basename(pdfPath);
  let target = path.join(PAPERS_DUPLICATES, basename);
  let n = 2;
  while (await fs.stat(target).catch(() => null)) {
    target = path.join(PAPERS_DUPLICATES, `${basename.replace(/\.pdf$/i, "")}-${n}.pdf`);
    n += 1;
  }
  await fs.rename(pdfPath, target);
  console.log(`  ! duplicate skipped: ${reason} — moved to papers/duplicates/${path.basename(target)}`);
}

/**
 * Returns the compiled paper, or null when the file was skipped as a duplicate.
 */
async function processPdf(pdfPath: string, model: string, index: number, total: number): Promise<DbPaper | null> {
  const basename = path.basename(pdfPath);
  const relativeFile = path.relative(PAPERS_NEW, pdfPath) || basename;
  const filenameSlug = slugify(basename);
  const paperCtx = {
    scope: "paper" as const,
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

  // --- Cheap pre-analysis duplicate guard (meaningful filenames) ----------
  const preAnalysisDuplicate = await runCompileStep(
    "duplicate-check",
    "Check for duplicate paper",
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

  // --- Extract ------------------------------------------------------------
  const extracted = await runCompileStep("extract-pdf", "Extract PDF text", () => extractPdf(pdfPath), paperCtx);
  console.log(`  extracted ${extracted.numPages} pages`);

  // --- LLM 1: analyze -------------------------------------------------------
  const analysis = await runCompileStep(
    "analyze-paper",
    "Analyze paper with LLM",
    async () => {
      const analysisPrompt = paperAnalysisPrompt({
        text: extracted.text,
        metaTitle: extracted.metaTitle,
        kbIndex: kbIndexText(db),
        language: LANGUAGE,
      });
      return llmJson<PaperAnalysis>({ model, ...analysisPrompt });
    },
    paperCtx
  );

  // --- Phase 2: report ------------------------------------------------------
  console.log(`  Title:        ${analysis.title}`);
  console.log(`  Lead:         ${truncate(analysis.essence, 300)}`);
  console.log(`  Positioning:  ${analysis.evolutionaryChain?.role ?? "?"} — ${truncate(analysis.evolutionaryChain?.note ?? "", 160)}`);
  console.log(`  Contribution: ${truncate(analysis.contributions[0] ?? "(none)", 200)}`);
  console.log(`  Limitation:   ${truncate(analysis.limitations, 160)}`);

  // --- Canonical slug from the REAL title -----------------------------------
  // Files dropped as e.g. "2006.11239.pdf" are renamed to the paper's actual
  // title. Fallback chain: LLM title -> PDF metadata title -> filename.
  const { titleSlug, slug } = await runCompileStep(
    "resolve-title-slug",
    "Resolve canonical title slug",
    async () => {
      const resolvedTitleSlug =
        slugify(analysis.title ?? "") ||
        slugify(extracted.metaTitle ?? "") ||
        filenameSlug ||
        `paper-${Date.now()}`;
      const taken = new Set(db.papers.map((p) => p.slug));
      return { titleSlug: resolvedTitleSlug, slug: uniqueSlug(resolvedTitleSlug, taken) };
    },
    paperCtx
  );

  // Post-analysis duplicate guard: same paper re-dropped under a different name.
  if (db.papers.some((p) => p.slug === titleSlug)) {
    await runCompileStep(
      "move-to-duplicates",
      "Move duplicate PDF aside",
      () => moveToDuplicates(pdfPath, `already compiled as "${titleSlug}"`),
      { ...paperCtx, slug }
    );
    await recordCompileEvent({
      ...paperCtx,
      slug,
      step: "paper-finished",
      label: "Paper skipped as duplicate",
      status: "skipped",
      message: `Already compiled as "${titleSlug}"`,
    });
    return null;
  }

  if (slug !== filenameSlug) {
    console.log(`  Renamed:      ${basename} -> ${slug}.pdf`);
  }
  // --- LLM 2: classify ------------------------------------------------------
  const classification = await runCompileStep(
    "classify-topic",
    "Classify topic with LLM",
    async () => {
      const classifyPrompt = milestoneClassifyPrompt({
        title: analysis.title,
        essence: analysis.essence,
        contributions: analysis.contributions,
        topicTree: topicTreeText(db),
        language: LANGUAGE,
      });
      const raw = await llmJson<Classification>({ model, ...classifyPrompt });
      return validateClassification(raw, db);
    },
    { ...paperCtx, slug }
  );
  console.log(
    `  Topic:        ${classification.action === "create" ? `(new) ${classification.topic!.slug}` : classification.topicSlug}${classification.subtopicSlug ? ` / ${classification.subtopicSlug}` : ""} — ${truncate(classification.reason, 140)}`
  );

  // --- Frontmatter tags -------------------------------------------------------
  const tags: string[] = [];
  if (analysis.publishedAt) tags.push(`year/${analysis.publishedAt}`);
  const vt = venueTag(analysis.venue ?? "");
  if (vt) tags.push(vt);

  const milestone =
    classification.action === "create" ? classification.topic!.slug : classification.topicSlug!;
  const subtopic = classification.action === "assign" ? classification.subtopicSlug ?? null : null;

  // --- Apply classification to topic layer -----------------------------------
  const topicPage = await runCompileStep(
    "apply-topic-classification",
    "Apply topic classification",
    async () => {
      const topicPages = await readTopicPages();
      let selectedTopicPage = topicPages.find((t) => t.fm.slug === milestone);

      if (classification.action === "create") {
        const fm: TopicFrontmatter = {
          slug: classification.topic!.slug,
          name: classification.topic!.name,
          definition: classification.topic!.definition,
          mode: "standalone",
          parent_milestone: classification.topic!.parentSlug ?? null,
          children: [],
          subtopics: [],
          tags: classification.topic!.tags ?? [],
        };
        // If created under a parent, register bidirectionally.
        if (fm.parent_milestone) {
          const parent = topicPages.find((t) => t.fm.slug === fm.parent_milestone)!;
          parent.fm.children = [...parent.fm.children, fm.slug];
          if (parent.fm.mode === "standalone") parent.fm.mode = "split";
          await writePage(parent.filePath, parent.fm, parent.body);
        }
        const relDir = fm.parent_milestone ? path.join(WIKI_TOPICS_DIR, fm.parent_milestone) : WIKI_TOPICS_DIR;
        selectedTopicPage = {
          fm,
          body: "",
          filePath: path.join(relDir, `${fm.slug}.md`),
          relPath: path.relative(WIKI_TOPICS_DIR, path.join(relDir, `${fm.slug}.md`)),
        };
      } else if (subtopic && selectedTopicPage) {
        // Organic growth: new subtopic inside an existing topic.
        if (!selectedTopicPage.fm.subtopics.includes(subtopic)) {
          selectedTopicPage.fm.subtopics = [...selectedTopicPage.fm.subtopics, subtopic].sort();
        }
        if (selectedTopicPage.fm.mode === "standalone") selectedTopicPage.fm.mode = "merged";
      }

      if (!selectedTopicPage) {
        throw new Error(`internal: topic page for "${milestone}" not found after classification`);
      }
      return selectedTopicPage;
    },
    { ...paperCtx, slug }
  );

  // --- Reference resolution (code-side, bidirectional) ------------------------
  const { resolvedRefs, cites } = await runCompileStep(
    "resolve-citations",
    "Resolve citation links",
    async () => {
      const refs = resolveReferences(
        (analysis.references ?? []).slice(0, 50),
        db.papers.map((p) => ({ slug: p.slug, title: p.title })),
        slug
      );
      const predecessorSlugs = (analysis.predecessors ?? [])
        .map((p) => p.slug)
        .filter((s) => db.papers.some((p) => p.slug === s));
      const linked = [...new Set([...refs.filter((r) => r.slug).map((r) => r.slug!), ...predecessorSlugs])].sort();
      return { resolvedRefs: refs, cites: linked };
    },
    { ...paperCtx, slug }
  );

  // --- Write paper page -------------------------------------------------------
  const relations = [
    ...(analysis.predecessors ?? [])
      .filter((p) => db.papers.some((x) => x.slug === p.slug))
      .map((p) => ({ relation: p.relation, slug: p.slug, note: p.note })),
    ...(analysis.contradictions ?? [])
      .filter((p) => db.papers.some((x) => x.slug === p.slug))
      .map((p) => ({ relation: "contradicts", slug: p.slug, note: p.note })),
    ...(analysis.crossTopicImpacts ?? [])
      .filter((p) => db.papers.some((x) => x.slug === p.slug))
      .map((p) => ({ relation: "impacts", slug: p.slug, note: p.note })),
  ];

  const paperFm: PaperFrontmatter = {
    slug,
    title: analysis.title,
    authors: analysis.authors ?? [],
    venue: analysis.venue ?? "",
    publishedAt: analysis.publishedAt ?? "",
    tags,
    milestone,
    subtopic,
    numPages: extracted.numPages,
    addedAt: today(),
    rawPath: path.join("papers", "compiled", `${slug}.pdf`),
    pdfUrl: `/pdfs/${slug}.pdf`,
    cites,
    citedBy: [],
  };

  const paperBody = renderPaperBody({
    essence: analysis.essence,
    contributions: analysis.contributions ?? [],
    novelInsight: analysis.novelInsight ?? "",
    limitations: analysis.limitations ?? "",
    frontier: analysis.researchFrontier ?? "",
    relationsContext: analysis.relationsContext ?? "",
    relations,
    references: resolvedRefs,
    milestoneAnchor: milestone,
  });

  const paperPath = path.join(WIKI_PAPERS_DIR, `${slug}.md`);
  await runCompileStep(
    "write-paper-page",
    "Write paper wiki page",
    () => writePage(paperPath, paperFm, paperBody),
    { ...paperCtx, slug }
  );

  // Bidirectional citedBy updates on target pages.
  await runCompileStep(
    "update-cited-by",
    "Update cited-by links",
    async () => {
      for (const target of cites) {
        await addCitedBy(target, slug);
      }
    },
    { ...paperCtx, slug }
  );

  // --- LLM 3: topic synthesis -------------------------------------------------
  const existingSources = db.papers.filter((p) => p.milestone === milestone);
  const sourcesForSynthesis = [
    ...existingSources.slice(0, 12).map((p) => ({
      slug: p.slug,
      title: p.title,
      essence: p.essence,
      contributions: [] as string[],
      publishedAt: p.publishedAt,
    })),
    {
      slug,
      title: analysis.title,
      essence: analysis.essence,
      contributions: analysis.contributions ?? [],
      publishedAt: analysis.publishedAt ?? "",
    },
  ];

  const synthesis = await runCompileStep(
    "synthesize-topic",
    "Synthesize topic with LLM",
    async () => {
      const synthesisPrompt = topicSynthesisPrompt({
        topicName: topicPage.fm.name,
        topicSlug: topicPage.fm.slug,
        currentDefinition: topicPage.fm.definition,
        existingBody: topicPage.body || null,
        sources: sourcesForSynthesis,
        subtopics: topicPage.fm.subtopics,
        language: LANGUAGE,
      });
      return llmJson<TopicSynthesis>({ model, ...synthesisPrompt });
    },
    { ...paperCtx, slug }
  );

  topicPage.fm.definition = truncate(synthesis.definition, 400);
  const topicBody = renderTopicBody({
    fm: topicPage.fm,
    definitionProse: synthesis.definition,
    keyProperties: synthesis.keyProperties ?? [],
    sources: [
      ...existingSources.map((p) => ({
        slug: p.slug,
        title: p.title,
        venue: p.venue,
        publishedAt: p.publishedAt,
        subtopic: p.subtopic,
      })),
      { slug, title: analysis.title, venue: analysis.venue ?? "", publishedAt: analysis.publishedAt ?? "", subtopic },
    ],
    chronologicalEvolution: synthesis.chronologicalEvolution ?? null,
    subtopicNotes: synthesis.subtopicNotes ?? {},
  });
  await runCompileStep(
    "write-topic-page",
    "Write topic wiki page",
    () => writePage(topicPage.filePath, topicPage.fm, topicBody),
    { ...paperCtx, slug }
  );

  // --- Move PDF (Phase 3 + hard gate) ------------------------------------------
  await runCompileStep(
    "move-pdf",
    "Move PDF and create public link",
    async () => {
      const targetPath = path.join(PAPERS_COMPILED, `${slug}.pdf`);
      await fs.rename(pdfPath, targetPath);
      await assertRemovedFromInbox(basename);

      // Symlink into public/ (relative target; copy fallback).
      const linkPath = path.join(PUBLIC_PDFS, `${slug}.pdf`);
      try {
        await fs.unlink(linkPath).catch(() => {});
        await fs.symlink(path.join("..", "..", "papers", "compiled", `${slug}.pdf`), linkPath);
      } catch {
        await fs.copyFile(targetPath, linkPath);
      }
    },
    { ...paperCtx, slug }
  );

  await runCompileStep(
    "create-comments-dir",
    "Create comments directory",
    () => fs.mkdir(path.join(COMMENTS_DIR, slug), { recursive: true }).then(() => undefined),
    { ...paperCtx, slug }
  );

  // --- Index, log, derived db (per-paper atomic) --------------------------------
  const freshDb = await runCompileStep(
    "rebuild-derived-files",
    "Rebuild index, log, and database",
    async () => {
      const nextDb = await deriveDb();
      await regenIndex(nextDb, LANGUAGE);
      await appendLog("ingest", analysis.title, [
        `slug: ${slug}`,
        `topic: ${milestone}${subtopic ? ` / ${subtopic}` : ""} (${classification.action})`,
        `cites: ${cites.length > 0 ? cites.join(", ") : "-"}`,
        `model: ${model}`,
      ]);
      await writeDbAtomic(nextDb);
      return nextDb;
    },
    { ...paperCtx, slug }
  );

  await recordCompileEvent({
    ...paperCtx,
    slug,
    step: "paper-finished",
    label: "Paper compiled",
    status: "completed",
    message: `wiki/papers/${slug}.md`,
  });
  console.log(`  ✓ compiled -> wiki/papers/${slug}.md`);
  return freshDb.papers.find((p) => p.slug === slug)!;
}

// ---------------------------------------------------------------------------
// Consolidation checks (Confirm-tier -> proposals queue, never auto-applied)
// ---------------------------------------------------------------------------

async function consolidationChecks(db: WikiDb): Promise<number> {
  const existing = await readProposals();
  const hasPending = (type: string, topic: string, subtopic: string | null) =>
    existing.some(
      (p) => p.status === "pending" && p.type === type && p.topic === topic && p.subtopic === subtopic
    );

  let added = 0;

  for (const topic of db.topics) {
    const count = topic.sources.length;

    if (topic.mode === "standalone" && count > 8 && !hasPending("split-topic", topic.slug, null)) {
      await appendProposal({
        type: "split-topic",
        topic: topic.slug,
        subtopic: null,
        reason: `${count} sources > 8 — topic is too coarse; identify sub-clusters`,
      });
      added += 1;
    }

    if (topic.mode === "merged") {
      for (const sub of topic.subtopics) {
        const subCount = db.papers.filter((p) => p.milestone === topic.slug && p.subtopic === sub).length;
        if (subCount >= 5 && !hasPending("promote-subtopic", topic.slug, sub)) {
          await appendProposal({
            type: "promote-subtopic",
            topic: topic.slug,
            subtopic: sub,
            reason: `${subCount} papers >= 5 — split out to topics/${topic.slug}/${sub}.md`,
          });
          added += 1;
        }
      }
    }
  }

  // Tag-to-parent: 3+ root standalone topics sharing a tag.
  const roots = db.topics.filter((t) => !t.parentSlug && t.mode === "standalone");
  const byTag = new Map<string, string[]>();
  for (const t of roots) {
    for (const tag of t.tags) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), t.slug]);
    }
  }
  for (const [tag, slugs] of byTag) {
    if (slugs.length >= 3 && !hasPending("tag-to-parent", tag, null)) {
      await appendProposal({
        type: "tag-to-parent",
        topic: tag,
        subtopic: null,
        reason: `${slugs.length} standalone topics share tag "${tag}" (${slugs.join(", ")}) — consider a merged parent`,
      });
      added += 1;
    }
  }

  return added;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const model = resolveModel(args.model);

  await startCompileRun({
    runId: process.env.PAPERWIKI_COMPILE_RUN_ID,
    source: process.env.PAPERWIKI_COMPILE_SOURCE === "ui" ? "ui" : "cli",
    model,
  });

  try {
    console.log(`PaperWiki compile — model: ${model}`);

    await runCompileStep("prepare-dirs", "Prepare workspace directories", () => ensureDirs());

    // Pre-flight: fail before touching anything if the LLM is unreachable.
    await runCompileStep("llm-preflight", "Check LLM connectivity", () => llmHealthCheck(model));
    console.log("LLM pre-flight check... ok");

    const inbox = await runCompileStep("scan-inbox", "Scan papers/new inbox", () => findInboxPdfs());
    await updateCompileRun({ totals: { papers: inbox.length, compiled: 0, duplicates: 0, failed: 0 } });

    if (inbox.length === 0) {
      const message = "papers/new/ is empty — nothing to compile.";
      console.log(message);
      await finishCompileRun("completed", message);
      return;
    }
    console.log(`Inbox: ${inbox.length} PDF(s)`);

    const compiled: DbPaper[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < inbox.length; i++) {
      const pdfPath = inbox[i];
      const basename = path.basename(pdfPath);
      try {
        const result = await processPdf(pdfPath, model, i, inbox.length);
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

    // Post-run: consolidation detection (Confirm-tier proposals only).
    const proposals = await runCompileStep(
      "consolidation-checks",
      "Check topic consolidation proposals",
      async () => {
        const finalDb = await deriveDb();
        const count = await consolidationChecks(finalDb);
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

    console.log(`\nDone. ${compiled.length} paper(s) compiled:`);
    for (const p of compiled) {
      console.log(`  - ${p.slug} → topic ${p.milestone}`);
    }
    if (skipped.length > 0) {
      console.log(`${skipped.length} duplicate(s) moved to papers/duplicates/:`);
      for (const s of skipped) console.log(`  - ${s}`);
    }

    const duplicateText = skipped.length > 0 ? `, ${skipped.length} duplicate(s) skipped` : "";
    await finishCompileRun("completed", `Compiled ${compiled.length} paper(s)${duplicateText}.`);
  } catch (err) {
    await finishCompileRun("failed", errorMessage(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✗ compile failed: ${errorMessage(err)}`);
  process.exit(1);
});
