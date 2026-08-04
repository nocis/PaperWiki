import Link from "next/link";
import KnowledgeDashboard from "@/components/KnowledgeDashboard";
import { readEffectiveKnowledgeStatus } from "@/lib/runs";
import { deriveKnowledgeDb } from "@/lib/knowledge";
import { loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [db, wikiDb, runStatus] = await Promise.all([deriveKnowledgeDb(), loadDb(), readEffectiveKnowledgeStatus()]);
  const stale =
    db.compiledAt !== null &&
    ((db.wikiUpdatedAt !== null &&
      wikiDb.updatedAt !== null &&
      new Date(db.wikiUpdatedAt) < new Date(wikiDb.updatedAt)) ||
      db.pieces.some((p) => new Date(p.updatedAt ?? p.addedAt) > new Date(db.compiledAt!)));

  return (
    <KnowledgeDashboard
      initialDb={{
        pieces: db.pieces,
        articles: db.articles,
        compiledAt: db.compiledAt,
        wikiUpdatedAt: db.wikiUpdatedAt,
        stale,
        runStatus: runStatus
          ? {
              runId: runStatus.runId,
              status: runStatus.status,
              provider: runStatus.provider,
              model: runStatus.model,
              error: runStatus.error,
              totals: runStatus.totals,
              events: runStatus.events,
            }
          : null,
      }}
      initialRunStatus={
        runStatus
          ? {
              runId: runStatus.runId,
              status: runStatus.status,
              provider: runStatus.provider,
              model: runStatus.model,
              error: runStatus.error,
              totals: runStatus.totals,
              events: runStatus.events,
            }
          : null
      }
    />
  );
}
