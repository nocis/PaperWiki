import { NextRequest, NextResponse } from "next/server";
import {
  CITATIONS_PROGRESS_LOG,
  CITATIONS_STATUS_PATH,
  createCitationsRunId,
  markCitationsProcessFinished,
  readCitationsStatus,
  startCitationsRun,
} from "@/lib/runs";
import { citationCoverage, citationCoverageSummary, readCitationMap } from "@/lib/citations";
import { readPaperPages } from "@/lib/wiki";
import { attachJobFinalize, parseProviderRequest, runningSnapshot, spawnJob, type ActiveJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // Shared across route module reloads in dev to prevent concurrent rebuilds.
  // eslint-disable-next-line no-var
  var __paperwikiCitations: ActiveJob | undefined;
}

const CITATIONS_IDLE_TOTALS = { papers: 0, rebuilt: 0, skipped: 0, failed: 0 };

/** GET /api/citations — rebuild status + citation coverage for the health page. */
export async function GET() {
  const active = globalThis.__paperwikiCitations;
  const snapshot = await readCitationsStatus();
  const status =
    active && snapshot?.runId !== active.runId
      ? runningSnapshot(active.runId, CITATIONS_IDLE_TOTALS, active.scope)
      : snapshot;

  const [map, pages] = await Promise.all([readCitationMap(), readPaperPages()]);
  const paperSlugs = pages.map((p) => p.fm.slug).sort();

  return NextResponse.json({
    status: status ?? {
      runId: null,
      status: "idle",
      totals: CITATIONS_IDLE_TOTALS,
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

  const parsed = await parseProviderRequest(request, { slug: true });
  if (!parsed.ok) return parsed.response;
  const { provider, model, slug } = parsed;
  const scope = slug ?? "all";

  const runId = createCitationsRunId();
  await startCitationsRun({ runId, source: "ui", provider: provider.id, model, scope });

  const active = spawnJob({
    runId,
    command: "yarn",
    args: ["citations", ...(slug ? ["--slug", slug] : [])],
    env: {
      PAPERWIKI_CITATIONS_RUN_ID: runId,
      PAPERWIKI_CITATIONS_SOURCE: "ui",
      WIKI_LLM_PROVIDER: provider.id,
      WIKI_LLM_MODEL: model,
    },
    shell: process.platform === "win32",
  });
  active.scope = scope;
  globalThis.__paperwikiCitations = active;

  attachJobFinalize(active, "__paperwikiCitations", "citation rebuild", (result) =>
    markCitationsProcessFinished({
      runId,
      ok: result.ok,
      message: result.ok
        ? "Citation rebuild process exited successfully."
        : `Citation rebuild process exited with code ${result.exitCode ?? "unknown"}.`,
      outputTail: result.output,
    })
  );

  return NextResponse.json(
    {
      ok: true,
      runId,
      status: "running",
      scope,
      progressLog: CITATIONS_PROGRESS_LOG,
      statusFile: CITATIONS_STATUS_PATH,
    },
    { status: 202 }
  );
}
