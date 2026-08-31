"use client";

import { Card } from "@/components/ui";
import { INTENTS, type Intent } from "./types";

/**
 * Step 1 — what are you doing?
 *
 * The single biggest simplification in the wizard. The old page put `fill`
 * (top up / add / replace) in the middle of a long form as three radio cards
 * with a paragraph each, so the most consequential setting on the page — the one
 * that silently doubles somebody's week if you get it wrong — looked exactly
 * like the eighteen settings around it.
 *
 * Asking the question first, in the operator's own words, means the answer can
 * be derived instead of configured, and the words "top up" and "replace" never
 * have to appear at all.
 */
export function StepIntent({
  value,
  onChange,
}: {
  value: Intent | null;
  onChange: (intent: Intent) => void;
}) {
  return (
    <div>
      <h2 className="font-heading text-lg font-semibold">What do you want to do?</h2>
      <p className="mt-1 text-sm text-muted">
        Everything after this adapts to the answer, so you only ever see the settings that matter.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {INTENTS.map((intent) => {
          const on = value === intent.id;
          return (
            <button
              key={intent.id}
              type="button"
              onClick={() => onChange(intent.id)}
              aria-pressed={on}
              className="text-left"
            >
              <Card
                className={`h-full p-4 transition ${
                  on ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "hover:border-brand/40"
                }`}
              >
                <div className={`text-sm font-semibold ${on ? "text-brand" : "text-ink"}`}>
                  {intent.title}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{intent.blurb}</p>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
