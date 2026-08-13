/**
 * Shared lint plumbing: wiki-syntax regexes, page lookups, mechanical fixes,
 * and the issue/proposal emitters every rule uses.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { appendProposal, writePage, type PaperPage, type TopicPage } from "../wiki";
import { FIGURES_DIR_FOR } from "../extract-figures";
import type { LintIssue, LintState } from "./types";

export const WIKIKLINK_RE = /\[\[([a-z0-9][a-z0-9-]*)\]\]/gi;
export const FEEDS_MILESTONE_RE = /^milestone:\s*\[\[([^\]]+)\]\]$/m;
export const FIGURE_EMBED_RE = /!\[[^\]]*\]\(\/figures\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp))\)/gi;
const RELATION_LINE_RE = /^- \*\*([^*\n]+)\*\* \[\[([a-z0-9][a-z0-9-]*)\]\] — (.*)$/gm;

export function paperBySlug(pages: PaperPage[], slug: string): PaperPage | undefined {
  return pages.find((p) => p.fm.slug === slug);
}

export function topicBySlug(pages: TopicPage[], slug: string): TopicPage | undefined {
  return pages.find((t) => t.fm.slug === slug);
}

export function depthOf(slug: string, topicPages: TopicPage[], seen: Set<string> = new Set()): number {
  if (seen.has(slug)) return 99;
  const t = topicBySlug(topicPages, slug);
  if (!t || !t.fm.parent_milestone) return 1;
  return 1 + depthOf(t.fm.parent_milestone, topicPages, new Set([...seen, slug]));
}

/**
 * Report an issue. When the issue is auto-fixable and fixes are enabled, the
 * fix runs and the issue lands in `fixed` instead.
 */
export async function emit(state: LintState, issue: LintIssue, fix?: () => Promise<void>): Promise<void> {
  if (state.applyFixes && fix) {
    await fix();
    state.fixed.push(issue);
  } else {
    state.issues.push(issue);
  }
}

/** Queue a Confirm-tier proposal (deduped against pending keys); honors queueProposals. */
export async function queueProposal(
  state: LintState,
  type: string,
  topic: string,
  subtopic: string | null,
  reason: string
): Promise<void> {
  if (!state.queueProposals) return;
  const key = `${type}|${topic}|${subtopic ?? ""}`;
  if (state.pendingKeys.has(key)) return;
  await appendProposal({ type, topic, subtopic, reason });
  state.proposalsAdded += 1;
}

/** Add missing reciprocal citedBy entries; drop citedBy entries with no cites match. */
export async function fixCitationReciprocity(paper: PaperPage, all: PaperPage[]): Promise<string[]> {
  const done: string[] = [];
  const citedBy = [...paper.fm.citedBy];

  for (const target of paper.fm.cites) {
    const targetPage = paperBySlug(all, target);
    if (!targetPage) continue;
    if (!targetPage.fm.citedBy.includes(paper.fm.slug)) {
      targetPage.fm.citedBy = [...targetPage.fm.citedBy, paper.fm.slug].sort();
      await writePage(targetPage.filePath, targetPage.fm, targetPage.body);
      done.push(`added ${paper.fm.slug} to citedBy of ${target}`);
    }
  }

  // A citedBy entry `s` is stale when paper `s` no longer lists THIS paper in
  // its cites[] — i.e. reciprocity is broken from the other side.
  const stale = citedBy.filter((s) => {
    const citingPaper = paperBySlug(all, s);
    return !citingPaper || !citingPaper.fm.cites.includes(paper.fm.slug);
  });
  if (stale.length > 0) {
    paper.fm.citedBy = citedBy.filter((s) => !stale.includes(s)).sort();
    await writePage(paper.filePath, paper.fm, paper.body);
    done.push(`pruned stale citedBy entries (${stale.join(", ")}) of ${paper.fm.slug}`);
  }
  return done;
}

/** Sync the `milestone: [[...]]` line in a paper body's Feeds section. */
export async function fixFeedsMilestone(paper: PaperPage): Promise<string | null> {
  const expected = paper.fm.milestone;
  const match = paper.body.match(FEEDS_MILESTONE_RE);
  if (match && match[1] === expected) return null;
  let body = paper.body;
  if (match) {
    body = body.replace(FEEDS_MILESTONE_RE, `milestone: [[${expected}]]`);
  } else {
    body = `${body.replace(/\s+$/, "")}\n\n## Feeds\nmilestone: [[${expected}]]\n`;
  }
  await writePage(paper.filePath, paper.fm, body);
  return `synced Feeds milestone of ${paper.fm.slug} to [[${expected}]]`;
}

/** Drop figure entries whose file no longer exists on disk. */
export async function pruneBrokenFigures(paper: PaperPage): Promise<string | null> {
  if (!paper.fm.figures?.length) return null;
  const good: string[] = [];
  const missing: string[] = [];
  for (const file of paper.fm.figures) {
    try {
      await fs.stat(path.join(FIGURES_DIR_FOR(paper.fm.slug), file));
      good.push(file);
    } catch {
      missing.push(file);
    }
  }
  if (missing.length === 0) return null;
  paper.fm.figures = good;
  await writePage(paper.filePath, paper.fm, paper.body);
  return `pruned missing figure references (${missing.join(", ")}) of ${paper.fm.slug}`;
}

/** Parse `- **relation** [[slug]] — note` lines from the ## Relations body. */
export function parseBodyRelations(body: string): { relation: string; slug: string; note: string }[] {
  const out: { relation: string; slug: string; note: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = RELATION_LINE_RE.exec(body)) !== null) {
    out.push({ relation: m[1].trim(), slug: m[2], note: m[3].trim() });
  }
  return out;
}
