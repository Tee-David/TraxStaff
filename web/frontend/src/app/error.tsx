"use client";

/**
 * Root error boundary — catches throws outside the dashboard (marketing, login,
 * invite and password-reset flows), which have no boundary of their own.
 *
 * Deliberately dependency-free: this renders when something in the tree below has
 * already failed, so it must not rely on providers, fetches or context that may be
 * the very thing that broke.
 */

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon-badge.svg" alt="" className="mx-auto mb-5 h-10 w-10" />
        <h1 className="font-heading text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          This page didn&apos;t load. Trying again usually fixes it.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-faint">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold transition hover:bg-canvas"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
