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
 *
 * Each check is a LintRule in src/lib/lint/; this module is the driver.
 */
import { appendLog, readPaperPages, readProposals, readTopicPages } from "./wiki";
import { checkBrokenWikilinks, checkFigureReferences } from "./lint/links";
import { checkCitationMapDrift, checkCitesReciprocity } from "./lint/citations";
import { checkFeedsMilestone, checkRelationsSync } from "./lint/relations";
import { checkGranularity, checkMilestoneValidity, checkTagToParent, checkTopicHierarchy } from "./lint/topics";
import { checkArchiveIntegrity, checkUntitledPapers } from "./lint/archive";
import { checkKnowledgeLayer } from "./lint/knowledge";
import type { LintContext, LintResult, LintRule, LintState } from "./lint/types";

export type { LintSeverity, LintIssue, LintResult, LintContext } from "./lint/types";

async function collectContext(): Promise<LintContext> {
  const [paperPages, topicPages, existingProposals] = await Promise.all([
    readPaperPages(),
    readTopicPages(),
    readProposals(),
  ]);
  return { paperPages, topicPages, existingProposals };
}

/** Checks run in this order; each contributes issues/fixes/proposals to the state. */
const RULES: LintRule[] = [
  checkBrokenWikilinks,
  checkCitationMapDrift,
  checkCitesReciprocity,
  checkRelationsSync,
  checkFeedsMilestone,
  checkFigureReferences,
  checkMilestoneValidity,
  checkTopicHierarchy,
  checkGranularity,
  checkTagToParent,
  checkArchiveIntegrity,
  checkUntitledPapers,
  checkKnowledgeLayer,
];

export async function runLint(opts: { applyFixes?: boolean; queueProposals?: boolean } = {}): Promise<LintResult> {
  const { applyFixes = false, queueProposals = true } = opts;
  const ctx = await collectContext();
  const paperSlugs = new Set(ctx.paperPages.map((p) => p.fm.slug));
  const topicSlugs = new Set(ctx.topicPages.map((t) => t.fm.slug));
  const knownSlugs = new Set([...paperSlugs, ...topicSlugs]);
  const state: LintState = {
    ctx,
    paperSlugs,
    topicSlugs,
    knownSlugs,
    applyFixes,
    queueProposals,
    issues: [],
    fixed: [],
    proposalsAdded: 0,
    pendingKeys: new Set(
      ctx.existingProposals.filter((p) => p.status === "pending").map((p) => `${p.type}|${p.topic}|${p.subtopic ?? ""}`)
    ),
  };

  for (const rule of RULES) {
    await rule.run(state);
  }

  // --- Audit trail ------------------------------------------------------------
  if (applyFixes && state.fixed.length > 0) {
    await appendLog("lint", "Auto-fixed wiki invariants", state.fixed.map((f) => f.message));
  }

  state.issues.sort((a, b) => (a.severity === b.severity ? a.kind.localeCompare(b.kind) : a.severity === "error" ? -1 : 1));
  return { generatedAt: new Date().toISOString(), issues: state.issues, fixed: state.fixed, proposalsAdded: state.proposalsAdded };
}

export function summarize(result: LintResult): { errors: number; warnings: number; ok: boolean } {
  const errors = result.issues.filter((i) => i.severity === "error").length;
  const warnings = result.issues.filter((i) => i.severity === "warning").length;
  return { errors, warnings, ok: errors === 0 };
}
