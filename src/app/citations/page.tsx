import Link from "next/link";
import CitationGraph, { type GraphPaperInfo, type GraphRelationLink } from "@/components/CitationGraph";
import { citationCoverage, readCitationMap } from "@/lib/citations";
import { loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

function TopList({ title, entries }: { title: string; entries: { slug: string; label: string; count: number }[] }) {
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="mt-1 text-xs text-gray-500">No data yet.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <ol className="mt-2 space-y-1.5">
        {entries.map((entry, index) => (
          <li key={entry.slug} className="flex items-baseline gap-2 text-sm">
            <span className="w-5 shrink-0 text-right text-xs font-semibold text-gray-400">{index + 1}</span>
            <Link href={`/paper/${entry.slug}`} className="min-w-0 truncate font-medium text-gray-900 hover:text-blue-700">
              {entry.label}
            </Link>
            <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{entry.count}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function CitationsPage() {
  const [db, map] = await Promise.all([loadDb(), readCitationMap()]);
  const paperSlugs = db.papers.map((p) => p.slug);
  const slugSet = new Set(paperSlugs);

  const nodes = db.papers.map((p) => ({ id: p.slug, label: p.title, group: p.milestone }));
  const links: { source: string; target: string; ref?: string }[] = [];
  for (const paper of db.papers) {
    const entry = map.papers[paper.slug];
    if (!entry) continue;
    for (const record of entry.citations) {
      if (record.matchedSlug && slugSet.has(record.matchedSlug) && record.matchedSlug !== paper.slug) {
        links.push({
          source: paper.slug,
          target: record.matchedSlug,
          ref: entry.rawReferences[record.entry - 1],
        });
      }
    }
  }

  // Typed relations (frontmatter relations[]) rendered as colored edge classes:
  // temporal (builds-on/extends/supersedes), contradicts, cross-topic impacts.
  const RELATION_CLASS: Record<string, GraphRelationLink["kind"]> = {
    "builds-on": "temporal",
    extends: "temporal",
    supersedes: "temporal",
    contradicts: "contradicts",
    impacts: "impacts",
  };
  const relationLinks: GraphRelationLink[] = [];
  for (const paper of db.papers) {
    for (const rel of paper.relations ?? []) {
      const kind = RELATION_CLASS[rel.relation];
      if (!kind || !slugSet.has(rel.slug) || rel.slug === paper.slug) continue;
      relationLinks.push({ source: paper.slug, target: rel.slug, kind, note: rel.note });
    }
  }

  const paperInfo: GraphPaperInfo[] = db.papers.map((p) => ({
    slug: p.slug,
    title: p.title,
    publishedAt: p.publishedAt,
    essence: p.essence,
    milestone: p.milestone,
  }));

  const citedCount = new Map<string, number>();
  for (const link of links) {
    citedCount.set(link.target, (citedCount.get(link.target) ?? 0) + 1);
  }
  const citingCount = new Map<string, number>();
  for (const link of links) {
    citingCount.set(link.source, (citingCount.get(link.source) ?? 0) + 1);
  }

  const mostCited = [...citedCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([slug, count]) => ({ slug, label: db.papers.find((p) => p.slug === slug)?.title ?? slug, count }));
  const citingMost = [...citingCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([slug, count]) => ({ slug, label: db.papers.find((p) => p.slug === slug)?.title ?? slug, count }));
  const orphans = db.papers
    .filter((p) => (citedCount.get(p.slug) ?? 0) === 0 && (citingCount.get(p.slug) ?? 0) === 0)
    .map((p) => ({ slug: p.slug, label: p.title, count: 0 }));

  const coverage = citationCoverage(map, paperSlugs);
  const summary = {
    papers: coverage.length,
    withMap: coverage.filter((r) => !r.missing).length,
    citations: coverage.reduce((s, r) => s + r.total, 0),
    matched: coverage.reduce((s, r) => s + r.matched, 0),
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← Knowledge Base
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">Citation Map</h1>
          <p className="mt-1 text-sm text-gray-500">
            The LLM-built citation graph: every paper's raw bibliography normalized and pinned to compiled papers.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">{summary.withMap}/{summary.papers} papers mapped</span>
          <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">{summary.matched}/{summary.citations} citations linked</span>
          <Link href="/health" className="rounded-full border border-gray-200 bg-white px-3 py-1 text-gray-700 shadow-sm hover:border-gray-300">
            Rebuild on Health
          </Link>
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-gray-500">
          No compiled papers yet — the graph appears once the knowledge base has papers.
        </p>
      ) : (
        <>
          <CitationGraph nodes={nodes} links={links} relationLinks={relationLinks} papers={paperInfo} />
          <div className="grid gap-6 lg:grid-cols-3">
            <TopList title="Most cited in the wiki" entries={mostCited} />
            <TopList title="Papers citing the most" entries={citingMost} />
            <TopList title="Isolated papers (no links)" entries={orphans} />
          </div>
        </>
      )}
    </div>
  );
}
