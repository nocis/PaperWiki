import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const dirFor = (slug: string) => path.join(process.cwd(), "comments", slug);

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/comments/[slug] — list all comments for a paper. */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  if (!SLUG_RE.test(slug)) return bad("invalid slug");

  try {
    const dir = dirFor(slug);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    const comments = (
      await Promise.all(
        files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")))
      )
    ).sort(
      (a, b) =>
        (a.position?.pageNumber ?? 0) - (b.position?.pageNumber ?? 0) ||
        String(a.createdAt).localeCompare(String(b.createdAt))
    );
    return NextResponse.json({ comments });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ comments: [] });
    }
    return bad("failed to read comments", 500);
  }
}

/** POST /api/comments/[slug] — create a comment/highlight. */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  if (!SLUG_RE.test(slug)) return bad("invalid slug");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON body");
  }

  const b = body as Record<string, unknown>;
  const position = b?.position as { pageNumber?: unknown } | undefined;
  if (!position || typeof position.pageNumber !== "number") {
    return bad("position.pageNumber (number) is required");
  }
  if (typeof b?.comment !== "string" || !(b.comment as string).trim()) {
    return bad("comment (non-empty string) is required");
  }

  const record = {
    id: crypto.randomUUID(),
    paperSlug: slug,
    text: typeof b.text === "string" ? b.text : "",
    comment: (b.comment as string).trim(),
    createdAt: new Date().toISOString(),
    position,
  };

  const dir = dirFor(slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2) + "\n");

  return NextResponse.json({ comment: record }, { status: 201 });
}
