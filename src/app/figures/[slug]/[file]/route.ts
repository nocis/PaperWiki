import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import { FIGURES_DIR_FOR } from "@/lib/extract-figures";
import { SLUG_RE } from "@/lib/wiki-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$/i;

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(_request: Request, { params }: { params: { slug: string; file: string } }) {
  const { slug, file } = params;
  if (!SLUG_RE.test(slug) || !FILE_RE.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = path.extname(file).toLowerCase();
  const contentPath = path.join(FIGURES_DIR_FOR(slug), file);
  if (path.relative(FIGURES_DIR_FOR(slug), contentPath).startsWith("..")) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const data = await fs.readFile(contentPath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
