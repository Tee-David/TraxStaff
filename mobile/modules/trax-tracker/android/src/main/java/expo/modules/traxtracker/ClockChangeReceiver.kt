package expo.modules.traxtracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlin.math.abs
import kotlin.concurrent.thread

/**
 * Records system clock and timezone changes as tamper evidence.
 *
 * `ACTION_TIME_SET` and `ACTION_TIMEZONE_CHANGED` are two of the few implicit
 * broadcasts still delivered to manifest-declared receivers, which is exactly
 * why they are used here: the signal has to be captured even when the app is not
 * running and the JS runtime does not exist.
 *
 * Nothing is blocked as a result. A clock change is recorded and surfaced for
 * review — credited duration already comes from the monotonic clock, so moving
 * the wall clock buys the user no time in the first place.
 */
class ClockChangeReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val kind = when (intent.action) {
      Intent.ACTION_TIME_CHANGED -> "time_set"
      Intent.ACTION_TIMEZONE_CHANGED -> "timezone_changed"
      else -> return
    }
    val app = context.applicationContext
    val pending = goAsync()

    // onReceive runs on the main thread with a ~10s budget; the SQLite write
    // goes to a background thread and goAsync keeps the process alive for it.
    thread(name = "trax-clock-event") {
      try {
        val ledger = Ledger.get(app)
        val open = ledger.openSegmentRow()
        val detail = if (open == null) {
          "no timer running"
        } else {
          // How far the wall clock moved relative to the monotonic clock since
          // the segment's last checkpoint. This is the number that matters:
          // a plain "the clock changed" says nothing about direction or size.
          val monotonicDeltaMs = (Clock.elapsedNanos() - open.tickElapsedNanos) / 1_000_000L
          val expectedWallMs = open.tickWallMs + monotonicDeltaMs
          val skewMs = Clock.wallMs() - expectedWallMs
          val tz = java.util.TimeZone.getDefault().id
          "session ${open.sessionId} skewMs=$skewMs tz=$tz" +
            if (abs(skewMs) > 60_000L) " (significant)" else ""
        }
        ledger.event(app, kind, open?.sessionId, detail)
      } catch (e: Throwable) {
        Log.e("TraxClockReceiver", "failed to record $kind", e)
      } finally {
        pending.finish()
      }
    }
  }
}
