import Link from "next/link";
import { notFound } from "next/navigation";
import AnnotatePanel from "@/components/AnnotatePanel";
import FigureGallery from "@/components/FigureGallery";
import PaperTabs from "@/components/PaperTabs";
import WikiMarkdown from "@/components/WikiMarkdown";
import { loadDb, readPaperPages } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function PaperPage({ params }: { params: { slug: string } }) {
  const [pages, db] = await Promise.all([readPaperPages(), loadDb()]);
  const page = pages.find((candidate) => candidate.fm.slug === params.slug);
  if (!page) notFound();

  const frontmatter = page.fm;
  return (
    <article className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← Knowledge Base
        </Link>
        <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight text-gray-950">{frontmatter.title}</h1>
        <p className="mt-2 text-sm text-gray-600">{frontmatter.authors.join(", ")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{frontmatter.venue}</span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{frontmatter.publishedAt}</span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{frontmatter.numPages} pages</span>
          <Link
            href={`/wiki/topics/${frontmatter.milestone}`}
            className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100"
          >
            {frontmatter.milestone}
          </Link>
          {frontmatter.subtopic && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{frontmatter.subtopic}</span>
          )}
          <a
            href={frontmatter.pdfUrl}
            className="rounded-full border border-gray-200 px-2.5 py-1 font-medium text-gray-500 hover:border-gray-300 hover:text-gray-800"
          >
            Raw PDF ↗
          </a>
          <Link
            href={`/wiki/papers/${frontmatter.slug}`}
            className="rounded-full border border-gray-200 px-2.5 py-1 font-medium text-gray-500 hover:border-gray-300 hover:text-gray-800"
          >
            Wiki source
          </Link>
        </div>
      </div>

      <PaperTabs
        annotate={<AnnotatePanel slug={frontmatter.slug} pdfUrl={frontmatter.pdfUrl} />}
        figures={
          (frontmatter.figures ?? []).length > 0 ? (
            <FigureGallery slug={frontmatter.slug} files={frontmatter.figures} />
          ) : undefined
        }
        wiki={
          <WikiMarkdown
            content={page.body}
            paperSlugs={db.papers.map((candidate) => candidate.slug)}
            topicSlugs={db.topics.map((topic) => topic.slug)}
          />
        }
      />
    </article>
  );
}
