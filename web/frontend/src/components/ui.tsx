"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionPresets } from "@/lib/motion";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, HTMLAttributes } from "react";

/* ---------- surfaces ---------- */

export function Card({
  children,
  className = "",
  hover = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-soft)] ${
        hover ? "transition hover:shadow-[var(--shadow-lift)]" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Titled card with an optional icon and right-aligned action. */
export function Section({
  title,
  icon,
  action,
  children,
  className = "",
  bodyClassName = "p-5",
  ...rest
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={className} {...rest}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            {icon && <span className="text-muted">{icon}</span>}
            {title && <h2 className="font-heading text-[15px] font-semibold">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

/* ---------- page scaffolding ---------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-[26px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- stat tile ---------- */

export function StatTile({
  icon,
  label,
  value,
  suffix,
  delta,
  tone = "brand",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  suffix?: string;
  delta?: { value: string; positive: boolean };
  tone?: "brand" | "accent" | "teal" | "muted";
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand/10 text-brand",
    accent: "bg-accent/10 text-accent",
    teal: "bg-[var(--color-cat-other)]/12 text-[var(--color-cat-other)]",
    muted: "bg-canvas text-muted",
  };
  return (
    <Card className="p-4" hover>
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${tones[tone]}`}>{icon}</span>
        {delta && (
          <span className={`text-xs font-semibold ${delta.positive ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]"}`}>
            {delta.positive ? "↑" : "↓"} {delta.value}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-0.5 font-heading text-[26px] font-bold tnum text-ink">
        {value}
        {suffix && <span className="text-lg text-muted">{suffix}</span>}
      </div>
      <div className="mt-0.5 text-[13px] text-muted">{label}</div>
    </Card>
  );
}

/* ---------- feedback states ---------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  icon = "✨",
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-2xl">{icon}</div>
      <div className="font-heading text-base font-semibold">{title}</div>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

/* ---------- controls ---------- */

type ButtonVariant = "primary" | "accent" | "ghost" | "danger" | "subtle";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand text-brand-fg hover:bg-brand-600",
    accent: "bg-accent text-accent-fg hover:opacity-90",
    ghost: "border border-border bg-transparent text-ink hover:bg-canvas",
    danger: "bg-[var(--color-negative)] text-white hover:opacity-90",
    subtle: "bg-canvas text-ink hover:bg-border/60",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none transition placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/8 ${className}`}
      {...props}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-[13px] font-medium text-ink">{children}</label>;
}

export function Badge({
  children,
  tone = "muted",
  dot = false,
}: {
  children: ReactNode;
  tone?: "muted" | "brand" | "accent" | "green" | "red" | "teal";
  dot?: boolean;
}) {
  const tones: Record<string, string> = {
    muted: "bg-canvas text-muted",
    brand: "bg-brand/10 text-brand",
    accent: "bg-accent/10 text-accent",
    green: "bg-[var(--color-positive)]/12 text-[var(--color-positive)]",
    red: "bg-[var(--color-negative)]/10 text-[var(--color-negative)]",
    teal: "bg-[var(--color-cat-other)]/12 text-[var(--color-cat-other)]",
  };
  const dotColors: Record<string, string> = {
    muted: "bg-faint",
    brand: "bg-brand",
    accent: "bg-accent",
    green: "bg-[var(--color-positive)]",
    red: "bg-[var(--color-negative)]",
    teal: "bg-[var(--color-cat-other)]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColors[tone]}`} />}
      {children}
    </span>
  );
}

/* ---------- modal shell ---------- */

/**
 * The shell every dialog in the app sits in.
 *
 * Seven dialogs had each rebuilt this by hand, and they had drifted: only one
 * capped its height, so on a short screen — or any phone once the keyboard is
 * up — the others ran off the bottom with their Cancel/Save buttons
 * unreachable and no way to scroll to them. This is that fix in one place, so
 * the eighth dialog inherits it instead of repeating the bug.
 *
 * What it guarantees:
 *
 *   - never taller than the screen: the card scrolls internally past `85dvh`,
 *     so the actions are always reachable. `dvh` over `vh` on purpose — `vh`
 *     on mobile means the viewport with the browser chrome *retracted*, so a
 *     `85vh` card is taller than what you can actually see whenever the URL bar
 *     is showing, which is exactly when someone is typing into it;
 *   - never wider than the screen: `w-full` under a `max-w-*` cap, inside a
 *     gutter that shrinks on small phones;
 *   - Escape closes it, and a click on the backdrop does too — but never while
 *     it is mid-save, when closing would hide the outcome of the thing it is
 *     doing;
 *   - the panel is a labelled `role="dialog"`, which the hand-rolled ones were
 *     inconsistent about.
 *
 * `busy` exists so a dialog that is saving can refuse both dismissals with one
 * prop rather than each one guarding separately.
 */
export function Modal({
  label,
  onClose,
  busy = false,
  size = "md",
  children,
}: {
  /** Accessible name for the dialog — what it is, in a few words. */
  label: string;
  onClose: () => void;
  busy?: boolean;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" };
  // The shared presets, applied here rather than per dialog — two of the seven
  // animated and five appeared instantly, which read as two different apps.
  // They collapse to a plain fade under `prefers-reduced-motion` (lib/motion).
  const m = useMotionPresets();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      // A `Select` open inside the dialog answers Escape by closing its own
      // option panel; without this the same keypress would tear the whole
      // dialog down underneath it.
      if (document.querySelector("[data-select-panel]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        {...m.backdrop}
      >
        <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onClose()} />
        <motion.div
          className={`relative z-10 flex max-h-[85dvh] w-full flex-col ${widths[size]}`}
          {...m.dialog}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * The card inside a `Modal` — scrolls internally once the content is taller
 * than the shell allows.
 *
 * Padding steps down on small phones: `p-6` is 48px of the 320px a small screen
 * has, and a form does not need to spend it on margins.
 */
export function ModalCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 ${className}`}>
      {children}
    </Card>
  );
}
