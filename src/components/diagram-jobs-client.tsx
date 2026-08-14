"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLlmPrefs } from "./LlmPrefsProvider";

export type DiagramJobStatus = "queued" | "rendering" | "done" | "failed";

export interface DiagramJobView {
  key: string;
  slug: string;
  id: string;
  status: DiagramJobStatus;
  error?: string;
}

type JobsResponse = { jobs?: DiagramJobView[] };
type StartResponse = { ok?: boolean; status?: DiagramJobStatus; error?: string };

let jobs: Map<string, DiagramJobView> = new Map();
const listeners = new Set<() => void>();
const pendingPosts = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let pollSlug: string | null = null;
let routerRef: { refresh: () => void } | null = null;
/** Keys observed non-terminal since the last page refresh (per-completion refresh). */
let trackedNonTerminal = new Set<string>();

const POLL_INTERVAL_MS = 1000;

function emit() {
  for (const l of listeners) l();
}

function anyNonTerminal(slug: string): boolean {
  for (const v of jobs.values()) {
    if (v.slug === slug && (v.status === "queued" || v.status === "rendering")) return true;
  }
  return false;
}

function upsert(view: DiagramJobView) {
  const prev = jobs.get(view.key);
  if (prev && prev.status === view.status && prev.error === view.error) return;
  const next = new Map(jobs);
  next.set(view.key, view);
  jobs = next;
  emit();
}

function stopPoll() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ensurePoll() {
  if (pollSlug === null) return;
  if (pollTimer !== null) return;
  if (!anyNonTerminal(pollSlug)) return;
  void tick();
  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

async function tick() {
  if (pollSlug === null || pollInFlight) return;
  pollInFlight = true;
  try {
    const res = await fetch(
      `/api/paper-knowledge?diagram-jobs=1&slug=${encodeURIComponent(pollSlug)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const data = (await res.json()) as JobsResponse;
    const incoming = data.jobs ?? [];
    const seen = new Set(incoming.map((j) => j.id));
    let changed = false;
    const next = new Map(jobs);
    for (const j of incoming) {
      const prev = next.get(j.key);
      if (!prev || prev.status !== j.status || prev.error !== j.error) {
        next.set(j.key, { ...j });
        changed = true;
      }
    }
    for (const [key, v] of next) {
      if (v.slug !== pollSlug) continue;
      // An in-flight view absent from the server list is treated as done —
      // UNLESS its register-POST is still pending (the server hasn't had a
      // chance to list it yet), so optimistic state can't be misread as done.
      if (
        (v.status === "queued" || v.status === "rendering") &&
        !seen.has(v.id) &&
        !pendingPosts.has(key)
      ) {
        next.set(key, { ...v, status: "done" });
        changed = true;
      }
    }
    if (changed) {
      jobs = next;
      emit();
    }
    // Per-completion refresh: refresh the page as soon as ANY previously
    // non-terminal key turns terminal (done or failed) — a finished diagram
    // appears immediately instead of waiting for slower sibling renders.
    for (const [key, v] of next) {
      if (v.slug !== pollSlug) continue;
      if (v.status === "queued" || v.status === "rendering") trackedNonTerminal.add(key);
    }
    let completed = false;
    for (const key of trackedNonTerminal) {
      const v = next.get(key);
      if (!v || (v.status !== "queued" && v.status !== "rendering")) {
        completed = true;
        break;
      }
    }
    if (completed) {
      trackedNonTerminal = new Set();
      routerRef?.refresh();
    }
    if (!anyNonTerminal(pollSlug)) stopPoll();
  } catch {
    /* transient — keep polling */
  } finally {
    pollInFlight = false;
  }
}

function seedAndActivate(slug: string, initialJobs: DiagramJobView[]) {
  pollSlug = slug;
  const next = new Map<string, DiagramJobView>();
  for (const [, v] of jobs) if (v.slug !== slug) next.set(v.key, v);
  for (const j of initialJobs) next.set(j.key, { ...j });
  jobs = next;
  trackedNonTerminal = new Set();
  emit();
  ensurePoll();
}

function deactivate(slug: string) {
  stopPoll();
  if (pollSlug === slug) pollSlug = null;
  trackedNonTerminal = new Set();
  let changed = false;
  const next = new Map<string, DiagramJobView>();
  for (const [k, v] of jobs) {
    if (v.slug === slug) changed = true;
    else next.set(k, v);
  }
  if (changed) {
    jobs = next;
    emit();
  }
}

export async function startDiagram(opts: {
  slug: string;
  id: string;
  provider: string;
  model: string;
}): Promise<void> {
  const { slug, id, provider, model } = opts;
  if (pollSlug === null) pollSlug = slug;
  const key = `${slug}:${id}`;
  pendingPosts.add(key);
  upsert({ key, slug, id, status: "rendering" });
  try {
    const res = await fetch("/api/paper-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "render-diagram", slug, id, provider, model }),
    });
    let data: StartResponse = {};
    try {
      data = (await res.json()) as StartResponse;
    } catch {
      /* non-JSON */
    }
    if (!res.ok || !data.ok) {
      upsert({
        key,
        slug,
        id,
        status: "failed",
        error: data.error ?? `render failed (HTTP ${res.status})`,
      });
      return;
    }
    // The server may hold the render back at the concurrency cap.
    if (data.status === "queued") {
      upsert({ key, slug, id, status: "queued" });
    }
  } catch (err) {
    upsert({
      key,
      slug,
      id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // Start polling only once the register-POST resolved, so the immediate
    // poll in ensurePoll can't outrun the server-side job entry (mirrors the
    // compile panel, which polls only after its POST confirms the run).
    pendingPosts.delete(key);
    ensurePoll();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function DiagramJobsPoller({
  slug,
  initialJobs,
}: {
  slug: string;
  initialJobs: DiagramJobView[];
}) {
  const router = useRouter();
  const sig = initialJobs.map((j) => `${j.id}:${j.status}`).join(",");
  useEffect(() => {
    routerRef = router;
    seedAndActivate(slug, initialJobs);
    return () => deactivate(slug);
    // Re-seed only when the server-truth set of in-flight jobs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sig]);
  return null;
}

export function useDiagramJob(slug: string | null, id: string): {
  view: DiagramJobView | undefined;
  start: () => Promise<void>;
} {
  const key = slug ? `${slug}:${id}` : "";
  const view = useSyncExternalStore(
    subscribe,
    () => (key ? jobs.get(key) : undefined),
    () => undefined
  );
  const { prefs } = useLlmPrefs();
  const start = useCallback(async () => {
    if (!slug || !prefs.provider || !prefs.model) return;
    await startDiagram({ slug, id, provider: prefs.provider, model: prefs.model });
  }, [slug, id, prefs.provider, prefs.model]);
  return { view, start };
}