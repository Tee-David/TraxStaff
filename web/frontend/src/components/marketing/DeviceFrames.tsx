import type { ReactNode } from "react";

/**
 * Device shells for the app captures.
 *
 * The captures come from a browser, so they carry no OS chrome — a phone shot
 * with no status bar reads as a web page in a rounded box. The status bars
 * below are drawn as SVG rather than markup so they scale exactly with the
 * frame, which is sized in rem and changes across breakpoints.
 *
 * They are set at 9:41 for the same reason every device mockup is: it is the
 * placeholder time, not a claim about anything.
 */

const STATUS_INK = "#12162b";
/* iOS sets the status bar in SF; system-ui is the closest thing available and
   the only choice that doesn't look like a web font pretending. */
const STATUS_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Cellular bars, wifi and battery — shared by both status bars. */
function StatusIcons({ x, cellular = true }: { x: number; cellular?: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      {cellular && (
        <g fill={STATUS_INK}>
          <rect x="0" y="27" width="4" height="6" rx="1.3" />
          <rect x="7" y="24" width="4" height="9" rx="1.3" />
          <rect x="14" y="21" width="4" height="12" rx="1.3" />
          <rect x="21" y="18" width="4" height="15" rx="1.3" />
        </g>
      )}
      <g
        transform={`translate(${cellular ? 34 : 0} 0)`}
        fill="none"
        stroke={STATUS_INK}
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d="M0 25.2a13 13 0 0 1 16 0" />
        <path d="M4 29.4a7 7 0 0 1 8 0" />
      </g>
      <circle cx={(cellular ? 34 : 0) + 8} cy="33.4" r="1.9" fill={STATUS_INK} />
      <g transform={`translate(${cellular ? 62 : 28} 0)`}>
        <rect
          x="0"
          y="19"
          width="25"
          height="13"
          rx="4"
          fill="none"
          stroke={STATUS_INK}
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <rect x="2" y="21" width="17" height="9" rx="2.5" fill={STATUS_INK} />
        <path d="M27 23.6v4.8a2.6 2.6 0 0 0 0-4.8z" fill={STATUS_INK} fillOpacity="0.35" />
      </g>
    </g>
  );
}

/**
 * iPhone status bar, with the Dynamic Island the time and icons sit either
 * side of. The island is a real cutout on the device — a black pill on a light
 * bar — so it is drawn as one rather than as a thin slot, which is what made
 * the previous version read as a sticker.
 */
function PhoneStatusBar() {
  return (
    <svg viewBox="0 0 393 54" className="block w-full" aria-hidden>
      <rect width="393" height="54" fill="#f5f6fa" />
      <text
        x="62"
        y="34"
        textAnchor="middle"
        fontSize="16"
        fontWeight="600"
        fill={STATUS_INK}
        fontFamily={STATUS_FONT}
      >
        9:41
      </text>
      <rect x="134" y="12" width="125" height="36" rx="18" fill="#05060e" />
      <StatusIcons x={289} />
    </svg>
  );
}

/** iPad status bar — no island, no cellular on a wifi model, and much shorter. */
function TabletStatusBar() {
  return (
    <svg viewBox="0 0 834 44" className="block w-full" aria-hidden>
      <rect width="834" height="44" fill="#ffffff" />
      <text
        x="46"
        y="30"
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill={STATUS_INK}
        fontFamily={STATUS_FONT}
      >
        9:41
      </text>
      <g transform="translate(0 -4)">
        <StatusIcons x={745} cellular={false} />
      </g>
    </svg>
  );
}

/**
 * iPhone. Thin even bezel, squared-off rail with the volume and side buttons,
 * and a screen radius that sits just inside the body's.
 */
export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* Side buttons, on the body rather than the screen. */}
      <span aria-hidden className="absolute -left-[2px] top-[16%] h-[4%] w-[2px] rounded-l bg-[#2b2d36]" />
      <span aria-hidden className="absolute -left-[2px] top-[24%] h-[7%] w-[2px] rounded-l bg-[#2b2d36]" />
      <span aria-hidden className="absolute -left-[2px] top-[33%] h-[7%] w-[2px] rounded-l bg-[#2b2d36]" />
      <span aria-hidden className="absolute -right-[2px] top-[26%] h-[11%] w-[2px] rounded-r bg-[#2b2d36]" />
      <div className="overflow-hidden rounded-[13%/6.2%] bg-[#1b1c22] p-[1.6%] shadow-[0_28px_70px_-24px_rgba(18,22,43,0.55)]">
        <div className="overflow-hidden rounded-[11.6%/5.4%] bg-surface">
          <PhoneStatusBar />
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * iPad. Bezels are even on all four sides and proportionally thicker than a
 * phone's, the corner radius is much gentler, and there is a front camera on
 * the top edge instead of a cutout in the screen.
 */
export function TabletFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <span aria-hidden className="absolute -right-[2px] top-[8%] h-[5%] w-[2px] rounded-r bg-[#2b2d36]" />
      <div className="relative overflow-hidden rounded-[6.5%/4.6%] bg-[#1b1c22] p-[3.4%] shadow-[0_28px_70px_-24px_rgba(18,22,43,0.5)]">
        <span
          aria-hidden
          className="absolute left-1/2 top-[1.5%] h-[0.7%] w-[1.4%] -translate-x-1/2 rounded-full bg-[#33353f]"
        />
        <div className="overflow-hidden rounded-[3.6%/2.6%] bg-surface">
          <TabletStatusBar />
          {children}
        </div>
      </div>
    </div>
  );
}
