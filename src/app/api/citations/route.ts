import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  CITATIONS_PROGRESS_LOG,
  CITATIONS_STATUS_PATH,
  createCitationsRunId,
  markCitationsProcessFinished,
  readCitationsStatus,
  startCitationsRun,
  type CitationsRunSnapshot,
} from "@/lib/runs";
import { citationCoverage, citationCoverageSummary, readCitationMap } from "@/lib/citations";
import { readPaperPages } from "@/lib/wiki";
import { resolveModel, resolveProvider, type LLMProviderDef } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OUTPUT_CHARS = 200_000;

type CitationsResult = {
  ok: boolean;
  exitCode: number | null;
  output: string;
};

type ActiveCitations = {
  runId: string;
  scope: string;
  promise: Promise<CitationsResult>;
};

declare global {
  // Shared across route module reloads in dev to prevent concurrent rebuilds.
  // eslint-disable-next-line no-var
  var __paperwikiCitations: ActiveCitations | undefined;
}

function appendOutput(current: string, chunk: Buffer | string): string {
  return (current + chunk.toString()).slice(-MAX_OUTPUT_CHARS);
}

function runRebuild(runId: string, provider: string, model: string, slug?: string): Promise<CitationsResult> {
  return new Promise((resolve) => {
    const args = ["citations", ...(slug ? ["--slug", slug] : [])];
    const child = spawn("yarn", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PAPERWIKI_CITATIONS_RUN_ID: runId,
        PAPERWIKI_CITATIONS_SOURCE: "ui",
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

function runningSnapshot(runId: string, scope?: string): CitationsRunSnapshot {
  const now = new Date().toISOString();
  return {
    runId,
    status: "running",
    source: "ui",
    scope,
    startedAt: now,
    updatedAt: now,
    totals: { papers: 0, rebuilt: 0, skipped: 0, failed: 0 },
    events: [],
  };
}

/** GET /api/citations — rebuild status + citation coverage for the health page. */
export async function GET() {
  const active = globalThis.__paperwikiCitations;
  const snapshot = await readCitationsStatus();
  const status =
    active && snapshot?.runId !== active.runId
      ? runningSnapshot(active.runId, active.scope)
      : snapshot;

  const [map, pages] = await Promise.all([readCitationMap(), readPaperPages()]);
  const paperSlugs = pages.map((p) => p.fm.slug).sort();

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: { papers: 0, rebuilt: 0, skipped: 0, failed: 0 },
      events: [],
    },
    coverage: {
      summary: citationCoverageSummary(map, paperSlugs),
      rows: citationCoverage(map, paperSlugs),
    },
    progressLog: CITATIONS_PROGRESS_LOG,
    statusFile: CITATIONS_STATUS_PATH,
  });
}

/** POST /api/citations — start `yarn citations` (full rebuild, or one paper). */
export async function POST(request: NextRequest) {
  if (globalThis.__paperwikiCitations) {
    return NextResponse.json({ error: "citation rebuild is already running" }, { status: 409 });
  }

  let slug: string | undefined;
  let providerId: string | undefined;
  let modelOverride: string | undefined;
  try {
    const body = (await request.json()) as { slug?: unknown; provider?: unknown; model?: unknown };
    slug = typeof body.slug === "string" && body.slug.length > 0 ? body.slug : undefined;
    providerId = typeof body.provider === "string" && body.provider.length > 0 ? body.provider : undefined;
    modelOverride = typeof body.model === "string" && body.model.length > 0 ? body.model : undefined;
  } catch {
    /* POST without a body is allowed — full rebuild with env/default config */
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
  const runId = createCitationsRunId();
  await startCitationsRun({ runId, source: "ui", provider: provider.id, model, scope: slug ?? "all" });

  const rebuildPromise = runRebuild(runId, provider.id, model, slug);
  const active: ActiveCitations = { runId, scope: slug ?? "all", promise: rebuildPromise };
  globalThis.__paperwikiCitations = active;

  void rebuildPromise
    .then(async (result) => {
      await markCitationsProcessFinished({
        runId,
        ok: result.ok,
        message: result.ok
          ? "Citation rebuild process exited successfully."
          : `Citation rebuild process exited with code ${result.exitCode ?? "unknown"}.`,
        outputTail: result.output,
      });
    })
    .catch((err) => {
      console.error("failed to finalize citation rebuild progress", err);
    })
    .finally(() => {
      if (globalThis.__paperwikiCitations === active) {
        globalThis.__paperwikiCitations = undefined;
      }
    });

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      scope: slug ?? "all",
      progressLog: CITATIONS_PROGRESS_LOG,
      statusFile: CITATIONS_STATUS_PATH,
    },
    { status: 202 }
  );
}
