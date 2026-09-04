/**
 * The TraxStaff lockup: the mark, then the wordmark.
 *
 * The proportions are fixed here rather than at each call site: the mark stands
 * 1.4x the wordmark's cap height (35px against 25px) and the gap is 0.30 of
 * that cap (7.5px). Centring does the rest, because for Space Grotesk the
 * ascent minus the descent is very nearly the cap height, so the middle of the
 * line box and the middle of the capitals coincide.
 *
 * 1.4 rather than the 1.6 a diamond- or square-shaped mark can carry: ours is a
 * filled circle, and a circle covers far more area than an open cluster of the
 * same height, so the same number makes it the heavier of the two objects. The
 * gap is tighter than the usual third of a cap for the same reason — a circle's
 * edge curves away from the wordmark, so a measured gap reads wider than it is.
 *
 * They live in one component because the last time they were copied per page,
 * two surfaces were left behind on the old numbers and the lockup looked
 * different depending on where you met it.
 *
 * Uses `mark-color.svg` — the mark cropped to its own ink — not the badge. The
 * badge's white disc is invisible on these pages, which turns its padding into
 * dead space and pushes the wordmark away from the mark.
 *
 * The 0.8px lift is optical, not geometric. Centring puts the mark's *box* on
 * the cap band, but our mark carries a solid block in its lower right, so its
 * centre of mass sits below its box centre — measured at 0.03 of a cap height
 * below the wordmark's own centre of mass. The lift cancels exactly that. It is
 * deliberately tiny: the box centring is what does the work, and this is the
 * last fraction of it.
 */
export default function Lockup({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[7.5px] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mark-color.svg"
        alt=""
        aria-hidden
        width={35}
        height={35}
        className="h-[35px] w-[35px]"
        style={{ transform: "translateY(-0.8px)" }}
      />
      {/* A hair lower than centring puts it. The mark reads as sitting a touch
          high against the capitals otherwise; 1px is the whole correction, and
          it moves the word, not the mark. */}
      <span className="font-heading text-4xl font-bold tracking-tight" style={{ transform: "translateY(1px)" }}>
        TraxStaff
      </span>
    </span>
  );
}
