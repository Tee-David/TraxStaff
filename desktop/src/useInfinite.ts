import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Cursor-paged list driven by an IntersectionObserver sentinel.
 *
 * Deliberately an observer rather than a scroll handler: it fires once, when
 * the sentinel actually reaches the viewport, instead of asking the backend for
 * another page on every frame of a flick scroll. The tracker runs against a
 * free-tier Render service, so an accidental request storm is a real cost.
 *
 * `buildPath` must be memoised by the caller; changing it resets the list.
 */
export function useInfiniteList<T>(buildPath: (cursor: string | null) => string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cursor = useRef<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const gen = generation.current;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await api<CursorPage<T>>(buildPath(reset ? null : cursor.current));
        if (gen !== generation.current) return;
        cursor.current = page.nextCursor;
        setDone(page.nextCursor === null);
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setError(null);
      } catch (e) {
        if (gen !== generation.current) return;
        setError(e instanceof Error ? e.message : "Couldn't load");
        setDone(true);
      } finally {
        if (gen === generation.current) {
          setLoading(false);
          setLoadingMore(false);
        }
        inFlight.current = false;
      }
    },
    [buildPath]
  );

  useEffect(() => {
    generation.current += 1;
    cursor.current = null;
    setDone(false);
    setItems([]);
    setError(null);
    inFlight.current = false;
    void fetchPage(true);
  }, [fetchPage]);

  const observer = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!node) return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) void fetchPage(false);
        },
        { rootMargin: "500px 0px" }
      );
      observer.current.observe(node);
    },
    [fetchPage]
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  return { items, setItems, loading, loadingMore, error, done, sentinelRef };
}
