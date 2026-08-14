"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLlmPrefs } from "../LlmPrefsProvider";

interface KnowledgeEntry {
  slug: string;
  status: "pending" | "running" | "ready" | "failed";
  error?: string;
  diagramPlan?: "pending" | "running" | "ready" | "failed";
  diagramPlanError?: string;
  updatedAt: string;
}

interface KnowledgeStatus {
  entries: KnowledgeEntry[];
  active: boolean;
}

const STATUS_LABEL: Record<KnowledgeEntry["status"], string> = {
  pending: "Pending",
  running: "Running",
  ready: "Ready",
  failed: "Failed",
};

const PLAN_LABEL: Record<NonNullable<KnowledgeEntry["diagramPlan"]>, string> = {
  pending: "Plan pending",
  running: "Planning",
  ready: "Plan ready",
  failed: "Plan failed",
};

/**
 * Health panel for the Paper Knowledge pipeline (amend + diagram plan): every
 * tracked paper with its statuses, plus a Retry button for FAILED amends and
 * a "Retry plan" button when the amend is ready but the diagram plan failed
 * (re-runs ONLY the plan — the amend is never regenerated). Polls while any
 * phase is pending/running; re-polls when refreshKey changes (e.g. after a
 * reset-to-zero, so the stale list clears immediately).
 */
export default function PaperKnowledgePanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const { prefs } = useLlmPrefs();
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-knowledge");
      if (!res.ok) return;
      setStatus((await res.json()) as KnowledgeStatus);
    } catch {
      /* keep the last known state */
    }
  }, []);

  useEffect(() => {
    void poll();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll, refreshKey]);

  const anyActive =
    status?.active === true ||
    status?.entries.some((e) => e.status === "pending" || e.status === "running") ||
    status?.entries.some((e) => e.diagramPlan === "pending" || e.diagramPlan === "running");
  useEffect(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (anyActive) timer.current = setInterval(() => void poll(), 3000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [anyActive, poll]);

  async function retry(slug: string, action: "retry" | "retry-diagrams") {
    if (!prefs.provider || !prefs.model) {
      setActionError("Select a provider/model in the top navigation first.");
      return;
    }
    setBusySlug(slug);
    setActionError(null);
    try {
      const res = await fetch("/api/paper-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, slug, provider: prefs.provider, model: prefs.model }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(`"${slug}": ${data.error ?? "retry failed"}`);
      } else {
        await poll();
      }
    } catch (err) {
      setActionError(`"${slug}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusySlug(null);
    }
  }

  const entries = status?.entries ?? [];
  const failed = entries.filter((e) => e.status === "failed");
  const inFlight = entries.filter(
    (e) => e.status === "pending" || e.status === "running" || e.diagramPlan === "pending" || e.diagramPlan === "running"
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight text-gray-900">Paper Knowledge amend</h3>
        {status?.active && <span className="text-xs text-gray-500">background job running…</span>}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">
          No tracked papers yet — the amend and the diagram plan run in the background after each compile;
          retries are available for failed amends and failed diagram plans.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-2">Paper</th>
              <th className="px-2 py-2">Amend</th>
              <th className="px-2 py-2">Diagrams</th>
              <th className="px-2 py-2">Error</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.slug} className="border-b border-gray-100">
                <td className="px-2 py-2">
                  <a href={`/paper/${e.slug}`} className="text-blue-700 underline decoration-blue-200 hover:decoration-blue-400">
                    {e.slug}
                  </a>
                </td>
                <td className="px-2 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      e.status === "ready"
                        ? "bg-green-50 text-green-700"
                        : e.status === "failed"
                          ? "bg-red-50 text-red-700"
                          : e.status === "running"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {e.diagramPlan ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.diagramPlan === "ready"
                          ? "bg-green-50 text-green-700"
                          : e.diagramPlan === "failed"
                            ? "bg-red-50 text-red-700"
                            : e.diagramPlan === "running"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {PLAN_LABEL[e.diagramPlan]}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="max-w-md truncate px-2 py-2 text-xs text-gray-500" title={e.error ?? e.diagramPlanError}>
                  {e.diagramPlan === "failed" ? (e.diagramPlanError ?? "") : (e.error ?? "")}
                </td>
                <td className="px-2 py-2 text-right">
                  {e.status === "failed" && (
                    <button
                      type="button"
                      disabled={busySlug === e.slug}
                      onClick={() => void retry(e.slug, "retry")}
                      className="rounded-lg bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {busySlug === e.slug ? "Retrying…" : "Retry"}
                    </button>
                  )}
                  {e.status === "ready" && e.diagramPlan === "failed" && (
                    <button
                      type="button"
                      disabled={busySlug === e.slug}
                      onClick={() => void retry(e.slug, "retry-diagrams")}
                      className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {busySlug === e.slug ? "Retrying…" : "Retry plan"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {inFlight.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          {inFlight.length} paper(s) in flight — the paper page shows a skeleton until ready; browsing is never blocked.
        </p>
      )}
      {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
    </section>
  );
}
