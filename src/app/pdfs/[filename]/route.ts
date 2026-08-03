import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import { PAPERS_COMPILED } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { filename: string } }) {
  const filename = params.filename;
  if (!/^[a-z0-9][a-z0-9-]*\.pdf$/i.test(filename)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const file = await fs.readFile(path.join(PAPERS_COMPILED, filename));
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
