"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLlmPrefs } from "./LlmPrefsProvider";

interface KnowledgeEntry {
  slug: string;
  status: "pending" | "running" | "ready" | "failed";
  error?: string;
  diagramPlan?: "pending" | "running" | "ready" | "failed";
  diagramPlanError?: string;
  updatedAt: string;
}

/**
 * Paper Knowledge status surface on the paper page. Renders nothing when the
 * paper has no block (classic sections only) or when both the amend AND the
 * diagram plan are done (the block + fences are in the markdown body). Shows
 * a skeleton while the background amend or the diagram plan runs, an error +
 * Retry for failed amends, and an error + "Retry diagram planning" when the
 * amend is ready but the plan failed (retry re-runs ONLY the plan — the
 * successful amend is never regenerated).
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

  const amendActive = entry?.status === "pending" || entry?.status === "running";
  const planActive = entry?.status === "ready" && (entry.diagramPlan === "pending" || entry.diagramPlan === "running");
  const active = amendActive || planActive;
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

  const done = entry !== undefined && entry !== null && entry.status === "ready" && entry.diagramPlan === "ready";
  if (entry === undefined || !entry || done) return null;

  async function retry(action: "retry" | "retry-diagrams") {
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
        body: JSON.stringify({ action, slug, provider: prefs.provider, model: prefs.model }),
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

  // Diagram plan failed: the amend succeeded; only the plan re-runs.
  if (entry.status === "ready" && entry.diagramPlan === "failed") {
    return (
      <div className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Diagram planning failed (Paper Knowledge is ready)</p>
        {entry.diagramPlanError && <p className="mt-1 text-xs leading-5 text-amber-800">{entry.diagramPlanError}</p>}
        {actionError && <p className="mt-1 text-xs text-amber-800">{actionError}</p>}
        <button
          type="button"
          disabled={retrying}
          onClick={() => void retry("retry-diagrams")}
          className="mt-3 rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry diagram planning"}
        </button>
      </div>
    );
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
          onClick={() => void retry("retry")}
          className="mt-3 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    );
  }

  const planning = planActive;
  return (
    <div className="my-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        <span className="text-sm text-gray-600">
          {planning
            ? "Planning diagrams (deciding where diagrams belong)…"
            : "Extracting Paper Knowledge (terminology, core formulas, mechanism)…"}
        </span>
      </div>
    </div>
  );
}
