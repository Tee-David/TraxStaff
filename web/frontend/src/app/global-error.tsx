"use client";

/**
 * Last resort: catches a throw in the ROOT layout itself, which `error.tsx`
 * cannot — that boundary lives inside the layout it would need to replace.
 *
 * Next renders this in place of the root layout, so `globals.css` and the font
 * variables are not applied. Everything here is therefore inline-styled with
 * system fonts and literal colours: a stylesheet-dependent fallback for a
 * layout failure can end up as unstyled text on a white page, which reads as a
 * second bug rather than a handled one.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f8fa",
          color: "#11131a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "420px", textAlign: "center" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>TraxStaff couldn&apos;t start</h1>
          <p style={{ fontSize: "14px", color: "#5b6070", marginTop: "8px" }}>
            Something failed before the app could load. Reloading usually fixes it.
          </p>
          {error.digest && (
            <p style={{ fontSize: "11px", color: "#8b90a0", marginTop: "12px" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "24px",
              border: 0,
              borderRadius: "8px",
              background: "#1b2ccc",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              padding: "10px 18px",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
