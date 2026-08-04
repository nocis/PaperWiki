"use client";

import { useLlmPrefs } from "./LlmPrefsProvider";
import { availabilityMessage } from "@/lib/llm-availability";

/**
 * Site-wide alert shown while the selected provider/model is unavailable.
 * Always-on while bad (no dismiss); auto-clears when a poll recovers.
 */
export default function LlmStatusBanner() {
  const { prefs, availability, availabilityState, checkNow } = useLlmPrefs();

  if (availabilityState === "available" || availabilityState === "checking" || availabilityState === "unknown") {
    return null;
  }

  const text = availability
    ? availabilityMessage(availability.kind, availability.provider, availability.model)
    : `LLM unavailable for ${prefs.provider} (${prefs.model}).`;

  return (
    <div className="border-b border-red-200 bg-red-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
        <p className="min-w-0 flex-1 text-sm text-red-800">{text}</p>
        <button
          type="button"
          onClick={() => void checkNow()}
          className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:border-red-300"
        >
          Check now
        </button>
      </div>
    </div>
  );
}
