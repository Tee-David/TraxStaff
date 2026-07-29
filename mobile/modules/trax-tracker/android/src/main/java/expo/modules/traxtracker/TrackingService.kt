package expo.modules.traxtracker

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Holds the process alive for the length of a shift and keeps the ledger's
 * liveness checkpoint fresh.
 *
 * Declared `specialUse` rather than `dataSync`: Android 15 caps `dataSync`
 * foreground services at 6 hours per 24 hours app-wide, and an 8-hour shift
 * simply does not fit in that. The justification Play reads is
 * `R.string.trax_fgs_subtype`.
 *
 * The service does not itself measure anything — [Clock] does, and every
 * measurement lands in [Ledger]. The service's only job is to make sure the
 * process is still around to write those checkpoints.
 */
class TrackingService : Service() {

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var segmentId: Long = -1L
  private var startedElapsedNanos: Long = 0L

  private val ticker = object : Runnable {
    override fun run() {
      if (segmentId > 0) Ledger.get(applicationContext).tick(segmentId)
      handler?.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // START_NOT_STICKY means a null intent here can only be a system restart we
    // did not ask for; there is nothing safe to resume, so bow out.
    if (intent == null) {
      stopSelf()
      return START_NOT_STICKY
    }

    segmentId = intent.getLongExtra(EXTRA_SEGMENT_ID, -1L)
    startedElapsedNanos = intent.getLongExtra(EXTRA_STARTED_NANOS, Clock.elapsedNanos())
    val label = intent.getStringExtra(EXTRA_LABEL) ?: "Tracking"
    runningSessionId = intent.getStringExtra(EXTRA_SESSION_ID)
    runningSegmentId = segmentId

    val notification = TraxNotifications.tracking(this, label, startedElapsedNanos)
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    } else {
      0
    }
    ServiceCompat.startForeground(this, TraxNotifications.TRACKING_NOTIFICATION_ID, notification, type)

    startTicking()

    // NOT sticky on purpose. A sticky restart would try to re-enter the
    // foreground from the background, which API 31+ blocks, and it would resume
    // a timer the user never restarted. A kill is instead detected on next
    // launch (Ledger.recover) and surfaced honestly.
    return START_NOT_STICKY
  }

  private fun startTicking() {
    if (thread != null) return
    // SQLite writes must not run on the main thread; the checkpoint is a write
    // every 30 seconds for a whole shift.
    val t = HandlerThread("trax-tracker-tick").also { it.start() }
    thread = t
    handler = Handler(t.looper).also { it.post(ticker) }
  }

  override fun onDestroy() {
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    handler = null
    thread = null

    // Normal stop closes the segment before stopping the service, so this is a
    // no-op then. It only bites when the system tears the service down under us.
    if (segmentId > 0) {
      val ledger = Ledger.get(applicationContext)
      val row = ledger.segment(segmentId)
      if (row != null && row.closeReason == null) {
        ledger.closeSegment(applicationContext, segmentId, "service_destroyed")
        ledger.event(applicationContext, "service_destroyed", row.sessionId, "foreground service torn down")
        TraxNotifications.interrupted(this, "The system stopped your Trax timer. Time up to that point was saved.")
      }
    }

    runningSessionId = null
    runningSegmentId = null
    segmentId = -1L
    super.onDestroy()
  }

  companion object {
    private const val TAG = "TraxTrackingService"
    private const val TICK_MS = 30_000L

    private const val EXTRA_SEGMENT_ID = "segmentId"
    private const val EXTRA_SESSION_ID = "sessionId"
    private const val EXTRA_STARTED_NANOS = "startedNanos"
    private const val EXTRA_LABEL = "label"

    /** Read by the module so recovery can tell "still running" from "killed". */
    @Volatile
    var runningSessionId: String? = null
      private set

    @Volatile
    var runningSegmentId: Long? = null
      private set

    fun start(
      context: Context,
      segmentId: Long,
      sessionId: String,
      startedElapsedNanos: Long,
      label: String
    ): Boolean {
      val intent = Intent(context, TrackingService::class.java)
        .putExtra(EXTRA_SEGMENT_ID, segmentId)
        .putExtra(EXTRA_SESSION_ID, sessionId)
        .putExtra(EXTRA_STARTED_NANOS, startedElapsedNanos)
        .putExtra(EXTRA_LABEL, label)
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (e: Throwable) {
        // e.g. ForegroundServiceStartNotAllowedException if something started
        // the timer while the app was in the background. Report it rather than
        // leaving a segment open with nothing keeping the process alive.
        Log.e(TAG, "could not start foreground service", e)
        false
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, TrackingService::class.java))
    }
  }
}
