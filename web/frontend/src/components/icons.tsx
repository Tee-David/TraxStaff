import type { SVGProps } from "react";

// Compact 20px stroke icons — one consistent line style across the app.
const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconSidebar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
);
export const IconDashboard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></svg>
);
export const IconTrend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>
);
export const IconKanban = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v7M12 7v10M16 7v4" /></svg>
);
export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6M21 20a5.2 5.2 0 0 0-4-5" /></svg>
);
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
);
export const IconFlag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 21V4M5 4h11l-1.5 4L16 12H5" /></svg>
);
export const IconAudit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>
);
export const IconHelp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 3.6-1.9c1.6.8 1.4 2.6 0 3.4-.9.5-1.1 1-1.1 1.9" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>
);
export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h12" /></svg>
);
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
);
export const IconWindows = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="4" width="7.5" height="7.5" rx="0.5" /><rect x="13.5" y="4" width="7.5" height="7.5" rx="0.5" /><rect x="3" y="14.5" width="7.5" height="7.5" rx="0.5" /><rect x="13.5" y="14.5" width="7.5" height="7.5" rx="0.5" /></svg>
);
export const IconLinux = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="10" rx="4.2" ry="5" />
    <path d="M8.4 14.5c-1.8 1-2.9 3-2.9 5.5h13c0-2.5-1.1-4.5-2.9-5.5" />
    <circle cx="10.2" cy="9" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="13.8" cy="9" r="0.55" fill="currentColor" stroke="none" />
  </svg>
);
export const IconAndroid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 10v6.5" />
    <path d="M17 10v6.5" />
    <path d="M7.5 10h9v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7Z" />
    <path d="M7.5 10a4.5 4.5 0 0 1 9 0" />
    <path d="M9.3 5.2L8.2 3.6M14.7 5.2l1.1-1.6" />
    <path d="M9.5 20.5v1.3M14.5 20.5v1.3" />
  </svg>
);
export const IconExternalLink = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 4h6v6" /><path d="M20 4l-9.5 9.5" /><path d="M8 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-2" /></svg>
);
export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 12h15" /><path d="M13 6l6 6-6 6" /></svg>
);
export const IconLogin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" /><path d="M14 7l5 5-5 5" /><path d="M19 12H9" /></svg>
);
export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.6 6.6l8.4 5.9 8.4-5.9" /></svg>
);
export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 12a8 8 0 1 1-8-8" /><path d="M9.4 2.6 12 4 9.4 5.4" /></svg>
);
export const IconApple = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M15.5 12.1c0-2.1 1.6-3.1 1.7-3.2-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2.1 1 0 1.4-.7 2.6-.7s1.6.7 2.7.6c1.1 0 1.8-1 2.5-2 .5-.7.9-1.5 1.1-2.3-1.5-.6-1.9-1.9-1.9-2.9Z" />
    <path d="M13 5.6c.5-.6.9-1.5.8-2.4-.8.1-1.8.6-2.3 1.3-.5.6-.9 1.5-.8 2.3.9.1 1.8-.5 2.3-1.2Z" />
  </svg>
);

