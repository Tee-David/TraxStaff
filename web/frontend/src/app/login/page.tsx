"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setToken, type AuthUser } from "@/lib/api";
import LightRays from "@/components/LightRays";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      router.push(params.get("next") ?? "/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-surface p-3">
      {/* Left: form */}
      <div className="flex flex-1 flex-col px-6 py-8 sm:px-12 lg:px-20">
        <img src="/brand/logo-horizontal-color.svg" alt="Trax" className="h-8 w-auto self-start" />
        <div className="flex flex-1 flex-col justify-center">
          <div className="mx-auto w-full max-w-sm">
            <h1 className="font-heading text-4xl font-bold tracking-tight">Welcome back</h1>
            <p className="mt-2 text-sm text-muted">Please enter your details to sign in.</p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 pr-11 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-ink"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-brand" />
                Remember me
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-brand-fg transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Signing in…" : "Log in"}
              </button>
            </form>
            <p className="mt-6 text-center text-xs text-muted">
              Access is invite-only. Contact your admin if you need an account.
            </p>
          </div>
        </div>
      </div>

      {/* Right: animated panel */}
      <div className="relative hidden flex-1 overflow-hidden rounded-2xl lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-[#000065] via-[#12126b] to-[#05052e]" />
        <LightRays
          raysOrigin="top-center"
          raysColor="#ffffff"
          raysSpeed={1}
          lightSpread={0.5}
          rayLength={3}
          followMouse
          mouseInfluence={0.1}
          distortion={0.4}
          saturation={1}
        />
        <div className="absolute bottom-10 left-10 z-10 max-w-xs">
          <div className="font-heading text-2xl font-semibold text-white">Track. Analyze. Advance.</div>
          <p className="mt-2 text-sm text-white/70">Time tracking &amp; productivity for your team.</p>
        </div>
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
