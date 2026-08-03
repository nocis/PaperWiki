import Link from "next/link";
import { notFound } from "next/navigation";
import WikiMarkdown from "@/components/WikiMarkdown";
import { readPaperPages } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function PaperPage({ params }: { params: { slug: string } }) {
  const pages = await readPaperPages();
  const page = pages.find((candidate) => candidate.fm.slug === params.slug);
  if (!page) notFound();

  const frontmatter = page.fm;
  return (
    <article className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← Knowledge Base
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">{frontmatter.title}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {frontmatter.authors.join(", ")} · {frontmatter.venue} · {frontmatter.publishedAt}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Topic:{" "}
          <Link href={`/wiki/topics/${frontmatter.milestone}`} className="text-blue-700 hover:underline">
            {frontmatter.milestone}
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href={frontmatter.pdfUrl}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Open PDF
        </a>
        <Link
          href={`/wiki/papers/${frontmatter.slug}`}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          Wiki source
        </Link>
      </div>

      <WikiMarkdown
        content={page.body}
        paperSlugs={pages.map((candidate) => candidate.fm.slug)}
        topicSlugs={[frontmatter.milestone]}
      />
    </article>
  );
}
