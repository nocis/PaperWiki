"use client";

import type { PaperComment } from "./annotation-types";
import AddToKnowledgeButton from "./AddToKnowledgeButton";

export default function CommentSidebar({
  comments,
  onSelect,
  onDelete,
}: {
  comments: PaperComment[];
  onSelect: (comment: PaperComment) => void;
  onDelete: (comment: PaperComment) => void;
}) {
  return (
    <aside className="border-t border-gray-200 pt-5 lg:h-[min(72vh,58rem)] lg:min-h-[32rem] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-5 lg:pr-1 lg:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-gray-950">Reading notes</h2>
        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
          {comments.length}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-500">
        Select text in the PDF to capture a passage and attach a private note.
      </p>
      <div className="mt-4 space-y-3 pb-1">
        {comments.map((comment) => (
          <article
            key={comment.id}
            className="group rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition hover:border-yellow-300 hover:shadow"
          >
            <button type="button" onClick={() => onSelect(comment)} className="block w-full text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800">
                  p. {comment.position.pageNumber}
                </span>
                <time dateTime={comment.createdAt} className="text-[11px] text-gray-400">
                  {new Date(comment.createdAt).toLocaleDateString()}
                </time>
              </div>
              {comment.text && (
                <blockquote className="mt-2 line-clamp-3 border-l-2 border-yellow-300 pl-2 text-xs italic leading-5 text-gray-500">
                  {comment.text}
                </blockquote>
              )}
              <p className="mt-2 text-sm leading-5 text-gray-800">{comment.comment}</p>
            </button>
            <div className="mt-2 flex justify-end gap-3 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <AddToKnowledgeButton
                kind="note"
                source={comment.id}
                content={`**Paper**: [[${comment.paperSlug}]] (p. ${comment.position.pageNumber})\n\n${comment.text ? `> ${comment.text}\n\n` : ""}${comment.comment}`}
                title={`note-${comment.paperSlug}-${comment.position.pageNumber}`}
                label="Add to knowledge"
              />
              <button
                type="button"
                onClick={() => onDelete(comment)}
                className="text-xs font-medium text-gray-400 hover:text-red-600"
              >
                Delete note
              </button>
            </div>
          </article>
        ))}
        {comments.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
            <p className="text-sm font-medium text-gray-600">No notes yet</p>
            <p className="mt-1 text-xs leading-5 text-gray-400">Highlight any passage in the PDF to start annotating.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
