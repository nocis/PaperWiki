import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import DiagramSlot from "./DiagramSlot";
import { DiagramJobsPoller, type DiagramJobView } from "./diagram-jobs-client";
import { wrapBareMath } from "@/lib/math";
import { DIAGRAM_ID_RE } from "@/lib/wiki-ids";

function linkWikilinks(
  markdown: string,
  paperSlugs: Set<string>,
  topicSlugs: Set<string>,
  knowledgeSlugs: Set<string>
): string {
  return markdown.replace(/\[\[([a-z0-9][a-z0-9-]*)\]\]/gi, (_, slug: string) => {
    const href = paperSlugs.has(slug)
      ? `/paper/${slug}`
      : topicSlugs.has(slug)
        ? `/wiki/topics/${slug}`
        : knowledgeSlugs.has(slug)
          ? `/knowledge/articles/${slug}`
          : null;
    return href ? `[${slug}](${href})` : slug;
  });
}

export default function WikiMarkdown({
  content,
  paperSlugs,
  topicSlugs,
  knowledgeSlugs = [],
  paperSlug,
  diagramCache = [],
  diagramInitialJobs = [],
}: {
  content: string;
  paperSlugs: string[];
  topicSlugs: string[];
  knowledgeSlugs?: string[];
  /** Paper page only: enables lazy ```diagram fences for this paper. */
  paperSlug?: string;
  /** Server-resolved SVG cache state for the paper's diagram fences. */
  diagramCache?: { id: string; hasSvg: boolean }[];
  /** Server-resolved in-session render-job status for the paper's diagrams. */
  diagramInitialJobs?: DiagramJobView[];
}) {
  return (
    <div className="wiki-md max-w-none">
      {paperSlug ? <DiagramJobsPoller slug={paperSlug} initialJobs={diagramInitialJobs} /> : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
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
          p: ({ node: _node, children, ...props }) => {
            // A paragraph whose sole child is an image (curated-figure embed)
            // renders as a figure: centered image + a caption (the alt text)
            // processed through the math pipeline, so $...$ LaTeX typesets.
            const imgNode = (_node as {
              children?: { type?: string; tagName?: string; properties?: Record<string, unknown> }[];
            } | undefined)?.children;
            const onlyImg =
              imgNode?.length === 1 &&
              imgNode[0].type === "element" &&
              imgNode[0].tagName === "img";
            if (onlyImg) {
              const alt = typeof imgNode[0].properties?.alt === "string" ? imgNode[0].properties.alt : "";
              return (
                <figure className="my-6">
                  {children}
                  {alt && (
                    <figcaption className="mx-auto mt-2 max-w-2xl text-center text-sm leading-6 text-gray-500">
                      <ReactMarkdown
                        remarkPlugins={[remarkMath]}
                        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
                      >
                        {wrapBareMath(alt)}
                      </ReactMarkdown>
                    </figcaption>
                  )}
                </figure>
              );
            }
            return (
              <p className="my-4 text-[15px] leading-7 text-gray-700 first:mt-0 last:mb-0" {...props}>
                {children}
              </p>
            );
          },
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
          img: ({ node: _node, src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              loading="lazy"
              className="mx-auto block max-h-96 w-auto max-w-full rounded-lg border border-gray-200 bg-white object-contain shadow-sm"
            />
          ),
          em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="my-4 border-l-4 border-gray-200 pl-4 text-[15px] italic leading-7 text-gray-500" {...props} />
          ),
          code: ({ node, className, children, ...props }) => {
            const lang = typeof className === "string" ? /language-([\w-]+)/.exec(className)?.[1] : undefined;
            if (lang === "diagram") {
              // The diagram id lives in the fence INFO STRING (```diagram <id>),
              // which react-markdown exposes as the hast element's data.meta —
              // NOT in the content's first line. Fall back to the first content
              // line only for fences written with the id on a content line.
              const text = String(children).trim();
              const metaId = ((node as { data?: { meta?: string | null } } | undefined)?.data?.meta ?? "").trim();
              const nl = text.indexOf("\n");
              const firstLine = (nl === -1 ? text : text.slice(0, nl)).trim();
              let id = "";
              let brief = text;
              if (DIAGRAM_ID_RE.test(metaId)) {
                id = metaId;
              } else if (DIAGRAM_ID_RE.test(firstLine)) {
                id = firstLine;
                brief = nl === -1 ? "" : text.slice(nl + 1).trim();
              }
              if (id) {
                const cached = paperSlug ? (diagramCache.find((d) => d.id === id)?.hasSvg ?? false) : false;
                return <DiagramSlot paperSlug={paperSlug} id={id} brief={brief} cached={cached} />;
              }
              // Unparseable fence — a graceful placeholder, never bare text.
              return (
                <div className="my-6 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/60 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Diagram</p>
                  <p className="mt-1.5 text-sm leading-6 text-gray-600">{text}</p>
                </div>
              );
            }
            return (
              <code
                className={`rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800 ${className ?? ""}`}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ node: _node, children, ...props }) => {
            const innerCode = (_node as { children?: { properties?: Record<string, unknown> }[] } | undefined)
              ?.children?.[0];
            const cls = innerCode?.properties?.className;
            const clsText = Array.isArray(cls) ? cls.join(" ") : typeof cls === "string" ? cls : "";
            if (/language-diagram/.test(clsText)) {
              // Diagram fences render as their own slot — no dark pre wrapper.
              return <>{children}</>;
            }
            return (
              <pre className="my-4 overflow-x-auto rounded-lg bg-gray-950 p-4 text-[13px] leading-6 text-gray-100" {...props} />
            );
          },
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
        {linkWikilinks(content, new Set(paperSlugs), new Set(topicSlugs), new Set(knowledgeSlugs))}
      </ReactMarkdown>
    </div>
  );
}
