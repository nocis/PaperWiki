import type { PaperPage, Proposal, TopicPage } from "../wiki";

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

export interface LintContext {
  paperPages: PaperPage[];
  topicPages: TopicPage[];
  existingProposals: Proposal[];
}

/** Mutable state threaded through every lint rule. */
export interface LintState {
  ctx: LintContext;
  paperSlugs: Set<string>;
  topicSlugs: Set<string>;
  knownSlugs: Set<string>;
  applyFixes: boolean;
  queueProposals: boolean;
  issues: LintIssue[];
  fixed: LintIssue[];
  proposalsAdded: number;
  pendingKeys: Set<string>;
}

/** One lint check: reads state, appends to state.issues/fixed/proposalsAdded. */
export interface LintRule {
  id: string;
  run(state: LintState): Promise<void>;
}
