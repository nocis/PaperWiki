"use client";

import type { KnowledgeArticlePayload, KnowledgePiecePayload } from "@/lib/knowledge";
import { ArticleCard } from "./ArticleCard";
import { PieceRow } from "./PieceRow";

/** The topic articles section (empty state + card list). */
export function ArticlesSection({
  articles,
  onToggleFavorite,
}: {
  articles: KnowledgeArticlePayload[];
  onToggleFavorite: (article: KnowledgeArticlePayload) => void;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-950">Topic articles</h2>
      <p className="mt-1 text-sm text-gray-500">
        LLM-discovered topics from your pieces. Overlapping membership is intended — a piece can
        inform several articles. Favorited articles are archived and kept when the next compile
        wipes stale ones.
      </p>
      {articles.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-gray-500">
          No articles yet. Add knowledge pieces (reading note or chat selection), then run a
          knowledge compile.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {articles.map((article) => (
            <ArticleCard key={article.slug} article={article} onToggleFavorite={onToggleFavorite} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The knowledge pieces section (empty state + row list). */
export function PiecesSection({
  pieces,
  onPatch,
  onDelete,
}: {
  pieces: KnowledgePiecePayload[];
  onPatch: (slug: string, op: "edit-content" | "set-topics", payload: Record<string, unknown>) => Promise<void>;
  onDelete: (slug: string) => void;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-gray-950">Knowledge pieces</h2>
      <p className="mt-1 text-sm text-gray-500">
        Atomic units of your knowledge. Chat pieces are editable; note pieces are immutable
        (delete + re-add). Topic hints are managed separately from editing — for both kinds.
      </p>
      {pieces.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-gray-500">
          No pieces yet. Use <span className="font-medium">Add to knowledge</span> on a reading note
          (paper page → Annotate) or save a chat selection.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {pieces.map((piece) => (
            <PieceRow
              key={piece.slug}
              piece={piece}
              onPatch={onPatch}
              onDelete={() => onDelete(piece.slug)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
