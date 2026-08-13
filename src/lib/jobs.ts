/**
 * Shared machinery for the three long-running background jobs (paper compile,
 * citation rebuild, knowledge compile).
 *
 * Each route keeps its own preflight/response shape; this module provides the
 * common parts: output capture, child spawn, the optimistic "running"
 * snapshot, the provider guard, and the finalize-then-clear wiring.
 */
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { resolveModel, resolveProvider, type LLMProviderDef } from "@/lib/llm";
import type { RunSnapshot } from "@/lib/progress";

const MAX_OUTPUT_CHARS = 200_000;

function appendOutput(current: string, chunk: Buffer | string): string {
  return (current + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

interface JobResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
}

export interface ActiveJob {
  runId: string;
  child: ChildProcess;
  promise: Promise<JobResult>;
  /** True once the child exited or failed to start (set on "close"/"error"). */
  settled: boolean;
  /** Citations only: the rebuild scope ("all" or one slug). */
  scope?: string;
}

interface SpawnJobOptions {
  runId: string;
  command: string;
  args: string[];
  /** Child env additions (PAPERWIKI_*_RUN_ID etc.). */
  env: Record<string, string>;
  /** Prefer a shell (yarn wrapper) — used on win32. */
  shell?: boolean;
  /** Run banner line appended to the output log (best-effort). */
  banner?: string;
  /** When set, child output is appended here (best-effort). */
  outputLog?: string;
  /** When set, child output is also forwarded to the server stdout. */
  forwardToStdout?: boolean;
}

/**
 * Spawn a background job and capture its output (bounded tail). The returned
 * ActiveJob.settled flips to true once the child exits or fails to start.
 */
export function spawnJob(opts: SpawnJobOptions): ActiveJob {
  const child = spawn(opts.command, opts.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...opts.env },
    ...(opts.shell ? { shell: true } : {}),
  });

  let output = "";
  const promise = new Promise<JobResult>((resolve) => {
    if (opts.banner && opts.outputLog) {
      fs.appendFile(opts.outputLog, opts.banner).catch(() => {});
    }
    const onData = (chunk: Buffer | string) => {
      output = appendOutput(output, chunk);
      if (opts.forwardToStdout) process.stdout.write(chunk.toString());
      if (opts.outputLog) {
        fs.appendFile(opts.outputLog, chunk.toString()).catch(() => {});
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, output: appendOutput(output, `${err.message}\n`) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, exitCode: code, output });
    });
  });

  const active: ActiveJob = { runId: opts.runId, child, promise, settled: false };
  const markSettled = () => {
    active.settled = true;
  };
  child.on("close", markSettled);
  child.on("error", markSettled);

  return active;
}

/** Optimistic "running" snapshot shown while the child is live but not yet on disk. */
export function runningSnapshot(runId: string, totals: Record<string, number>, scope?: string): RunSnapshot {
  const now = new Date().toISOString();
  return {
    runId,
    status: "running",
    source: "ui",
    scope,
    startedAt: now,
    updatedAt: now,
    totals,
    events: [],
  };
}

/**
 * Parse the POST body (provider/model, optionally slug), resolve the provider,
 * and enforce the zero-cost API-key guard. Returns either the resolved
 * provider + model, or a ready-to-send error response.
 */
export async function parseProviderRequest(
  request: NextRequest,
  opts: { slug?: boolean } = {}
): Promise<{ ok: true; provider: LLMProviderDef; model: string; slug?: string } | { ok: false; response: NextResponse }> {
  let slug: string | undefined;
  let providerId: string | undefined;
  let modelOverride: string | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (opts.slug) {
      slug = typeof body.slug === "string" && body.slug.length > 0 ? body.slug : undefined;
    }
    providerId = typeof body.provider === "string" && body.provider.length > 0 ? body.provider : undefined;
    modelOverride = typeof body.model === "string" && body.model.length > 0 ? body.model : undefined;
  } catch {
    /* POST without a body is allowed — use env/default configuration */
  }

  let provider: LLMProviderDef;
  try {
    provider = resolveProvider(providerId);
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: err instanceof Error ? err.message : "unknown provider" },
        { status: 400 }
      ),
    };
  }
  if (!process.env[provider.apiKeyEnv]) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `${provider.apiKeyEnv} is not set. Add it to .env.local and restart the server.`,
          kind: "missing-key",
        },
        { status: 503 }
      ),
    };
  }
  const model = resolveModel(provider, modelOverride);
  return opts.slug ? { ok: true, provider, model, slug } : { ok: true, provider, model };
}

/**
 * Wire the job's terminal result into the run tracker, then clear the global
 * slot. The slot is cleared only when this job is still the current one.
 */
export function attachJobFinalize(
  active: ActiveJob,
  globalKey: string,
  label: string,
  mark: (result: JobResult) => Promise<void>
): void {
  const g = globalThis as Record<string, unknown>;
  void active.promise
    .then(async (result) => {
      await mark(result);
    })
    .catch((err) => {
      console.error(`failed to finalize ${label} job progress`, err);
    })
    .finally(() => {
      if (g[globalKey] === active) {
        g[globalKey] = undefined;
      }
    });
}
