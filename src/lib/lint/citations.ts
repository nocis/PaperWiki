/**
 * Citation checks: the citation map is authoritative (missing entry, truncation
 * cap, cites[] drift) and cites/citedBy reciprocity between paper pages.
 */
import { matchedSlugsOf, readCitationMap } from "../citations";
import { MAX_REFERENCES } from "../prompts";
import { writePage } from "../wiki";
import { emit, fixCitationReciprocity, paperBySlug } from "./state";
import type { LintIssue, LintRule, LintState } from "./types";

/** Citation map ↔ frontmatter (LLM-built map is authoritative). */
export const checkCitationMapDrift: LintRule = {
  id: "citation-map-drift",
  async run(state: LintState) {
    const citationMap = await readCitationMap();
    for (const paper of state.ctx.paperPages) {
      const entry = citationMap.papers[paper.fm.slug];
      if (!entry) {
        await emit(state, {
          severity: "warning",
          kind: "missing-citation-map",
          target: paper.fm.slug,
          message: "no LLM citation map entry — run citation rebuild from the health page",
          autoFixable: false,
        });
        continue;
      }
      if (entry.rawReferences.length >= MAX_REFERENCES) {
        await emit(state, {
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
        await emit(state, issue, async () => {
          paper.fm.cites = expected;
          await writePage(paper.filePath, paper.fm, paper.body);
        });
      }
    }
  },
};

/** cites[]/citedBy[] reciprocity: unknown cites, missing and stale reciprocals. */
export const checkCitesReciprocity: LintRule = {
  id: "cites-reciprocity",
  async run(state: LintState) {
    for (const paper of state.ctx.paperPages) {
      for (const target of paper.fm.cites) {
        const targetPage = paperBySlug(state.ctx.paperPages, target);
        if (!targetPage) {
          await emit(state, {
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
          await emit(state, issue, async () => {
            await fixCitationReciprocity(paper, state.ctx.paperPages);
          });
        }
      }
      const stale = paper.fm.citedBy.filter((s) => {
        const citingPaper = paperBySlug(state.ctx.paperPages, s);
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
        await emit(state, issue, async () => {
          await fixCitationReciprocity(paper, state.ctx.paperPages);
        });
      }
    }
  },
};
