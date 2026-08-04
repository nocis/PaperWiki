"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { IHighlight } from "react-pdf-highlighter";
import CommentSidebar from "./CommentSidebar";
import type { PaperComment } from "./annotation-types";

const PdfViewer = dynamic(() => import("./PdfViewer"), {
  ssr: false,
  loading: () => <div className="flex h-[min(72vh,58rem)] min-h-[32rem] items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-sm text-gray-500">Loading PDF viewer…</div>,
});

function byPage(a: PaperComment, b: PaperComment): number {
  return a.position.pageNumber - b.position.pageNumber || a.createdAt.localeCompare(b.createdAt);
}

export default function AnnotatePanel({ slug, pdfUrl }: { slug: string; pdfUrl: string }) {
  const [comments, setComments] = useState<PaperComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollToRef = useRef<(highlight: IHighlight) => void>();

  useEffect(() => {
    let active = true;
    fetch(`/api/comments/${slug}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load reading notes");
        return (await response.json()) as { comments: PaperComment[] };
      })
      .then((data) => { if (active) setComments(data.comments.sort(byPage)); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load reading notes"); });
    return () => { active = false; };
  }, [slug]);

  async function createComment(position: IHighlight["position"], text: string, comment: string) {
    setError(null);
    const response = await fetch(`/api/comments/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ position, text, comment }),
    });
    if (!response.ok) {
      setError("Unable to save this note.");
      return;
    }
    const data = (await response.json()) as { comment: PaperComment };
    setComments((current) => [...current, data.comment].sort(byPage));
  }

  async function deleteComment(comment: PaperComment) {
    setError(null);
    const response = await fetch(`/api/comments/${slug}/${comment.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Unable to delete this note.");
      return;
    }
    setComments((current) => current.filter((candidate) => candidate.id !== comment.id));
  }

  return (
    <div>
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(16rem,3fr)]">
        <PdfViewer
          pdfUrl={pdfUrl}
          comments={comments}
          onCreate={createComment}
          onDelete={deleteComment}
          onScrollRef={(scrollTo) => { scrollToRef.current = scrollTo; }}
        />
        <CommentSidebar
          comments={comments}
          onSelect={(comment) => {
            const highlight: IHighlight = {
              id: comment.id,
              content: { text: comment.text },
              comment: { text: comment.comment, emoji: "" },
              position: comment.position,
            };
            scrollToRef.current?.(highlight);
          }}
          onDelete={deleteComment}
        />
      </div>
    </div>
  );
}
