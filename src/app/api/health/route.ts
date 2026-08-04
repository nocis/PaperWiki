import { NextRequest, NextResponse } from "next/server";
import { runLint, summarize } from "@/lib/lint-wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — read-only health report (no writes). */
export async function GET() {
  const result = await runLint({ applyFixes: false, queueProposals: false });
  return NextResponse.json({
    generatedAt: result.generatedAt,
    ...summarize(result),
    issues: result.issues,
  });
}

/** POST — apply mechanical auto-fixes and queue structural proposals. */
export async function POST(request: NextRequest) {
  let queueProposals = true;
  try {
    const body = await request.json();
    queueProposals = (body as { queueProposals?: unknown })?.queueProposals !== false;
  } catch {
    /* POST without a body is allowed — default behavior */
  }

  const result = await runLint({ applyFixes: true, queueProposals });
  return NextResponse.json({
    generatedAt: result.generatedAt,
    ...summarize(result),
    issues: result.issues,
    fixed: result.fixed,
    proposalsAdded: result.proposalsAdded,
  });
}
