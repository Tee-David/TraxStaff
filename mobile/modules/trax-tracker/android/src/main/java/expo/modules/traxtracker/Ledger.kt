package expo.modules.traxtracker

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log

/**
 * Append-only local ledger of tracked segments and tamper events.
 *
 * Written exclusively by Kotlin — the service, the module and the broadcast
 * receivers. JS only ever reads it and marks rows synced. That is not stylistic:
 * a broadcast receiver and the foreground service both run in situations where
 * the React Native runtime does not exist, so anything JS-owned would silently
 * lose those writes.
 *
 * "Append-only" is enforced by triggers rather than convention: rows cannot be
 * deleted, a closed segment cannot be reopened or re-timed, and an event is
 * immutable apart from its sync marker.
 */
internal class Ledger private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT,
        boot_id INTEGER NOT NULL,
        started_elapsed_nanos INTEGER NOT NULL,
        started_wall_ms INTEGER NOT NULL,
        -- Liveness checkpoint, refreshed by the service. If the process is
        -- killed outright the segment is later credited only up to here, which
        -- is the honest answer: we know it was alive at that instant and we do
        -- not know it was alive afterwards.
        tick_elapsed_nanos INTEGER NOT NULL,
        tick_wall_ms INTEGER NOT NULL,
        ended_elapsed_nanos INTEGER,
        ended_wall_ms INTEGER,
        credited_seconds REAL,
        close_reason TEXT,
        synced_at INTEGER
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        boot_id INTEGER NOT NULL,
        elapsed_nanos INTEGER NOT NULL,
        wall_ms INTEGER NOT NULL,
        session_id TEXT,
        detail TEXT,
        synced_at INTEGER
      )
      """.trimIndent()
    )
    db.execSQL("CREATE INDEX idx_segments_open ON segments (close_reason)")
    db.execSQL("CREATE INDEX idx_segments_sync ON segments (synced_at)")

    // Append-only enforcement.
    db.execSQL(
      """
      CREATE TRIGGER segments_no_delete BEFORE DELETE ON segments
      BEGIN SELECT RAISE(ABORT, 'trax ledger is append-only'); END
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TRIGGER segments_immutable BEFORE UPDATE ON segments
      WHEN OLD.close_reason IS NOT NULL
        AND (NEW.close_reason IS NOT OLD.close_reason
          OR NEW.credited_seconds IS NOT OLD.credited_seconds
          OR NEW.ended_elapsed_nanos IS NOT OLD.ended_elapsed_nanos
          OR NEW.started_elapsed_nanos IS NOT OLD.started_elapsed_nanos
          OR NEW.session_id IS NOT OLD.session_id
          OR NEW.boot_id IS NOT OLD.boot_id)
      BEGIN SELECT RAISE(ABORT, 'closed segments are immutable'); END
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT, 'trax ledger is append-only'); END
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TRIGGER events_immutable BEFORE UPDATE ON events
      WHEN NEW.kind IS NOT OLD.kind OR NEW.wall_ms IS NOT OLD.wall_ms
        OR NEW.elapsed_nanos IS NOT OLD.elapsed_nanos OR NEW.boot_id IS NOT OLD.boot_id
      BEGIN SELECT RAISE(ABORT, 'events are immutable'); END
      """.trimIndent()
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // No destructive migrations: the ledger is evidence. Future versions add
    // columns/tables here.
  }

  // ---- segments ---------------------------------------------------------

  fun openSegment(context: Context, sessionId: String, projectId: String, taskId: String?): Long {
    val now = Clock.elapsedNanos()
    val wall = Clock.wallMs()
    val values = ContentValues().apply {
      put("session_id", sessionId)
      put("project_id", projectId)
      put("task_id", taskId)
      put("boot_id", Clock.bootId(context))
      put("started_elapsed_nanos", now)
      put("started_wall_ms", wall)
      put("tick_elapsed_nanos", now)
      put("tick_wall_ms", wall)
    }
    return writableDatabase.insertOrThrow("segments", null, values)
  }

  /** Refresh the liveness checkpoint of the open segment. */
  fun tick(segmentId: Long) {
    val values = ContentValues().apply {
      put("tick_elapsed_nanos", Clock.elapsedNanos())
      put("tick_wall_ms", Clock.wallMs())
    }
    writableDatabase.update("segments", values, "id = ? AND close_reason IS NULL", arrayOf(segmentId.toString()))
  }

  /**
   * Close a segment and compute its credited seconds.
   *
   * @param atNanos monotonic reading to close at, or null to use "now".
   * Cross-boot closes must pass the segment's own last tick — see [recover].
   */
  fun closeSegment(context: Context, segmentId: Long, reason: String, atNanos: Long? = null): Row? {
    val row = segment(segmentId) ?: return null
    if (row.closeReason != null) return row

    val currentBoot = Clock.bootId(context)
    val sameBoot = currentBoot == row.bootId
    val endNanos = atNanos ?: if (sameBoot) Clock.elapsedNanos() else row.tickElapsedNanos

    // THE bug this module exists to avoid: elapsedRealtimeNanos restarts at zero
    // on reboot, so subtracting a reading from a previous boot produces garbage
    // (usually negative). Never diff across bootIds — credit up to the last
    // checkpoint recorded inside the segment's own boot instead.
    val credited = Clock.creditedSeconds(row.startedElapsedNanos, endNanos)

    val values = ContentValues().apply {
      put("ended_elapsed_nanos", endNanos)
      // Wall-clock end is derived from the checkpoint plus the monotonic delta,
      // not read from the clock, so a clock change cannot move it.
      put("ended_wall_ms", row.startedWallMs + (credited * 1000.0).toLong())
      put("credited_seconds", credited)
      put("close_reason", reason)
    }
    writableDatabase.update("segments", values, "id = ? AND close_reason IS NULL", arrayOf(segmentId.toString()))
    return segment(segmentId)
  }

  fun openSegmentRow(): Row? = query("close_reason IS NULL", null, "id DESC").firstOrNull()

  fun segment(id: Long): Row? = query("id = ?", arrayOf(id.toString()), "id DESC").firstOrNull()

  fun pendingSegments(limit: Int): List<Row> =
    query("close_reason IS NOT NULL AND synced_at IS NULL", null, "id ASC", limit)

  fun markSegmentSynced(id: Long) {
    val values = ContentValues().apply { put("synced_at", Clock.wallMs()) }
    writableDatabase.update("segments", values, "id = ?", arrayOf(id.toString()))
  }

  /**
   * Close any segment left open by a crash, an OEM process kill or a reboot.
   *
   * @param liveSegmentId the segment the running service currently owns, which
   * must be left alone.
   */
  fun recover(context: Context, liveSegmentId: Long?): List<Row> {
    val currentBoot = Clock.bootId(context)
    val recovered = mutableListOf<Row>()
    for (row in query("close_reason IS NULL", null, "id ASC")) {
      if (row.id == liveSegmentId) continue
      val reason = if (row.bootId != currentBoot) "recovered_after_reboot" else "recovered_after_kill"
      // Both cases credit only to the last checkpoint: after a reboot the old
      // boot's counter is unusable, and after a kill we have no evidence of
      // anything past the last tick.
      closeSegment(context, row.id, reason, atNanos = row.tickElapsedNanos)?.let { recovered += it }
      event(
        context,
        kind = reason,
        sessionId = row.sessionId,
        detail = "segment ${row.id} left open (bootId ${row.bootId} -> $currentBoot)"
      )
    }
    return recovered
  }

  // ---- events -----------------------------------------------------------

  fun event(context: Context, kind: String, sessionId: String?, detail: String?): Long {
    val values = ContentValues().apply {
      put("kind", kind)
      put("boot_id", Clock.bootId(context))
      put("elapsed_nanos", Clock.elapsedNanos())
      put("wall_ms", Clock.wallMs())
      put("session_id", sessionId)
      put("detail", detail)
    }
    return try {
      writableDatabase.insertOrThrow("events", null, values)
    } catch (e: Throwable) {
      Log.e(TAG, "failed to record event $kind", e)
      -1L
    }
  }

  fun pendingEvents(limit: Int): List<EventRow> {
    val out = mutableListOf<EventRow>()
    readableDatabase.query(
      "events", null, "synced_at IS NULL", null, null, null, "id ASC", limit.toString()
    ).use { c ->
      while (c.moveToNext()) out += c.toEventRow()
    }
    return out
  }

  fun markEventSynced(id: Long) {
    val values = ContentValues().apply { put("synced_at", Clock.wallMs()) }
    writableDatabase.update("events", values, "id = ?", arrayOf(id.toString()))
  }

  // ---- plumbing ---------------------------------------------------------

  private fun query(where: String, args: Array<String>?, order: String, limit: Int? = null): List<Row> {
    val out = mutableListOf<Row>()
    readableDatabase.query("segments", null, where, args, null, null, order, limit?.toString()).use { c ->
      while (c.moveToNext()) out += c.toRow()
    }
    return out
  }

  data class Row(
    val id: Long,
    val sessionId: String,
    val projectId: String,
    val taskId: String?,
    val bootId: Long,
    val startedElapsedNanos: Long,
    val startedWallMs: Long,
    val tickElapsedNanos: Long,
    val tickWallMs: Long,
    val endedWallMs: Long?,
    val creditedSeconds: Double?,
    val closeReason: String?,
    val syncedAt: Long?
  ) {
    /** Shape handed to JS. Monotonic nanos are deliberately not exported: they
     *  are meaningless outside this process and large enough to lose precision
     *  as a JS number. */
    fun toMap(): Map<String, Any?> = mapOf(
      "id" to id,
      "sessionId" to sessionId,
      "projectId" to projectId,
      "taskId" to taskId,
      "bootId" to bootId,
      "startedWallMs" to startedWallMs,
      "endedWallMs" to endedWallMs,
      "creditedSeconds" to creditedSeconds,
      "closeReason" to closeReason,
      "synced" to (syncedAt != null)
    )
  }

  data class EventRow(
    val id: Long,
    val kind: String,
    val bootId: Long,
    val wallMs: Long,
    val sessionId: String?,
    val detail: String?,
    val syncedAt: Long?
  ) {
    fun toMap(): Map<String, Any?> = mapOf(
      "id" to id,
      "kind" to kind,
      "bootId" to bootId,
      "wallMs" to wallMs,
      "sessionId" to sessionId,
      "detail" to detail,
      "synced" to (syncedAt != null)
    )
  }

  private fun Cursor.toRow() = Row(
    id = getLong(getColumnIndexOrThrow("id")),
    sessionId = getString(getColumnIndexOrThrow("session_id")),
    projectId = getString(getColumnIndexOrThrow("project_id")),
    taskId = getStringOrNull("task_id"),
    bootId = getLong(getColumnIndexOrThrow("boot_id")),
    startedElapsedNanos = getLong(getColumnIndexOrThrow("started_elapsed_nanos")),
    startedWallMs = getLong(getColumnIndexOrThrow("started_wall_ms")),
    tickElapsedNanos = getLong(getColumnIndexOrThrow("tick_elapsed_nanos")),
    tickWallMs = getLong(getColumnIndexOrThrow("tick_wall_ms")),
    endedWallMs = getLongOrNull("ended_wall_ms"),
    creditedSeconds = getDoubleOrNull("credited_seconds"),
    closeReason = getStringOrNull("close_reason"),
    syncedAt = getLongOrNull("synced_at")
  )

  private fun Cursor.toEventRow() = EventRow(
    id = getLong(getColumnIndexOrThrow("id")),
    kind = getString(getColumnIndexOrThrow("kind")),
    bootId = getLong(getColumnIndexOrThrow("boot_id")),
    wallMs = getLong(getColumnIndexOrThrow("wall_ms")),
    sessionId = getStringOrNull("session_id"),
    detail = getStringOrNull("detail"),
    syncedAt = getLongOrNull("synced_at")
  )

  private fun Cursor.getStringOrNull(name: String): String? {
    val i = getColumnIndexOrThrow(name)
    return if (isNull(i)) null else getString(i)
  }

  private fun Cursor.getLongOrNull(name: String): Long? {
    val i = getColumnIndexOrThrow(name)
    return if (isNull(i)) null else getLong(i)
  }

  private fun Cursor.getDoubleOrNull(name: String): Double? {
    val i = getColumnIndexOrThrow(name)
    return if (isNull(i)) null else getDouble(i)
  }

  companion object {
    private const val TAG = "TraxLedger"
    private const val DB_NAME = "trax_ledger.db"
    private const val DB_VERSION = 1

    @Volatile
    private var instance: Ledger? = null

    /** One helper per process. The service, the receivers and the module all
     *  share it so SQLite's own locking is the only coordination needed. */
    fun get(context: Context): Ledger =
      instance ?: synchronized(this) {
        instance ?: Ledger(context).also { instance = it }
      }
  }
}
