package expo.modules.traxtracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlin.concurrent.thread

/**
 * Detects that a reboot (or an app update) ended a running timer.
 *
 * It deliberately does NOT restart the foreground service. Starting an FGS from
 * `BOOT_COMPLETED` is blocked on API 35/36 and would throw — and even where it
 * is allowed it would silently resume a timer the user did not restart, which is
 * exactly the phantom-time behaviour Trax refuses to ship.
 *
 * What it does instead: close the orphaned segment honestly (credited only up to
 * the last checkpoint recorded in the previous boot, never by differencing
 * `elapsedRealtimeNanos` across boots) and tell the user tracking stopped.
 */
class BootReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val kind = when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED -> "boot_completed"
      Intent.ACTION_MY_PACKAGE_REPLACED -> "package_replaced"
      else -> return
    }
    val app = context.applicationContext
    val pending = goAsync()

    thread(name = "trax-boot-recovery") {
      try {
        val ledger = Ledger.get(app)
        ledger.event(app, kind, null, "device restarted or app updated")
        // No service can be running this early, so nothing is exempt from
        // recovery.
        val recovered = ledger.recover(app, liveSegmentId = null)
        if (recovered.isNotEmpty()) {
          val minutes = recovered.sumOf { it.creditedSeconds ?: 0.0 }.toLong() / 60
          TraxNotifications.interrupted(
            app,
            if (kind == "boot_completed") {
              "Your device restarted while a timer was running. $minutes min was saved — open Trax to start again."
            } else {
              "Trax was updated while a timer was running. $minutes min was saved — open Trax to start again."
            }
          )
        }
      } catch (e: Throwable) {
        Log.e("TraxBootReceiver", "recovery failed", e)
      } finally {
        pending.finish()
      }
    }
  }
}
