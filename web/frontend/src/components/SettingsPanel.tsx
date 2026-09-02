"use client";

import type { ReactNode } from "react";

/**
 * A labelled sub-panel inside a settings section — a bordered, rounded, slightly
 * recessed container holding `SettingsRow`s separated by hairline dividers.
 */
export function SettingsPanel({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[var(--radius-lg)] border border-border bg-canvas ${className}`}>
      {title && (
        <header className="border-b border-border px-4 py-3">
          <h3 className="font-heading text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</h3>
          {description && <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p>}
        </header>
      )}
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}
