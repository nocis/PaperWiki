import { spawn, type ChildProcess } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import {
  COMPILE_STEP_CATALOG,
  createCompileRunId,
  isStaleRunning,
  markCompileProcessFinished,
  readCompileStatus,
  readEffectiveCompileStatus,
  startCompileRun,
  type CompileRunSnapshot,
} from "@/lib/runs";
import { resolveProvider, resolveModel, type LLMProviderDef } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OUTPUT_CHARS = 200_000;

const COMPILE_OUTPUT_LOG = path.join(process.cwd(), ".log", "compile-output.log");

function forwardOutput(chunk: Buffer | string): void {
  process.stdout.write(chunk.toString());
  fs.appendFile(COMPILE_OUTPUT_LOG, chunk.toString()).catch(() => {
    /* log persistence is best-effort */
  });
}

type CompileResult = {
  ok: boolean;
  exitCode: number | null;
  output: string;
};

export type ActiveCompile = {
  runId: string;
  child: ChildProcess;
  promise: Promise<CompileResult>;
  /** True once the child exited or failed to start (set on "close"/"error"). */
  settled: boolean;
};

declare global {
  // Shared across route module reloads in dev to prevent concurrent compiles.
  // eslint-disable-next-line no-var
  var __paperwikiCompile: ActiveCompile | undefined;
}

function appendOutput(current: string, chunk: Buffer | string): string {
  return (current + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

function runCompile(runId: string, provider: string, model: string): {
  child: ChildProcess;
  promise: Promise<CompileResult>;
} {
  // Spawn the compiler directly with node --import tsx — no `yarn` indirection
  // (no PATH dependence, works identically on all platforms without a shell).
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join(process.cwd(), "scripts", "compile.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAPERWIKI_COMPILE_RUN_ID: runId,
        PAPERWIKI_COMPILE_SOURCE: "ui",
        WIKI_LLM_PROVIDER: provider,
        WIKI_LLM_MODEL: model,
      },
    }
  );

  const promise = new Promise<CompileResult>((resolve) => {
    let output = "";
    fs.appendFile(COMPILE_OUTPUT_LOG, `\n===== compile run ${runId} @ ${new Date().toISOString()} =====\n`).catch(() => {});
    child.stdout.on("data", (chunk) => {
      output = appendOutput(output, chunk);
      forwardOutput(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output = appendOutput(output, chunk);
      forwardOutput(chunk);
    });
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, output: appendOutput(output, `${err.message}\n`) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, exitCode: code, output });
    });
  });

  return { child, promise };
}

function runningSnapshot(runId: string): CompileRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId,
    status: "running",
    source: "ui",
    startedAt: now,
    updatedAt: now,
    totals: { papers: 0, compiled: 0, duplicates: 0, failed: 0 },
    events: [],
  };
}

/** GET /api/compile — latest persistent compile-run status for dashboard polling. */
export async function GET() {
  const active = globalThis.__paperwikiCompile;
  const snapshot = await readEffectiveCompileStatus();
  // Only a genuinely alive child is reported as "running"; a dead/hung one
  // must surface its persisted (terminal) status instead of a fake running.
  const activeAlive =
    active !== undefined &&
    !active.settled &&
    active.child.exitCode === null &&
    active.child.signalCode === null;
  const status = activeAlive && snapshot?.runId !== active.runId ? runningSnapshot(active.runId) : snapshot;

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: { papers: 0, compiled: 0, duplicates: 0, failed: 0 },
      events: [],
    },
    stepCatalog: COMPILE_STEP_CATALOG,
    progressLog: ".log/compile-progress.jsonl",
    statusFile: ".log/compile-status.json",
  });
}

/** POST /api/compile — start the fixed compile command in the background. */
export async function POST(request: NextRequest) {
  // Only a genuinely alive process keeps the slot. A dead/hung child (exited,
  // or never started) must not block retries: formally fail its run if the
  // persisted snapshot still claims "running", then clear and proceed.
  const existingActive = globalThis.__paperwikiCompile;
  if (existingActive) {
    const alive =
      !existingActive.settled &&
      existingActive.child.exitCode === null &&
      existingActive.child.signalCode === null;
    const snapshot = await readCompileStatus();
    const snapshotTerminal = snapshot !== null && snapshot.status !== "running";
    if (alive && !snapshotTerminal) {
      return NextResponse.json({ error: "compile is already running" }, { status: 409 });
    }
    if (!snapshotTerminal) {
      await markCompileProcessFinished({
        runId: existingActive.runId,
        ok: false,
        message: "The previous compile process ended before it could mark the run complete.",
      });
    }
    globalThis.__paperwikiCompile = undefined;
  }

  // A stale "running" snapshot from a dead run must not block a new one.
  const stale = isStaleRunning(await readCompileStatus());
  if (stale) {
    const staleSnapshot = await readCompileStatus();
    await markCompileProcessFinished({
      runId: staleSnapshot!.runId,
      ok: false,
      message: "Previous compile run was interrupted (server restarted mid-run).",
    });
  }

  let providerId: string | undefined;
  let modelOverride: string | undefined;
  try {
    const body = (await request.json()) as { provider?: unknown; model?: unknown };
    providerId = typeof body.provider === "string" && body.provider.length > 0 ? body.provider : undefined;
    modelOverride = typeof body.model === "string" && body.model.length > 0 ? body.model : undefined;
  } catch {
    /* POST without a body is allowed — use env/default configuration */
  }

  // Zero-cost hard guard: a provider without its API key env var must not start.
  let provider: LLMProviderDef;
  try {
    provider = resolveProvider(providerId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown provider" },
      { status: 400 }
    );
  }
  if (!process.env[provider.apiKeyEnv]) {
    return NextResponse.json(
      {
        error: `${provider.apiKeyEnv} is not set. Add it to .env.local and restart the server.`,
        kind: "missing-key",
      },
      { status: 503 }
    );
  }

  const model = resolveModel(provider, modelOverride);
  const runId = createCompileRunId();
  await startCompileRun({ runId, source: "ui", provider: provider.id, model });

  const { child, promise: compilePromise } = runCompile(runId, provider.id, model);
  const active: ActiveCompile = { runId, child, promise: compilePromise, settled: false };
  child.on("close", () => {
    active.settled = true;
  });
  child.on("error", () => {
    active.settled = true;
  });
  globalThis.__paperwikiCompile = active;

  void compilePromise
    .then(async (result) => {
      await markCompileProcessFinished({
        runId,
        ok: result.ok,
        message: result.ok
          ? "Compiler process exited successfully."
          : `Compiler process exited with code ${result.exitCode ?? "unknown"}.`,
        outputTail: result.output,
      });
    })
    .catch((err) => {
      console.error("failed to finalize compile progress", err);
    })
    .finally(() => {
      if (globalThis.__paperwikiCompile === active) {
        globalThis.__paperwikiCompile = undefined;
      }
    });

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      progressLog: ".log/compile-progress.jsonl",
      statusFile: ".log/compile-status.json",
    },
    { status: 202 }
  );
}
