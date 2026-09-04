"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Continue with Google", rendered by Google Identity Services.
 *
 * The button is drawn by Google's own script rather than by us. That is not
 * laziness — GIS only hands out an ID token from a button it rendered itself,
 * and Google's branding terms govern what that button may look like, so a
 * hand-styled one either cannot produce a credential or is not allowed. What we
 * control is where it sits and how wide it is; `theme` follows the dashboard's
 * light/dark setting so it does not glow white in a dark login screen.
 *
 * Renders nothing at all when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, so a
 * deployment without Google configured shows a plain email/password form rather
 * than a button that cannot work. The backend is the real gate — it 503s the
 * route when its own GOOGLE_CLIENT_ID is missing — this just keeps the dead
 * control off the screen.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

/**
 * Whether Google sign-in is configured for this build. Exported so a page can
 * drop the surrounding "or sign in with email" divider too, instead of leaving
 * a separator with nothing on one side of it. `NEXT_PUBLIC_*` is inlined at
 * build time, so this is a constant, not a runtime lookup.
 */
export const googleSignInEnabled = Boolean(CLIENT_ID);
/**
 * `hl=en` pins the language of everything Google draws for us.
 *
 * GIS localises its own button to the viewer's Google account or browser
 * language, which is how an otherwise English login page came to offer
 * "Doorgaan met Google". The `locale` option below covers the button; this
 * covers the account chooser and the rest of the GIS chrome, which that option
 * cannot reach.
 */
const GSI_SRC = "https://accounts.google.com/gsi/client?hl=en";

interface GsiButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
}

interface GsiClient {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: GsiButtonOptions): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GsiClient;
  }
}

/**
 * Load the GIS script once per page, however many buttons ask for it. Module
 * scope rather than a ref: two mounts (React strict mode double-invokes effects
 * in dev) must share one <script>, not race to append a second.
 */
let scriptPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      // Let a later mount try again — a blocked or flaky first load should not
      // permanently disable the button for the life of the tab.
      scriptPromise = null;
      reject(new Error("Could not load Google sign-in"));
    });
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return scriptPromise;
}

export default function GoogleSignInButton({
  onCredential,
  onError,
}: {
  /** Called with the ID token to post to POST /auth/google. */
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // Keep the latest callbacks reachable from GIS's own callback without
  // re-initializing (and so re-rendering) the button on every parent render.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  onCredentialRef.current = onCredential;
  onErrorRef.current = onError;

  // GIS wants an explicit pixel width — it will not fill its parent. Measure the
  // container and redraw when it changes, so the button matches the form at every
  // breakpoint instead of being pinned at one size.
  const measure = useCallback(() => {
    const el = holder.current?.parentElement;
    if (!el) return;
    // 400 is GIS's documented maximum; anything larger is silently clamped.
    setWidth(Math.min(400, Math.round(el.getBoundingClientRect().width)));
  }, []);

  useEffect(() => {
    if (!CLIENT_ID) return;
    measure();
    const el = holder.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!CLIENT_ID || !width) return;
    let cancelled = false;

    loadGsi()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            if (!response.credential) {
              onErrorRef.current("Google sign-in was cancelled.");
              return;
            }
            onCredentialRef.current(response.credential);
          },
          // No One Tap here: the login screen already shows an explicit button,
          // and auto-selecting an account would sign someone in before they had
          // chosen to.
          auto_select: false,
        });
        holder.current.innerHTML = "";
        window.google.accounts.id.renderButton(holder.current, {
          type: "standard",
          theme:
            document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width,
          // Not the viewer's language: this button sits in an English page.
          locale: "en",
        });
      })
      .catch((err: Error) => {
        if (!cancelled) onErrorRef.current(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [width]);

  if (!CLIENT_ID) return null;
  // min-height reserves the button's own height so the form below does not jump
  // when Google's script finishes loading.
  return <div ref={holder} className="flex min-h-[44px] justify-center" />;
}
