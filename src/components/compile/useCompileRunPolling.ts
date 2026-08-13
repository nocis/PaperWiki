"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLlmPrefs } from "@/components/LlmPrefsProvider";
import type { CompileRunSnapshot } from "@/lib/runs";

export type CompileStepInfo = { id: string; label: string };
type CompileStatusResponse = {
  status: CompileRunSnapshot | null;
  stepCatalog: { system: CompileStepInfo[]; paper: CompileStepInfo[] };
  progressLog: string;
  statusFile: string;
};

const fallbackCatalog: CompileStatusResponse["stepCatalog"] = {
  system: [],
  paper: [],
};

/** Per-run completion summary is hidden until the user dismisses it. */
const DISMISS_KEY = "paperwiki:compile-summary-dismissed";

/**
 * All stateful compile-run behavior: status polling, start/cancel actions,
 * and the session-dismissed completion summary.
 */
export function useCompileRunPolling(initialStatus: CompileRunSnapshot | null) {
  const router = useRouter();
  const [status, setStatus] = useState<CompileRunSnapshot | null>(initialStatus);
  const [catalog, setCatalog] = useState(fallbackCatalog);
  const [progressLog, setProgressLog] = useState(".log/compile-progress.jsonl");
  const [statusFile, setStatusFile] = useState(".log/compile-status.json");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [shouldPoll, setShouldPoll] = useState(initialStatus?.status === "running");
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const sawRunningRef = useRef(initialStatus?.status === "running");
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();

  // A dismissed completion summary stays hidden across refreshes (session).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* storage is optional */
    }
  }, []);

  useEffect(() => {
    if (!shouldPoll) return;

    let active = true;
    async function loadStatus() {
      try {
        const response = await fetch("/api/compile", { cache: "no-store" });
        if (!response.ok) throw new Error(`status request failed with HTTP ${response.status}`);
        const body = (await response.json()) as CompileStatusResponse;
        if (!active) return;
        setStatus(body.status);
        setCatalog(body.stepCatalog);
        setProgressLog(body.progressLog);
        setStatusFile(body.statusFile);
        setStarting(false);
        setRequestError(null);
        if (body.status?.status === "completed" || body.status?.status === "failed" || body.status?.status === "cancelled") {
          setShouldPoll(false);
        }
      } catch (err) {
        if (active) {
          setRequestError(err instanceof Error ? err.message : "failed to load compile status");
        }
      }
    }

    void loadStatus();
    const interval = window.setInterval(loadStatus, 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [shouldPoll]);

  useEffect(() => {
    if (status?.status === "running") {
      sawRunningRef.current = true;
      return;
    }
    if ((status?.status === "completed" || status?.status === "failed") && sawRunningRef.current) {
      sawRunningRef.current = false;
      router.refresh();
    }
  }, [status, router]);

  async function compilePapers() {
    setRequestError(null);
    if (availabilityState !== "available") {
      setRequestError("LLM unavailable — cannot start compile.");
      void checkNow();
      return;
    }
    // Optimistic start: clear the old snapshot and show "Run is starting…"
    // immediately. Polling starts only after the POST confirms the new run is
    // on disk — a first poll during the POST would read the OLD terminal
    // snapshot and freeze the panel on the previous failure.
    try {
      sessionStorage.removeItem(DISMISS_KEY);
    } catch {
      /* storage is optional */
    }
    setDismissed(false);
    setStatus(null);
    setStarting(true);
    sawRunningRef.current = true;

    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: prefs.provider, model: prefs.model }),
      });
      const body = (await response.json()) as { error?: string };
      if (response.ok) {
        setStarting(false);
        setShouldPoll(true);
      } else if (/already running/i.test(body.error ?? "")) {
        // Another run is genuinely live — reconcile by showing it.
        setStarting(false);
        setShouldPoll(true);
        setRequestError("A compile is already running — showing its live status.");
      } else {
        setRequestError(body.error ?? `compile request failed with HTTP ${response.status}`);
        setShouldPoll(false);
        sawRunningRef.current = false;
        setStarting(false);
      }
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "compile request failed");
      setShouldPoll(false);
      sawRunningRef.current = false;
      setStarting(false);
    }
  }

  async function cancelCompile() {
    setRequestError(null);
    setCancelling(true);
    try {
      const response = await fetch("/api/compile/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `cancel request failed with HTTP ${response.status}`);
      }
      // Pick up the cancelled terminal state on the next poll.
      setShouldPoll(true);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "cancel request failed");
      // Reconcile — the run may have ended on its own.
      setShouldPoll(true);
    } finally {
      setCancelling(false);
    }
  }

  function dismissSummary() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage is optional */
    }
  }

  const prefsUnresolved = !prefs.provider || !prefs.model;
  const llmBlocked =
    prefsUnresolved ||
    availabilityState === "checking" ||
    availabilityState === "unavailable" ||
    availabilityState === "unknown";
  const isCompiling = status?.status === "running" || shouldPoll || starting;

  return {
    status,
    catalog,
    progressLog,
    statusFile,
    requestError,
    starting,
    cancelling,
    dismissed,
    prefs,
    availability,
    availabilityState,
    checkNow,
    prefsUnresolved,
    llmBlocked,
    isCompiling,
    compilePapers,
    cancelCompile,
    dismissSummary,
  };
}
