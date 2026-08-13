"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLlmPrefs } from "@/components/LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";
import type { KnowledgeApiPayload, KnowledgeArticlePayload } from "@/lib/knowledge";
import type { KnowledgeRunSnapshot } from "@/lib/runs";

/**
 * All stateful knowledge-dashboard behavior: data refresh + polling, compile /
 * piece / favorite actions, and the LLM-availability-derived UI flags.
 */
export function useKnowledgeDashboard(initialDb: KnowledgeApiPayload) {
  const [db, setDb] = useState<KnowledgeApiPayload>(initialDb);
  const [runStatus, setRunStatus] = useState<KnowledgeRunSnapshot | null>(initialDb.runStatus);
  const [polling, setPolling] = useState(initialDb.runStatus?.status === "running");
  const [requestError, setRequestError] = useState<string | null>(null);
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge", { cache: "no-store" });
      if (!res.ok) throw new Error(`knowledge request failed with HTTP ${res.status}`);
      const data = (await res.json()) as KnowledgeApiPayload;
      setDb(data);
      setRunStatus(data.runStatus);
    } catch (err) {
      setRequestError(errorMessage(err));
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

  async function toggleFavorite(article: KnowledgeArticlePayload) {
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

  const runTotals = runStatus?.totals;
  const runProgress =
    runStatus?.status === "running" && runTotals && runTotals.articles > 0
      ? Math.min(99, Math.round((runTotals.compiled / runTotals.articles) * 100))
      : runStatus?.status === "completed" || runStatus?.status === "failed"
        ? 100
        : 0;

  return {
    db,
    runStatus,
    polling,
    requestError,
    availabilityState,
    checkNow,
    prefsUnresolved,
    llmBlocked,
    unavailableHint,
    runTotals,
    runProgress,
    compileKnowledge,
    deletePiece,
    toggleFavorite,
    patchPiece,
  };
}
