"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Cursor-paged list backed by an IntersectionObserver sentinel.
 *
 * The point of the observer (rather than a scroll handler) is that it fires
 * once, when the sentinel actually enters the viewport — a scroll listener
 * would ask the server for the next page on every frame of a flick scroll.
 * `inFlight` additionally guards against the observer re-firing while a request
 * is still open, which happens whenever the sentinel stays visible because the
 * page it's waiting on hasn't grown the list yet.
 *
 * `buildPath` must be memoised by the caller (useCallback over the filters);
 * changing it resets the list and refetches from the first page.
 */
export function useInfiniteList<T>(buildPath: (cursor: string | null) => string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true); // first page of the current filter set
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cursor = useRef<string | null>(null);
  const inFlight = useRef(false);
  // Bumped on every filter change; a page that resolves after a filter change
  // belongs to the previous query and must not be appended.
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
        // A failed page must look different from an empty one — the old
        // `.catch(() => setShots([]))` made a dead backend indistinguishable
        // from "no screenshots this week".
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

  // Filters changed → drop everything and start over at the newest page.
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
        // Start the next page a screen early so the skeletons are usually
        // replaced before the user reaches them.
        { rootMargin: "600px 0px" }
      );
      observer.current.observe(node);
    },
    [fetchPage]
  );

  useEffect(() => () => observer.current?.disconnect(), []);

  return { items, setItems, loading, loadingMore, error, done, sentinelRef, loadMore: () => fetchPage(false) };
}
