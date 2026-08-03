import * as path from "path";
import PendingCompilePanel from "@/components/PendingCompilePanel";
import { readCompileStatus } from "@/lib/compile-progress";
import { findInboxPdfs, loadDb, PAPERS_NEW } from "@/lib/wiki";

export const dynamic = "force-dynamic";

/**
 * Discovery dashboard (minimal Phase A version — full UI in Phase B).
 * Reads the derived db; sole entry point into papers.
 */
export default async function Dashboard() {
  const [db, inboxPdfs, compileStatus] = await Promise.all([
    loadDb(),
    findInboxPdfs(),
    readCompileStatus(),
  ]);
  const pendingFiles = inboxPdfs.map((file) => path.relative(PAPERS_NEW, file));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <p className="text-sm text-gray-500">
          {db.papers.length} paper(s) · {db.topics.length} topic(s)
          {db.updatedAt ? ` · last compile ${db.updatedAt}` : ""}
        </p>
      </div>

      {pendingFiles.length > 0 && (
        <PendingCompilePanel files={pendingFiles} initialStatus={compileStatus} />
      )}

      {db.papers.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-gray-500">
          Empty knowledge base. Drop PDFs into <code>papers/new/</code>
          {pendingFiles.length > 0 ? " and use the compile button above." : (
            <>
              {" "}and run <code>yarn compile</code>.
            </>
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {db.papers.map((p) => (
            <li key={p.slug} className="rounded border border-gray-200 bg-white p-3">
              <a href={`/paper/${p.slug}`} className="font-medium text-blue-700 hover:underline">
                {p.title}
              </a>
              <span className="ml-2 text-sm text-gray-500">
                {p.venue} {p.publishedAt} · topic {p.milestone}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
