/**
 * Knowledge-layer checks: article frontmatter consistency, article wikilinks,
 * orphan pieces, and the piece origin guard.
 */
import { readArticles, readPieces } from "../knowledge";
import { emit, WIKIKLINK_RE } from "./state";
import type { LintRule, LintState } from "./types";

export const checkKnowledgeLayer: LintRule = {
  id: "knowledge-layer",
  async run(state: LintState) {
    const [pieces, articles] = await Promise.all([readPieces(), readArticles()]);
    const pieceSlugSet = new Set(pieces.map((p) => p.fm.slug));
    const articleSlugSet = new Set(articles.map((a) => a.fm.slug));
    const knowledgeKnown = new Set([...pieceSlugSet, ...articleSlugSet]);

    // Article frontmatter consistency (derived artifacts — drift means a stale
    // compile, not a hand edit).
    for (const article of articles) {
      for (const slug of article.fm.pieceSlugs) {
        if (!pieceSlugSet.has(slug)) {
          await emit(state, {
            severity: "warning",
            kind: "article-unknown-piece",
            target: article.fm.slug,
            message: `article lists piece [[${slug}]] which does not exist — recompile knowledge`,
            autoFixable: false,
          });
        }
      }
      for (const slug of article.fm.paperSlugs) {
        if (!state.paperSlugs.has(slug)) {
          await emit(state, {
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
        if (knowledgeKnown.has(slug) || state.knownSlugs.has(slug) || seenBody.has(slug)) continue;
        seenBody.add(slug);
        await emit(state, {
          severity: "warning",
          kind: "article-broken-wikilink",
          target: article.fm.slug,
          message: `article links to missing page [[${slug}]]`,
          autoFixable: false,
        });
      }
    }

    // Orphan pieces: not referenced by any article. Not an error — the human
    // may be mid-curation — but a warning that a compile is needed.
    const coveredPieces = new Set<string>();
    for (const article of articles) {
      for (const slug of article.fm.pieceSlugs) coveredPieces.add(slug);
    }
    for (const piece of pieces) {
      if (!coveredPieces.has(piece.fm.slug)) {
        await emit(state, {
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
        await emit(state, {
          severity: "warning",
          kind: "unsanctioned-origin",
          target: piece.fm.slug,
          message: `piece of kind "${piece.fm.kind}" has source "${source}" which is neither a reading-note comment id nor a chat-<timestamp> label`,
          autoFixable: false,
        });
      }
    }
  },
};
