"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Filter state mirrored into the query string, so a filtered view is a
 * shareable link and survives a refresh.
 *
 * Reads `window.location.search` directly instead of `useSearchParams()`: the
 * hook version forces every page that filters into a Suspense boundary at build
 * time, and we get nothing for it here — these pages are client-rendered behind
 * an auth gate and never prerendered with real params anyway.
 *
 * Only values that differ from their default are written, so the common case is
 * still a clean URL.
 */
export function useUrlState<T extends Record<string, string>>(
  defaults: T
): [T, (patch: Partial<T>) => void] {
  // Defaults are a literal at every call site; freezing the first one keeps the
  // read/write callbacks stable instead of re-running effects on every render.
  const defaultsRef = useRef(defaults);

  const read = useCallback((): T => {
    const out = { ...defaultsRef.current };
    if (typeof window === "undefined") return out;
    const params = new URLSearchParams(window.location.search);
    for (const key of Object.keys(out)) {
      const v = params.get(key);
      if (v !== null) (out as Record<string, string>)[key] = v;
    }
    return out;
  }, []);

  // Start from the defaults on both server and first client render — reading the
  // URL during render would hydrate-mismatch. The effect below adopts the real
  // query string immediately after mount.
  const [state, setState] = useState<T>(defaultsRef.current);

  useEffect(() => {
    setState(read());
    const onPop = () => setState(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);

  const set = useCallback((patch: Partial<T>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(next)) {
        if (value === defaultsRef.current[key] || value === "") params.delete(key);
        else params.set(key, value as string);
      }
      const qs = params.toString();
      // replaceState, not push: filter tweaks shouldn't bury the previous page
      // under a dozen history entries.
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
      return next;
    });
  }, []);

  return [state, set];
}
