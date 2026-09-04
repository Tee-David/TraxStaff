/**
 * The TraxStaff lockup — mark, then wordmark — with the spacing decided here
 * once instead of re-guessed at every call site.
 *
 * What kept going wrong: `icon-badge.svg` draws the mark on a white disc, and
 * the mark covers only 52% of that box. On a dark background that padding is
 * the disc and reads as intentional; on a white one the disc disappears and
 * the padding becomes invisible margin, so a 12px CSS gap rendered as a 28px
 * hole and the mark looked adrift and undersized in a box twice its size.
 *
 * Hence two marks, each sized by what a reader actually sees:
 *   `mark`  — the art cropped to its own ink, for light surfaces.
 *   `badge` — the disc, for dark or busy ones, where the disc *is* the shape.
 * Either way the height a caller asks for is the height on screen, and the gap
 * scales with the mark rather than being a fixed pixel count that only suits
 * one size.
 *
 * Vertical alignment is plain centring, which for Space Grotesk lands within
 * half a pixel of the cap-height centre: its ascent minus its descent is very
 * nearly its cap height, so the middle of the line box and the middle of the
 * capitals coincide. A mark that still looks low in a lockup is an asset whose
 * art sits off-centre in its own box — fix it there, not with a nudge here.
 */

const MARKS = {
  // 1em: the mark stands exactly as tall as the type is nominally set, which
  // puts it about 1.4x the cap height — enough to hold its own against a bold
  // wordmark without growing into a second focal point.
  mark: { src: "/brand/mark-color.svg", height: 1, gap: 0.36 },
  // A circle can sit slightly closer than a square before the gap reads as
  // tight, so the badge takes the smaller share of its (much larger) height.
  badge: { src: "/brand/icon-badge.svg", height: 1.8, gap: 0.3 },
} as const;

export interface BrandLockupProps {
  /** Which mark to use — see the note above; defaults to the bare mark. */
  variant?: keyof typeof MARKS;
  /** Mark height in `em`, relative to the wordmark. Defaults per variant. */
  markHeight?: number;
  /** Sizing and colour for the lockup as a whole (font-size lives here). */
  className?: string;
  /** Extra classes for the wordmark only — tracking, colour transitions. */
  wordmarkClassName?: string;
}

export default function BrandLockup({
  variant = "mark",
  markHeight,
  className = "",
  wordmarkClassName = "",
}: BrandLockupProps) {
  const spec = MARKS[variant];
  const height = markHeight ?? spec.height;

  return (
    // `align-middle` matters when the lockup is dropped straight into an inline
    // context (a bare link): an inline-flex box would otherwise hang off its
    // first item's baseline — the bottom of the mark — and push the line box
    // around it.
    <span className={`inline-flex items-center align-middle ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={spec.src}
        alt=""
        aria-hidden
        className="shrink-0 select-none"
        style={{ height: `${height}em`, width: `${height}em`, marginRight: `${height * spec.gap}em` }}
      />
      <span className={`font-heading font-bold tracking-[-0.03em] ${wordmarkClassName}`}>TraxStaff</span>
    </span>
  );
}
