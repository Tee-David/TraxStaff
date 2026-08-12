"use client";

/**
 * Error boundary for the dashboard.
 *
 * Nested under /app so it renders INSIDE AppLayout: the sidebar, top bar and
 * navigation stay live and only the page body is replaced. Without it, any throw
 * in the tree — the whole dashboard is one client tree — hit Next's default root
 * boundary, which replaces the entire document with "Application error: a
 * client-side exception has occurred", offers no way to retry, and leaves no
 * navigation to escape with.
 *
 * That is not a hypothetical: one hard-deleted member left an orphaned
 * UnusualActivityFlag, the Insights panel dereferenced its null `session.user`,
 * and because the bad row is persistent database state rather than a transient
 * response, the dashboard stayed unusable across reloads for days.
 */

import { useEffect } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Release builds hide the stack from the user, so make sure it is at least
    // reachable from the console — this page is the only signal a user can see.
    console.error("[dashboard] unhandled render error:", error);
  }, [error]);

  return (
    <div>
      <PageHeader title="Something went wrong" subtitle="This page couldn't be displayed." />
      <Card className="p-6">
        <p className="text-sm text-muted">
          The rest of the app is still working — use the menu to carry on, or try this page again.
        </p>
        {error.message && (
          <p className="mt-3 break-words rounded-lg bg-canvas px-3 py-2 font-mono text-xs text-muted">
            {error.message}
          </p>
        )}
        {error.digest && (
          <p className="mt-2 text-[11px] text-faint">Reference: {error.digest}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/app"
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold transition hover:bg-canvas"
          >
            Back to dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}
