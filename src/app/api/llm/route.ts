import { NextResponse } from "next/server";
import { publicCatalog } from "@/lib/llm-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/llm — provider/model catalog, models fetched live from provider APIs. */
export async function GET() {
  try {
    return NextResponse.json(await publicCatalog());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load model catalog" },
      { status: 502 }
    );
  }
}
