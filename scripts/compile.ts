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
  DEDUP_SAME_SCORE,
  dedupScreenPrompt,
  paperMergedPrompt,
  titleEssencePrompt,
  topicMergePrompt,
  topicSynthesisPrompt,
  type Classification,
  type DedupScreen,
  type PaperMergedResponse,
  type TitleEssence,
  type TopicMergePair,
  type TopicSynthesis,
} from "../src/lib/prompts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANGUAGE = "en";

// ---------------------------------------------------------------------------
// Pipeline budgets (one place, tuned for a 1M-token / 384K-max-output model)
// ---------------------------------------------------------------------------

/** KB context budget shared by the deep call's relation index and the dedup screen's history slice (~75k tokens at ~4 chars/token). */
const KB_BUDGET_CHARS = 300_000;
/** Classification input budget for the topic tree (~25k tokens). */
const TOPIC_TREE_BUDGET_CHARS = 100_000;
/** Deep analysis call output bound (defensive; realistic need is well below). */
const DEEP_MAX_TOKENS = 65_536;
const TITLE_ESSENCE_MAX_TOKENS = 4_096;
const SCREEN_MAX_TOKENS = 1_024;
const SYNTH_MAX_TOKENS = 16_384;

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

/** A name carries no title signal when it is empty, pure digits ("0.pdf"), or an arXiv id ("2006.11239"). */
function isGarbageName(candidate: string): boolean {
  return !candidate || /^\d+$/.test(candidate) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(candidate);
}

/**
 * Canonical slug from the real title. Chain: LLM title → PDF metadata title →
 * dedicated-retry title → meaningful filename → "untitled-<filename>" (garbage
 * filenames only — flagged by lint).
 */
function resolveTitleSlug(llmTitle: string, metaTitle: string, retriedTitle: string, filenameSlug: string): string {
  for (const t of [llmTitle, metaTitle, retriedTitle]) {
    const s = slugify(t);
    if (!isGarbageName(s)) return s;
  }
  return !isGarbageName(filenameSlug) ? filenameSlug : `untitled-${filenameSlug || `paper-${Date.now()}`}`;
}

/** Title-token overlap (Jaccard over normalized tokens); higher = more similar. */
function titleOverlap(a: string, b: string): number {
  const tokens = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Papers ordered for LLM context: title-similarity first, recency as tiebreak
 * (insertion order ≈ chronological). The bounded slice is decided by the caller.
 */
function orderByRelevance<T extends { title: string }>(papers: T[], incomingTitle: string): T[] {
  return papers
    .map((p, i) => ({ p, score: titleOverlap(p.title, incomingTitle) - i / 1e6 }))
    .sort((a, b) => b.score - a.score)
    .map(({ p }) => p);
}

/** Fill a budgeted context block: consume lines until the char budget is exhausted. */
function buildBudgeted(lines: string[], budgetChars: number): string {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budgetChars) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

/** Compact, relevance-ordered KB context for the deep analysis prompt. */
function kbIndexText(db: WikiDb, incomingTitle: string): string {
  const lines = orderByRelevance(db.papers, incomingTitle).map(
    (p) => `- ${p.slug} — "${p.title}" (${p.venue}, ${p.publishedAt}): ${truncate(p.essence, 160)}`
  );
  return buildBudgeted(lines, KB_BUDGET_CHARS);
}

/**
 * Compact history record for the dedup screen: title + essence only.
 * Forced slugs (e.g. the slug-collision candidate) are guaranteed a seat.
 */
function historyRecordSlice(db: WikiDb, incomingTitle: string, forcedSlugs: string[]): string {
  const forced = forcedSlugs.map((s) => db.papers.find((p) => p.slug === s)).filter((p): p is DbPaper => !!p);
  const rest = orderByRelevance(
    db.papers.filter((p) => !forced.some((f) => f.slug === p.slug)),
    incomingTitle
  );
  const lines = [...forced, ...rest].map(
    (p) => `- ${p.slug} — "${p.title}" — ${truncate(p.essence, 200)}`
  );
  return buildBudgeted(lines, KB_BUDGET_CHARS);
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
  const lines = db.topics.map(
    (t) =>
      `- ${t.slug} (depth ${depth(t.slug)}, mode ${t.mode}${t.subtopics.length ? `, subtopics: ${t.subtopics.join(", ")}` : ""}) — ${truncate(t.definition, 140)}`
  );
  return buildBudgeted(lines, TOPIC_TREE_BUDGET_CHARS);
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

  // --- LLM 1: title + essence (the dedup key, decided before deep analysis) --
  // One slim call on the full text. A garbage title triggers ONE dedicated
  // retry (filename + metadata hint are already in the prompt). If both fail,
  // the resolve step falls back to metadata/filename and lint flags the result.
  const phaseA: TitleEssence = { title: "", essence: "" };
  let retriedTitle = "";
  await runCompileStep(
    "extract-title-essence",
    "Extract title and essence with LLM",
    async () => {
      const first = await llmJson<TitleEssence>({
        provider,
        model,
        ...titleEssencePrompt({
          text: extracted.text,
          metaTitle: extracted.metaTitle,
          filename: basename,
          language: LANGUAGE,
        }),
        maxTokens: TITLE_ESSENCE_MAX_TOKENS,
        temperature: 0.2,
      });
      phaseA.title = first?.title ?? "";
      phaseA.essence = first?.essence ?? "";
      if (!isGarbageName(slugify(phaseA.title)) || extracted.text.trim().length === 0) return;
      const retried = await llmJson<TitleEssence>({
        provider,
        model,
        ...titleEssencePrompt({
          text: extracted.text,
          metaTitle: extracted.metaTitle,
          filename: basename,
          language: LANGUAGE,
        }),
        maxTokens: TITLE_ESSENCE_MAX_TOKENS,
        temperature: 0,
      });
      if (!isGarbageName(slugify(retried?.title ?? ""))) {
        console.log(`  Title:        ${retried.title} (dedicated extraction)`);
        retriedTitle = retried?.title ?? "";
      }
    },
    paperCtx
  );

  // --- Canonical slug from the REAL title (code-only; the title is known) ----
  // Fallback chain: LLM title -> PDF metadata title -> retry title -> meaningful
  // filename -> "untitled-<filename>" (flagged by lint) only for garbage names.
  const { titleSlug, collidingPaper } = await runCompileStep(
    "resolve-title-slug",
    "Resolve canonical title slug",
    () => {
      const resolved = resolveTitleSlug(phaseA.title, extracted.metaTitle ?? "", retriedTitle, filenameSlug);
      return { titleSlug: resolved, collidingPaper: db.papers.find((p) => p.slug === resolved) ?? null };
    },
    paperCtx
  );
  let slug = titleSlug;

  // --- LLM 2: dedup screen (title+essence vs compiled history) ---------------
  // The screen is the SINGLE duplicate decision: score >= DEDUP_SAME_SCORE
  // means "same document" (conservative — below it, the paper compiles).
  // Colliding slugs are force-included in the record so the screen always
  // sees the collision candidate. An inconclusive screen (invalid response)
  // proceeds — a logged note, never a silent skip.
  let screenMatch: { slug: string | null; score: number } = { slug: null, score: 0 };
  if (phaseA.title.trim() || phaseA.essence.trim()) {
    screenMatch = await runCompileStep(
      "dedup-screen",
      "Screen against compiled papers with LLM",
      async () => {
        const forced = collidingPaper ? [collidingPaper.slug] : [];
        const record = historyRecordSlice(db, phaseA.title, forced);
        const raw = await llmJson<DedupScreen>({
          provider,
          model,
          ...dedupScreenPrompt({ title: phaseA.title, essence: phaseA.essence, record }),
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
              db.papers.some((p) => p.slug === raw.slug)));
        if (!valid) {
          console.log("  ! dedup screen inconclusive (invalid response) — proceeding");
          return { slug: null as string | null, score: 0 };
        }
        return { slug: raw.slug, score: raw.score };
      },
      { ...paperCtx, slug }
    );
  } else {
    await recordCompileEvent({
      ...paperCtx,
      slug,
      step: "dedup-screen",
      label: "Screen against compiled papers with LLM",
      status: "skipped",
      message: "No title or essence extracted (scanned PDF?)",
    });
  }

  // --- Duplicate verdict ------------------------------------------------------
  const duplicateOf =
    screenMatch.slug !== null && screenMatch.score >= DEDUP_SAME_SCORE ? screenMatch.slug : null;
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
      { ...paperCtx, slug }
    );
    await recordCompileEvent({
      ...paperCtx,
      slug,
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
  if (collidingPaper && slug === titleSlug) {
    slug = uniqueSlug(titleSlug, new Set(db.papers.map((p) => p.slug)));
    if (slug !== titleSlug) {
      console.log(`  Title collision with "${titleSlug}" — distinct paper, compiled as "${slug}"`);
    }
  }

  if (slug !== filenameSlug) {
    console.log(`  Renamed:      ${basename} -> ${slug}.pdf`);
  }

  // --- LLM 4: deep analysis + classification (full text) ---------------------
  // Title + essence are fixed facts from phase A — the deep call builds on
  // them and never re-derives them. Everything else (contributions, relations,
  // bibliography, classification) is grounded in the full paper text.
  const merged = await runCompileStep(
    "analyze-classify",
    "Analyze and classify with LLM",
    async () => {
      const prompt = paperMergedPrompt({
        text: extracted.text,
        metaTitle: extracted.metaTitle,
        kbIndex: kbIndexText(db, phaseA.title),
        topicTree: topicTreeText(db),
        language: LANGUAGE,
        knownTitle: phaseA.title,
        knownEssence: phaseA.essence,
      });
      const raw = await llmJson<PaperMergedResponse>({
        provider,
        model,
        ...prompt,
        // Reasoning models spend budget on reasoning_content first — headroom
        // is required or long-reasoning runs truncate to an empty content.
        maxTokens: DEEP_MAX_TOKENS,
        temperature: 0.2,
      });
      return {
        ...raw,
        classification: validateClassification(raw.classification, db),
      };
    },
    { ...paperCtx, slug }
  );
  const analysis = merged;

  // --- Phase 2: report ------------------------------------------------------
  console.log(`  Title:        ${phaseA.title}`);
  console.log(`  Lead:         ${truncate(phaseA.essence, 300)}`);
  console.log(`  Positioning:  ${analysis.evolutionaryChain?.role ?? "?"} — ${truncate(analysis.evolutionaryChain?.note ?? "", 160)}`);
  console.log(`  Contribution: ${truncate(analysis.contributions[0] ?? "(none)", 200)}`);
  console.log(`  Limitation:   ${truncate(analysis.limitations, 160)}`);
  console.log(
    `  Topic:        ${analysis.classification.action === "create" ? `(new) ${analysis.classification.topic!.slug}` : analysis.classification.topicSlug}${analysis.classification.subtopicSlug ? ` / ${analysis.classification.subtopicSlug}` : ""} — ${truncate(analysis.classification.reason, 140)}`
  );

  // --- Citation records: persisted raw list, records built at end-of-run ------
  // The deep call extracts the FULL bibliography; normalization + matching
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

  // --- LLM 5: classify (already validated inside the deep call) --------------
  const classification = merged.classification;

  // --- Frontmatter tags -------------------------------------------------------
  const tags: string[] = [];
  if (analysis.publishedAt) tags.push(`year/${analysis.publishedAt}`);
  const vt = venueTag(analysis.venue ?? "");
  if (vt) tags.push(vt);

  // --- Apply classification to topic layer -----------------------------------
  // Topic page mutations (create/assign) are read-modify-writes; the
  // create-collision re-check is defensive — a topic may have been created by
  // an earlier run step since the analysis snapshot was taken.
  const { topicPage, milestone, subtopic } = await runCompileStep(
    "apply-topic-classification",
    "Apply topic classification",
    async () => {
      const topicPages = await readTopicPages();

      if (classification.action === "create" && topicPages.some((t) => t.fm.slug === classification.topic!.slug)) {
        console.log(
          `  Topic collision: "${classification.topic!.slug}" already exists — assigning this paper to it`
        );
        classification.action = "assign";
        classification.topicSlug = classification.topic!.slug;
        classification.subtopicSlug = null;
      }

      const milestone =
        classification.action === "create" ? classification.topic!.slug : classification.topicSlug!;
      const subtopic = classification.action === "assign" ? classification.subtopicSlug ?? null : null;

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
        // Write the topic skeleton NOW: the paper page written next references
        // this milestone, so the topic file must exist on disk before it — any
        // deriveDb between here and write-topic-page must not find a missing
        // milestone topic (and an aborted run never leaves an orphan reference).
        // write-topic-page later overwrites this with the synthesized body.
        await writePage(selectedTopicPage.filePath, fm, "");
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
      return { topicPage: selectedTopicPage, milestone, subtopic };
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
    title: phaseA.title,
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
    essence: phaseA.essence,
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
  // Incremental compounding: the NEW paper plus the newest 11 of its milestone
  // (insertion order ≈ chronological) — the topic page evolves by incorporating
  // new work, not by re-summarizing the oldest sources. The existing body is
  // passed to the prompt, so earlier insights are retained, not restated.
  const existingSources = db.papers.filter((p) => p.milestone === milestone);
  const sourcesForSynthesis = [
    ...existingSources
      .slice(-11)
      .reverse()
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        essence: p.essence,
        contributions: [] as string[],
        publishedAt: p.publishedAt,
      })),
    {
      slug,
      title: phaseA.title,
      essence: phaseA.essence,
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
      return llmJson<TopicSynthesis>({ provider, model, ...synthesisPrompt, maxTokens: SYNTH_MAX_TOKENS });
    },
    { ...paperCtx, slug }
  );

  // Topic write re-reads the FRESH topic page + source list: the body reflects
  // every paper of the milestone compiled so far (the synthesis prose is
  // additive — last write wins, but no paper is ever lost from the cluster).
  await runCompileStep(
    "write-topic-page",
    "Write topic wiki page",
    async () => {
      const fresh = await deriveDb();
      const freshTopicPages = await readTopicPages();
      const currentTopic = freshTopicPages.find((t) => t.fm.slug === topicPage.fm.slug) ?? topicPage;
      currentTopic.fm.definition = truncate(synthesis.definition, 400);
      const freshSources = fresh.papers.filter((p) => p.milestone === currentTopic.fm.slug && p.slug !== slug);
      const topicBody = renderTopicBody({
        fm: currentTopic.fm,
        definitionProse: synthesis.definition,
        keyProperties: synthesis.keyProperties ?? [],
        sources: [
          ...freshSources.map((p) => ({
            slug: p.slug,
            title: p.title,
            venue: p.venue,
            publishedAt: p.publishedAt,
            subtopic: p.subtopic,
          })),
          { slug, title: phaseA.title, venue: analysis.venue ?? "", publishedAt: analysis.publishedAt ?? "", subtopic },
        ],
        chronologicalEvolution: synthesis.chronologicalEvolution ?? null,
        subtopicNotes: synthesis.subtopicNotes ?? {},
      });
      await writePage(currentTopic.filePath, currentTopic.fm, topicBody);
    },
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

  // --- Index, log, derived db -------------------------------------------------
  const freshDb = await runCompileStep(
    "rebuild-derived-files",
    "Rebuild index, log, and database",
    async () => {
      const nextDb = await deriveDb();
      await regenIndex(nextDb, LANGUAGE);
      await appendLog("ingest", phaseA.title, [
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

async function consolidationChecks(
  db: WikiDb,
  provider: LLMProviderDef,
  model: string,
  newTopicSlugs: string[]
): Promise<number> {
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

  // Merge candidates: only when this run created a topic. One LLM pass over
  // the whole tree (slug+name+definition) surfaces near-duplicates as
  // Confirm-tier proposals — never auto-applied (P5). A failure here must not
  // abort the compile, so it is caught and logged.
  if (newTopicSlugs.length > 0 && db.topics.length >= 2) {
    try {
      const newSet = new Set(newTopicSlugs);
      const prompt = topicMergePrompt({
        topics: db.topics.map((t) => ({
          slug: t.slug,
          name: t.name,
          definition: t.definition,
          parentSlug: t.parentSlug,
        })),
      });
      const raw = await llmJson<{ mergeCandidates?: TopicMergePair[] }>({
        provider,
        model,
        ...prompt,
        maxTokens: 2048,
        temperature: 0,
      });
      for (const pair of raw.mergeCandidates ?? []) {
        const a = db.topics.find((t) => t.slug === pair.slugA);
        const b = db.topics.find((t) => t.slug === pair.slugB);
        if (!a || !b || a.slug === b.slug) continue;
        if (a.parentSlug === b.slug || b.parentSlug === a.slug) continue;
        if (a.children.includes(b.slug) || b.children.includes(a.slug)) continue;
        if (a.subtopics.includes(b.slug) || b.subtopics.includes(a.slug)) continue;
        if (!newSet.has(a.slug) && !newSet.has(b.slug)) continue;
        const [slugA, slugB] = [a.slug, b.slug].sort();
        if (hasPending("merge-topic", slugA, slugB)) continue;
        await appendProposal({
          type: "merge-topic",
          topic: slugA,
          subtopic: slugB,
          reason: `${pair.reason} (new topic involved: ${newTopicSlugs.join(", ")})`,
        });
        added += 1;
      }
    } catch (err) {
      console.warn(`  ! merge-topic check skipped: ${err instanceof Error ? err.message : String(err)}`);
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
