"use client";

import type { ReactNode, HTMLAttributes } from "react";

export type SettingsNavItem = {
  id: string;
  label: string;
  icon: (p: { className?: string }) => ReactNode;
};

/**
 * Section switcher for the settings page. A vertical rail from `lg` up; below
 * that it collapses to a horizontally scrollable tab strip, so a long section
 * list never widens the page.
 */
export function SettingsNav({
  items,
  active,
  onSelect,
  ...rest
}: {
  items: SettingsNavItem[];
  active: string;
  onSelect: (id: string) => void;
} & HTMLAttributes<HTMLElement>) {
  const base =
    "flex items-center gap-2.5 rounded-xl text-[13.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const tone = (on: boolean) => (on ? "bg-brand/10 text-brand" : "text-muted hover:bg-canvas hover:text-ink");

  return (
    <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-4 lg:w-56 lg:shrink-0" {...rest}>
      {/* Rail — lg and up */}
      <div className="hidden lg:flex lg:flex-col lg:gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const on = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={on ? "page" : undefined}
              className={`${base} w-full px-3 py-2.5 text-left ${tone(on)}`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${on ? "text-brand" : "text-faint"}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab strip — below lg */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden">
        {items.map((item) => {
          const Icon = item.icon;
          const on = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={on ? "page" : undefined}
              className={`${base} shrink-0 whitespace-nowrap border border-border bg-surface px-3 py-2 ${
                on ? "border-brand/30 bg-brand/10 text-brand" : "text-muted"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${on ? "text-brand" : "text-faint"}`} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
