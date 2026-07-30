import Application from "expo-application";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import Tracker, { TamperEvent, TrackedSegment, TrackerState } from "../../modules/trax-tracker";
import { ApiError, api } from "../api/client";
import type { Project, Task } from "../api/types";
import { useAuth } from "../auth/AuthContext";

// `Constants.expoConfig?.version` reads app.config.ts's hardcoded "0.1.0" —
// CI (mobile-android.yml) stamps the real version into the generated native
// Gradle project's versionName post-`expo prebuild`, never back into
// app.config.ts, so that field is permanently stale at runtime regardless of
// what's actually installed. `Application.nativeApplicationVersion` reads the
// real installed package's version from the Android PackageManager instead.
// It can be null in Expo Go / a dev client with no real package installed,
// which is the only case the fallback below is for.
const APP_VERSION = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
const POLL_MS = 1_000;
const HEARTBEAT_MS = 60_000;

const IDLE: TrackerState = {
  tracking: false,
  serviceRunning: false,
  bootId: 0,
  segmentId: null,
  sessionId: null,
  projectId: null,
  taskId: null,
  startedWallMs: null,
  creditedSeconds: 0,
  staleBoot: false,
};

type TrackerValue = {
  state: TrackerState;
  available: boolean;
  /** Segments closed by something other than the user, not yet acknowledged. */
  interrupted: TrackedSegment[];
  pendingCount: number;
  syncError: string | null;
  lastSyncedAt: number | null;
  start: (project: Project, task: Task | null) => Promise<void>;
  stop: () => Promise<void>;
  sync: () => Promise<void>;
  acknowledgeInterrupted: () => void;
};

const TrackerContext = createContext<TrackerValue | null>(null);

export function TrackerProvider({ children }: { children: ReactNode }) {
  const { status, deviceId } = useAuth();
  const [state, setState] = useState<TrackerState>(IDLE);
  const [interrupted, setInterrupted] = useState<TrackedSegment[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const syncing = useRef(false);

  const refreshState = useCallback(async () => {
    setState(await Tracker.getState());
  }, []);

  /**
   * Push closed-but-unsynced segments to the server.
   *
   * `POST /sessions/start` is idempotent on the client-minted id, so replaying a
   * segment after a failed response returns the existing row instead of creating
   * a duplicate. That is what makes it safe to retry indefinitely — and why the
   * session id is minted here rather than by the server.
   */
  const sync = useCallback(async () => {
    if (syncing.current || status !== "signedIn" || !deviceId) return;
    syncing.current = true;
    try {
      const segments = await Tracker.pendingSegments(50);
      setPendingCount(segments.length);

      for (const seg of segments) {
        try {
          await api.startSession({
            id: seg.sessionId,
            startedAt: new Date(seg.startedWallMs).toISOString(),
            projectId: seg.projectId,
            taskId: seg.taskId ?? undefined,
            deviceId,
            platform: "android",
            appVersion: APP_VERSION,
          });
          try {
            await api.stopSession(
              seg.sessionId,
              seg.closeReason === "stopped" || seg.closeReason === "superseded" ? "stopped" : "abrupt_exit"
            );
          } catch (err) {
            // 409 = already stopped (a previous attempt got through, or the
            // server took the session over). Nothing left to do for it.
            if (!(err instanceof ApiError && err.status === 409)) throw err;
          }
          await Tracker.markSegmentSynced(seg.id);
        } catch (err) {
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            // Permanently unacceptable — a deleted project, or a session the
            // server will never create. Retrying forever would jam the queue
            // behind it, which is exactly the bug the desktop app hit.
            await Tracker.markSegmentSynced(seg.id);
            continue;
          }
          throw err;
        }
      }

      // Tamper evidence rides along as a session note, so it is visible in the
      // same place a reviewer already looks. Events with no session (a clock
      // change while nothing was running) are recorded locally only — there is
      // no server object to hang them on.
      const events: TamperEvent[] = await Tracker.pendingEvents(50);
      for (const ev of events) {
        if (ev.sessionId) {
          try {
            await api.addNote(
              ev.sessionId,
              `[device] ${ev.kind}${ev.detail ? ` — ${ev.detail}` : ""} at ${new Date(ev.wallMs).toISOString()}`
            );
          } catch (err) {
            if (!(err instanceof ApiError && (err.status === 404 || err.status === 400))) throw err;
          }
        }
        await Tracker.markEventSynced(ev.id);
      }

      setPendingCount((await Tracker.pendingSegments(50)).length);
      setSyncError(null);
      setLastSyncedAt(Date.now());
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      syncing.current = false;
    }
  }, [deviceId, status]);

  /** Close anything a crash, a kill or a reboot left open, then sync it. */
  const recover = useCallback(async () => {
    const closed = await Tracker.recover();
    if (closed.length) setInterrupted((prev) => [...prev, ...closed]);
    await refreshState();
    await sync();
  }, [refreshState, sync]);

  useEffect(() => {
    if (status !== "signedIn") return;
    void recover();
  }, [status, recover]);

  // Re-check on every return to the foreground: that is the only moment we can
  // discover the service was killed while the app was away.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active" && status === "signedIn") void recover();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [recover, status]);

  // Display poll. This reads Kotlin's monotonic count — it does NOT advance a
  // local counter, so a suspended JS runtime costs display freshness, never time.
  useEffect(() => {
    if (!state.tracking) return;
    const id = setInterval(() => void refreshState(), POLL_MS);
    return () => clearInterval(id);
  }, [state.tracking, refreshState]);

  // Heartbeat keeps this device's presence fresh so the backend does not treat
  // the session as dead and let another device take it over.
  useEffect(() => {
    if (!state.tracking || !state.sessionId || status !== "signedIn") return;
    const sessionId = state.sessionId;
    const beat = () => {
      api.heartbeat(sessionId).catch(() => {
        /* offline: the session is already in the ledger, nothing is lost */
      });
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [state.tracking, state.sessionId, status]);

  const start = useCallback(
    async (project: Project, task: Task | null) => {
      const sessionId = randomUUID();
      const label = task ? `${project.name} · ${task.title}` : project.name;

      // Kotlin opens the segment and takes the process into the foreground
      // BEFORE the network is touched: if registration fails we still have a
      // correct local record to replay, which is the whole offline-first point.
      await Tracker.start(sessionId, project.id, task?.id ?? null, label);
      await refreshState();

      try {
        await api.startSession({
          id: sessionId,
          startedAt: new Date().toISOString(),
          projectId: project.id,
          taskId: task?.id,
          deviceId,
          platform: "android",
          appVersion: APP_VERSION,
        });
        setSyncError(null);
      } catch (err) {
        // A 409 means a live timer on another device — surface it, but the local
        // segment stands; the user is told and can stop the other one.
        setSyncError(err instanceof Error ? err.message : "Couldn't register this session yet.");
      }
    },
    [deviceId, refreshState]
  );

  const stop = useCallback(async () => {
    await Tracker.stop("stopped");
    await refreshState();
    await sync();
  }, [refreshState, sync]);

  const acknowledgeInterrupted = useCallback(() => setInterrupted([]), []);

  const value = useMemo<TrackerValue>(
    () => ({
      state,
      available: Tracker.isAvailable,
      interrupted,
      pendingCount,
      syncError,
      lastSyncedAt,
      start,
      stop,
      sync,
      acknowledgeInterrupted,
    }),
    [state, interrupted, pendingCount, syncError, lastSyncedAt, start, stop, sync, acknowledgeInterrupted]
  );

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>;
}

export function useTracker() {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useTracker must be used inside <TrackerProvider>");
  return ctx;
}
