package expo.modules.traxtracker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing surface of the tracker.
 *
 * The contract with JS is one-directional: **Kotlin counts time, JS displays
 * it.** Every duration returned here is derived from
 * `SystemClock.elapsedRealtimeNanos` inside a single boot. JS is expected to
 * poll `getState()` and render `creditedSeconds`; it must never accumulate a
 * counter of its own, because the JS runtime is suspended whenever the screen is
 * off and would quietly under-report a whole shift.
 */
class TraxTrackerModule : Module() {

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TraxTracker")

    OnCreate {
      // Channels must exist before the first startForeground call, and before
      // any recovery notification the receivers might post.
      TraxNotifications.ensureChannels(context)
    }

    Function("getBootId") { Clock.bootId(context) }

    Function("hasNotificationPermission") {
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    }

    AsyncFunction("getState") { state() }

    /**
     * Open a segment and put the process in the foreground for it.
     * `sessionId` is minted by JS (it is the server-side session id too), so the
     * ledger row and the server row can be reconciled after any failure.
     */
    AsyncFunction("start") { sessionId: String, projectId: String, taskId: String?, label: String ->
      val ledger = Ledger.get(context)

      // Anything still open that the live service does not own is debris from a
      // crash, a kill or a reboot. Close it before adding another.
      ledger.recover(context, TrackingService.runningSegmentId)

      // Same device switching project/task is not double-tracking — close the
      // current segment cleanly first, mirroring the backend's takeover rule.
      TrackingService.runningSegmentId?.let { live ->
        ledger.closeSegment(context, live, "superseded")
        TrackingService.stop(context)
      }

      val segmentId = ledger.openSegment(context, sessionId, projectId, taskId)
      val row = ledger.segment(segmentId)
        ?: throw CodedException("ERR_TRAX_LEDGER", "segment was not written", null)

      val started = TrackingService.start(context, segmentId, sessionId, row.startedElapsedNanos, label)
      if (!started) {
        // Never leave a segment open with nothing keeping the process alive —
        // it would look like a running timer that credits nothing.
        ledger.closeSegment(context, segmentId, "service_start_failed")
        ledger.event(context, "service_start_failed", sessionId, "startForegroundService refused")
        throw CodedException(
          "ERR_TRAX_FGS",
          "Android refused to start the tracking service. Open Trax and try again.",
          null
        )
      }
      state()
    }

    /** Close the open segment, then tear the service down. Order matters: the
     *  service's onDestroy treats a still-open segment as an involuntary stop. */
    AsyncFunction("stop") { reason: String? ->
      val ledger = Ledger.get(context)
      val open = ledger.openSegmentRow()
      val closed = open?.let { ledger.closeSegment(context, it.id, reason ?: "stopped") }
      TrackingService.stop(context)
      closed?.toMap()
    }

    /** Called on app foreground. Returns whatever it had to close so the UI can
     *  tell the user their timer stopped and how much was kept. */
    AsyncFunction("recover") {
      Ledger.get(context).recover(context, TrackingService.runningSegmentId).map { it.toMap() }
    }

    AsyncFunction("pendingSegments") { limit: Int ->
      Ledger.get(context).pendingSegments(limit).map { it.toMap() }
    }

    // Ids cross as Double: JS has no integer type and the Double converter is
    // the one guaranteed to round-trip.
    AsyncFunction("markSegmentSynced") { id: Double ->
      Ledger.get(context).markSegmentSynced(id.toLong())
    }

    AsyncFunction("pendingEvents") { limit: Int ->
      Ledger.get(context).pendingEvents(limit).map { it.toMap() }
    }

    AsyncFunction("markEventSynced") { id: Double ->
      Ledger.get(context).markEventSynced(id.toLong())
    }
  }

  private fun state(): Map<String, Any?> {
    val ledger = Ledger.get(context)
    val open = ledger.openSegmentRow()
    val bootId = Clock.bootId(context)

    // Credited seconds are computed here, on every read, from the monotonic
    // counter — and only when the open segment belongs to the current boot. If
    // it does not, the counter has been reset under us and the only defensible
    // number is the span up to the last checkpoint taken in the old boot.
    val credited = open?.let {
      if (it.bootId == bootId) Clock.creditedSeconds(it.startedElapsedNanos, Clock.elapsedNanos())
      else Clock.creditedSeconds(it.startedElapsedNanos, it.tickElapsedNanos)
    } ?: 0.0

    return mapOf(
      "tracking" to (open != null),
      "serviceRunning" to (TrackingService.runningSegmentId != null),
      "bootId" to bootId,
      "segmentId" to open?.id,
      "sessionId" to open?.sessionId,
      "projectId" to open?.projectId,
      "taskId" to open?.taskId,
      "startedWallMs" to open?.startedWallMs,
      "creditedSeconds" to credited,
      "staleBoot" to (open != null && open.bootId != bootId)
    )
  }
}
