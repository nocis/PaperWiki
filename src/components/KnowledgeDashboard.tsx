"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLlmPrefs } from "@/components/LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";

interface KnowledgePiece {
  slug: string;
  kind: "note" | "chat";
  source: string;
  addedAt: string;
  updatedAt: string;
  tags: string[];
  topics: string[];
  preview: string;
}

interface KnowledgeArticle {
  slug: string;
  title: string;
  compiledAt: string;
  definition: string;
  pieceSlugs: string[];
  pieceCount: number;
  paperCount: number;
  relatedArticles: string[];
  favorite: boolean;
}

interface KnowledgeDbPayload {
  pieces: KnowledgePiece[];
  articles: KnowledgeArticle[];
  compiledAt: string | null;
  wikiUpdatedAt: string | null;
  stale: boolean;
  runStatus: {
    runId: string | null;
    status: "idle" | "running" | "completed" | "failed";
    provider?: string;
    model?: string;
    error?: string;
    totals: Record<string, number>;
    events: { step: string; label: string; status: string; message?: string; slug?: string }[];
  } | null;
}

interface KnowledgeRunStatusResponse {
  status: {
    runId: string | null;
    status: "idle" | "running" | "completed" | "failed";
    provider?: string;
    model?: string;
    error?: string;
    totals: Record<string, number>;
    events: { step: string; label: string; status: string; message?: string; slug?: string }[];
  } | null;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export default function KnowledgeDashboard({
  initialDb,
  initialRunStatus,
}: {
  initialDb: KnowledgeDbPayload;
  initialRunStatus: KnowledgeRunStatusResponse["status"];
}) {
  const [db, setDb] = useState<KnowledgeDbPayload>(initialDb);
  const [runStatus, setRunStatus] = useState(initialRunStatus);
  const [polling, setPolling] = useState(initialRunStatus?.status === "running");
  const [requestError, setRequestError] = useState<string | null>(null);
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();
  const router = useRouter();

  const prefsUnresolved = !prefs.provider || !prefs.model;
  const llmBlocked =
    prefsUnresolved ||
    availabilityState === "checking" ||
    availabilityState === "unavailable" ||
    availabilityState === "unknown";
  const unavailableHint = prefsUnresolved
    ? "Loading model configuration…"
    : availabilityState === "unavailable" && availability
      ? availabilityMessage(availability.kind, availability.provider, availability.model)
      : availabilityState === "checking" || availabilityState === "unknown"
        ? "Checking LLM availability…"
        : null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge", { cache: "no-store" });
      if (!res.ok) throw new Error(`knowledge request failed with HTTP ${res.status}`);
      const data = (await res.json()) as KnowledgeDbPayload;
      setDb(data);
      setRunStatus(data.runStatus);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!polling) return;
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(interval);
  }, [polling, refresh]);

  const runTerminal = runStatus?.status === "completed" || runStatus?.status === "failed";

  useEffect(() => {
    if (!runTerminal) return;
    setPolling(false);
    void refresh();
  }, [runTerminal, refresh]);

  async function compileKnowledge() {
    setRequestError(null);
    if (availabilityState !== "available") {
      setRequestError("LLM unavailable — cannot start knowledge compile.");
      void checkNow();
      return;
    }
    if (db.pieces.length === 0) {
      setRequestError("No knowledge pieces yet — add some first (reading note or chat selection).");
      return;
    }
    setPolling(true);
    try {
      const res = await fetch("/api/knowledge/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: prefs.provider, model: prefs.model }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `compile request failed with HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "compile request failed");
      setPolling(false);
    }
  }

  async function deletePiece(slug: string) {
    setRequestError(null);
    try {
      const res = await fetch(`/api/knowledge?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `delete failed with HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function toggleFavorite(article: KnowledgeArticle) {
    setRequestError(null);
    try {
      const res = await fetch("/api/knowledge/articles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: article.slug, favorite: !article.favorite }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `update failed with HTTP ${res.status}`);
      await refresh();
      router.refresh();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "update failed");
    }
  }

  async function patchPiece(slug: string, op: "edit-content" | "set-topics", payload: Record<string, unknown>) {
    setRequestError(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, op, ...payload }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `update failed with HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "update failed");
    }
  }

  /** Human-readable provenance; falls back to raw fields. */
  function provenanceLine(piece: KnowledgePiece): string {
    if (piece.kind === "chat") return `chat exchange · ${piece.addedAt}`;
    const match = piece.preview.match(/^\*\*Paper\*\*:\s*\[\[([a-z0-9][a-z0-9-]*)\]\]\s*\(p\.\s*(\d+)\)/i);
    if (match) return `reading note on ${match[1]} p. ${match[2]} · ${piece.addedAt}`;
    return `reading note · ${piece.addedAt}`;
  }

  const runTotals = runStatus?.totals;
  const runProgress =
    runStatus?.status === "running" && runTotals && runTotals.articles > 0
      ? Math.min(99, Math.round((runTotals.compiled / runTotals.articles) * 100))
      : runStatus?.status === "completed" || runStatus?.status === "failed"
        ? 100
        : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← Knowledge Base
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">Your Knowledge</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your own notes and chat discoveries, compiled by the LLM into topic articles and reviewed
            against the literature wiki.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
            {db.pieces.length} piece{db.pieces.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
            {db.articles.length} article{db.articles.length === 1 ? "" : "s"}
          </span>
          {db.compiledAt ? (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">
              compiled {formatTime(db.compiledAt)}
            </span>
          ) : null}
          {db.stale && (
            <span
              className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800"
              title="The literature wiki changed since the last knowledge compile — recompile to refresh the academic review."
            >
              stale — recompile
            </span>
          )}
        </div>
      </div>

      {requestError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{requestError}</p>
      )}

      {unavailableHint && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {unavailableHint}
          {availabilityState === "unavailable" && (
            <button
              type="button"
              onClick={() => void checkNow()}
              className="ml-2 font-medium underline underline-offset-2"
            >
              Check now
            </button>
          )}
        </p>
      )}

      {/* --- Compile ---------------------------------------------------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">Knowledge Compile</h2>
            <p className="mt-1 text-sm text-gray-500">
              From-zero build: cluster all pieces into overlapping topic articles, then review each
              against the latest literature wiki. Articles are derived — edits belong in pieces.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void compileKnowledge()}
            disabled={polling || llmBlocked || db.pieces.length === 0}
            title={
              db.pieces.length === 0
                ? "Add knowledge pieces first (reading note or chat selection)"
                : llmBlocked && availabilityState !== "available"
                  ? "Waiting for LLM availability…"
                  : undefined
            }
            className="rounded-full bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {polling
              ? "Compiling…"
              : llmBlocked
                ? prefsUnresolved
                  ? "Loading…"
                  : availabilityState === "checking" || availabilityState === "unknown"
                    ? "Checking availability…"
                    : "LLM unavailable"
                : "Compile knowledge"}
          </button>
        </div>

        {runStatus && runStatus.status === "running" && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">
              Compiling knowledge…
              {runStatus.provider || runStatus.model ? (
                <span className="ml-2 text-xs text-gray-500">
                  <code>{runStatus.provider ?? "default"}/{runStatus.model ?? "default"}</code>
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {runTotals?.compiled ?? 0}/{runTotals?.articles ?? 0} articles written · {runTotals?.pieces ?? 0} pieces
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded bg-white">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${runProgress}%` }} />
            </div>
            {runStatus.events.slice(-5).map((event, index) => (
              <p key={`${event.step}-${index}`} className="mt-1 font-mono text-xs text-gray-500">
                {event.status} · {event.label}
                {event.message ? `: ${event.message}` : ""}
              </p>
            ))}
          </div>
        )}

        {runStatus && (runStatus.status === "completed" || runStatus.status === "failed") && (
          <p
            className={`mt-3 rounded border p-2 text-sm ${
              runStatus.status === "failed"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {runStatus.status === "failed"
              ? `Knowledge compile failed: ${runStatus.error ?? "unknown error"}`
              : "Knowledge compile completed."}
          </p>
        )}
      </section>

      {/* --- Articles (Wikipedia-style) ---------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold text-gray-950">Topic articles</h2>
        <p className="mt-1 text-sm text-gray-500">
          LLM-discovered topics from your pieces. Overlapping membership is intended — a piece can
          inform several articles. Favorited articles are archived and kept when the next compile
          wipes stale ones.
        </p>
        {db.articles.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-gray-500">
            No articles yet. Add knowledge pieces (reading note or chat selection), then run a
            knowledge compile.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {db.articles.map((article) => (
              <div key={article.slug} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
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
                      onClick={() => void toggleFavorite(article)}
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
            ))}
          </div>
        )}
      </section>

      {/* --- Pieces ------------------------------------------------------------- */}
      <section>
        <h2 className="text-xl font-semibold text-gray-950">Knowledge pieces</h2>
        <p className="mt-1 text-sm text-gray-500">
          Atomic units of your knowledge. Chat pieces are editable; note pieces are immutable
          (delete + re-add). Topic hints are managed separately from editing — for both kinds.
        </p>
        {db.pieces.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-gray-500">
            No pieces yet. Use <span className="font-medium">Add to knowledge</span> on a reading note
            (paper page → Annotate) or save a chat selection.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {db.pieces.map((piece) => (
              <PieceRow
                key={piece.slug}
                piece={piece}
                onPatch={patchPiece}
                onDelete={() => void deletePiece(piece.slug)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PieceRow({
  piece,
  onPatch,
  onDelete,
}: {
  piece: KnowledgePiece;
  onPatch: (slug: string, op: "edit-content" | "set-topics", payload: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [topics, setTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function provenanceLine(): string {
    if (piece.kind === "chat") return `chat exchange · ${piece.addedAt}`;
    const match = piece.preview.match(/^\*\*Paper\*\*:\s*\[\[([a-z0-9][a-z0-9-]*)\]\]\s*\(p\.\s*(\d+)\)/i);
    if (match) return `reading note on ${match[1]} p. ${match[2]} · ${piece.addedAt}`;
    return `reading note · ${piece.addedAt}`;
  }

  async function saveContent() {
    setSaving(true);
    setError(null);
    try {
      await onPatch(piece.slug, "edit-content", { content });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveTopics() {
    setSaving(true);
    setError(null);
    try {
      await onPatch(piece.slug, "set-topics", {
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setTopicsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/knowledge/pieces/${piece.slug}`}
              className="font-mono text-sm font-medium text-gray-900 hover:text-blue-700"
            >
              {piece.slug}
            </Link>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
              {piece.kind}
            </span>
            <code className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">{piece.source}</code>
          </div>
          <p className="mt-1 text-xs text-gray-400">{provenanceLine()}</p>

          {editing ? (
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={6}
              className="mt-2 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6 text-gray-800 outline-none focus:border-blue-500"
            />
          ) : (
            <p className="mt-1 text-sm leading-6 text-gray-600">{piece.preview}</p>
          )}

          {piece.topics.length > 0 && !topicsOpen && (
            <div className="mt-2 flex flex-wrap gap-1">
              {piece.topics.map((topic) => (
                <span key={topic} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">
                  {topic}
                </span>
              ))}
            </div>
          )}

          {topicsOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={topics}
                onChange={(event) => setTopics(event.target.value)}
                placeholder="Topic hints (comma-separated)"
                className="w-64 rounded border border-gray-300 px-2 py-1 text-xs text-gray-800 outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => void saveTopics()}
                disabled={saving}
                className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setTopicsOpen(false)}
                className="text-xs text-gray-400 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          {piece.kind === "chat" && (
            <button
              type="button"
              onClick={async () => {
                setTopicsOpen(false);
                try {
                  const res = await fetch(`/api/knowledge?slug=${encodeURIComponent(piece.slug)}`, { cache: "no-store" });
                  const data = (await res.json()) as { piece?: { content?: string }; error?: string };
                  if (!res.ok || !data.piece) throw new Error(data.error ?? "failed to load piece");
                  setContent(data.piece.content ?? "");
                  setEditing(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "failed to load piece");
                }
              }}
              className="text-xs font-medium text-blue-700 hover:text-blue-900"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setTopics(piece.topics.join(", "));
              setTopicsOpen(true);
              setEditing(false);
            }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Topics
          </button>
          <button type="button" onClick={onDelete} className="text-xs font-medium text-gray-400 hover:text-red-600">
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
