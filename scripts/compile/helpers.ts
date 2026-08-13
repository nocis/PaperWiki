/**
 * Pure helpers shared by the compile pipeline steps.
 *
 * The context-budget constants live in budgets.ts (KB context, topic tree).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { truncate } from "../lib/cli-utils";
import { PAPERS_DUPLICATES, slugify, type DbPaper, type WikiDb } from "../../src/lib/wiki";
import type { Classification } from "../../src/lib/prompts";
import { KB_BUDGET_CHARS, TOPIC_TREE_BUDGET_CHARS } from "./budgets";

/** A name carries no title signal when it is empty, pure digits ("0.pdf"), or an arXiv id ("2006.11239"). */
export function isGarbageName(candidate: string): boolean {
  return !candidate || /^\d+$/.test(candidate) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(candidate);
}

/**
 * Canonical slug from the real title. Chain: LLM title → PDF metadata title →
 * dedicated-retry title → meaningful filename → "untitled-<filename>" (garbage
 * filenames only — flagged by lint).
 */
export function resolveCanonicalSlug(llmTitle: string, metaTitle: string, retriedTitle: string, filenameSlug: string): string {
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
export function kbIndexText(db: WikiDb, incomingTitle: string): string {
  const lines = orderByRelevance(db.papers, incomingTitle).map(
    (p) => `- ${p.slug} — "${p.title}" (${p.venue}, ${p.publishedAt}): ${truncate(p.essence, 160)}`
  );
  return buildBudgeted(lines, KB_BUDGET_CHARS);
}

/**
 * Compact history record for the dedup screen: title + essence only.
 * Forced slugs (e.g. the slug-collision candidate) are guaranteed a seat.
 */
export function historyRecordSlice(db: WikiDb, incomingTitle: string, forcedSlugs: string[]): string {
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
export function topicTreeText(db: WikiDb): string {
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

export function venueTag(venue: string): string | null {
  const v = venue.trim().replace(/\s+/g, "-");
  return v ? `venue/${v}` : null;
}

export function validateClassification(c: Classification, db: WikiDb): Classification {
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

/** Duplicates are non-fatal: move aside so the inbox drains, and continue the run. */
export async function moveToDuplicates(pdfPath: string, reason: string): Promise<void> {
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
