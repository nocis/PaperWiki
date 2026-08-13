"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLlmPrefs } from "./LlmPrefsProvider";

interface KnowledgeEntry {
  slug: string;
  status: "pending" | "running" | "ready" | "failed";
  error?: string;
  updatedAt: string;
}

/**
 * Paper Knowledge status surface on the paper page. Renders nothing when the
 * paper has no block (classic sections only) or when it is ready (the block
 * itself is in the markdown body). Shows a skeleton while the background
 * amend runs, and an error + Retry ONLY for failed slugs — ready blocks are
 * terminal and never regenerate without a full recompile.
 */
export default function PaperKnowledgeStatus({ slug }: { slug: string }) {
  const { prefs } = useLlmPrefs();
  const [entry, setEntry] = useState<KnowledgeEntry | null | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/paper-knowledge?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { entry: KnowledgeEntry | null };
      setEntry(data.entry);
    } catch {
      /* keep the last known state */
    }
  }, [slug]);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);

  const active = entry?.status === "pending" || entry?.status === "running";
  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (active) timer.current = setInterval(() => void poll(), 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, poll]);

  if (entry === undefined || !entry || entry.status === "ready") return null;

  async function retry() {
    if (!prefs.provider || !prefs.model) {
      setActionError("Select a provider/model in the top navigation first.");
      return;
    }
    setRetrying(true);
    setActionError(null);
    try {
      const res = await fetch("/api/paper-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", slug, provider: prefs.provider, model: prefs.model }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? "retry failed");
      } else {
        await poll();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  }

  if (entry.status === "failed") {
    return (
      <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-800">Paper Knowledge extraction failed</p>
        {entry.error && <p className="mt-1 text-xs leading-5 text-red-700">{entry.error}</p>}
        {actionError && <p className="mt-1 text-xs text-red-700">{actionError}</p>}
        <button
          type="button"
          disabled={retrying}
          onClick={() => void retry()}
          className="mt-3 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  return (
    <div className="my-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        <span className="text-sm text-gray-600">
          Extracting Paper Knowledge (terminology, core formulas, mechanism)…
        </span>
      </div>
    </div>
  );
}
