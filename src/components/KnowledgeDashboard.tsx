"use client";

import Link from "next/link";
import type { KnowledgeApiPayload } from "@/lib/knowledge";
import { useKnowledgeDashboard } from "./knowledge/useKnowledgeDashboard";
import { formatTime } from "./knowledge/format";
import { CompilePanel } from "./knowledge/CompilePanel";
import { ArticlesSection, PiecesSection } from "./knowledge/Sections";

export default function KnowledgeDashboard({
  initialDb,
}: {
  initialDb: KnowledgeApiPayload;
}) {
  const {
    db,
    runStatus,
    polling,
    requestError,
    availabilityState,
    checkNow,
    prefsUnresolved,
    llmBlocked,
    unavailableHint,
    runTotals,
    runProgress,
    compileKnowledge,
    deletePiece,
    toggleFavorite,
    patchPiece,
  } = useKnowledgeDashboard(initialDb);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
            ← Knowledge Base
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">Your Knowledge</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your own notes and chat discoveries, compiled by the LLM into topic articles and reviewed
            against the literature wiki.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
            {db.pieces.length} piece{db.pieces.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
            {db.articles.length} article{db.articles.length === 1 ? "" : "s"}
          </span>
          {db.compiledAt ? (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">
              compiled {formatTime(db.compiledAt)}
            </span>
          ) : null}
          {db.stale && (
            <span
              className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800"
              title="The literature wiki changed since the last knowledge compile — recompile to refresh the academic review."
            >
              stale — recompile
            </span>
          )}
        </div>
      </div>

      {requestError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{requestError}</p>
      )}

      {unavailableHint && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {unavailableHint}
          {availabilityState === "unavailable" && (
            <button
              type="button"
              onClick={() => void checkNow()}
              className="ml-2 font-medium underline underline-offset-2"
            >
              Check now
            </button>
          )}
        </p>
      )}

      <CompilePanel
        db={db}
        runStatus={runStatus}
        runTotals={runTotals}
        runProgress={runProgress}
        polling={polling}
        llmBlocked={llmBlocked}
        prefsUnresolved={prefsUnresolved}
        availabilityState={availabilityState}
        onCompile={() => void compileKnowledge()}
      />

      <ArticlesSection articles={db.articles} onToggleFavorite={toggleFavorite} />

      <PiecesSection pieces={db.pieces} onPatch={patchPiece} onDelete={deletePiece} />
    </div>
  );
}
