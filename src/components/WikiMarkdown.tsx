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
    <div className="wiki-md max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _node, ...props }) => (
            <h1 className="mb-4 mt-10 text-2xl font-bold tracking-tight text-gray-950 first:mt-0" {...props} />
          ),
          h2: ({ node: _node, ...props }) => (
            <h2 className="mb-3 mt-8 border-b border-gray-100 pb-2 text-xl font-semibold tracking-tight text-gray-900 first:mt-0" {...props} />
          ),
          h3: ({ node: _node, ...props }) => (
            <h3 className="mb-2 mt-6 text-base font-semibold text-gray-900" {...props} />
          ),
          h4: ({ node: _node, ...props }) => (
            <h4 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-gray-700" {...props} />
          ),
          p: ({ node: _node, ...props }) => (
            <p className="my-4 text-[15px] leading-7 text-gray-700 first:mt-0 last:mb-0" {...props} />
          ),
          ul: ({ node: _node, ...props }) => (
            <ul className="my-4 list-disc space-y-2 pl-6 marker:text-gray-300" {...props} />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol className="my-4 list-decimal space-y-2 pl-6 marker:text-gray-400" {...props} />
          ),
          li: ({ node: _node, ...props }) => (
            <li className="pl-1 text-[15px] leading-7 text-gray-700" {...props} />
          ),
          a: ({ node: _node, href, children }) => (
            <Link
              href={href ?? "#"}
              className="font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 transition hover:text-blue-900 hover:decoration-blue-400"
            >
              {children}
            </Link>
          ),
          strong: ({ node: _node, ...props }) => (
            <strong className="font-semibold text-gray-900" {...props} />
          ),
          em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="my-4 border-l-4 border-gray-200 pl-4 text-[15px] italic leading-7 text-gray-500" {...props} />
          ),
          code: ({ node: _node, className, children, ...props }) => (
            <code
              className={`rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800 ${className ?? ""}`}
              {...props}
            >
              {children}
            </code>
          ),
          pre: ({ node: _node, ...props }) => (
            <pre className="my-4 overflow-x-auto rounded-lg bg-gray-950 p-4 text-[13px] leading-6 text-gray-100" {...props} />
          ),
          hr: ({ node: _node, ...props }) => <hr className="my-8 border-gray-200" {...props} />,
          table: ({ node: _node, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: ({ node: _node, ...props }) => (
            <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700" {...props} />
          ),
          td: ({ node: _node, ...props }) => (
            <td className="border-b border-gray-100 px-3 py-2 align-top text-gray-700" {...props} />
          ),
        }}
      >
        {linkWikilinks(content, new Set(paperSlugs), new Set(topicSlugs))}
      </ReactMarkdown>
    </div>
  );
}
