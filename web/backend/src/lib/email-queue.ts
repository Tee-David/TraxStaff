/**
 * Durable outbox for outgoing mail, with retries.
 *
 * Why this exists at all: this API runs on an instance that hibernates. Mail
 * used to be a fire-and-forget call — build the message, hand it to the relay,
 * turn any failure into `false`, log a line, move on. Three things fell through
 * that gap, and all three were invisible:
 *
 *   1. A relay or SMTP failure was final. Nothing retried, ever.
 *   2. The digest scheduler recorded a Notification row BEFORE sending, so a
 *      failed send was permanently marked as sent — the period could never come
 *      round again.
 *   3. A digest whose local send hour passed while the instance was asleep was
 *      lost outright, because the only thing that would have sent it was a tick
 *      of a `setInterval` in a process that did not exist.
 *
 * A row in `OutboundEmail` fixes all three: it outlives the process, so the
 * worker below drains it on the next boot — which, on a hibernating instance, is
 * precisely the moment sending becomes possible again.
 *
 * Deliberately NOT a general-purpose job queue. There is one worker, one row at
 * a time, no locking: a second instance would at worst re-send a message whose
 * row it read before the first marked it sent, and `dedupeKey` plus the small
 * batch size make that both unlikely and harmless. Anything stronger would need
 * `SELECT ... FOR UPDATE SKIP LOCKED` and a schema this database cannot be
 * relied upon to accept.
 */
import { prisma } from "./prisma";

/** How often the worker looks for mail to send once the server is up. */
export const QUEUE_INTERVAL_MS = 60_000;

/**
 * Attempts before a message is given up on as `failed`.
 *
 * Twelve, because the eleven waits between them have to add up to more than a
 * night: doubling from one minute and capped at six hours, they span a little
 * over twenty hours in total. Eight attempts — the first guess — covered only
 * about two, which would have given up before the morning it exists to survive.
 * Still bounded, so a genuinely undeliverable address stops being retried within
 * the day rather than forever.
 */
export const MAX_ATTEMPTS = 12;

/** Messages sent per pass. Small on purpose: one relay, one Vercel function. */
export const BATCH_SIZE = 25;

/**
 * How long a message stays worth sending, when the caller does not say.
 *
 * Two days covers a weekend of hibernation. Callers whose content goes stale
 * faster pass their own — a password-reset link outlives its usefulness in an
 * hour, and mailing it afterwards is worse than not mailing it at all.
 */
export const DEFAULT_TTL_MS = 48 * 3_600_000;

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

export type OutboundMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The mailer's label, e.g. "daily shortfall digest". Used in logs. */
  kind: string;
  /**
   * Idempotency key. Set it whenever a message is derived from a period or an
   * event that could be re-derived — the unique index then makes a duplicate
   * physically impossible. Leave it unset for mail that legitimately repeats
   * (a re-sent invite, a second password reset).
   */
  dedupeKey?: string;
  /** Overrides `DEFAULT_TTL_MS` for content that goes stale sooner. */
  ttlMs?: number;
};

export type DeliveryResult = { ok: true } | { ok: false; error: string };

/** The actual transport. Injected so this module never imports the mailer — it
 *  is the mailer that depends on the queue, and the cycle has to break here. */
export type Deliver = (message: OutboundMessage) => Promise<DeliveryResult>;

export type EnqueueResult =
  | { state: "queued"; id: string }
  | { state: "duplicate" }
  | { state: "unavailable" };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Reserved domains that cannot receive mail, ever (RFC 2606 / RFC 6761).
 *
 * Worth a hard check rather than letting the SMTP server decide, because the
 * cost is not one wasted send: the receiving side accepts the message and then
 * hard-bounces it, and a stream of bounces is exactly what pushes a sending
 * domain's real mail into spam folders. Seed and demo data is full of these —
 * `admin@trax.test` was a live owner on this deployment, mailed every single
 * digest.
 */
const RESERVED_TLDS = ["test", "example", "invalid", "localhost", "local"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

export function isUndeliverable(to: string): boolean {
  const at = to.lastIndexOf("@");
  if (at < 0) return true; // not an address at all
  const domain = to.slice(at + 1).toLowerCase();
  if (RESERVED_DOMAINS.includes(domain)) return true;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return RESERVED_TLDS.includes(tld);
}

/**
 * Delay before attempt number `attempts`, doubling from a minute and capped at
 * six hours.
 *
 * Capped rather than unbounded because the thing being waited out is usually
 * hibernation, and an instance that has just woken should try again within the
 * hour rather than in a day and a half.
 */
export function backoffMs(attempts: number): number {
  const step = 60_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(step, 6 * 3_600_000);
}

/**
 * Writes the message to the outbox.
 *
 * Three outcomes, and the caller has to treat them differently:
 *   - `queued`     — durable; try it now, and the worker will retry if that fails
 *   - `duplicate`  — this exact message is already queued or already sent
 *   - `unavailable` — the outbox itself could not be written to
 *
 * `unavailable` is the important one. The table is created on boot by
 * ensure-schema.ts against a database that has drifted from schema.prisma, so
 * "the outbox does not exist yet" is a real state — and it must never stop an
 * invite or a password reset going out. lib/mailer.ts responds by sending
 * directly, exactly as it did before this queue existed.
 */
export async function enqueue(msg: OutboundMessage, log: Logger): Promise<EnqueueResult> {
  const ttl = msg.ttlMs ?? DEFAULT_TTL_MS;
  try {
    const row = await prisma.outboundEmail.create({
      data: {
        recipient: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        kind: msg.kind,
        dedupeKey: msg.dedupeKey ?? null,
        expiresAt: new Date(Date.now() + ttl),
      },
      select: { id: true },
    });
    return { state: "queued", id: row.id };
  } catch (err) {
    // P2002 is the unique violation on dedupeKey: someone already queued this
    // exact message. That is a success for the caller, not an error.
    if ((err as { code?: string }).code === "P2002") return { state: "duplicate" };
    log.warn(
      `[email-queue] could not queue ${msg.kind} for ${msg.to} (${message(
        err
      )}) — falling back to sending it directly, with no retry.`
    );
    return { state: "unavailable" };
  }
}

/**
 * Records the outcome of one delivery attempt.
 *
 * A failure that has run out of attempts becomes `failed` rather than staying
 * `pending` forever, so the queue cannot grow a permanent tail of addresses that
 * will never accept mail — and so `lastError` is still there to explain why.
 */
export async function recordAttempt(
  row: { id: string; attempts: number },
  result: DeliveryResult,
  log: Logger
): Promise<void> {
  const attempts = row.attempts + 1;
  const data = result.ok
    ? { status: "sent", attempts, sentAt: new Date(), lastError: null }
    : {
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts,
        lastError: result.error.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      };

  try {
    await prisma.outboundEmail.update({ where: { id: row.id }, data });
  } catch (err) {
    // The mail itself may well have gone out; only the bookkeeping failed. Say
    // so and carry on — the worst case is one duplicate on a later pass, which
    // `dedupeKey` prevents for everything that sets one.
    log.warn(`[email-queue] could not record the outcome for ${row.id}: ${message(err)}`);
  }
}

/**
 * Sends whatever is due, oldest first.
 *
 * Sequential rather than parallel: every message goes through one relay function
 * on one SMTP connection, and firing twenty-five at once is how you get rate
 * limited by your own mail host.
 */
export async function drainQueue(
  log: Logger,
  deliver: Deliver,
  now: Date = new Date()
): Promise<{ sent: number; retry: number; failed: number; expired: number }> {
  const tally = { sent: 0, retry: 0, failed: 0, expired: 0 };

  let rows: {
    id: string;
    recipient: string;
    subject: string;
    html: string;
    text: string;
    kind: string;
    attempts: number;
    expiresAt: Date | null;
  }[];
  try {
    rows = await prisma.outboundEmail.findMany({
      where: { status: "pending", nextAttemptAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      // Explicit select, never a bare findMany: a not-yet-migrated column must
      // not be able to take the whole worker down (the rule routes/sync.ts
      // states outright).
      select: {
        id: true,
        recipient: true,
        subject: true,
        html: true,
        text: true,
        kind: true,
        attempts: true,
        expiresAt: true,
      },
    });
  } catch (err) {
    // Almost always "the table does not exist yet". Nothing to do but say so.
    log.warn(`[email-queue] could not read the outbox: ${message(err)}`);
    return tally;
  }

  if (rows.length === 0) return tally;

  for (const row of rows) {
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      tally.expired++;
      try {
        await prisma.outboundEmail.update({
          where: { id: row.id },
          data: { status: "expired", lastError: "expired before it could be delivered" },
        });
      } catch (err) {
        log.warn(`[email-queue] could not expire ${row.id}: ${message(err)}`);
      }
      log.warn(
        `[email-queue] gave up on ${row.kind} to ${row.recipient} — it went stale before it could be sent.`
      );
      continue;
    }

    const result = await deliver({
      to: row.recipient,
      subject: row.subject,
      html: row.html,
      text: row.text,
      kind: row.kind,
    });
    await recordAttempt(row, result, log);

    if (result.ok) {
      tally.sent++;
      log.info(`[email-queue] sent ${row.kind} to ${row.recipient} on attempt ${row.attempts + 1}`);
      continue;
    }

    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      tally.failed++;
      log.warn(
        `[email-queue] giving up on ${row.kind} to ${row.recipient} after ${attempts} attempts: ${result.error}`
      );
    } else {
      tally.retry++;
      log.warn(
        `[email-queue] ${row.kind} to ${row.recipient} failed (attempt ${attempts}), retrying in ${Math.round(
          backoffMs(attempts) / 60_000
        )}m: ${result.error}`
      );
    }
  }

  return tally;
}

/**
 * Starts the worker.
 *
 * Runs once immediately, and that first pass is the whole point of the design:
 * on an instance that hibernates, boot is the first moment anything queued while
 * it was asleep can actually be sent. The interval afterwards handles the
 * ordinary case of a relay that was briefly unreachable.
 */
export function startEmailQueueWorker(log: Logger, deliver: Deliver): void {
  const run = () =>
    drainQueue(log, deliver)
      .then((t) => {
        if (t.sent || t.retry || t.failed || t.expired) {
          log.info(
            `[email-queue] pass complete: ${t.sent} sent, ${t.retry} to retry, ${t.failed} failed, ${t.expired} expired`
          );
        }
      })
      .catch((err) => log.warn(`[email-queue] pass failed: ${message(err)}`));

  void run();
  const timer = setInterval(run, QUEUE_INTERVAL_MS);
  // Never hold the process open on its own account, exactly as the sweeper and
  // the digest scheduler do.
  timer.unref();
}
