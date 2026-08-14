"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { useLlmPrefs } from "./LlmPrefsProvider";
import { useDiagramJob } from "./diagram-jobs-client";
import Lightbox from "./Lightbox";
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

/** Strip the planner-written `**Title**: ...` first line from a brief. */
function captionOf(brief: string): string {
  return brief.replace(/^\*\*Title\*\*:\s*[^\n]*\n?/, "").trim();
}

/** How long "Ready — refreshing…" may linger before falling back to the button. */
const DONE_WAIT_MS = 4000;

/**
 * Lazy diagram slot: the plan pass stores only a structured brief (with a
 * title, a section, a render format and an optional position) in the paper
 * body; the artifact is rendered on demand (click) — svg.js code executed
 * headlessly (see src/lib/diagram-exec.ts) or Mermaid source rendered
 * client-side — cached by brief hash, and served at a content-addressed URL
 * (svgUrl / mmdUrl), which changes whenever the diagram is re-rendered, so
 * neither the browser cache nor a stale server state can keep showing an old
 * diagram.
 *
 * Renders run as in-process background jobs (see src/lib/paper-knowledge.ts
 * startDiagramJob) and are tracked in an external store polled by
 * DiagramJobsPoller. So the slot simply derives its UI from the store view
 * (+ the server-resolved url props for done state on disk): spinning while
 * queued/rendering, error+retry on failed, artifact on done/cached. Re-clicking
 * while in-flight is a server-side no-op (dedup), so the "render again and not
 * know if it's alive" footgun is gone.
 */
export default function DiagramSlot({
  paperSlug,
  id,
  brief,
  section,
  title,
  format,
  svgUrl,
  mmdUrl,
}: {
  paperSlug?: string;
  id: string;
  brief: string;
  /** Paper Knowledge section the fence lives under (fence info string). */
  section?: string;
  /** Human title from the planning call (falls back to section-derived). */
  title?: string;
  /** Rendering route (fence info string); defaults to svg. */
  format?: "mermaid" | "svg";
  /** Content-addressed cached SVG URL; present only when the cache is current. */
  svgUrl?: string;
  /** Content-addressed cached Mermaid source URL (mermaid diagrams). */
  mmdUrl?: string;
}) {
  const { prefs } = useLlmPrefs();
  const [slug, setSlug] = useState<string | null>(paperSlug ?? null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug && typeof window !== "undefined") {
      setSlug(slugFromPathname(window.location.pathname));
    }
  }, [slug]);

  const { view, start } = useDiagramJob(slug, id);
  const isMermaid = format === "mermaid";
  const label = title ?? (section ? `${section} diagram` : id === "overview" ? "Overview diagram" : "Diagram");
  const artifactUrl = isMermaid ? mmdUrl : svgUrl;

  // The "Ready — refreshing…" state is transient: the server refresh delivers
  // the artifact URL within a moment. If it does not arrive (e.g. the server
  // restarted mid-render and the in-memory job registry lost the job), fall
  // back to the button so the slot can never freeze on a stale done view.
  const done = view?.status === "done" && !artifactUrl;
  const [doneStale, setDoneStale] = useState(false);
  useEffect(() => {
    if (!done) {
      setDoneStale(false);
      return;
    }
    const timer = setTimeout(() => setDoneStale(true), DONE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [done]);

  // Mermaid route: fetch the cached source and render it client-side (lazy
  // mermaid import keeps the initial bundle lean).
  useEffect(() => {
    if (!isMermaid || !mmdUrl) return;
    let cancelled = false;
    setMermaidSvg(null);
    setMermaidError(null);
    void (async () => {
      try {
        const res = await fetch(mmdUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`failed to load Mermaid source (HTTP ${res.status})`);
        const source = await res.text();
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral" });
        const { svg } = await mermaid.render(`diagram-${slug}-${id}-${Date.now()}`, source);
        if (!cancelled) setMermaidSvg(svg);
      } catch (err) {
        if (!cancelled) setMermaidError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMermaid, mmdUrl, slug, id]);

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

  const caption = (
    <figcaption className="mx-auto mt-2 max-w-2xl text-center text-xs leading-5 text-gray-500">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      >
        {wrapBareMath(`How to read this diagram: ${captionOf(brief)}`)}
      </ReactMarkdown>
    </figcaption>
  );

  if (artifactUrl) {
    if (isMermaid) {
      return (
        <figure className="my-6">
          {mermaidSvg ? (
            <Lightbox
              alt={`Diagram: ${captionOf(brief)}`}
              className="mx-auto block w-full max-w-2xl cursor-zoom-in"
            >
              <div
                className="mx-auto max-w-2xl overflow-x-auto rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
                dangerouslySetInnerHTML={{ __html: mermaidSvg }}
              />
            </Lightbox>
          ) : mermaidError ? (
            <div className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-sm font-semibold text-red-800">Mermaid render failed</p>
              <p className="mt-1 text-xs leading-5 text-red-700">{mermaidError}</p>
              <button
                type="button"
                onClick={() => void handleRender()}
                className="mt-3 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-500">
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
              Rendering Mermaid diagram…
            </div>
          )}
          {caption}
        </figure>
      );
    }
    return (
      <figure className="my-6">
        {/* The SVG is displayed via <object> (not <img>) because math labels
            render as KaTeX MathML inside <foreignObject>, which browsers only
            paint when the SVG is embedded interactively. */}
        {/* pointer-events-none: an <object> is a nested browsing context and
            swallows clicks, so the wrapping button would never fire. Clicks
            fall through to the button, which opens the lightbox. */}
        <Lightbox
          alt={`Diagram: ${captionOf(brief)}`}
          className="mx-auto block w-full max-w-2xl cursor-zoom-in"
        >
          <object
            type="image/svg+xml"
            data={svgUrl}
            aria-label={`${label} for ${slug}`}
            className="pointer-events-none block max-h-96 w-full rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
          />
        </Lightbox>
        {caption}
      </figure>
    );
  }

  const rendering = view?.status === "queued" || view?.status === "rendering";
  const failed = view?.status === "failed";
  const errorText = failed ? view?.error ?? "diagram render failed" : preflightError;

  // A completed render whose artifact URL hasn't arrived via router.refresh()
  // yet — show a transient state instead of reverting to the bare button.
  // The done state self-limits: if the refresh never delivers the URL (e.g.
  // the server restarted mid-render and lost the job registry), fall back to
  // the button with a hint instead of freezing.
  if (done && !doneStale) {
    return (
      <div className="my-6 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <p className="mt-3 text-sm text-gray-500">Ready — refreshing…</p>
      </div>
    );
  }

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
          {doneStale && !failed && (
            <p className="mt-2 text-xs text-amber-600">
              The render may have been interrupted (e.g. the server restarted) — click to try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
