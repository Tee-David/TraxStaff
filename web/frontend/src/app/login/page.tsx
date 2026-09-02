"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { api, setToken, type AuthUser } from "@/lib/api";
import LightRays from "@/components/LightRays";
import GoogleSignInButton, { googleSignInEnabled as googleEnabled } from "@/components/GoogleSignInButton";

// Flat, single-stroke line icons (no color) for the form fields.
const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function MailIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3.3 3.8M6.6 6.6A15 15 0 0 0 2 12s3.5 6 10 6a9.3 9.3 0 0 0 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Both sign-in paths end the same way: store the token, go where they were
  // headed. Shared so the `next` parameter and the cookie write cannot drift
  // apart between them.
  function completeSignIn(token: string) {
    setToken(token);
    router.push(params.get("next") ?? "/app");
  }

  async function onGoogleCredential(credential: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: AuthUser }>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential }),
      });
      completeSignIn(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      completeSignIn(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-surface p-3">
      {/* Left: form */}
      <div className="flex flex-1 flex-col justify-center px-6 py-8 sm:px-12 lg:px-20">
        <motion.div
          className="mx-auto w-full max-w-sm"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon-badge.svg" alt="" className="h-16 w-16" />
            <span className="font-heading text-4xl font-bold tracking-tight">TraxStaff</span>
          </div>
          <h1 className="mt-5 text-center font-heading text-4xl font-bold tracking-tight">Welcome back</h1>
          <p className="mx-auto mt-2 max-w-xs text-center text-sm text-muted">
            Sign in to access your dashboard, settings and projects.
          </p>

          {googleEnabled && (
            <>
              <div className="mt-7">
                <GoogleSignInButton onCredential={onGoogleCredential} onError={setError} />
              </div>

              <div className="my-5 flex items-center gap-3 text-xs text-faint">
                <span className="h-px flex-1 bg-border" />
                or sign in with email
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={onSubmit} className={googleEnabled ? "space-y-4" : "mt-7 space-y-4"}>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><MailIcon /></span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3.5 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/8"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Password</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><LockIcon /></span>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-11 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/8"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:text-ink"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-brand" />
                Remember for 30 days
              </label>
              <Link href="/forgot-password" className="text-xs font-medium text-accent hover:underline">
                Forgot Password?
              </Link>
            </div>
            {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-sm font-semibold text-brand-fg transition hover:bg-brand-600 disabled:opacity-50"
            >
              {loading ? "Signing in…" : <>Sign in <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">›</span></>}
            </button>
          </form>
        </motion.div>
      </div>

      {/* Right: animated panel */}
      <div className="relative hidden flex-1 overflow-hidden rounded-2xl lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-[#000065] via-[#12126b] to-[#05052e]" />
        <LightRays
          raysOrigin="top-center"
          raysColor="#ffffff"
          raysSpeed={1.4}
          lightSpread={0.85}
          rayLength={3.4}
          pulsating
          followMouse
          mouseInfluence={0.18}
          distortion={0.45}
          saturation={1.2}
        />
        {/* soft brand glow to make the rays read stronger against the gradient */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-white/15 blur-3xl" />
        <motion.div
          className="absolute bottom-12 left-12 z-10 max-w-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="font-heading text-5xl font-bold leading-tight tracking-tight text-white">Track. Analyze. Advance.</div>
          <p className="mt-4 text-lg text-white/80">Time tracking &amp; productivity for your team.</p>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
