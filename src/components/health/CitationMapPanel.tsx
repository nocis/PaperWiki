"use client";

import Link from "next/link";
import type { AvailabilityState } from "@/lib/llm-availability";
import type { CitationsRunSnapshot } from "@/lib/runs";
import type { CitationCoverageRow, CitationsResponse } from "./types";

/** The Citation Map section: rebuild controls, coverage summary, live run, table. */
export function CitationMapPanel({
  citations,
  runStatus,
  totals,
  rebuildProgress,
  coverage,
  rebuilding,
  llmBlocked,
  prefsUnresolved,
  availabilityState,
  unavailableHint,
  checkNow,
  citationsError,
  onRebuild,
}: {
  citations: CitationsResponse | null;
  runStatus: CitationsRunSnapshot | null;
  totals: Record<string, number>;
  rebuildProgress: number;
  coverage: CitationsResponse["coverage"]["summary"] | undefined;
  rebuilding: boolean;
  llmBlocked: boolean;
  prefsUnresolved: boolean;
  availabilityState: AvailabilityState;
  unavailableHint: string | null;
  checkNow: () => void;
  citationsError: string | null;
  onRebuild: (slug?: string) => void;
}) {
  return (
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
            onClick={() => onRebuild()}
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
              {citations.coverage.rows.map((row: CitationCoverageRow) => (
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
                      onClick={() => onRebuild(row.slug)}
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
  );
}
