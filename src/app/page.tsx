import * as path from "path";
import Link from "next/link";
import type { ComponentProps } from "react";
import PendingCompilePanel from "@/components/PendingCompilePanel";
import { readEffectiveCompileStatus } from "@/lib/runs";
import { runLint, summarize } from "@/lib/lint-wiki";
import {
  findInboxPdfs,
  loadDb,
  PAPERS_NEW,
  readLog,
  type DbPaper,
  type DbTopic,
} from "@/lib/wiki";
import { deriveKnowledgeDb } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

function PaperRow({ paper }: { paper: DbPaper }) {
  return (
    <li className="border-l border-gray-200 pl-4">
      <Link href={`/paper/${paper.slug}`} className="font-medium text-gray-900 hover:text-blue-700">
        {paper.title}
      </Link>
      <span className="ml-2 text-xs text-gray-500">
        {paper.venue} · {paper.publishedAt}
      </span>
      {paper.essence && <p className="mt-1 text-sm leading-6 text-gray-600">{paper.essence}</p>}
    </li>
  );
}

function TopicNode({ topic, topics, papers, depth = 0 }: {
  topic: DbTopic;
  topics: Map<string, DbTopic>;
  papers: Map<string, DbPaper>;
  depth?: number;
}) {
  const topicPapers = topic.sources.map((slug) => papers.get(slug)).filter(Boolean) as DbPaper[];
  const subtopicGroups = topic.mode === "merged"
    ? topic.subtopics.map((subtopic) => ({
        name: subtopic,
        papers: topicPapers.filter((paper) => paper.subtopic === subtopic),
      })).filter((group) => group.papers.length > 0)
    : [];
  const ungrouped = topic.mode === "merged"
    ? topicPapers.filter((paper) => !paper.subtopic || !topic.subtopics.includes(paper.subtopic))
    : topicPapers;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/wiki/topics/${topic.slug}`} className="text-lg font-semibold text-gray-950 hover:text-blue-700">
              {topic.name}
            </Link>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">
              {topic.mode}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">{topic.definition}</p>
        </div>
        <span className="whitespace-nowrap text-xs text-gray-500">
          {topic.sources.length} paper{topic.sources.length === 1 ? "" : "s"}
        </span>
      </div>

      {topic.mode === "split" && topic.children.length > 0 && (
        <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
          {topic.children.map((childSlug) => {
            const child = topics.get(childSlug);
            return child ? <TopicNode key={child.slug} topic={child} topics={topics} papers={papers} depth={depth + 1} /> : null;
          })}
        </div>
      )}

      {(ungrouped.length > 0 || subtopicGroups.length > 0) && (
        <div className="mt-5 space-y-5 border-t border-gray-100 pt-4">
          {subtopicGroups.map((group) => (
            <div key={group.name}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{group.name}</h3>
              <ul className="space-y-3">
                {group.papers.map((paper) => <PaperRow key={paper.slug} paper={paper} />)}
              </ul>
            </div>
          ))}
          {ungrouped.length > 0 && (
            <ul className="space-y-3">
              {ungrouped.map((paper) => <PaperRow key={paper.slug} paper={paper} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default async function Dashboard() {
  const [db, inboxPdfs, compileStatus, logEntries, lintReport, knowledgeDb] = await Promise.all([
    loadDb(),
    findInboxPdfs(),
    // The generic tracker snapshot matches the client's CompileRunSnapshot
    // shape at runtime (totals are a loose Record in the factory type).
    readEffectiveCompileStatus() as unknown as ComponentProps<typeof PendingCompilePanel>["initialStatus"],
    readLog(),
    runLint({ applyFixes: false, queueProposals: false }),
    deriveKnowledgeDb(),
  ]);
  const lintSummary = summarize(lintReport);
  const pendingFiles = inboxPdfs.map((file) => path.relative(PAPERS_NEW, file));
  const topics = new Map(db.topics.map((topic) => [topic.slug, topic]));
  const papers = new Map(db.papers.map((paper) => [paper.slug, paper]));
  const roots = db.topics.filter((topic) => !topic.parentSlug);
  const pendingProposals = db.proposals.filter((proposal) => proposal.status === "pending").length;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Research workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950">Knowledge Base</h1>
          <p className="mt-2 text-sm text-gray-500">
            {db.papers.length} paper{db.papers.length === 1 ? "" : "s"} · {db.topics.length} topic{db.topics.length === 1 ? "" : "s"}
            {db.updatedAt ? ` · last compile ${new Date(db.updatedAt).toLocaleString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/knowledge"
            className="rounded-full border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-100"
          >
            Knowledge
            {(knowledgeDb.pieces.length > 0 || knowledgeDb.articles.length > 0) && (
              <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-violet-700">
                {knowledgeDb.articles.length > 0 ? `${knowledgeDb.articles.length} art` : `${knowledgeDb.pieces.length} pcs`}
              </span>
            )}
          </Link>
          <Link
            href="/health"
            className={`rounded-full border bg-white px-4 py-2 text-sm shadow-sm transition hover:border-gray-300 ${
              lintSummary.errors > 0
                ? "border-red-200 text-red-700"
                : lintSummary.warnings > 0
                  ? "border-amber-200 text-amber-700"
                  : "border-gray-200 text-gray-700"
            }`}
          >
            Health
            {(lintSummary.errors > 0 || lintSummary.warnings > 0) && (
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${lintSummary.errors > 0 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                {lintSummary.errors > 0 ? `${lintSummary.errors} err` : `${lintSummary.warnings} warn`}
              </span>
            )}
          </Link>
          <Link href="/wiki/proposals" className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:border-gray-300">
            Proposals{pendingProposals > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{pendingProposals}</span>}
          </Link>
        </div>
      </div>

      {pendingFiles.length > 0 && <PendingCompilePanel files={pendingFiles} initialStatus={compileStatus} />}

      {db.papers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-gray-500">
          Empty knowledge base. Drop PDFs into <code>papers/new/</code>
          {pendingFiles.length > 0 ? " and use the compile button above." : <> and run <code>yarn compile</code>.</>}
        </p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-950">Topic map</h2>
                <p className="mt-1 text-sm text-gray-500">Synthesis and source papers organized by milestone.</p>
              </div>
              <Link href="/wiki" className="text-sm text-blue-700 hover:underline">Browse wiki</Link>
            </div>
            <div className="space-y-4">
              {roots.map((topic) => <TopicNode key={topic.slug} topic={topic} topics={topics} papers={papers} />)}
            </div>
          </section>

          <aside>
            <h2 className="text-xl font-semibold text-gray-950">Recent ingest</h2>
            <p className="mt-1 text-sm text-gray-500">The latest changes to the knowledge base.</p>
            <ol className="mt-5 space-y-5 border-l border-gray-200 pl-5">
              {logEntries.slice(0, 12).map((entry, index) => {
                const paper = db.papers.find((candidate) => candidate.title === entry.title);
                return (
                  <li key={`${entry.date}-${entry.title}-${index}`} className="relative">
                    <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-blue-600 ring-4 ring-gray-50" />
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{entry.date} · {entry.operation}</p>
                    {paper ? <Link href={`/paper/${paper.slug}`} className="mt-1 block text-sm font-medium text-gray-900 hover:text-blue-700">{entry.title}</Link> : <p className="mt-1 text-sm font-medium text-gray-900">{entry.title}</p>}
                    {entry.details.length > 0 && <p className="mt-1 text-xs leading-5 text-gray-500">{entry.details.slice(0, 2).join(" · ")}</p>}
                  </li>
                );
              })}
              {logEntries.length === 0 && <li className="text-sm text-gray-500">No ingest activity yet.</li>}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}
