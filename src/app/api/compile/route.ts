import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
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

type CompileResult = {
  ok: boolean;
  exitCode: number | null;
  output: string;
};

type ActiveCompile = {
  runId: string;
  promise: Promise<CompileResult>;
};

declare global {
  // Shared across route module reloads in dev to prevent concurrent compiles.
  // eslint-disable-next-line no-var
  var __paperwikiCompile: ActiveCompile | undefined;
}

function appendOutput(current: string, chunk: Buffer | string): string {
  return (current + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

function runCompile(runId: string, provider: string, model: string): Promise<CompileResult> {
  return new Promise((resolve) => {
    const child = spawn("yarn", ["compile"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAPERWIKI_COMPILE_RUN_ID: runId,
        PAPERWIKI_COMPILE_SOURCE: "ui",
        WIKI_LLM_PROVIDER: provider,
        WIKI_LLM_MODEL: model,
      },
      shell: process.platform === "win32",
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output = appendOutput(output, chunk);
    });
    child.stderr.on("data", (chunk) => {
      output = appendOutput(output, chunk);
    });
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, output: appendOutput(output, `${err.message}\n`) });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, exitCode: code, output });
    });
  });
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
  const status = active && snapshot?.runId !== active.runId ? runningSnapshot(active.runId) : snapshot;

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

/** POST /api/compile — start the fixed `yarn compile` command in the background. */
export async function POST(request: NextRequest) {
  if (globalThis.__paperwikiCompile) {
    return NextResponse.json({ error: "compile is already running" }, { status: 409 });
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

  const compilePromise = runCompile(runId, provider.id, model);
  const active: ActiveCompile = { runId, promise: compilePromise };
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
