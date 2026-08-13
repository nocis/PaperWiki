"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLlmPrefs } from "@/components/LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";
import type { CitationsResponse, HealthReport, View } from "./types";

/**
 * All health-dashboard state: lint report load/apply, citations status
 * polling + rebuild, the reset-to-zero flow, and LLM-derived flags.
 */
export function useHealthDashboard() {
  const router = useRouter();
  const [view, setView] = useState<View>("running");
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [citations, setCitations] = useState<CitationsResponse | null>(null);
  const [citationsError, setCitationsError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();

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
      setError(errorMessage(err));
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
      setCitationsError(errorMessage(err));
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

  async function applyFixes() {
    await load(true);
    setView("applied");
  }

  async function resetToZero() {
    const first = window.confirm(
      "Reset to zero?\n\nEvery compiled paper will be moved back to papers/new/ as a new paper, and all generated artifacts will be deleted: wiki pages, index/log/proposals, data/wiki-db.json, citation map, figures, progress logs, knowledge articles.\n\nKept: wiki/SCHEMA.md, wiki/journal/, knowledge/pieces/, comments/, and favorited knowledge articles."
    );
    if (!first) return;
    const second = window.confirm("This cannot be undone. Continue?");
    if (!second) return;
    setResetting(true);
    setResetResult(null);
    try {
      const res = await fetch("/api/health/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const data = (await res.json()) as {
        error?: string;
        movedToInbox?: string[];
        renamed?: string[];
        leftoverDuplicates?: string[];
        removedDirs?: string[];
        removedFiles?: string[];
      };
      if (!res.ok) throw new Error(data.error ?? `reset failed with HTTP ${res.status}`);
      setResetResult(
        `${data.movedToInbox?.length ?? 0} paper(s) moved back to papers/new/${
          data.renamed && data.renamed.length > 0 ? `; ${data.renamed.length} renamed on collision` : ""
        }; ${
          (data.removedDirs?.length ?? 0) + (data.removedFiles?.length ?? 0)
        } generated item(s) removed. Run a from-zero compile to rebuild the wiki.${
          data.leftoverDuplicates && data.leftoverDuplicates.length > 0
            ? ` Warning: ${data.leftoverDuplicates.length} duplicate(s) left in papers/duplicates/.`
            : ""
        }`
      );
      await Promise.all([load(false), loadCitations()]);
      // The reset moved compiled papers back to the inbox and deleted derived
      // artifacts — invalidate the client router cache so navigating back to
      // the home page shows the fresh state (papers list, compile panel) without
      // a manual refresh.
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResetting(false);
    }
  }

  async function startRebuild(slug?: string) {
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
      setCitationsError(errorMessage(err));
      setRebuilding(false);
    }
  }

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

  const runStatus = citations?.status;
  const totals = runStatus?.totals ?? { papers: 0, rebuilt: 0, skipped: 0, failed: 0 };
  const rebuildProgress =
    runStatus?.status === "running" && totals.papers > 0
      ? Math.min(99, Math.round(((totals.rebuilt + totals.skipped) / totals.papers) * 100))
      : runStatus?.status === "completed" || runStatus?.status === "failed"
        ? 100
        : 0;
  const coverage = citations?.coverage.summary;

  return {
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
  };
}
