import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function linkWikilinks(markdown: string, paperSlugs: Set<string>, topicSlugs: Set<string>): string {
  return markdown.replace(/\[\[([a-z0-9][a-z0-9-]*)\]\]/gi, (_, slug: string) => {
    const href = paperSlugs.has(slug) ? `/paper/${slug}` : topicSlugs.has(slug) ? `/wiki/topics/${slug}` : null;
    return href ? `[${slug}](${href})` : slug;
  });
}

export default function WikiMarkdown({
  content,
  paperSlugs,
  topicSlugs,
}: {
  content: string;
  paperSlugs: string[];
  topicSlugs: string[];
}) {
  return (
    <div className="prose prose-gray max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href ?? "#"}>
              {children}
            </Link>
          ),
        }}
      >
        {linkWikilinks(content, new Set(paperSlugs), new Set(topicSlugs))}
      </ReactMarkdown>
    </div>
  );
}
