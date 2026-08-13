/**
 * Link and figure-reference checks: broken wikilinks on wiki pages, and
 * figure references (frontmatter list vs disk, body embeds vs frontmatter).
 */
import * as fs from "fs/promises";
import * as path from "path";
import { FIGURES_DIR_FOR } from "../extract-figures";
import { emit, FIGURE_EMBED_RE, pruneBrokenFigures, WIKIKLINK_RE } from "./state";
import type { LintIssue, LintRule, LintState } from "./types";

/** [[slug]] links to pages that do not exist (paper or topic). */
export const checkBrokenWikilinks: LintRule = {
  id: "broken-wikilinks",
  async run(state: LintState) {
    for (const page of [...state.ctx.paperPages, ...state.ctx.topicPages]) {
      const body = page.body;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = WIKIKLINK_RE.exec(body)) !== null) {
        const slug = m[1];
        if (state.knownSlugs.has(slug) || seen.has(slug)) continue;
        seen.add(slug);
        await emit(state, {
          severity: "error",
          kind: "broken-wikilink",
          target: page.fm.slug,
          message: `links to missing page [[${slug}]]`,
          autoFixable: false,
        });
      }
    }
  },
};

/** Frontmatter figures[] vs disk, and body embeds vs frontmatter. */
export const checkFigureReferences: LintRule = {
  id: "figure-references",
  async run(state: LintState) {
    for (const paper of state.ctx.paperPages) {
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
          await emit(state, {
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
        await emit(state, issue, () => pruneBrokenFigures(paper).then(() => undefined));
      }
    }
  },
};
