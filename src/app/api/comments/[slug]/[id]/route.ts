import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-zA-Z0-9-]+$/;

/** DELETE /api/comments/[slug]/[id] — delete one comment file. */
export async function DELETE(_req: NextRequest, { params }: { params: { slug: string; id: string } }) {
  const { slug, id } = params;
  if (!SLUG_RE.test(slug) || !ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid slug or id" }, { status: 400 });
  }

  try {
    await fs.unlink(path.join(process.cwd(), "comments", slug, `${id}.json`));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "comment not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed to delete comment" }, { status: 500 });
  }
}
