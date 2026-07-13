"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setToken, type AuthUser } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-color.svg" alt="Trax" className="mx-auto mb-3 h-20 w-auto" />
          <p className="text-sm text-muted">Sign in to your workspace</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
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
