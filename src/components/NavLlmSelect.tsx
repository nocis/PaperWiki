"use client";

import { useLlmPrefs } from "./LlmPrefsProvider";
import ProviderModelSelect from "./ProviderModelSelect";
import { availabilityMessage } from "@/lib/llm-availability";

const DOT_CLASS: Record<string, string> = {
  unknown: "bg-gray-300",
  checking: "bg-amber-400 animate-pulse",
  available: "bg-emerald-500",
  unavailable: "bg-red-500",
};

export default function NavLlmSelect() {
  const { prefs, setPrefs, catalog, catalogError, retryCatalog, availabilityState, availability } = useLlmPrefs();

  const title =
    availabilityState === "available"
      ? `LLM available (${prefs.provider || "…"}/${prefs.model || "…"})`
      : availabilityState === "checking"
        ? "Checking LLM availability…"
        : availability
          ? availabilityMessage(availability.kind, availability.provider, availability.model)
          : "LLM availability unknown";

  return (
    <div className="flex items-center gap-2.5">
      <span title={title} className="flex items-center">
        <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASS[availabilityState]}`} />
      </span>
      <span className="hidden sm:inline">
        <ProviderModelSelect
          catalog={catalog}
          value={prefs}
          onChange={setPrefs}
          catalogError={catalogError}
          onRetryCatalog={retryCatalog}
        />
      </span>
    </div>
  );
}
