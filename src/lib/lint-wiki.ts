/**
 * Wiki health linter + invariant inspector.
 *
 * Reads the markdown wiki directly (never deriveDb — invariant violations make
 * deriveDb throw, which is exactly what lint should surface as issues).
 *
 * Two-tier resolution (mirrors the AutoWiki autonomy model):
 * - Auto-fixable (mechanical): reciprocal cites/citedBy repair, Feeds
 *   milestone sync, pruning broken figure references. Applied in place.
 * - Structural (Confirm-tier): granularity violations and tag-to-parent
 *   candidates are queued in wiki/proposals.md, never auto-applied.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { appendLog, appendProposal, PAPERS_COMPILED, readPaperPages, readProposals, readTopicPages, writePage, type PaperPage, type Proposal, type TopicPage } from "./wiki";
import { FIGURES_DIR_FOR } from "./extract-figures";
import { matchedSlugsOf, readCitationMap } from "./citations";
import { KNOWLEDGE_ARTICLES_DIR, KNOWLEDGE_PIECES_DIR, readArticles, readPieces } from "./knowledge";
import { MAX_REFERENCES } from "./prompts";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  /** Machine-readable kind, e.g. "broken-wikilink". */
  kind: string;
  /** Page path relative to wiki/ (or paper slug) the issue belongs to. */
  target?: string;
  message: string;
  /** True when the issue can be repaired mechanically. */
  autoFixable: boolean;
}

export interface LintResult {
  generatedAt: string;
  /** Remaining issues after auto-fixes were applied. */
  issues: LintIssue[];
  /** Issues auto-fixed during this run. */
  fixed: LintIssue[];
  /** Structural proposals queued during this run. */
  proposalsAdded: number;
}

const WIKIKLINK_RE = /\[\[([a-z0-9][a-z0-9-]*)\]\]/gi;
const FEEDS_MILESTONE_RE = /^milestone:\s*\[\[([^\]]+)\]\]$/m;
const FIGURE_EMBED_RE = /!\[[^\]]*\]\(\/figures\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp))\)/gi;

export interface LintContext {
  paperPages: PaperPage[];
  topicPages: TopicPage[];
  existingProposals: Proposal[];
}

async function collectContext(): Promise<LintContext> {
  const [paperPages, topicPages, existingProposals] = await Promise.all([
    readPaperPages(),
    readTopicPages(),
    readProposals(),
  ]);
  return { paperPages, topicPages, existingProposals };
}

function paperBySlug(pages: PaperPage[], slug: string): PaperPage | undefined {
  return pages.find((p) => p.fm.slug === slug);
}

function topicBySlug(pages: TopicPage[], slug: string): TopicPage | undefined {
  return pages.find((t) => t.fm.slug === slug);
}

function depthOf(slug: string, topicPages: TopicPage[], seen: Set<string> = new Set()): number {
  if (seen.has(slug)) return 99;
  const t = topicBySlug(topicPages, slug);
  if (!t || !t.fm.parent_milestone) return 1;
  return 1 + depthOf(t.fm.parent_milestone, topicPages, new Set([...seen, slug]));
}

// ---------------------------------------------------------------------------
// Auto-fixes
// ---------------------------------------------------------------------------

/** Add missing reciprocal citedBy entries; drop citedBy entries with no cites match. */
async function fixCitationReciprocity(paper: PaperPage, all: PaperPage[]): Promise<string[]> {
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
async function fixFeedsMilestone(paper: PaperPage): Promise<string | null> {
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
async function pruneBrokenFigures(paper: PaperPage): Promise<string | null> {
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

// ---------------------------------------------------------------------------
// Main lint
// ---------------------------------------------------------------------------

export async function runLint(opts: { applyFixes?: boolean; queueProposals?: boolean } = {}): Promise<LintResult> {
  const { applyFixes = false, queueProposals = true } = opts;
  const ctx = await collectContext();
  const issues: LintIssue[] = [];
  const fixed: LintIssue[] = [];
  let proposalsAdded = 0;

  const paperSlugs = new Set(ctx.paperPages.map((p) => p.fm.slug));
  const topicSlugs = new Set(ctx.topicPages.map((t) => t.fm.slug));
  const knownSlugs = new Set([...paperSlugs, ...topicSlugs]);

  // --- Broken wikilinks ------------------------------------------------------
  for (const page of [...ctx.paperPages, ...ctx.topicPages]) {
    const body = page.body;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = WIKIKLINK_RE.exec(body)) !== null) {
      const slug = m[1];
      if (knownSlugs.has(slug) || seen.has(slug)) continue;
      seen.add(slug);
      issues.push({
        severity: "error",
        kind: "broken-wikilink",
        target: page.fm.slug,
        message: `links to missing page [[${slug}]]`,
        autoFixable: false,
      });
    }
  }

  // --- Citation map ↔ frontmatter (LLM-built map is authoritative) -------------
  const citationMap = await readCitationMap();
  for (const paper of ctx.paperPages) {
    const entry = citationMap.papers[paper.fm.slug];
    if (!entry) {
      issues.push({
        severity: "warning",
        kind: "missing-citation-map",
        target: paper.fm.slug,
        message: "no LLM citation map entry — run citation rebuild from the health page",
        autoFixable: false,
      });
      continue;
    }
    if (entry.rawReferences.length >= MAX_REFERENCES) {
      issues.push({
        severity: "warning",
        kind: "truncated-references",
        target: paper.fm.slug,
        message: `reference list hits the extraction cap (${entry.rawReferences.length} >= ${MAX_REFERENCES}) — some bibliography entries may be missing; recompile the paper to re-extract every entry`,
        autoFixable: false,
      });
    }
    const expected = matchedSlugsOf(entry.citations);
    const current = [...paper.fm.cites].sort();
    if (expected.join("|") !== current.join("|")) {
      const issue: LintIssue = {
        severity: "warning",
        kind: "cites-map-drift",
        target: paper.fm.slug,
        message: `cites[] differs from citation map (expected ${expected.length} slug(s), has ${current.length})`,
        autoFixable: true,
      };
      if (applyFixes) {
        paper.fm.cites = expected;
        await writePage(paper.filePath, paper.fm, paper.body);
        fixed.push(issue);
      } else {
        issues.push(issue);
      }
    }
  }

  // --- cites/citedBy reciprocity ---------------------------------------------
  for (const paper of ctx.paperPages) {
    for (const target of paper.fm.cites) {
      const targetPage = paperBySlug(ctx.paperPages, target);
      if (!targetPage) {
        issues.push({
          severity: "error",
          kind: "unknown-cite",
          target: paper.fm.slug,
          message: `cites unknown paper "${target}"`,
          autoFixable: false,
        });
        continue;
      }
      if (!targetPage.fm.citedBy.includes(paper.fm.slug)) {
        const issue: LintIssue = {
          severity: "error",
          kind: "missing-cited-by",
          target: paper.fm.slug,
          message: `cites "${target}" but is missing from its citedBy[]`,
          autoFixable: true,
        };
        if (applyFixes) {
          await fixCitationReciprocity(paper, ctx.paperPages);
          fixed.push(issue);
        } else {
          issues.push(issue);
        }
      }
    }
    const stale = paper.fm.citedBy.filter((s) => {
      const citingPaper = paperBySlug(ctx.paperPages, s);
      return !citingPaper || !citingPaper.fm.cites.includes(paper.fm.slug);
    });
    if (stale.length > 0) {
      const issue: LintIssue = {
        severity: "warning",
        kind: "stale-cited-by",
        target: paper.fm.slug,
        message: `citedBy[] lists papers that do not cite it (${stale.join(", ")})`,
        autoFixable: true,
      };
      if (applyFixes) {
        await fixCitationReciprocity(paper, ctx.paperPages);
        fixed.push(issue);
      } else {
        issues.push(issue);
      }
    }
  }

  // --- Feeds ↔ milestone sync --------------------------------------------------
  for (const paper of ctx.paperPages) {
    const match = paper.body.match(FEEDS_MILESTONE_RE);
    if (match && match[1] !== paper.fm.milestone) {
      const issue: LintIssue = {
        severity: "error",
        kind: "feeds-milestone-mismatch",
        target: paper.fm.slug,
        message: `Feeds milestone [[${match[1]}]] differs from frontmatter milestone "${paper.fm.milestone}"`,
        autoFixable: true,
      };
      if (applyFixes) {
        await fixFeedsMilestone(paper);
        fixed.push(issue);
      } else {
        issues.push(issue);
      }
    } else if (!match) {
      issues.push({
        severity: "warning",
        kind: "missing-feeds",
        target: paper.fm.slug,
        message: "body has no Feeds milestone line",
        autoFixable: true,
      });
    }
  }

  // --- Figure references --------------------------------------------------------
  for (const paper of ctx.paperPages) {
    const missing: string[] = [];
    for (const file of paper.fm.figures ?? []) {
      try {
        await fs.stat(path.join(FIGURES_DIR_FOR(paper.fm.slug), file));
      } catch {
        missing.push(file);
      }
    }
    const bodyFigureFiles = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = FIGURE_EMBED_RE.exec(paper.body)) !== null) {
      const [, embedSlug, embedFile] = m;
      if (embedSlug !== paper.fm.slug) continue;
      bodyFigureFiles.add(embedFile);
      if (!(paper.fm.figures ?? []).includes(embedFile)) {
        issues.push({
          severity: "warning",
          kind: "figure-not-in-frontmatter",
          target: paper.fm.slug,
          message: `body embeds /figures/${embedSlug}/${embedFile} but frontmatter figures[] does not list it`,
          autoFixable: false,
        });
      }
    }
    if (missing.length > 0) {
      const issue: LintIssue = {
        severity: "error",
        kind: "broken-figure",
        target: paper.fm.slug,
        message: `frontmatter lists missing figure file(s): ${missing.join(", ")}`,
        autoFixable: true,
      };
      if (applyFixes) {
        await pruneBrokenFigures(paper);
        fixed.push(issue);
      } else {
        issues.push(issue);
      }
    }
  }

  // --- Milestone / subtopic validity --------------------------------------------
  for (const paper of ctx.paperPages) {
    const topic = topicBySlug(ctx.topicPages, paper.fm.milestone);
    if (!topic) {
      issues.push({
        severity: "error",
        kind: "orphan-paper",
        target: paper.fm.slug,
        message: `milestone "${paper.fm.milestone}" is not a topic`,
        autoFixable: false,
      });
    } else if (paper.fm.subtopic && !(topic.fm.subtopics ?? []).includes(paper.fm.subtopic)) {
      issues.push({
        severity: "error",
        kind: "unknown-subtopic",
        target: paper.fm.slug,
        message: `claims subtopic "${paper.fm.subtopic}" not listed in topic "${topic.fm.slug}"`,
        autoFixable: false,
      });
    }
  }

  // --- Topic hierarchy -------------------------------------------------------------
  for (const topic of ctx.topicPages) {
    if (topic.fm.parent_milestone) {
      const parent = topicBySlug(ctx.topicPages, topic.fm.parent_milestone);
      if (!parent) {
        issues.push({
          severity: "error",
          kind: "unknown-parent",
          target: topic.fm.slug,
          message: `parent_milestone "${topic.fm.parent_milestone}" does not exist`,
          autoFixable: false,
        });
      } else if (!parent.fm.children.includes(topic.fm.slug)) {
        issues.push({
          severity: "error",
          kind: "parent-children-mismatch",
          target: topic.fm.slug,
          message: `parent "${parent.fm.slug}" does not list it in children[]`,
          autoFixable: false,
        });
      }
    }
    for (const child of topic.fm.children) {
      const childPage = topicBySlug(ctx.topicPages, child);
      if (!childPage) {
        issues.push({
          severity: "error",
          kind: "unknown-child",
          target: topic.fm.slug,
          message: `lists child "${child}" which does not exist`,
          autoFixable: false,
        });
      } else if (childPage.fm.parent_milestone !== topic.fm.slug) {
        issues.push({
          severity: "error",
          kind: "child-parent-mismatch",
          target: topic.fm.slug,
          message: `child "${child}" has parent_milestone "${childPage.fm.parent_milestone}"`,
          autoFixable: false,
        });
      }
    }
    if (depthOf(topic.fm.slug, ctx.topicPages) > 3) {
      issues.push({
        severity: "error",
        kind: "depth-overflow",
        target: topic.fm.slug,
        message: "exceeds max topic depth 3",
        autoFixable: false,
      });
    }
  }

  // --- Hollow / granularity (Confirm-tier proposals) --------------------------------
  const topicCounts = new Map<string, number>();
  for (const paper of ctx.paperPages) {
    topicCounts.set(paper.fm.milestone, (topicCounts.get(paper.fm.milestone) ?? 0) + 1);
  }

  const pendingKeys = new Set(
    ctx.existingProposals.filter((p) => p.status === "pending").map((p) => `${p.type}|${p.topic}|${p.subtopic ?? ""}`)
  );

  const queueProposal = async (type: string, topic: string, subtopic: string | null, reason: string) => {
    const key = `${type}|${topic}|${subtopic ?? ""}`;
    if (pendingKeys.has(key)) return;
    await appendProposal({ type, topic, subtopic, reason });
    proposalsAdded += 1;
  };

  for (const topic of ctx.topicPages) {
    const count = topicCounts.get(topic.fm.slug) ?? 0;
    if (topic.fm.mode === "standalone" && count > 8) {
      issues.push({
        severity: "warning",
        kind: "granularity",
        target: topic.fm.slug,
        message: `${count} sources > 8 — candidate for split-topic`,
        autoFixable: false,
      });
      if (queueProposals) {
        await queueProposal("split-topic", topic.fm.slug, null, `${count} sources > 8 — topic is too coarse; identify sub-clusters`);
      }
    }
    if (topic.fm.mode === "merged") {
      for (const sub of topic.fm.subtopics) {
        const subCount = ctx.paperPages.filter((p) => p.fm.milestone === topic.fm.slug && p.fm.subtopic === sub).length;
        if (subCount >= 5) {
          issues.push({
            severity: "warning",
            kind: "granularity",
            target: topic.fm.slug,
            message: `subtopic "${sub}" has ${subCount} papers >= 5 — candidate for promote-subtopic`,
            autoFixable: false,
          });
          if (queueProposals) {
            await queueProposal("promote-subtopic", topic.fm.slug, sub, `${subCount} papers >= 5 — split out to topics/${topic.fm.slug}/${sub}.md`);
          }
        }
      }
    }
    if (count === 0 && topic.fm.children.length === 0) {
      issues.push({
        severity: "warning",
        kind: "hollow-topic",
        target: topic.fm.slug,
        message: "topic has no sources and no children",
        autoFixable: false,
      });
    }
  }

  // Tag-to-parent: 3+ root standalone topics sharing a tag.
  const roots = ctx.topicPages.filter((t) => !t.fm.parent_milestone && t.fm.mode === "standalone");
  const byTag = new Map<string, string[]>();
  for (const t of roots) {
    for (const tag of t.fm.tags ?? []) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), t.fm.slug]);
    }
  }
  for (const [tag, slugs] of byTag) {
    if (slugs.length >= 3) {
      issues.push({
        severity: "warning",
        kind: "tag-to-parent",
        target: tag,
        message: `${slugs.length} standalone topics share tag "${tag}" (${slugs.join(", ")})`,
        autoFixable: false,
      });
      if (queueProposals) {
        await queueProposal("tag-to-parent", tag, null, `${slugs.length} standalone topics share tag "${tag}" (${slugs.join(", ")}) — consider a merged parent`);
      }
    }
  }

  // --- Archive integrity ----------------------------------------------------------
  let compiledEntries: string[] = [];
  try {
    compiledEntries = await fs.readdir(PAPERS_COMPILED);
  } catch {
    /* dir may not exist yet */
  }
  const figuresDirs = new Set(compiledEntries.filter((e) => e.endsWith("_figures")));
  for (const dir of figuresDirs) {
    const slug = dir.replace(/_figures$/, "");
    if (!paperSlugs.has(slug)) {
      issues.push({
        severity: "warning",
        kind: "orphan-figures-dir",
        target: slug,
        message: `papers/compiled/${dir} exists but no paper "${slug}" references it`,
        autoFixable: false,
      });
    }
  }

  for (const paper of ctx.paperPages) {
    try {
      await fs.stat(path.join(PAPERS_COMPILED, `${paper.fm.slug}.pdf`));
    } catch {
      issues.push({
        severity: "error",
        kind: "missing-pdf",
        target: paper.fm.slug,
        message: `compiled PDF missing: papers/compiled/${paper.fm.slug}.pdf`,
        autoFixable: false,
      });
    }
  }

  // --- Audit trail ------------------------------------------------------------
  if (applyFixes && fixed.length > 0) {
    await appendLog("lint", "Auto-fixed wiki invariants", fixed.map((f) => f.message));
  }

  // --- Knowledge layer (pieces + derived articles) ------------------------------
  const [pieces, articles] = await Promise.all([readPieces(), readArticles()]);
  const pieceSlugSet = new Set(pieces.map((p) => p.fm.slug));
  const articleSlugSet = new Set(articles.map((a) => a.fm.slug));
  const knowledgeKnown = new Set([...pieceSlugSet, ...articleSlugSet]);

  // Article frontmatter consistency (derived artifacts — drift means a stale
  // compile, not a hand edit).
  for (const article of articles) {
    for (const slug of article.fm.pieceSlugs) {
      if (!pieceSlugSet.has(slug)) {
        issues.push({
          severity: "warning",
          kind: "article-unknown-piece",
          target: article.fm.slug,
          message: `article lists piece [[${slug}]] which does not exist — recompile knowledge`,
          autoFixable: false,
        });
      }
    }
    for (const slug of article.fm.paperSlugs) {
      if (!paperSlugs.has(slug)) {
        issues.push({
          severity: "warning",
          kind: "article-unknown-paper",
          target: article.fm.slug,
          message: `article grounds on paper [[${slug}]] which is not compiled — recompile knowledge`,
          autoFixable: false,
        });
      }
    }
    const body = article.body;
    const seenBody = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = WIKIKLINK_RE.exec(body)) !== null) {
      const slug = m[1];
      if (knowledgeKnown.has(slug) || knownSlugs.has(slug) || seenBody.has(slug)) continue;
      seenBody.add(slug);
      issues.push({
        severity: "warning",
        kind: "article-broken-wikilink",
        target: article.fm.slug,
        message: `article links to missing page [[${slug}]]`,
        autoFixable: false,
      });
    }
  }

  // Orphan pieces: not referenced by any article. Not an error — the human may
  // be mid-curation — but a warning that a compile is needed.
  const coveredPieces = new Set<string>();
  for (const article of articles) {
    for (const slug of article.fm.pieceSlugs) coveredPieces.add(slug);
  }
  for (const piece of pieces) {
    if (!coveredPieces.has(piece.fm.slug)) {
      issues.push({
        severity: "warning",
        kind: "orphan-piece",
        target: piece.fm.slug,
        message: "piece is not covered by any topic article — run a knowledge compile",
        autoFixable: false,
      });
    }
    // Origin guard: pieces may only come from Add-to-knowledge (reading note →
    // comment id; chat range → chat-<timestamp>). Anything else is unsanctioned.
    const source = String(piece.fm.source ?? "");
    const sanctioned =
      piece.fm.kind === "note"
        ? /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(source) || /^note-/.test(source)
        : /^chat-/.test(source);
    if (!sanctioned) {
      issues.push({
        severity: "warning",
        kind: "unsanctioned-origin",
        target: piece.fm.slug,
        message: `piece of kind "${piece.fm.kind}" has source "${source}" which is neither a reading-note comment id nor a chat-<timestamp> label`,
        autoFixable: false,
      });
    }
  }

  issues.sort((a, b) => (a.severity === b.severity ? a.kind.localeCompare(b.kind) : a.severity === "error" ? -1 : 1));
  return { generatedAt: new Date().toISOString(), issues, fixed, proposalsAdded };
}

export function summarize(result: LintResult): { errors: number; warnings: number; ok: boolean } {
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.filter((i) => i.severity === "warning").length;
  return { errors, warnings, ok: errors === 0 };
}
