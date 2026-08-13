/**
 * Persist phase: topic application, paper + topic page writes, and the
 * derived-file rebuild.
 *
 * Step ids match COMPILE_STEP_CATALOG.paper exactly.
 */
import * as path from "path";
import { truncate } from "../../lib/cli-utils";
import { venueTag } from "../helpers";
import { llmJson } from "../../../src/lib/llm";
import {
  appendLog,
  deriveDb,
  readTopicPages,
  regenIndex,
  today,
  writeDbAtomic,
  writePage,
  WIKI_PAPERS_DIR,
  WIKI_TOPICS_DIR,
  type DbPaper,
  type PaperFrontmatter,
  type TopicFrontmatter,
  type TopicPage,
} from "../../../src/lib/wiki";
import { renderPaperBody, renderTopicBody, normalizeKeyProperties, normalizeSubtopicNotes } from "../../../src/lib/templates";
import { topicSynthesisPrompt, type TopicSynthesis } from "../../../src/lib/prompts";
import { runCompileStep } from "../../../src/lib/runs";
import { SYNTH_MAX_TOKENS } from "../budgets";
import type { PaperCompileContext } from "../context";

/**
 * Apply classification to the topic layer. Topic page mutations
 * (create/assign) are read-modify-writes; the create-collision re-check is
 * defensive — a topic may have been created by an earlier run step since the
 * analysis snapshot was taken.
 */
export async function applyTopicClassification(
  ctx: PaperCompileContext
): Promise<{ topicPage: TopicPage; milestone: string; subtopic: string | null }> {
  return runCompileStep(
    "apply-topic-classification",
    "Apply topic classification",
    async () => {
      const topicPages = await readTopicPages();
      const classification = ctx.analysis.classification;

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
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}

/** Write the paper wiki page. cites[] is written by the end-of-run finalize pass (map is authoritative). */
export async function writePaperPage(ctx: PaperCompileContext): Promise<void> {
  const tags: string[] = [];
  if (ctx.analysis.publishedAt) tags.push(`year/${ctx.analysis.publishedAt}`);
  const vt = venueTag(ctx.analysis.venue ?? "");
  if (vt) tags.push(vt);

  const relations = [
    ...(ctx.analysis.predecessors ?? [])
      .filter((p) => ctx.db.papers.some((x) => x.slug === p.slug))
      .map((p) => ({ relation: p.relation, slug: p.slug, note: p.note })),
    ...(ctx.analysis.contradictions ?? [])
      .filter((p) => ctx.db.papers.some((x) => x.slug === p.slug))
      .map((p) => ({ relation: "contradicts", slug: p.slug, note: p.note })),
    ...(ctx.analysis.crossTopicImpacts ?? [])
      .filter((p) => ctx.db.papers.some((x) => x.slug === p.slug))
      .map((p) => ({ relation: "impacts", slug: p.slug, note: p.note })),
  ];

  const paperFm: PaperFrontmatter = {
    slug: ctx.slug,
    title: ctx.extraction.title,
    authors: ctx.analysis.authors ?? [],
    venue: ctx.analysis.venue ?? "",
    publishedAt: ctx.analysis.publishedAt ?? "",
    tags,
    milestone: ctx.milestone,
    subtopic: ctx.subtopic,
    numPages: ctx.extracted.numPages,
    addedAt: today(),
    rawPath: path.join("papers", "compiled", `${ctx.slug}.pdf`),
    pdfUrl: `/pdfs/${ctx.slug}.pdf`,
    figures: ctx.figures.map((f) => f.file),
    cites: [],
    citedBy: [],
    relations,
  };

  const paperBody = renderPaperBody({
    essence: ctx.extraction.essence,
    contributions: ctx.analysis.contributions ?? [],
    novelInsight: ctx.analysis.novelInsight,
    limitations: ctx.analysis.limitations ?? "",
    frontier: ctx.analysis.researchFrontier ?? "",
    relationsContext: ctx.analysis.relationsContext ?? "",
    relations,
    citations: { rawReferences: ctx.rawReferences, matches: [] },
    milestoneAnchor: ctx.milestone,
  });

  return runCompileStep(
    "write-paper-page",
    "Write paper wiki page",
    () => writePage(path.join(WIKI_PAPERS_DIR, `${ctx.slug}.md`), paperFm, paperBody),
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}

/**
 * LLM 4: topic synthesis. Incremental compounding: the NEW paper plus the
 * newest 11 of its milestone (insertion order ≈ chronological) — the topic
 * page evolves by incorporating new work, not by re-summarizing the oldest
 * sources. The existing body is passed to the prompt, so earlier insights are
 * retained, not restated.
 */
export async function synthesizeTopic(ctx: PaperCompileContext): Promise<TopicSynthesis> {
  const existingSources = ctx.db.papers.filter((p) => p.milestone === ctx.milestone);
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
      slug: ctx.slug,
      title: ctx.extraction.title,
      essence: ctx.extraction.essence,
      contributions: ctx.analysis.contributions ?? [],
      publishedAt: ctx.analysis.publishedAt ?? "",
    },
  ];

  return runCompileStep(
    "synthesize-topic",
    "Synthesize topic with LLM",
    async () => {
      const synthesisPrompt = topicSynthesisPrompt({
        topicName: ctx.topicPage.fm.name,
        topicSlug: ctx.topicPage.fm.slug,
        currentDefinition: ctx.topicPage.fm.definition,
        existingBody: ctx.topicPage.body || null,
        sources: sourcesForSynthesis,
        subtopics: ctx.topicPage.fm.subtopics,
        language: ctx.language,
      });
      return llmJson<TopicSynthesis>({ provider: ctx.provider, model: ctx.model, ...synthesisPrompt, maxTokens: SYNTH_MAX_TOKENS });
    },
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}

/**
 * Topic write re-reads the FRESH topic page + source list: the body reflects
 * every paper of the milestone compiled so far (the synthesis prose is
 * additive — last write wins, but no paper is ever lost from the cluster).
 */
export async function writeTopicPage(ctx: PaperCompileContext, synthesis: TopicSynthesis): Promise<void> {
  return runCompileStep(
    "write-topic-page",
    "Write topic wiki page",
    async () => {
      const fresh = await deriveDb();
      const freshTopicPages = await readTopicPages();
      const currentTopic = freshTopicPages.find((t) => t.fm.slug === ctx.topicPage.fm.slug) ?? ctx.topicPage;
      currentTopic.fm.definition = truncate(synthesis.definition, 400);
      const freshSources = fresh.papers.filter((p) => p.milestone === currentTopic.fm.slug && p.slug !== ctx.slug);
      const topicBody = renderTopicBody({
        fm: currentTopic.fm,
        definitionProse: synthesis.definition,
        keyProperties: normalizeKeyProperties(synthesis.keyProperties),
        sources: [
          ...freshSources.map((p) => ({
            slug: p.slug,
            title: p.title,
            venue: p.venue,
            publishedAt: p.publishedAt,
            subtopic: p.subtopic,
          })),
          { slug: ctx.slug, title: ctx.extraction.title, venue: ctx.analysis.venue ?? "", publishedAt: ctx.analysis.publishedAt ?? "", subtopic: ctx.subtopic },
        ],
        chronologicalEvolution: synthesis.chronologicalEvolution ?? null,
        subtopicNotes: normalizeSubtopicNotes(synthesis.subtopicNotes),
      });
      await writePage(currentTopic.filePath, currentTopic.fm, topicBody);
    },
    { ...ctx.paperCtx, slug: ctx.slug }
  );
}

/** Index, log, derived db — returns the freshly compiled paper. */
export async function rebuildDerivedFiles(ctx: PaperCompileContext): Promise<DbPaper> {
  const nextDb = await runCompileStep(
    "rebuild-derived-files",
    "Rebuild index, log, and database",
    async () => {
      const nextDb = await deriveDb();
      await regenIndex(nextDb, ctx.language);
      await appendLog("ingest", ctx.extraction.title, [
        `slug: ${ctx.slug}`,
        `topic: ${ctx.milestone}${ctx.subtopic ? ` / ${ctx.subtopic}` : ""} (${ctx.analysis.classification.action})`,
        `references: ${ctx.rawReferences.length} extracted (relations finalized at end of run)`,
        `provider: ${ctx.provider.id} · model: ${ctx.model}`,
      ]);
      await writeDbAtomic(nextDb);
      return nextDb;
    },
    { ...ctx.paperCtx, slug: ctx.slug }
  );
  return nextDb.papers.find((p) => p.slug === ctx.slug)!;
}
