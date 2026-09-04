"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, Input, Label } from "@/components/ui";
import Lockup from "@/components/Lockup";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <Lockup className="mb-3" />
          <p className="text-sm text-muted">
            {sent ? "Check your inbox" : "We'll email you a reset link"}
          </p>
        </div>

        {sent ? (
          <>
            {/* Deliberately not confirming whether the address exists — the API
                doesn't either, so the UI mustn't leak it. */}
            <p className="text-sm text-muted">
              If an account exists for <span className="font-medium text-ink">{email}</span>, a
              password reset link is on its way. It expires in 1 hour.
            </p>
            <Link
              href="/login"
              className="mt-6 block text-center text-sm font-medium text-accent hover:underline"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </Button>
            <Link
              href="/login"
              className="block text-center text-sm font-medium text-accent hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </Card>
    </div>
  );
}
