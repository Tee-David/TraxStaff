import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-surface border border-border rounded-[var(--radius-card)] shadow-[0_1px_3px_rgba(26,31,54,0.06),0_8px_24px_-12px_rgba(26,31,54,0.10)] ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "accent" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand text-brand-fg hover:opacity-90",
    accent: "bg-accent text-accent-fg hover:opacity-90",
    ghost: "bg-transparent text-ink hover:bg-canvas border border-border",
    danger: "bg-red-600 text-white hover:opacity-90",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 ${className}`}
      {...props}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium text-ink">{children}</label>;
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "brand" | "accent" | "green" | "red";
}) {
  const tones: Record<string, string> = {
    muted: "bg-canvas text-muted",
    brand: "bg-brand/10 text-brand",
    accent: "bg-accent/10 text-accent",
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
