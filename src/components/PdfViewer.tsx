"use client";

import { useState } from "react";
import { Highlight, PdfHighlighter, PdfLoader, Popup, type IHighlight } from "react-pdf-highlighter";
import type { PaperComment } from "./annotation-types";

const SCALE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "page-width", label: "Page width" },
  { value: "page-fit", label: "Page fit" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
];

function SelectionTip({ onSave, onCancel }: { onSave: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <form
      className="w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
      onSubmit={(event) => {
        event.preventDefault();
        if (note.trim()) onSave(note.trim());
      }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">New note</p>
      <textarea
        autoFocus
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What stands out here?"
        className="mt-2 w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!note.trim()}
          className="rounded-md bg-blue-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-40"
        >
          Save note
        </button>
      </div>
    </form>
  );
}

function NoteCard({ comment, onDelete }: { comment: PaperComment; onDelete: (comment: PaperComment) => void }) {
  return (
    <div className="w-64 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-xl">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Page {comment.position.pageNumber}
      </p>
      {comment.text && (
        <blockquote className="mt-1.5 line-clamp-4 border-l-2 border-yellow-300 pl-2 text-xs italic leading-5 text-gray-500">
          {comment.text}
        </blockquote>
      )}
      <p className="mt-1.5 text-sm leading-5 text-gray-800">{comment.comment}</p>
      <div className="mt-2 flex items-center justify-between">
        <time className="text-[10px] text-gray-400">{new Date(comment.createdAt).toLocaleDateString()}</time>
        <button
          type="button"
          onClick={() => onDelete(comment)}
          className="text-xs font-medium text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function PdfViewer({
  pdfUrl,
  comments,
  onCreate,
  onDelete,
  onScrollRef,
}: {
  pdfUrl: string;
  comments: PaperComment[];
  onCreate: (position: IHighlight["position"], text: string, comment: string) => void;
  onDelete: (comment: PaperComment) => void;
  onScrollRef: (scrollTo: (highlight: IHighlight) => void) => void;
}) {
  const [scale, setScale] = useState("auto");

  const highlights: IHighlight[] = comments.map((comment) => ({
    id: comment.id,
    content: { text: comment.text },
    comment: { text: comment.comment, emoji: "" },
    position: comment.position,
  }));
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));

  return (
    <div className="flex h-[min(72vh,58rem)] min-h-[32rem] flex-col overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
      <PdfLoader
        url={pdfUrl}
        workerSrc="/pdf.worker.min.js"
        beforeLoad={
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Loading PDF…</div>
        }
        errorMessage={
          <div className="flex flex-1 items-center justify-center text-sm text-red-700">Unable to load this PDF.</div>
        }
      >
        {(pdfDocument) => (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2">
              <span className="text-xs font-medium text-gray-500">{pdfDocument.numPages} pages</span>
              <label className="flex items-center gap-2 text-xs text-gray-500">
                Zoom
                <select
                  value={scale}
                  onChange={(event) => setScale(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 outline-none focus:border-blue-500"
                >
                  {SCALE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="relative min-h-0 flex-1">
              <PdfHighlighter
                pdfDocument={pdfDocument}
                highlights={highlights}
                pdfScaleValue={scale}
                onScrollChange={() => undefined}
                scrollRef={onScrollRef}
                enableAreaSelection={() => false}
                onSelectionFinished={(position, content, hideTipAndSelection) => (
                  <SelectionTip
                    onSave={(note) => {
                      onCreate(position, content.text ?? "", note);
                      hideTipAndSelection();
                    }}
                    onCancel={hideTipAndSelection}
                  />
                )}
                highlightTransform={(highlight, _index, setTip, hideTip, _viewportToScaled, _screenshot, isScrolledTo) => {
                  const comment = commentsById.get(highlight.id);
                  if (!comment) return <span />;
                  return (
                    <Popup
                      onMouseOver={(content) => setTip(highlight, () => content)}
                      onMouseOut={hideTip}
                      popupContent={<NoteCard comment={comment} onDelete={onDelete} />}
                    >
                      <Highlight
                        position={highlight.position}
                        comment={highlight.comment}
                        isScrolledTo={isScrolledTo}
                        onClick={() => setTip(highlight, () => <NoteCard comment={comment} onDelete={onDelete} />)}
                      />
                    </Popup>
                  );
                }}
              />
            </div>
          </>
        )}
      </PdfLoader>
    </div>
  );
}
