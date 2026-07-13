"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setToken, type AuthUser } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ token: string; user: AuthUser }>("/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setToken(res.token);
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="mb-1 font-heading text-2xl font-bold text-brand">Trax</div>
          <p className="text-sm text-muted">Set your password to join</p>
        </div>
        {!token ? (
          <p className="text-sm text-red-600">Missing invite token.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label>Choose a password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Joining…" : "Join workspace"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
