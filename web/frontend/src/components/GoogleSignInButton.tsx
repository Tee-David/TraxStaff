"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Continue with Google" for the login page.
 *
 * The button is rendered by Google Identity Services, and GIS localises its own
 * label — left to itself it picks the language of the visitor's Google account
 * or browser, which is how an English page ended up offering "Doorgaan met
 * Google". Both `?hl=en` on the script and `locale: "en"` on the button pin it:
 * the script parameter also covers the One Tap / account-chooser chrome, which
 * the per-button option cannot reach.
 *
 * With no client id configured the component degrades to a plain English button
 * that says so, rather than rendering nothing where a sign-in option should be.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GSI_SRC = "https://accounts.google.com/gsi/client?hl=en";

/** Matches the login card (`max-w-sm` = 384px); GIS caps `width` at 400. */
const BUTTON_WIDTH = 384;

/**
 * How long to wait for Google's script before giving up on it.
 *
 * A blocked request doesn't reliably fire `error` — behind a filtering proxy or
 * a tracker blocker it simply never settles — and an unresolved promise would
 * leave a silent gap where the sign-in option should be. After this we show our
 * own button, which at least says what it is and why it isn't working.
 */
const GSI_LOAD_TIMEOUT_MS = 8000;

interface GsiCredentialResponse {
  credential?: string;
}

/** What GIS hands `error_callback` when the flow never reaches the callback. */
interface GsiError {
  type?: string;
  message?: string;
}

/**
 * Turn a GIS failure into something a person can act on.
 *
 * The type is kept in the text on purpose: these failures happen on other
 * people's devices, and "popup_failed_to_open" in a screenshot is worth more
 * than a tidy sentence when someone reports that sign-in "just doesn't work".
 */
function describeGsiError(err: GsiError): string {
  switch (err.type) {
    case "popup_failed_to_open":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or sign in with your email below.";
    case "popup_closed":
      return "The Google sign-in window closed before finishing. Try again, or sign in with your email below.";
    default:
      return `Google sign-in didn't complete (${err.type ?? "unknown error"}). Try again, or sign in with your email below.`;
  }
}

interface GsiClient {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GsiCredentialResponse) => void;
        error_callback?: (error: GsiError) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        itp_support?: boolean;
        ux_mode?: "popup" | "redirect";
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "small" | "medium" | "large";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
          locale?: string;
        }
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GsiClient;
  }
}

let gsiScript: Promise<void> | null = null;

/** Loads the GIS script once per page, however many components ask for it. */
function loadGsi(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (gsiScript) return gsiScript;

  gsiScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      if (window.google) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google sign-in failed to load")));
      return;
    }

    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Google sign-in failed to load")));
    document.head.appendChild(script);
  }).catch((err) => {
    // A failed load must not be cached as "done" — a later mount should retry.
    gsiScript = null;
    throw err;
  });

  return gsiScript;
}

/** Google's mark, for the fallback button only — GIS draws its own. */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C41.4 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

export interface GoogleSignInButtonProps {
  /** Called with the Google ID token once the visitor picks an account. */
  onCredential: (credential: string) => void | Promise<void>;
  /** Surfaces problems on the page's own error line. */
  onError: (message: string) => void;
  className?: string;
}

export default function GoogleSignInButton({ onCredential, onError, className }: GoogleSignInButtonProps) {
  const target = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"loading" | "gsi" | "fallback">(CLIENT_ID ? "loading" : "fallback");

  // Held in a ref so re-renders of the login form never re-run the effect
  // below: re-initialising GIS mid-sign-in tears the rendered button out.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    const giveUp = setTimeout(() => {
      if (!cancelled) setMode((m) => (m === "loading" ? "fallback" : m));
    }, GSI_LOAD_TIMEOUT_MS);

    loadGsi()
      .then(() => {
        if (cancelled || !target.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          ux_mode: "popup",
          callback: (response) => {
            if (!response.credential) {
              handlers.current.onError("Google didn't return a sign-in token. Try again.");
              return;
            }
            void handlers.current.onCredential(response.credential);
          },
          // Without this, a window Google couldn't open — or one the person
          // closed — leaves the page looking like the button did nothing.
          error_callback: (err) => handlers.current.onError(describeGsiError(err)),
        });
        window.google.accounts.id.renderButton(target.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: BUTTON_WIDTH,
          // The fix for the non-English label — see the note at the top.
          locale: "en",
        });
        setMode("gsi");
      })
      .catch(() => {
        if (!cancelled) setMode("fallback");
      });

    return () => {
      cancelled = true;
      clearTimeout(giveUp);
    };
  }, []);

  const explain = useCallback(() => {
    onError(
      CLIENT_ID
        ? "Google sign-in couldn't load — check your connection, or sign in with your email below."
        : "Google sign-in isn't set up yet — sign in with your email below."
    );
  }, [onError]);

  if (mode === "fallback") {
    return (
      <button
        type="button"
        onClick={explain}
        className={`flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface py-2.5 text-sm font-semibold transition hover:bg-canvas ${className ?? ""}`}
      >
        <GoogleIcon /> Continue with Google
      </button>
    );
  }

  return (
    // `min-h` reserves the button's height so the card doesn't jump once GIS paints.
    <div ref={target} className={`flex min-h-[44px] w-full justify-center ${className ?? ""}`} />
  );
}
