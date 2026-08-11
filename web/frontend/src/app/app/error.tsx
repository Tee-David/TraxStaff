"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";

/**
 * Error boundary for the signed-in app.
 *
 * Without one, a single render-time throw anywhere under /app replaces the whole
 * document with Next's bare "Application error: a client-side exception has
 * occurred" text — no nav, no retry, and on a phone no console to read either.
 * One malformed row should cost the panel it renders in, not the whole session.
 *
 * It sits beside the layout rather than at the root so the sidebar and top bar
 * survive: a segment boundary wraps that layout's children, so the user can
 * navigate away without reloading. The digest is surfaced because the people who
 * hit this are usually on a device where reading the console isn't an option, and
 * "it went blank" is not a reportable bug.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled render error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mb-3 text-3xl">😕</div>
        <h1 className="font-heading text-lg font-semibold">This page hit a snag</h1>
        <p className="mt-2 text-sm text-muted">
          Something in this view failed to render. Your tracked time is unaffected — nothing was lost.
        </p>
        {error.message && (
          <p className="mt-4 break-words rounded-xl bg-canvas px-3 py-2 text-left text-[11px] text-muted">
            {error.message}
          </p>
        )}
        {error.digest && (
          <p className="mt-2 text-[11px] text-faint">
            Reference: <span className="tnum">{error.digest}</span>
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Link href="/app">
            <Button variant="ghost">Back to dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
