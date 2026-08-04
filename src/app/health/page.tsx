"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLlmPrefs } from "@/components/LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";

interface HealthIssue {
  severity: "error" | "warning";
  kind: string;
  target?: string;
  message: string;
  autoFixable: boolean;
}

interface HealthReport {
  generatedAt: string;
  errors: number;
  warnings: number;
  ok: boolean;
  issues: HealthIssue[];
  fixed?: HealthIssue[];
  proposalsAdded?: number;
}

type View = "report" | "running" | "applied";

interface CitationsTotals {
  papers: number;
  rebuilt: number;
  skipped: number;
  failed: number;
}

interface CitationsRunStatus {
  runId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  provider?: string;
  model?: string;
  scope?: string;
  totals: CitationsTotals;
  error?: string;
}

interface CitationCoverageRow {
  slug: string;
  missing: boolean;
  total: number;
  matched: number;
  unlinked: number;
  stale: boolean;
}

interface CitationsResponse {
  status: CitationsRunStatus | null;
  coverage: {
    summary: {
      papers: number;
      withMap: number;
      missingMap: number;
      citations: number;
      matched: number;
      unlinked: number;
    };
    rows: CitationCoverageRow[];
  };
}

export default function HealthDashboard() {
  const [view, setView] = useState<View>("running");
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [citations, setCitations] = useState<CitationsResponse | null>(null);
  const [citationsError, setCitationsError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();

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

  const load = useCallback(async (apply: boolean) => {
    setView("running");
    setError(null);
    try {
      const res = await fetch("/api/health", { method: apply ? "POST" : "GET" });
      const data = (await res.json()) as HealthReport;
      if (!res.ok) throw new Error((data as unknown as { error?: string })?.error ?? `HTTP ${res.status}`);
      setReport(data);
      setView("report");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setView("report");
    }
  }, []);

  const loadCitations = useCallback(async () => {
    try {
      const res = await fetch("/api/citations", { cache: "no-store" });
      if (!res.ok) throw new Error(`citation status request failed with HTTP ${res.status}`);
      const data = (await res.json()) as CitationsResponse;
      setCitations(data);
      setRebuilding(data.status?.status === "running");
    } catch (err) {
      setCitationsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load(false);
    void loadCitations();
  }, [load, loadCitations]);

  useEffect(() => {
    if (!rebuilding) return;
    const interval = window.setInterval(() => void loadCitations(), 1000);
    return () => window.clearInterval(interval);
  }, [rebuilding, loadCitations]);

  const applyFixes = async () => {
    await load(true);
    setView("applied");
  };

  const startRebuild = async (slug?: string) => {
    setCitationsError(null);
    if (availabilityState !== "available") {
      setCitationsError("LLM unavailable — cannot rebuild citations.");
      void checkNow();
      return;
    }
    setRebuilding(true);
    try {
      const res = await fetch("/api/citations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, provider: prefs.provider, model: prefs.model }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `rebuild request failed with HTTP ${res.status}`);
      await loadCitations();
    } catch (err) {
      setCitationsError(err instanceof Error ? err.message : String(err));
      setRebuilding(false);
    }
  };

  const severityClass = (severity: string) =>
    severity === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  const runStatus = citations?.status;
  const totals = runStatus?.totals ?? { papers: 0, rebuilt: 0, skipped: 0, failed: 0 };
  const rebuildProgress =
    runStatus?.status === "running" && totals.papers > 0
      ? Math.min(99, Math.round(((totals.rebuilt + totals.skipped) / totals.papers) * 100))
      : runStatus?.status === "completed" || runStatus?.status === "failed"
        ? 100
        : 0;
  const coverage = citations?.coverage.summary;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← Knowledge Base
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">Wiki Health</h1>
          <p className="mt-1 text-sm text-gray-500">
            Invariant inspector — reciprocity, links, figures, citation map, and granularity checks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={view === "running"}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:border-gray-300 disabled:opacity-50"
          >
            Re-run checks
          </button>
          <button
            type="button"
            onClick={() => void applyFixes()}
            disabled={view === "running"}
            className="rounded-full bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"
          >
            Apply auto-fixes
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
      )}

      {view === "running" && <p className="text-sm text-gray-500">Checking wiki invariants…</p>}

      {view === "applied" && report && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Auto-fixes applied: {report.fixed?.length ?? 0} issue(s) fixed, {report.proposalsAdded ?? 0} proposal(s)
          queued. {report.errors} error(s), {report.warnings} warning(s) remain.
        </p>
      )}

      {/* --- Citation Map section -------------------------------------------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">Citation Map</h2>
            <p className="mt-1 text-sm text-gray-500">
              LLM-built citation records linking each paper's raw bibliography to compiled papers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/citations" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:border-gray-300">
              View citation graph
            </Link>
            <button
              type="button"
              onClick={() => void startRebuild()}
              disabled={rebuilding || llmBlocked}
              title={llmBlocked && availabilityState !== "available" ? "Waiting for LLM availability…" : undefined}
              className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-400"
            >
              {rebuilding
                ? "Rebuilding…"
                : llmBlocked
                  ? prefsUnresolved
                    ? "Loading…"
                    : availabilityState === "checking" || availabilityState === "unknown"
                      ? "Checking availability…"
                      : "LLM unavailable"
                  : "Rebuild citations"}
            </button>
          </div>
        </div>

        {unavailableHint && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
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

        {citationsError && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{citationsError}</p>
        )}

        {coverage && (
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
              {coverage.withMap}/{coverage.papers} papers with map entries
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
              {coverage.citations} citations
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
              {coverage.matched} linked
            </span>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
              {coverage.unlinked} unlinked
            </span>
            {coverage.missingMap > 0 && (
              <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                {coverage.missingMap} missing map entries
              </span>
            )}
          </div>
        )}

        {runStatus && runStatus.status === "running" && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-900">
              Rebuilding citations…
              {runStatus.scope && runStatus.scope !== "all" && (
                <span className="ml-2 text-xs text-gray-500">paper {runStatus.scope}</span>
              )}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {totals.rebuilt + totals.skipped}/{totals.papers} papers processed
              {runStatus.provider || runStatus.model ? (
                <> · <code>{runStatus.provider ?? "default"}/{runStatus.model ?? "default"}</code></>
              ) : null}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded bg-white">
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${rebuildProgress}%` }} />
            </div>
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
            {runStatus.status === "failed" ? `Rebuild failed: ${runStatus.error ?? "unknown error"}` : "Citation rebuild completed."}
          </p>
        )}

        {citations && citations.coverage.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700">Paper</th>
                  <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700">Citations</th>
                  <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-right font-semibold text-gray-700">Rebuild</th>
                </tr>
              </thead>
              <tbody>
                {citations.coverage.rows.map((row) => (
                  <tr key={row.slug} className="border-b border-gray-100">
                    <td className="px-3 py-2">
                      <Link href={`/paper/${row.slug}`} className="font-medium text-gray-900 hover:text-blue-700">
                        {row.slug}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.missing ? "—" : `${row.matched}/${row.total} linked`}
                    </td>
                    <td className="px-3 py-2">
                      {row.missing ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">no map entry</span>
                      ) : row.stale ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">stale</span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">ok</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void startRebuild(row.slug)}
                        disabled={rebuilding || llmBlocked}
                        className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Rebuild
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {coverage && coverage.papers === 0 && (
          <p className="mt-4 text-sm text-gray-500">No compiled papers yet.</p>
        )}
      </section>

      {view !== "running" && report && (
        <>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
              {report.ok ? "Healthy" : "Issues found"}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
              {report.errors} error{report.errors === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
              {report.warnings} warning{report.warnings === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">
              checked {new Date(report.generatedAt).toLocaleTimeString()}
            </span>
          </div>

          {report.issues.length === 0 ? (
            <p className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-8 text-emerald-800">
              No issues detected — wiki invariants, links, figures, and citations all check out.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.issues.map((issue, index) => (
                <li
                  key={`${issue.kind}-${issue.target}-${index}`}
                  className={`flex flex-wrap items-baseline gap-2 rounded-lg border px-4 py-3 text-sm ${severityClass(issue.severity)}`}
                >
                  <span className="font-semibold uppercase tracking-wide">{issue.severity}</span>
                  <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">{issue.kind}</code>
                  {issue.target && <span className="font-medium">{issue.target}</span>}
                  <span className="flex-1 text-[13px]">{issue.message}</span>
                  {issue.autoFixable && (
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">auto-fixable</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
