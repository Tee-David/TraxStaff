"use client";

import type { ReactNode } from "react";

/**
 * One settings line: label (plus optional helper text) on the left, control on
 * the right. Stacks on narrow screens so long controls never push the page wide.
 * Dividers come from the parent panel's `divide-y`.
 */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:flex-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint && <p className="mt-0.5 max-w-md text-[12px] leading-relaxed text-muted">{hint}</p>}
      </div>
      <div className="min-w-0 shrink-0">{children}</div>
    </div>
  );
}
