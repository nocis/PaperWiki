"use client";

import type { LlmCatalog } from "@/lib/llm-availability";

const SELECT_CLASS =
  "h-8 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none ring-blue-600 transition focus:border-blue-500 focus:ring-2 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";

/**
 * Compact provider + model dropdowns for the nav bar. The catalog comes live
 * from GET /api/llm (which fetches models from the provider APIs) via the
 * LlmPrefsProvider. No model list or default is assumed client-side.
 */
export default function ProviderModelSelect({
  catalog,
  value,
  onChange,
  catalogError,
  onRetryCatalog,
}: {
  catalog: LlmCatalog | null;
  value: { provider: string; model: string };
  onChange: (next: { provider: string; model: string }) => void;
  catalogError?: string | null;
  onRetryCatalog?: () => void;
}) {
  if (catalogError) {
    return (
      <span className="flex items-center gap-2 text-xs text-red-700">
        Could not load model options
        {onRetryCatalog && (
          <button
            type="button"
            onClick={onRetryCatalog}
            className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:border-red-300"
          >
            Retry
          </button>
        )}
      </span>
    );
  }

  if (!catalog || catalog.providers.length === 0) {
    return (
      <span className="flex items-center gap-2">
        <select disabled aria-label="Provider" className={`${SELECT_CLASS} w-32`}>
          <option>Loading…</option>
        </select>
        <select disabled aria-label="Model" className={`${SELECT_CLASS} w-40`}>
          <option>Loading…</option>
        </select>
      </span>
    );
  }

  // No client-side default: until the resolved prefs arrive, show placeholders.
  const provider = value.provider ? catalog.providers.find((p) => p.id === value.provider) : undefined;

  if (!provider) {
    return (
      <span className="flex items-center gap-2">
        <select disabled aria-label="Provider" className={`${SELECT_CLASS} w-32`}>
          <option>Select…</option>
        </select>
        <select disabled aria-label="Model" className={`${SELECT_CLASS} w-40`}>
          <option>Select…</option>
        </select>
      </span>
    );
  }

  const model = provider.models.includes(value.model) ? value.model : provider.defaultModel;

  return (
    <span className="flex items-center gap-2">
      <select
        aria-label="LLM provider"
        value={provider.id}
        onChange={(event) => {
          const next = catalog.providers.find((p) => p.id === event.target.value) ?? provider;
          onChange({ provider: next.id, model: next.defaultModel || "" });
        }}
        className={`${SELECT_CLASS} max-w-36`}
      >
        {catalog.providers.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.label}
            {!candidate.keySet ? " (no key)" : candidate.models.length === 0 ? " (models unavailable)" : ""}
          </option>
        ))}
      </select>
      {provider.models.length === 0 ? (
        <select
          disabled
          aria-label="LLM model"
          title={provider.modelsError ?? undefined}
          className={`${SELECT_CLASS} w-40`}
        >
          <option>No models available</option>
        </select>
      ) : (
        <select
          aria-label="LLM model"
          value={model}
          onChange={(event) => onChange({ provider: provider.id, model: event.target.value })}
          className={`${SELECT_CLASS} max-w-44`}
        >
          {provider.models.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
