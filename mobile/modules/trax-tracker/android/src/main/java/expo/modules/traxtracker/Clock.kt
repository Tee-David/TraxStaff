package expo.modules.traxtracker

import android.content.Context
import android.os.SystemClock
import android.provider.Settings

/**
 * The only sanctioned source of time in this module.
 *
 * Credited duration comes from [SystemClock.elapsedRealtimeNanos] — it counts
 * deep sleep (so an 8-hour shift on a phone in a pocket is credited correctly),
 * and it is immune to the user changing the system clock.
 *
 * Deliberately NOT used:
 *  - `SystemClock.uptimeMillis()` stops during deep sleep and would under-credit
 *    every minute the screen was off. That is the single biggest source of
 *    missing hours on a phone.
 *  - `System.currentTimeMillis()` for duration — it is user-settable.
 *  - anything in JS. `performance.now()`'s backing clock in React Native is
 *    undocumented and the JS runtime is not even alive while the screen is off.
 *    Wall-clock millis are recorded alongside the monotonic value only so a
 *    segment can be placed on a calendar, never to measure a span.
 */
internal object Clock {

  fun elapsedNanos(): Long = SystemClock.elapsedRealtimeNanos()

  fun wallMs(): Long = System.currentTimeMillis()

  /**
   * Identifies the current boot.
   *
   * `elapsedRealtimeNanos` resets to zero on every reboot, so differencing two
   * readings taken in different boots yields a negative or wildly wrong span.
   * Every credited duration in this module is therefore gated on both readings
   * carrying the same bootId.
   *
   * `Settings.Global.BOOT_COUNT` is the authoritative value. If it is
   * unavailable we fall back to the wall-clock instant of boot
   * (`now - elapsedRealtime`), quantised to a minute so that NTP jitter does not
   * make it look like a new boot. The fallback is negated so it can never
   * collide with a real BOOT_COUNT.
   */
  fun bootId(context: Context): Long {
    val count = try {
      Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
    } catch (_: Throwable) {
      -1
    }
    if (count >= 0) return count.toLong()
    val bootWallMs = System.currentTimeMillis() - SystemClock.elapsedRealtime()
    return -(bootWallMs / 60_000L)
  }

  /** Monotonic nanos → seconds, clamped. A span can never be negative. */
  fun creditedSeconds(startNanos: Long, endNanos: Long): Double {
    val span = endNanos - startNanos
    return if (span <= 0L) 0.0 else span / 1_000_000_000.0
  }
}
