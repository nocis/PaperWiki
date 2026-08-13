"use client";

/** The reset-to-zero danger zone. */
export function DangerZone({
  resetting,
  resetResult,
  onReset,
}: {
  resetting: boolean;
  resetResult: string | null;
  onReset: () => void;
}) {
  return (
    <section className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-red-900">Danger zone</h2>
          <p className="mt-1 text-sm text-gray-500">
            Reset to zero: move every compiled paper back to <code>papers/new/</code> as a new
            paper and delete all generated artifacts (wiki pages, index/log/proposals, derived
            dbs, figures, progress logs, knowledge articles). Kept:{" "}
            <code>wiki/SCHEMA.md</code>, <code>wiki/journal/</code>, <code>knowledge/pieces/</code>,{" "}
            <code>comments/</code>, and favorited knowledge articles.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          className="rounded-full bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-400"
        >
          {resetting ? "Resetting…" : "Reset to zero"}
        </button>
      </div>
      {resetResult && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {resetResult}
        </p>
      )}
    </section>
  );
}
