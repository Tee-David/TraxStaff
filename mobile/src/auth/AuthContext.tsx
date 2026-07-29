import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, setTokenSource } from "../api/client";
import type { Me } from "../api/types";

// The JWT lives in the Android Keystore via expo-secure-store, never in
// AsyncStorage — AsyncStorage is plain-text on disk and readable by anything
// with the app's data directory (backup extraction, rooted device, adb on a
// debuggable build).
const TOKEN_KEY = "trax.jwt";
const DEVICE_KEY = "trax.deviceId";
// Bumped whenever the disclosure text in app/disclosure.tsx changes materially;
// a bump re-prompts everyone. Kept in step with the backend's consentVersion.
export const CONSENT_VERSION = 1;

type Status = "loading" | "signedOut" | "signedIn";

type AuthValue = {
  status: Status;
  me: Me | null;
  deviceId: string;
  /** True while a request has been in flight long enough that the wait is
   *  probably a Render cold start rather than a fast failure. */
  slow: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  acceptConsent: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // The API client pulls the token from here rather than from React state, so
  // a request fired during a render still sees the current value.
  useEffect(() => {
    setTokenSource(() => tokenRef.current);
  }, []);

  const withSlowHint = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const timer = setTimeout(() => setSlow(true), 4_000);
    try {
      return await fn();
    } finally {
      clearTimeout(timer);
      setSlow(false);
    }
  }, []);

  const clear = useCallback(async () => {
    tokenRef.current = null;
    setMe(null);
    setStatus("signedOut");
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) {
      setStatus("signedOut");
      return;
    }
    try {
      setMe(await withSlowHint(() => api.me()));
      setStatus("signedIn");
    } catch (err) {
      // Only an explicit 401 invalidates the session. A cold start or a dead
      // connection must not sign the user out — that would log people out every
      // time they open the app on the train.
      if (err instanceof ApiError && err.isAuth) {
        await clear();
        setError("Your session expired. Sign in again.");
      } else {
        setStatus("signedIn");
        setError(err instanceof Error ? err.message : "Couldn't reach Trax.");
      }
    }
  }, [clear, withSlowHint]);

  // Boot: restore token + device id, then validate the token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [token, storedDevice] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        SecureStore.getItemAsync(DEVICE_KEY).catch(() => null),
      ]);
      let device = storedDevice;
      if (!device) {
        device = randomUUID();
        await SecureStore.setItemAsync(DEVICE_KEY, device).catch(() => {});
      }
      if (cancelled) return;
      setDeviceId(device);
      tokenRef.current = token;
      if (!token) {
        setStatus("signedOut");
        return;
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately runs once: refresh is stable and re-running would re-mint state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const res = await withSlowHint(() => api.login(email.trim(), password));
        tokenRef.current = res.token;
        await SecureStore.setItemAsync(TOKEN_KEY, res.token);
        setMe(await api.me());
        setStatus("signedIn");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sign in failed.";
        setError(message);
        throw err;
      }
    },
    [withSlowHint]
  );

  const signOut = useCallback(async () => {
    setError(null);
    await clear();
  }, [clear]);

  const acceptConsent = useCallback(async () => {
    await api.acceptConsent(CONSENT_VERSION);
    setMe((prev) =>
      prev ? { ...prev, consentAcceptedAt: new Date().toISOString(), consentVersion: CONSENT_VERSION } : prev
    );
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, me, deviceId, slow, error, signIn, signOut, acceptConsent, refresh }),
    [status, me, deviceId, slow, error, signIn, signOut, acceptConsent, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** True when the signed-in user still owes us an affirmative consent for the
 *  current disclosure version. Play requires the disclosure to be in the app
 *  and visible in normal usage, not buried in a menu. */
export function needsConsent(me: Me | null): boolean {
  if (!me) return false;
  return !me.consentAcceptedAt || (me.consentVersion ?? 0) < CONSENT_VERSION;
}
