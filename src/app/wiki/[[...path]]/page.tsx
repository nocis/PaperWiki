import * as fs from "fs/promises";
import * as path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import matter from "gray-matter";
import WikiMarkdown from "@/components/WikiMarkdown";
import { INDEX_MD, WIKI_DIR, loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function WikiPage({ params }: { params: { path?: string[] } }) {
  const db = await loadDb();
  const relativePath = params.path?.length ? `${params.path.join("/")}.md` : "index.md";
  const filePath = params.path?.length ? path.join(WIKI_DIR, relativePath) : INDEX_MD;

  if (path.relative(WIKI_DIR, filePath).startsWith("..")) notFound();

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    notFound();
  }

  const parsed = matter(source);
  const title = parsed.data.name ?? parsed.data.title ?? (params.path?.at(-1) ?? "Wiki");

  return (
    <article className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← Knowledge Base
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      <WikiMarkdown
        content={parsed.content}
        paperSlugs={db.papers.map((paper) => paper.slug)}
        topicSlugs={db.topics.map((topic) => topic.slug)}
      />
    </article>
  );
}
