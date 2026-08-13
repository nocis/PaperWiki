"use client";

import Link from "next/link";
import type { KnowledgeArticlePayload } from "@/lib/knowledge";

/** One topic article card with the favorite toggle and its piece chips. */
export function ArticleCard({
  article,
  onToggleFavorite,
}: {
  article: KnowledgeArticlePayload;
  onToggleFavorite: (article: KnowledgeArticlePayload) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/knowledge/articles/${article.slug}`}
            className="text-lg font-semibold text-gray-950 hover:text-blue-700"
          >
            {article.title}
          </Link>
          <button
            type="button"
            onClick={() => onToggleFavorite(article)}
            title={
              article.favorite
                ? "Favorited — archived, kept by the next compile"
                : "Mark as favorite — survives the next compile wipe"
            }
            aria-label={article.favorite ? "Unfavorite article" : "Favorite article"}
            className={`text-base leading-none ${
              article.favorite ? "text-amber-500 hover:text-amber-600" : "text-gray-300 hover:text-amber-400"
            }`}
          >
            {article.favorite ? "★" : "☆"}
          </button>
        </div>
        <span className="text-xs text-gray-500">
          {article.pieceCount} piece{article.pieceCount === 1 ? "" : "s"}
          {article.paperCount > 0 ? ` · ${article.paperCount} paper${article.paperCount === 1 ? "" : "s"} grounded` : ""}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-gray-600">{article.definition}</p>
      {article.pieceSlugs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {article.pieceSlugs.map((slug) => (
            <Link
              key={slug}
              href={`/knowledge/pieces/${slug}`}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
            >
              {slug}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
