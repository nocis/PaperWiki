"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useHealthDashboard } from "@/components/health/useHealthDashboard";
import { CitationMapPanel } from "@/components/health/CitationMapPanel";
import { LintPanel } from "@/components/health/LintPanel";
import { DangerZone } from "@/components/health/DangerZone";
import PaperKnowledgePanel from "@/components/health/PaperKnowledgePanel";
import DiagramLogsPanel from "@/components/health/DiagramLogsPanel";

export default function HealthDashboard() {
  const {
    view,
    report,
    error,
    citations,
    citationsError,
    rebuilding,
    resetting,
    resetResult,
    prefsUnresolved,
    llmBlocked,
    unavailableHint,
    availabilityState,
    checkNow,
    runStatus,
    totals,
    rebuildProgress,
    coverage,
    load,
    applyFixes,
    resetToZero,
    startRebuild,
  } = useHealthDashboard();

  // After a successful reset-to-zero the paper-knowledge status file is gone;
  // bump the panel's refresh key so it re-fetches and clears the stale list.
  const [resetEpoch, setResetEpoch] = useState(0);
  useEffect(() => {
    if (resetResult) setResetEpoch((epoch) => epoch + 1);
  }, [resetResult]);

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

      <CitationMapPanel
        citations={citations}
        runStatus={runStatus}
        totals={totals}
        rebuildProgress={rebuildProgress}
        coverage={coverage}
        rebuilding={rebuilding}
        llmBlocked={llmBlocked}
        prefsUnresolved={prefsUnresolved}
        availabilityState={availabilityState}
        unavailableHint={unavailableHint}
        checkNow={checkNow}
        citationsError={citationsError}
        onRebuild={startRebuild}
      />

      {view !== "running" && report && <LintPanel report={report} />}

      <PaperKnowledgePanel refreshKey={resetEpoch} />

      <DiagramLogsPanel refreshKey={resetEpoch} />

      <DangerZone resetting={resetting} resetResult={resetResult} onReset={() => void resetToZero()} />
    </div>
  );
}
