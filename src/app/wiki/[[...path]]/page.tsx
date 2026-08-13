import * as fs from "fs/promises";
import * as path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import matter from "gray-matter";
import PaperKnowledgeStatus from "@/components/PaperKnowledgeStatus";
import WikiMarkdown from "@/components/WikiMarkdown";
import { readCachedDiagrams } from "@/lib/paper-knowledge";
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
  const data = parsed.data;
  const title = data.name ?? data.title ?? (params.path?.at(-1) ?? "Wiki");
  const isTopic = typeof data.mode === "string";
  const isPaper = typeof data.milestone === "string" && typeof data.title === "string";
  const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
  const paperSlug = isPaper && typeof data.slug === "string" ? data.slug : undefined;
  const diagramCache = paperSlug ? await readCachedDiagrams(paperSlug, parsed.content) : [];

  return (
    <article className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
        ← Knowledge Base
      </Link>

      <header className="mt-4 border-b border-gray-200 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          {isTopic && (
            <>
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                Topic
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">
                {data.mode}
              </span>
            </>
          )}
          {isPaper && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              Paper
            </span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">{title}</h1>
        {isTopic && typeof data.definition === "string" && (
          <p className="mt-3 text-base leading-7 text-gray-600">{data.definition}</p>
        )}
        {isPaper && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
            {Array.isArray(data.authors) && data.authors.length > 0 && (
              <span>{data.authors.join(", ")}</span>
            )}
            <span>
              {data.venue} · {data.publishedAt}
            </span>
            {typeof data.slug === "string" && (
              <Link href={`/paper/${data.slug}`} className="font-medium text-blue-700 hover:underline">
                Open in reader →
              </Link>
            )}
          </div>
        )}
        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="pt-2">
        {paperSlug && <PaperKnowledgeStatus slug={paperSlug} />}
        <WikiMarkdown
          content={parsed.content}
          paperSlugs={db.papers.map((paper) => paper.slug)}
          topicSlugs={db.topics.map((topic) => topic.slug)}
          paperSlug={paperSlug}
          diagramCache={diagramCache}
        />
      </div>
    </article>
  );
}
