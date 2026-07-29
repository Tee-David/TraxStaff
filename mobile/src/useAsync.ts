import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, COLD_START_HINT_MS } from "./api/client";

type State<T> = {
  data: T | null;
  loading: boolean;
  /** The request has been running long enough to be a Render cold start. */
  slow: boolean;
  error: string | null;
};

/**
 * Load-once-with-refresh. Errors are surfaced, never swallowed: a `.catch(() => [])`
 * makes a failed request look identical to "no data", which is the bug the web
 * dashboards keep hitting (checklist §4.2).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, slow: false, error: null });
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (quiet = false) => {
    if (!quiet) setState((p) => ({ ...p, loading: true, error: null }));
    const timer = setTimeout(() => {
      if (mounted.current) setState((p) => ({ ...p, slow: true }));
    }, COLD_START_HINT_MS);
    try {
      const data = await fnRef.current();
      if (mounted.current) setState({ data, loading: false, slow: false, error: null });
    } catch (err) {
      if (mounted.current) {
        setState((p) => ({
          ...p,
          loading: false,
          slow: false,
          error: err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong",
        }));
      }
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run };
}
