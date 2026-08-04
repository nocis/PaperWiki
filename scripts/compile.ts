/**
 * PaperWiki incremental compiler.
 *
 * Usage: yarn compile [--provider <id>] [--model <id>]
 *
 * Semantics (see wiki/SCHEMA.md):
 * - papers/new/ is the work queue: every PDF in it is this run's goal.
 * - Pre-flight LLM check; if unreachable, abort before touching anything.
 * - Per PDF, TWO LLM calls: (1) a merged analyze + classification pass over
 *   the raw text (reference list extraction included — EVERY bibliography
 *   entry, no truncation), then (2) topic synthesis once the topic page is
 *   selected code-side. All else is code: slug resolution, figure extraction,
 *   page writes, index/derive.
 * - Citations: the reference list extracted in the merged call is persisted
 *   to data/citations/map.json mid-run. After ALL papers of the run are
 *   compiled, an end-of-run finalize pass runs ONE slim citation call per
 *   paper against the FULL final index (see remapPaperCitations) — the map
 *   entry, the ## Citations section, cites[] and the global citedBy[] are
 *   derived from that pass, so the citation relation is built at compile
 *   time with no manual rebuild.
 * - Any LLM failure mid-run aborts the run: processed papers persist,
 *   unprocessed PDFs stay in the inbox for the next run.
 */
import * as fs from "fs/promises";
import * as path from "path";
import {
  llmHealthCheck,
  llmJson,
  resolveModel,
  resolveProvider,
  type LLMProviderDef,
} from "../src/lib/llm";
import { extractPdf } from "../src/lib/extract";
import { extractFigures } from "../src/lib/extract-figures";
import {
  PAPERS_NEW,
  PAPERS_COMPILED,
  PAPERS_DUPLICATES,
  COMMENTS_DIR,
  WIKI_PAPERS_DIR,
  WIKI_TOPICS_DIR,
  appendLog,
  appendProposal,
  assertRemovedFromInbox,
  deriveDb,
  ensureDirs,
  findInboxPdfs,
  readPaperPages,
  readProposals,
  readTopicPages,
  regenIndex,
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
import {
  readCitationMap,
  recomputeCitedBy,
  remapPaperCitations,
  updatePaperCitations,
} from "../src/lib/citations";
import { renderPaperBody, renderTopicBody, patchRelationsBlock } from "../src/lib/templates";
import { appendWikiJournal } from "../src/lib/wiki-journal";
import { finalizePaperRelations } from "../src/lib/relations";
import {
  finishCompileRun,
  recordCompileEvent,
  resumeCompileRun,
  runCompileStep,
  startCompileRun,
  updateCompileRun,
} from "../src/lib/runs";
import {
  paperMergedPrompt,
  topicSynthesisPrompt,
  type Classification,
  type PaperMergedResponse,
  type TopicSynthesis,
} from "../src/lib/prompts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANGUAGE = "en";

function parseArgs(argv: string[]): { provider?: string; model?: string } {
  const out: { provider?: string; model?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider" && argv[i + 1]) {
      out.provider = argv[i + 1];
    } else if (argv[i].startsWith("--provider=")) {
      out.provider = argv[i].slice("--provider=".length);
    } else if (argv[i] === "--model" && argv[i + 1]) {
      out.model = argv[i + 1];
    } else if (argv[i].startsWith("--model=")) {
      out.model = argv[i].slice("--model=".length);
    }
  }
  return out;
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

  // --- LLM call 1: analyze + citations + classify (ONE merged call) ---------
  // The reference list, citation records, and classification all derive from
  // the raw paper text — extracted in a single round-trip. Classification and
  // citation records are validated code-side right after.
  const merged = await runCompileStep(
    "analyze-classify",
    "Analyze, classify, and build citations with LLM",
    async () => {
      const prompt = paperMergedPrompt({
        text: extracted.text,
        metaTitle: extracted.metaTitle,
        kbIndex: kbIndexText(db),
        topicTree: topicTreeText(db),
        language: LANGUAGE,
      });
      const raw = await llmJson<PaperMergedResponse>({
        provider,
        model,
        ...prompt,
        maxTokens: 16000,
        temperature: 0.2,
      });
      return {
        ...raw,
        classification: validateClassification(raw.classification, db),
      };
    },
    paperCtx
  );
  const analysis = merged;

  // --- Phase 2: report ------------------------------------------------------
  console.log(`  Title:        ${analysis.title}`);
  console.log(`  Lead:         ${truncate(analysis.essence, 300)}`);
  console.log(`  Positioning:  ${analysis.evolutionaryChain?.role ?? "?"} — ${truncate(analysis.evolutionaryChain?.note ?? "", 160)}`);
  console.log(`  Contribution: ${truncate(analysis.contributions[0] ?? "(none)", 200)}`);
  console.log(`  Limitation:   ${truncate(analysis.limitations, 160)}`);
  console.log(
    `  Topic:        ${analysis.classification.action === "create" ? `(new) ${analysis.classification.topic!.slug}` : analysis.classification.topicSlug}${analysis.classification.subtopicSlug ? ` / ${analysis.classification.subtopicSlug}` : ""} — ${truncate(analysis.classification.reason, 140)}`
  );

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

  // --- Citation records: persisted raw list, records built at end-of-run ------
  // The merged call extracts the FULL bibliography; normalization + matching
  // against the (complete) final index happens in the end-of-run finalize
  // pass (remapPaperCitations) so relations exist at compile time.
  const rawReferences = merged.references ?? [];
  console.log(`  References:   ${rawReferences.length} bibliography entr${rawReferences.length === 1 ? "y" : "ies"} extracted`);

  await runCompileStep(
    "write-citation-map",
    "Persist reference list to citation map",
    async () => {
      await updatePaperCitations(slug, {
        rawReferences,
        provider: provider.id,
        model,
        citations: [],
      });
    },
    { ...paperCtx, slug }
  );

  // --- Figure extraction (best-effort, never aborts the run) -----------------
  const figures = await runCompileStep(
    "extract-figures",
    "Extract figures",
    () => extractFigures(pdfPath, slug),
    { ...paperCtx, slug }
  );
  if (figures.length > 0) {
    console.log(`  Figures:      ${figures.map((f) => f.file).join(", ")}`);
  }

  // --- LLM 2: classify ------------------------------------------------------
  // Classification was validated inside the merged call; use it directly.
  const classification = merged.classification;

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

  // --- Citation links (code-side) ------------------------------------------------
  // cites[] is written by the end-of-run finalize pass (map is authoritative).
  const cites: string[] = [];

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
    figures: figures.map((f) => f.file),
    cites,
    citedBy: [],
    relations,
  };

  const paperBody = renderPaperBody({
    essence: analysis.essence,
    contributions: analysis.contributions ?? [],
    novelInsight: analysis.novelInsight,
    limitations: analysis.limitations ?? "",
    frontier: analysis.researchFrontier ?? "",
    relationsContext: analysis.relationsContext ?? "",
    relations,
    citations: { rawReferences, matches: [] },
    milestoneAnchor: milestone,
    figures,
  });

  const paperPath = path.join(WIKI_PAPERS_DIR, `${slug}.md`);
  await runCompileStep(
    "write-paper-page",
    "Write paper wiki page",
    () => writePage(paperPath, paperFm, paperBody),
    { ...paperCtx, slug }
  );

  // Bidirectional citedBy links are recomputed globally by the finalize pass
  // (cites[] is empty until then).

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
      return llmJson<TopicSynthesis>({ provider, model, ...synthesisPrompt });
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
    "Move PDF to compiled archive",
    async () => {
      const targetPath = path.join(PAPERS_COMPILED, `${slug}.pdf`);
      await fs.rename(pdfPath, targetPath);
      await assertRemovedFromInbox(basename);

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
        `references: ${rawReferences.length} extracted (relations finalized at end of run)`,
        `provider: ${provider.id} · model: ${model}`,
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
    for (let i = 0; i < inbox.length; i++) {
      const pdfPath = inbox[i];
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
      async () => {
        const pages = await readPaperPages();
        const bySlug = new Map(pages.map((p) => [p.fm.slug, p]));
        const index = pages.map((p) => ({ slug: p.fm.slug, title: p.fm.title, publishedAt: p.fm.publishedAt }));
        const stats: { slug: string; matched: number; total: number }[] = [];
        for (const paper of compiled) {
          const map = await readCitationMap();
          const refs = map.papers[paper.slug]?.rawReferences ?? [];
          if (refs.length === 0) continue;
          const result = await remapPaperCitations({
            slug: paper.slug,
            rawReferences: refs,
            index,
            provider,
            model,
            pagesBySlug: bySlug,
          });
          stats.push({ slug: paper.slug, matched: result.matched, total: result.total });
          await appendLog("citations", paper.title, [
            `slug: ${paper.slug}`,
            `linked: ${result.matched}/${result.total}`,
            `provider: ${provider.id} · model: ${model}`,
          ]);
        }
        // Self-heal: papers whose finalize was interrupted (raw list persisted,
        // records empty or stale-shaped) get finalized now.
        const pending = Object.entries((await readCitationMap()).papers).filter(
          ([, entry]) =>
            entry.rawReferences.length > 0 &&
            !compiled.some((p) => p.slug === entry.slug) &&
            (entry.citations.length === 0 || typeof entry.citations[0].entry !== "number")
        );
        for (const [slug, entry] of pending) {
          const result = await remapPaperCitations({
            slug,
            rawReferences: entry.rawReferences,
            index,
            provider,
            model,
            pagesBySlug: bySlug,
          });
          stats.push({ slug, matched: result.matched, total: result.total });
          await appendLog("citations", bySlug.get(slug)?.fm.title ?? slug, [
            `slug: ${slug}`,
            `linked: ${result.matched}/${result.total}`,
            `provider: ${provider.id} · model: ${model}`,
          ]);
        }
        const reciprocityChanges = await recomputeCitedBy(pages);
        if (reciprocityChanges > 0) {
          await appendLog("citations", "citedBy reciprocity", [`updated ${reciprocityChanges} paper(s)`]);
        }
        return stats;
      }
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
      async () => {
        const pages = await readPaperPages();
        const bySlug = new Map(pages.map((p) => [p.fm.slug, p]));
        const knownSlugs = new Set(pages.map((p) => p.fm.slug));
        const finalIndex = pages
          .map((p) => `- ${p.fm.slug} — "${p.fm.title}" (${p.fm.publishedAt})`)
          .slice(0, 60)
          .join("\n");
        const stats: { slug: string; before: number; after: number }[] = [];
        for (const compiledPaper of compiled) {
          const page = bySlug.get(compiledPaper.slug);
          const seed = page?.fm.relations ?? [];
          if (!page || seed.length === 0) continue;
          const finalized = await finalizePaperRelations({
            provider,
            model,
            language: LANGUAGE,
            title: page.fm.title,
            seed,
            index: finalIndex,
            knownSlugs,
            selfSlug: page.fm.slug,
          });
          if (JSON.stringify(finalized) !== JSON.stringify(seed)) {
            page.fm.relations = finalized;
            page.body = patchRelationsBlock(page.body, finalized);
            await writePage(page.filePath, page.fm, page.body);
            stats.push({ slug: page.fm.slug, before: seed.length, after: finalized.length });
            await appendLog("relations", page.fm.title, [
              `slug: ${page.fm.slug}`,
              `relations: ${seed.length} → ${finalized.length}`,
              `provider: ${provider.id} · model: ${model}`,
            ]);
          }
        }
        return stats;
      }
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
