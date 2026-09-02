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
  // Solid fills, not tinted ones. A colour at 10% opacity sits on whatever is
  // behind it, which is why these chips looked washed out on the canvas and
  // different again inside a card.
  const tones: Record<string, string> = {
    brand: "bg-brand text-brand-fg",
    accent: "bg-accent text-accent-fg",
    teal: "bg-[var(--color-cat-other)] text-white",
    muted: "bg-border-strong text-ink",
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
    subtle: "bg-canvas text-ink hover:bg-border",
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
  // Solid fills with a contrasting foreground. These were tinted (`/10`, `/12`)
  // which made every badge a slightly different colour depending on the surface
  // underneath it, and washed out badly in dark mode.
  const tones: Record<string, string> = {
    muted: "bg-border-strong text-ink",
    brand: "bg-brand text-brand-fg",
    accent: "bg-accent text-accent-fg",
    green: "bg-[var(--color-positive)] text-white",
    red: "bg-[var(--color-negative)] text-white",
    teal: "bg-[var(--color-cat-other)] text-white",
  };
  // On a solid fill the dot has to read against the badge, not against the page.
  const dotColors: Record<string, string> = {
    muted: "bg-faint",
    brand: "bg-white",
    accent: "bg-white",
    green: "bg-white",
    red: "bg-white",
    teal: "bg-white",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotColors[tone]}`} />}
      {children}
    </span>
  );
}
