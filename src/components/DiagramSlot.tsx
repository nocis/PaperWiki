"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useLlmPrefs } from "./LlmPrefsProvider";
import { useDiagramJob } from "./diagram-jobs-client";
import { wrapBareMath } from "@/lib/math";

/**
 * Derive the paper slug from the current route — the slot must not depend on
 * a threaded prop, because diagram fences may render on any route that shows
 * a paper body (/paper/<slug>, /wiki/papers/<slug>).
 */
function slugFromPathname(pathname: string): string | null {
  const match = pathname.match(/\/(?:paper|papers)\/([a-z0-9][a-z0-9-]*)/i);
  return match ? match[1] : null;
}

/**
 * Lazy diagram slot: the amend pass stores only a TEXT BRIEF in the paper
 * body; the raw SVG is rendered on demand (click), cached by brief hash.
 *
 * Renders run as in-process background jobs (see src/lib/paper-knowledge.ts
 * startDiagramJob) and are tracked in an external store polled by
 * DiagramJobsPoller. So the slot simply derives its UI from the store view
 * (+ the server-resolved `cached` flag for done state on disk): spinning while
 * queued/rendering, error+retry on failed, figure on done/cached. Re-clicking
 * while in-flight is a server-side no-op (dedup), so the "render again and not
 * know if it's alive" footgun is gone — the spinner + status always show truth.
 */
export default function DiagramSlot({
  paperSlug,
  id,
  brief,
  cached,
}: {
  paperSlug?: string;
  id: string;
  brief: string;
  cached?: boolean;
}) {
  const { prefs } = useLlmPrefs();
  const [slug, setSlug] = useState<string | null>(paperSlug ?? null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug && typeof window !== "undefined") {
      setSlug(slugFromPathname(window.location.pathname));
    }
  }, [slug]);

  const { view, start } = useDiagramJob(slug, id);
  const svgUrl = slug ? `/diagrams/${slug}/${id}.svg` : null;
  const label = id === "overview" ? "Overview diagram" : "Mechanism diagram";

  async function handleRender() {
    setPreflightError(null);
    if (!slug) {
      setPreflightError("Cannot determine which paper this diagram belongs to.");
      return;
    }
    if (!prefs.provider || !prefs.model) {
      setPreflightError("Select a provider/model in the top navigation first.");
      return;
    }
    await start();
  }

  if ((cached || view?.status === "done") && svgUrl) {
    return (
      <figure className="my-6">
        <img
          src={svgUrl}
          alt={`${label} for ${slug}`}
          loading="lazy"
          className="mx-auto block max-h-96 max-w-2xl object-contain rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
        />
        <figcaption className="mx-auto mt-2 max-w-2xl text-center text-xs leading-5 text-gray-500">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
          >
            {wrapBareMath(`How to read this diagram: ${brief}`)}
          </ReactMarkdown>
        </figcaption>
      </figure>
    );
  }

  const rendering = view?.status === "queued" || view?.status === "rendering";
  const failed = view?.status === "failed";
  const errorText = failed ? view?.error ?? "diagram render failed" : preflightError;

  return (
    <div className="my-6 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/60 p-5">
      <div className="flex items-start gap-4">
        <svg
          viewBox="0 0 48 48"
          className="mt-0.5 h-10 w-10 shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="8" width="14" height="12" rx="2" />
          <rect x="31" y="8" width="14" height="12" rx="2" />
          <rect x="17" y="28" width="14" height="12" rx="2" />
          <path d="M17 14h14M17 20l4 8M27 28l4-6" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
          {rendering ? (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-gray-500">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 animate-spin text-blue-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.2-8.56" />
              </svg>
              Rendering diagram…
              {view?.status === "queued" ? " (queued)" : ""}
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleRender()}
                title={brief}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-800"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 3v18h18" />
                  <path d="M7 14l4-5 4 3 5-7" />
                </svg>
                {failed ? "Retry" : "Render diagram"}
              </button>
              {errorText ? <span className="text-sm text-red-600">{errorText}</span> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}