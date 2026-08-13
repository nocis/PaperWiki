/**
 * Relations and Feeds checks: frontmatter relations[] ↔ ## Relations body
 * sync, and the Feeds milestone line ↔ frontmatter milestone.
 */
import { writePage } from "../wiki";
import { emit, FEEDS_MILESTONE_RE, fixFeedsMilestone, parseBodyRelations } from "./state";
import type { LintIssue, LintRule, LintState } from "./types";

/**
 * Relations ↔ frontmatter sync. The ## Relations body is authoritative for
 * legacy pages (compiled before relations[] existed in frontmatter). Sync the
 * frontmatter, verify slugs.
 */
export const checkRelationsSync: LintRule = {
  id: "relations-sync",
  async run(state: LintState) {
    for (const paper of state.ctx.paperPages) {
      const bodyRelations = parseBodyRelations(paper.body)
        .filter((r) => state.paperSlugs.has(r.slug))
        .filter(
          (r, i, arr) =>
            arr.findIndex((x) => x.relation === r.relation && x.slug === r.slug && x.note === r.note) === i
        );
      const fmRelations = (paper.fm.relations ?? []).map((r) => ({
        relation: String(r.relation ?? ""),
        slug: String(r.slug ?? ""),
        note: String(r.note ?? ""),
      }));
      if (bodyRelations.length > 0 && JSON.stringify(bodyRelations) !== JSON.stringify(fmRelations)) {
        const issue: LintIssue = {
          severity: "warning",
          kind: "relations-body-drift",
          target: paper.fm.slug,
          message: `frontmatter relations[] differs from ## Relations body (${fmRelations.length} in frontmatter, ${bodyRelations.length} in body)`,
          autoFixable: true,
        };
        await emit(state, issue, async () => {
          paper.fm.relations = bodyRelations;
          await writePage(paper.filePath, paper.fm, paper.body);
        });
      }
      const unknown = (paper.fm.relations ?? []).filter((r) => !state.paperSlugs.has(r.slug));
      if (unknown.length > 0) {
        const issue: LintIssue = {
          severity: "error",
          kind: "unknown-relation",
          target: paper.fm.slug,
          message: `relations[] reference unknown paper(s): ${unknown.map((r) => r.slug).join(", ")}`,
          autoFixable: true,
        };
        await emit(state, issue, async () => {
          paper.fm.relations = (paper.fm.relations ?? []).filter((r) => state.paperSlugs.has(r.slug));
          await writePage(paper.filePath, paper.fm, paper.body);
        });
      }
    }
  },
};

/** Feeds ↔ milestone sync. */
export const checkFeedsMilestone: LintRule = {
  id: "feeds-milestone",
  async run(state: LintState) {
    for (const paper of state.ctx.paperPages) {
      const match = paper.body.match(FEEDS_MILESTONE_RE);
      if (match && match[1] !== paper.fm.milestone) {
        const issue: LintIssue = {
          severity: "error",
          kind: "feeds-milestone-mismatch",
          target: paper.fm.slug,
          message: `Feeds milestone [[${match[1]}]] differs from frontmatter milestone "${paper.fm.milestone}"`,
          autoFixable: true,
        };
        await emit(state, issue, async () => {
          await fixFeedsMilestone(paper);
        });
      } else if (!match) {
        await emit(state, {
          severity: "warning",
          kind: "missing-feeds",
          target: paper.fm.slug,
          message: "body has no Feeds milestone line",
          autoFixable: true,
        });
      }
    }
  },
};
