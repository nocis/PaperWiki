import Link from "next/link";
import KnowledgeDashboard from "@/components/KnowledgeDashboard";
import { readEffectiveKnowledgeStatus } from "@/lib/runs";
import { computeKnowledgeStaleness, deriveKnowledgeDb } from "@/lib/knowledge";
import { loadDb } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [db, wikiDb, runStatus] = await Promise.all([deriveKnowledgeDb(), loadDb(), readEffectiveKnowledgeStatus()]);
  const stale = computeKnowledgeStaleness(db, wikiDb);

  return (
    <KnowledgeDashboard
      initialDb={{
        pieces: db.pieces,
        articles: db.articles,
        compiledAt: db.compiledAt,
        wikiUpdatedAt: db.wikiUpdatedAt,
        stale,
        runStatus,
      }}
    />
  );
}
