"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  EMPTY_PREFS,
  fetchAvailability,
  fetchLlmCatalog,
  sanitizePrefs,
  type AvailabilityState,
  type LlmAvailability,
  type LlmCatalog,
  type ProviderModelPrefs,
} from "@/lib/llm-availability";

const STORAGE_PROVIDER = "paperwiki:provider";
const STORAGE_MODEL = "paperwiki:model";
const LEGACY_STORAGE_MODEL = "paperwiki:chat:model";

const POLL_INTERVAL_MS = 60_000;

interface LlmPrefsContextValue {
  prefs: ProviderModelPrefs;
  setPrefs: (next: ProviderModelPrefs) => void;
  catalog: LlmCatalog | null;
  catalogError: string | null;
  retryCatalog: () => void;
  availability: LlmAvailability | null;
  availabilityState: AvailabilityState;
  checkNow: () => void;
}

const LlmPrefsContext = createContext<LlmPrefsContextValue | null>(null);

/** Read stored prefs (client-only — never called during render). */
function loadSavedPrefs(): ProviderModelPrefs {
  let provider = "";
  let model = "";
  try {
    provider = localStorage.getItem(STORAGE_PROVIDER) ?? "";
    model = localStorage.getItem(STORAGE_MODEL) ?? "";
    if (!model) model = localStorage.getItem(LEGACY_STORAGE_MODEL) ?? "";
  } catch {
    /* storage is optional */
  }
  return { provider, model };
}

function savePrefs(prefs: ProviderModelPrefs): void {
  try {
    localStorage.setItem(STORAGE_PROVIDER, prefs.provider);
    localStorage.setItem(STORAGE_MODEL, prefs.model);
  } catch {
    /* storage is optional */
  }
}

export function LlmPrefsProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<LlmCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Hydration-safe: identical empty state on server and client; stored prefs
  // and the catalog are applied in an effect after mount.
  const [prefs, setPrefsState] = useState<ProviderModelPrefs>(EMPTY_PREFS);
  const [availability, setAvailability] = useState<LlmAvailability | null>(null);
  const [availabilityState, setAvailabilityState] = useState<AvailabilityState>("unknown");
  const prefsRef = useRef(prefs);
  const catalogRef = useRef(catalog);

  prefsRef.current = prefs;
  catalogRef.current = catalog;

  const loadCatalog = useCallback(async (refresh = false) => {
    setCatalogError(null);
    try {
      const data = await fetchLlmCatalog(refresh);
      setCatalog(data);
      setPrefsState((current) => sanitizePrefs(current, data));
    } catch (err) {
      setCatalogError(errorMessage(err));
    }
  }, []);

  // Mount: apply stored prefs, then resolve against the server catalog.
  useEffect(() => {
    setPrefsState(loadSavedPrefs());
    void loadCatalog();
  }, [loadCatalog]);

  const checkNow = useCallback(async () => {
    const { provider, model } = prefsRef.current;
    if (!provider) return;
    setAvailabilityState("checking");
    try {
      const result = await fetchAvailability(provider, model);
      setAvailability(result);
      setAvailabilityState(result.state);
      // A successful re-check means the provider is reachable; if the catalog
      // entry is still stale (no key / no models / fetch error), force a fresh
      // catalog load so "(no key)" and "No models available" actually update.
      if (result.state === "available") {
        const entry = catalogRef.current?.providers.find((p) => p.id === provider);
        if (entry && (!entry.keySet || entry.models.length === 0 || entry.modelsError)) {
          void loadCatalog(true);
        }
      }
    } catch (err) {
      setAvailability(null);
      setAvailabilityState("unavailable");
      setAvailability({ state: "unavailable", kind: "other", error: errorMessage(err), provider, model, checkedAt: new Date().toISOString() });
    }
  }, [loadCatalog]);

  // Re-check on mount and whenever the selection changes.
  useEffect(() => {
    void checkNow();
  }, [checkNow, prefs.provider, prefs.model]);

  // Periodic refresh, paused while the tab is hidden.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => {
        if (document.visibilityState === "visible") void checkNow();
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkNow();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.visibilityState === "visible") start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkNow]);

  const setPrefs = useCallback((next: ProviderModelPrefs) => {
    const sanitized = sanitizePrefs(next, catalog);
    setPrefsState(sanitized);
    savePrefs(sanitized);
  }, [catalog]);

  // Cross-tab sync: another tab changed the selection.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_PROVIDER || event.key === STORAGE_MODEL) {
        setPrefsState(sanitizePrefs(loadSavedPrefs(), catalog));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [catalog]);

  return (
    <LlmPrefsContext.Provider
      value={{
        prefs,
        setPrefs,
        catalog,
        catalogError,
        retryCatalog: () => void loadCatalog(true),
        availability,
        availabilityState,
        checkNow,
      }}
    >
      {children}
    </LlmPrefsContext.Provider>
  );
}

export function useLlmPrefs(): LlmPrefsContextValue {
  const value = useContext(LlmPrefsContext);
  if (!value) {
    throw new Error("useLlmPrefs must be used within <LlmPrefsProvider>");
  }
  return value;
}
