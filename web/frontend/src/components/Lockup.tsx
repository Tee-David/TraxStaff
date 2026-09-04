/**
 * The TraxStaff lockup: the mark, then the wordmark.
 *
 * The proportions are fixed here rather than at each call site: the mark stands
 * 1.6x the wordmark's cap height (40px against 25px) and the gap is 0.36 of
 * that cap (9px). Those are the numbers a well-set lockup uses — the same ones
 * the Dropbox logo is built on — and centring does the rest, because for Space
 * Grotesk the ascent minus the descent is very nearly the cap height, so the
 * middle of the line box and the middle of the capitals coincide.
 *
 * They live in one component because the last time they were copied per page,
 * two surfaces were left behind on the old numbers and the lockup looked
 * different depending on where you met it.
 *
 * Uses `mark-color.svg` — the mark cropped to its own ink — not the badge. The
 * badge's white disc is invisible on these pages, which turns its padding into
 * dead space and pushes the wordmark away from the mark.
 */
export default function Lockup({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[9px] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mark-color.svg" alt="" aria-hidden width={40} height={40} className="h-10 w-10" />
      <span className="font-heading text-4xl font-bold tracking-tight">TraxStaff</span>
    </span>
  );
}
