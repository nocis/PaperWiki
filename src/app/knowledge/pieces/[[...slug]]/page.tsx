import * as fs from "fs/promises";
import * as path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import matter from "gray-matter";
import WikiMarkdown from "@/components/WikiMarkdown";
import { KNOWLEDGE_PIECES_DIR, deriveKnowledgeDb } from "@/lib/knowledge";
import { loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function KnowledgePiecePage({ params }: { params: { slug?: string[] } }) {
  const slug = params.slug?.at(-1) ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) notFound();

  const [knowledge, wikiDb] = await Promise.all([deriveKnowledgeDb(), loadDb()]);
  const filePath = path.join(KNOWLEDGE_PIECES_DIR, `${slug}.md`);
  if (path.relative(KNOWLEDGE_PIECES_DIR, filePath).startsWith("..")) notFound();

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    notFound();
  }
  const parsed = matter(source);
  const data = parsed.data as { kind?: string; source?: string; addedAt?: string; updatedAt?: string; tags?: string[]; topics?: string[] };
  const inArticles = knowledge.articles.filter((a) => a.pieceSlugs.includes(slug));
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const topics = Array.isArray(data.topics) ? data.topics : [];

  const kind = data.kind ?? "note";
  let provenance = `added ${data.addedAt ?? "?"}`;
  if (kind === "chat") {
    provenance = `chat exchange · ${data.addedAt ?? "?"}`;
  } else {
    const noteMatch = parsed.content.match(/^\*\*Paper\*\*:\s*\[\[([a-z0-9][a-z0-9-]*)\]\]\s*\(p\.\s*(\d+)\)/i);
    if (noteMatch) {
      provenance = `reading note on [[${noteMatch[1]}]] p. ${noteMatch[2]} · ${data.addedAt ?? "?"}`;
    } else {
      provenance = `reading note · ${data.addedAt ?? "?"}`;
    }
  }

  return (
    <article className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/knowledge" className="text-sm text-gray-500 hover:text-gray-900">
          ← Your Knowledge
        </Link>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          Knowledge piece · {data.kind ?? "note"}
        </span>
      </div>

      <header className="mt-4 border-b border-gray-200 pb-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-gray-950">{slug}</h1>
        <p className="mt-2 text-sm text-gray-500">{provenance}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
            kind: {kind}
          </code>
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
            source: {data.source ?? "?"}
          </code>
          {data.updatedAt && (
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
              updated: {data.updatedAt}
            </code>
          )}
        </div>
        {(tags.length > 0 || topics.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topics.map((topic) => (
              <span key={`t-${topic}`} className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                topic: {topic}
              </span>
            ))}
            {tags.map((tag) => (
              <span key={`g-${tag}`} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        )}
        {inArticles.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500">appears in:</span>
            {inArticles.map((article) => (
              <Link
                key={article.slug}
                href={`/knowledge/articles/${article.slug}`}
                className="rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
              >
                {article.title}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="pt-2">
        <WikiMarkdown
          content={parsed.content}
          paperSlugs={wikiDb.papers.map((p) => p.slug)}
          topicSlugs={wikiDb.topics.map((t) => t.slug)}
          knowledgeSlugs={knowledge.articles.map((a) => a.slug)}
        />
      </div>
    </article>
  );
}
