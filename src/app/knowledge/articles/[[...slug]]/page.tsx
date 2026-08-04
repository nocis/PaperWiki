import * as fs from "fs/promises";
import * as path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import matter from "gray-matter";
import WikiMarkdown from "@/components/WikiMarkdown";
import { KNOWLEDGE_ARTICLES_DIR, deriveKnowledgeDb } from "@/lib/knowledge";
import { loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function KnowledgeArticlePage({ params }: { params: { slug?: string[] } }) {
  const slug = params.slug?.at(-1) ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) notFound();

  const [knowledge, wikiDb] = await Promise.all([deriveKnowledgeDb(), loadDb()]);
  const filePath = path.join(KNOWLEDGE_ARTICLES_DIR, `${slug}.md`);
  if (path.relative(KNOWLEDGE_ARTICLES_DIR, filePath).startsWith("..")) notFound();

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    notFound();
  }
  const parsed = matter(source);
  const data = parsed.data as { title?: string; pieceSlugs?: string[]; paperSlugs?: string[]; relatedArticles?: string[] };
  const title = data.title ?? slug;
  const pieceSlugs = Array.isArray(data.pieceSlugs) ? data.pieceSlugs : [];
  const paperSlugs = Array.isArray(data.paperSlugs) ? data.paperSlugs : [];

  return (
    <article className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/knowledge" className="text-sm text-gray-500 hover:text-gray-900">
          ← Your Knowledge
        </Link>
        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          Topic article · derived
        </span>
      </div>

      <header className="mt-4 border-b border-gray-200 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-gray-950">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {pieceSlugs.length} piece{pieceSlugs.length === 1 ? "" : "s"} ·{" "}
          {paperSlugs.length > 0 ? `${paperSlugs.length} paper${paperSlugs.length === 1 ? "" : "s"} grounded` : "no wiki grounding"}
          {" · "}
          regenerated on every knowledge compile — do not hand-edit
        </p>
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
