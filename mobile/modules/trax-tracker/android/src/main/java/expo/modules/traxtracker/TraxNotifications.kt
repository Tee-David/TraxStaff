package expo.modules.traxtracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Trax never tracks silently. A visible, ongoing notification for the entire
 * duration of a timer is both a Play requirement for a monitoring tool and a
 * product commitment — see the disclosure screen in the app.
 */
internal object TraxNotifications {

  const val CHANNEL_TRACKING = "trax.tracking"
  const val CHANNEL_ALERTS = "trax.alerts"
  const val TRACKING_NOTIFICATION_ID = 4201
  const val ALERT_NOTIFICATION_ID = 4202

  /**
   * Will the tracking notification actually appear?
   *
   * Deliberately not `checkSelfPermission(POST_NOTIFICATIONS)`: that permission
   * does not exist below API 33, where the check reports "granted" on a device
   * that shows nothing — and on any API level the user can switch the app's
   * notifications off in Settings without revoking it. Trax promises it never
   * tracks invisibly, so the honest signal is the one the system will apply.
   */
  fun enabled(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled()

  fun ensureChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return

    // LOW: always present, never buzzes. It must not be dismissible, which the
    // foreground-service association already guarantees.
    NotificationChannel(
      CHANNEL_TRACKING,
      context.getString(R.string.trax_channel_tracking),
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = context.getString(R.string.trax_channel_tracking_desc)
      setShowBadge(false)
      manager.createNotificationChannel(this)
    }

    // DEFAULT: "your timer stopped" is time-sensitive — losing an hour because
    // the notice was silent defeats the purpose.
    NotificationChannel(
      CHANNEL_ALERTS,
      context.getString(R.string.trax_channel_alerts),
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = context.getString(R.string.trax_channel_alerts_desc)
      manager.createNotificationChannel(this)
    }
  }

  /** Intent that reopens the app's launcher activity. Resolved by package so
   *  this module never has to know the app's MainActivity class name. */
  private fun openAppIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
      context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * The ongoing tracking notification.
   *
   * The chronometer's base is derived from the segment's monotonic start, not
   * from a wall-clock timestamp, so changing the device clock cannot make the
   * displayed elapsed time jump.
   */
  fun tracking(context: Context, projectLabel: String, startedElapsedNanos: Long): Notification {
    ensureChannels(context)
    val elapsedMs = (Clock.elapsedNanos() - startedElapsedNanos) / 1_000_000L
    return NotificationCompat.Builder(context, CHANNEL_TRACKING)
      .setSmallIcon(R.drawable.ic_trax_notification)
      .setContentTitle("Trax is tracking")
      .setContentText(projectLabel)
      .setUsesChronometer(true)
      .setWhen(System.currentTimeMillis() - elapsedMs)
      .setShowWhen(true)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAppIntent(context))
      .build()
  }

  /** Posted when a running timer was ended by something other than the user. */
  fun interrupted(context: Context, reason: String) {
    ensureChannels(context)
    val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
      .setSmallIcon(R.drawable.ic_trax_notification)
      .setContentTitle("Trax stopped — tap to resume")
      .setContentText(reason)
      .setStyle(NotificationCompat.BigTextStyle().bigText(reason))
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_ERROR)
      .setContentIntent(openAppIntent(context))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(ALERT_NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted. The recovered segment is already in the
      // ledger, so the only thing lost is the nudge.
    }
  }
}
