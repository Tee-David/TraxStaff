import { requireOptionalNativeModule } from "expo";

/**
 * Trax tracker — JS binding.
 *
 * Everything time-related here is READ-ONLY. `creditedSeconds` is computed in
 * Kotlin from `SystemClock.elapsedRealtimeNanos()` on every call; JS renders it
 * and nothing else. Do not add a `setInterval` that increments a local counter —
 * the JS runtime is suspended while the screen is off, so a JS-side counter
 * silently loses the majority of a real shift.
 */

export type TrackerState = {
  /** A segment is open in the ledger. */
  tracking: boolean;
  /** The foreground service is alive in this process. `tracking && !serviceRunning`
   *  means the timer was interrupted and is waiting to be recovered. */
  serviceRunning: boolean;
  bootId: number;
  segmentId: number | null;
  sessionId: string | null;
  projectId: string | null;
  taskId: string | null;
  startedWallMs: number | null;
  /** Authoritative elapsed time for the open segment, in seconds. */
  creditedSeconds: number;
  /** The open segment was started in a previous boot — its counter is unusable. */
  staleBoot: boolean;
};

export type TrackedSegment = {
  id: number;
  sessionId: string;
  projectId: string;
  taskId: string | null;
  bootId: number;
  startedWallMs: number;
  endedWallMs: number | null;
  creditedSeconds: number | null;
  closeReason: CloseReason | null;
  synced: boolean;
};

export type CloseReason =
  | "stopped"
  | "superseded"
  | "service_destroyed"
  | "service_start_failed"
  | "recovered_after_kill"
  | "recovered_after_reboot";

export type TamperEventKind =
  | "time_set"
  | "timezone_changed"
  | "boot_completed"
  | "package_replaced"
  | "service_destroyed"
  | "service_start_failed"
  | "recovered_after_kill"
  | "recovered_after_reboot";

export type TamperEvent = {
  id: number;
  kind: TamperEventKind;
  bootId: number;
  wallMs: number;
  sessionId: string | null;
  detail: string | null;
  synced: boolean;
};

type TraxTrackerNative = {
  getBootId(): number;
  hasNotificationPermission(): boolean;
  getState(): Promise<TrackerState>;
  start(sessionId: string, projectId: string, taskId: string | null, label: string): Promise<TrackerState>;
  stop(reason: string | null): Promise<TrackedSegment | null>;
  recover(): Promise<TrackedSegment[]>;
  pendingSegments(limit: number): Promise<TrackedSegment[]>;
  markSegmentSynced(id: number): Promise<void>;
  pendingEvents(limit: number): Promise<TamperEvent[]>;
  markEventSynced(id: number): Promise<void>;
};

// Optional: the module is Android-only, and it is absent in Expo Go and on web.
// Every caller has to cope with that rather than crashing at import time.
const native = requireOptionalNativeModule<TraxTrackerNative>("TraxTracker");

export const isTrackerAvailable = native != null;

const IDLE_STATE: TrackerState = {
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

function require_(): TraxTrackerNative {
  if (!native) {
    throw new Error(
      "The Trax tracker native module isn't in this build. Use a development build or the release APK, not Expo Go."
    );
  }
  return native;
}

export const Tracker = {
  isAvailable: isTrackerAvailable,
  bootId: () => native?.getBootId() ?? 0,
  hasNotificationPermission: () => native?.hasNotificationPermission() ?? false,
  getState: async (): Promise<TrackerState> => (native ? native.getState() : IDLE_STATE),
  start: (sessionId: string, projectId: string, taskId: string | null, label: string) =>
    require_().start(sessionId, projectId, taskId, label),
  stop: (reason: string | null = "stopped") => require_().stop(reason),
  recover: async (): Promise<TrackedSegment[]> => (native ? native.recover() : []),
  pendingSegments: async (limit = 50): Promise<TrackedSegment[]> =>
    native ? native.pendingSegments(limit) : [],
  markSegmentSynced: (id: number) => require_().markSegmentSynced(id),
  pendingEvents: async (limit = 50): Promise<TamperEvent[]> => (native ? native.pendingEvents(limit) : []),
  markEventSynced: (id: number) => require_().markEventSynced(id),
};

export default Tracker;
