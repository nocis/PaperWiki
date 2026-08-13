/**
 * End-of-run finalize passes for the compile pipeline.
 *
 * - finalizeCitations: ONE slim LLM call per compiled paper against the FULL
 *   final index (plus self-heal for interrupted runs), then a global citedBy
 *   recompute. The citation relation is built at compile time; no separate
 *   rebuild is needed.
 * - finalizeRelations: re-maps typed relations against the FULL final index —
 *   the analyze pass saw only the pre-run index, so same-run papers are missed
 *   and stale seeds are never corrected.
 * - consolidationChecks: Confirm-tier reorganization proposals only (split,
 *   promote, tag-to-parent, merge) — queued, never auto-applied (P5).
 */
import { llmJson, type LLMProviderDef } from "../../src/lib/llm";
import { errorMessage } from "../lib/cli-utils";
import {
  appendLog,
  appendProposal,
  readPaperPages,
  readProposals,
  writePage,
  type DbPaper,
  type WikiDb,
} from "../../src/lib/wiki";
import { readCitationMap, recomputeCitedBy, remapPaperCitations } from "../../src/lib/citations";
import { finalizePaperRelations } from "../../src/lib/relations";
import { patchRelationsBlock } from "../../src/lib/templates";
import { topicMergePrompt, type TopicMergePair } from "../../src/lib/prompts";
import { MERGE_MAX_TOKENS } from "./budgets";

/**
 * Finalize citation relations for every map entry with a persisted reference
 * list but no records yet — this covers papers compiled this run AND pending
 * entries left by an interrupted earlier run (compile self-heals; no separate
 * rebuild needed).
 */
export async function finalizeCitations(
  compiled: DbPaper[],
  provider: LLMProviderDef,
  model: string
): Promise<{ slug: string; matched: number; total: number }[]> {
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
  // records empty) get finalized now.
  const pending = Object.entries((await readCitationMap()).papers).filter(
    ([, entry]) => entry.rawReferences.length > 0 && !compiled.some((p) => p.slug === entry.slug)
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

/**
 * Re-map typed relations against the full final index, one slim call per
 * compiled paper. Seeds from the analyze pass are only corrected when the
 * finalized set actually differs (pages are rewritten only then).
 */
export async function finalizeRelations(
  compiled: DbPaper[],
  provider: LLMProviderDef,
  model: string,
  language: string
): Promise<{ slug: string; before: number; after: number }[]> {
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
      language,
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

/** Confirm-tier consolidation proposals (never auto-applied). */
export async function consolidationChecks(
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
        maxTokens: MERGE_MAX_TOKENS,
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
      console.warn(`  ! merge-topic check skipped: ${errorMessage(err)}`);
    }
  }

  return added;
}
