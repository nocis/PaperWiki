/**
 * Archive checks: orphan figures dirs, missing compiled PDFs, and papers that
 * could not be titled automatically.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { PAPERS_COMPILED } from "../wiki";
import { emit } from "./state";
import type { LintRule, LintState } from "./types";

/** Figure dirs without a referencing paper; papers without their compiled PDF. */
export const checkArchiveIntegrity: LintRule = {
  id: "archive-integrity",
  async run(state: LintState) {
    let compiledEntries: string[] = [];
    try {
      compiledEntries = await fs.readdir(PAPERS_COMPILED);
    } catch {
      /* dir may not exist yet */
    }
    const figuresDirs = new Set(compiledEntries.filter((e) => e.endsWith("_figures")));
    for (const dir of figuresDirs) {
      const slug = dir.replace(/_figures$/, "");
      if (!state.paperSlugs.has(slug)) {
        await emit(state, {
          severity: "warning",
          kind: "orphan-figures-dir",
          target: slug,
          message: `papers/compiled/${dir} exists but no paper "${slug}" references it`,
          autoFixable: false,
        });
      }
    }

    for (const paper of state.ctx.paperPages) {
      try {
        await fs.stat(path.join(PAPERS_COMPILED, `${paper.fm.slug}.pdf`));
      } catch {
        await emit(state, {
          severity: "error",
          kind: "missing-pdf",
          target: paper.fm.slug,
          message: `compiled PDF missing: papers/compiled/${paper.fm.slug}.pdf`,
          autoFixable: false,
        });
      }
    }
  },
};

/**
 * Papers whose real title could not be extracted compile under "untitled-*",
 * or keep a blank title when a meaningful filename fallback was used —
 * surface both so the human can rename the page, PDF, and comments dir.
 */
export const checkUntitledPapers: LintRule = {
  id: "untitled-papers",
  async run(state: LintState) {
    for (const paper of state.ctx.paperPages) {
      if (paper.fm.slug.startsWith("untitled-") || !paper.fm.title?.trim()) {
        await emit(state, {
          severity: "warning",
          kind: "untitled-paper",
          target: paper.fm.slug,
          message: `paper "${paper.fm.slug}" could not be titled automatically${
            paper.fm.title?.trim() ? " (raw filename fallback)" : " (no title in frontmatter)"
          } — rename it manually`,
          autoFixable: false,
        });
      }
    }
  },
};
