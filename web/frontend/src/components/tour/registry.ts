import type { Step } from "react-joyride";
import type { TourIconName } from "./tour-icon";

/**
 * Tour registry — the single source of truth for every guided tour in TraxStaff.
 *
 * A `TourStep` is a react-joyride `Step` plus a few TraxStaff-specific fields:
 *  - `key`          stable id for the step (debugging / React keys)
 *  - `route`        walkthrough steps that live on another page set this; the
 *                   provider decorates them with a `before` hook that navigates
 *                   there and waits for the target to mount.
 *  - `page`         friendly page name, shown in the tooltip and used to count
 *                   "N pages to go" in the walkthrough.
 *  - `optional`     the step is dropped silently if its target isn't in the DOM
 *                   (empty tables, unconfigured widgets, …).
 *  - `desktopOnly`  dropped below the `lg` breakpoint — TraxStaff's own sidebar rail
 *                   is `hidden lg:block` (see `Sidebar.tsx` / `app/layout.tsx`),
 *                   so its anchors exist but are invisible.
 *  - `mobileOnly`   dropped at `lg` and up (e.g. the drawer's hamburger).
 *  - `adminOnly`    dropped for a plain `member` — TraxStaff gates Insights,
 *                   Projects and Members to `owner`/`admin` in `Sidebar.tsx`'s
 *                   `MENU` array, and a member visiting those routes directly
 *                   should never have a tour try to spotlight them anyway.
 *  - `icon`         animated tooltip icon (see `tour-icon.tsx`).
 *  - `interact`     interactive stop: the user clicks the target and the tour
 *                   advances itself. The Next button still works as a fallback.
 *  - `showEstimate` render the "~3 min · 12 stops" chip (intro steps only).
 *
 * Copy rule: say what is *actually* on the page and what the operator can do
 * with it. No filler, no "this is the dashboard".
 *
 * Unlike the reference this is modeled on, TraxStaff is one app with role-gated
 * navigation rather than separate client/admin portals — so there is a single
 * welcome tour and a single walkthrough, and `adminOnly` steps within them
 * fold away for a plain member instead of a whole second tour existing.
 */
export type TourKind = "page" | "welcome" | "walkthrough";
export type TourRole = "owner" | "admin" | "member";

export type TourStep = Step & {
  key: string;
  route?: string;
  page?: string;
  optional?: boolean;
  desktopOnly?: boolean;
  mobileOnly?: boolean;
  adminOnly?: boolean;
  icon?: TourIconName;
  interact?: { hint: string; clickTarget?: string };
  showEstimate?: boolean;
};

export type TourDef = {
  id: string;
  kind: TourKind;
  /** Home route for a page tour (informational; page tours are matched by route-match). */
  route?: string;
  steps: TourStep[];
};

/** Convenience for a full-screen, centered "intro / outro" step. */
function centerStep(
  key: string,
  title: string,
  content: string,
  extra: Partial<TourStep> = {},
): TourStep {
  return {
    key,
    target: "body",
    placement: "center",
    // Centered steps have nothing to scroll to — joyride skips scrolling for
    // `placement: center` anyway, but being explicit keeps intent obvious.
    skipScroll: true,
    title,
    content,
    ...extra,
  };
}

/** A sidebar nav anchor. Desktop-only: the rail is `hidden` below `lg`. */
function navStep(
  tourKey: string,
  title: string,
  content: string,
  extra: Partial<TourStep> = {},
): TourStep {
  return {
    key: `nav-${tourKey}`,
    target: `[data-tour="nav-${tourKey}"]`,
    placement: "right",
    desktopOnly: true,
    title,
    content,
    ...extra,
  };
}

export const TOURS: Record<string, TourDef> = {
  // ─── Page tours ─────────────────────────────────────────────────────────
  dashboard: {
    id: "dashboard",
    kind: "page",
    route: "/app",
    steps: [
      centerStep(
        "intro",
        "Your dashboard",
        "Everything you tracked today and this week, in one customizable layout. Here's what each block shows.",
        { icon: "compass", showEstimate: true },
      ),
      {
        key: "dash-kpis",
        target: '[data-tour="dash-kpis"]',
        title: "The four numbers",
        content: "Active projects, ongoing tasks, completed tasks, and hours worked this week — at a glance.",
        icon: "gauge",
        optional: true,
      },
      {
        key: "dash-timeline",
        target: '[data-tour="dash-timeline"]',
        title: "Timeline",
        content:
          "Today's activity by hour, plus a session strip showing exactly when you worked. Hover a segment for its start and end time.",
        icon: "activity",
        optional: true,
      },
      {
        key: "dash-projects",
        target: '[data-tour="dash-projects"]',
        title: "Projects & tasks",
        content: "Your projects with live progress, and up to three tasks from each so you can jump back in without leaving the dashboard.",
        icon: "kanban",
        optional: true,
      },
      {
        key: "dash-heatmap",
        target: '[data-tour="dash-heatmap"]',
        title: "Work by hours",
        content: "A heatmap of when you actually work across the week — useful for spotting patterns in your own schedule.",
        icon: "barChart",
        optional: true,
      },
      {
        key: "dash-weekly",
        target: '[data-tour="dash-weekly"]',
        title: "Weekly goal",
        content: "Progress toward a 40-hour week, plus days active and today's average activity.",
        icon: "flag",
        optional: true,
      },
      {
        key: "dash-history",
        target: '[data-tour="dash-history"]',
        title: "Project history",
        content: "Your most recent sessions — project, date, work hours and total duration.",
        icon: "clock",
        optional: true,
      },
      {
        key: "dash-customize",
        target: '[data-tour="dash-customize"]',
        title: "Make it yours",
        content: "Drag any card to reorder it, or resize it with the ⤢ button. Your layout is saved to this browser.",
        icon: "settings",
        optional: true,
      },
    ],
  },

  timesheets: {
    id: "timesheets",
    kind: "page",
    route: "/app/timesheets",
    steps: [
      {
        key: "timesheets-filter",
        target: '[data-tour="timesheets-filter"]',
        title: "Pick a range",
        content: "Filter every entry below to today, this week, a custom range, or further back.",
        icon: "clock",
        optional: true,
      },
      {
        key: "timesheets-summary",
        target: '[data-tour="timesheets-summary"]',
        title: "The shape of your week",
        content:
          "A bar per weekday next to the totals: time in range, how much of it was manually entered, entry count, and anything flagged.",
        icon: "barChart",
        optional: true,
      },
      {
        key: "timesheets-table",
        target: '[data-tour="timesheets-table"]',
        title: "Every entry",
        content: "Project, date, work hours and duration for each session — with a badge marking manual entries and any tamper flags.",
        icon: "inbox",
        optional: true,
      },
    ],
  },

  reports: {
    id: "reports",
    kind: "page",
    route: "/app/reports",
    steps: [
      centerStep(
        "intro",
        "Reports",
        "Hours, activity and time-by-project over any range — plus app and website usage captured by the desktop tracker.",
        { icon: "barChart" },
      ),
      {
        key: "reports-filter",
        target: '[data-tour="reports-filter"]',
        title: "Scope the report",
        content: "Pick a date range, and — if you're an admin — a specific member instead of the whole team.",
        icon: "filter",
        optional: true,
      },
      {
        key: "reports-by-project",
        target: '[data-tour="reports-by-project"]',
        title: "Time by project",
        content: "Where the hours in this range actually went, with average activity per project alongside each bar.",
        icon: "kanban",
        optional: true,
      },
      {
        key: "reports-usage",
        target: '[data-tour="reports-usage"]',
        title: "App & website usage",
        content: "What was open while tracking, recorded by the desktop app — useful context next to the raw hours.",
        icon: "activity",
        optional: true,
      },
      {
        key: "reports-daily",
        target: '[data-tour="reports-daily"]',
        title: "Daily timesheet",
        content: "Tracked vs. manual time and session count for every day in range.",
        icon: "inbox",
        optional: true,
      },
      {
        key: "reports-export",
        target: '[data-tour="reports-export"]',
        title: "Export to CSV",
        content: "Download the project breakdown above as a spreadsheet.",
        icon: "plus",
        optional: true,
      },
    ],
  },

  screenshots: {
    id: "screenshots",
    kind: "page",
    route: "/app/screenshots",
    steps: [
      centerStep(
        "intro",
        "Screenshots",
        "Captured automatically by the desktop tracker while a session runs. Members see that a capture happened; only admins see the image.",
        { icon: "image" },
      ),
      {
        key: "screenshots-filter",
        target: '[data-tour="screenshots-filter"]',
        title: "Filter the range",
        content: "Same date range control as everywhere else — admins can also narrow to one member.",
        icon: "filter",
        optional: true,
      },
      {
        key: "screenshots-view-toggle",
        target: '[data-tour="screenshots-view-toggle"]',
        title: "Grid or list",
        content: "Switch views, and in grid view choose how many tiles sit per row.",
        icon: "layout",
        optional: true,
      },
      {
        key: "screenshots-results",
        target: '[data-tour="screenshots-results"]',
        title: "Open a capture",
        content: "Click any tile for the full-size view with its activity percentage. Locked tiles mean the picture is admin-only.",
        icon: "lock",
        optional: true,
      },
    ],
  },

  insights: {
    id: "insights",
    kind: "page",
    route: "/app/insights",
    steps: [
      centerStep(
        "intro",
        "Insights",
        "The admin-only view across the whole team: who's online, productivity, and anything that looks unusual.",
        { icon: "compass", showEstimate: true },
      ),
      {
        key: "insights-kpis",
        target: '[data-tour="insights-kpis"]',
        title: "Right now",
        content: "Who's online, who's actively tracking, average activity today, and any open risk flags.",
        icon: "gauge",
        optional: true,
      },
      {
        key: "insights-presence",
        target: '[data-tour="insights-presence"]',
        title: "Live presence",
        content: "Every member, online or not, and what they're tracking against right now.",
        icon: "users",
        optional: true,
      },
      {
        key: "insights-leaderboard",
        target: '[data-tour="insights-leaderboard"]',
        title: "Productivity ranking",
        content: "Hours and average activity per member for the selected range, ranked highest to lowest.",
        icon: "trophy",
        optional: true,
      },
      {
        key: "insights-daily-trend",
        target: '[data-tour="insights-daily-trend"]',
        title: "Daily hours trend",
        content: "The whole team's tracked time per day, so a slow week is visible at a glance.",
        icon: "barChart",
        optional: true,
      },
      {
        key: "insights-flags",
        target: '[data-tour="insights-flags"]',
        title: "Risk & anomaly flags",
        content: "Sustained high activity, robotic input patterns, clock changes and similar signals — dismiss one once you've reviewed it.",
        icon: "shieldCheck",
        optional: true,
      },
      {
        key: "insights-project-health",
        target: '[data-tour="insights-project-health"]',
        title: "Project health",
        content: "Hours tracked and average activity per project this period, so you can see which ones are actually moving.",
        icon: "activity",
        optional: true,
      },
    ],
  },

  projects: {
    id: "projects",
    kind: "page",
    route: "/app/projects",
    steps: [
      {
        key: "projects-header",
        target: '[data-tour="projects-header"]',
        title: "Add a project",
        content: "Name it, optionally tag a client, and it's immediately trackable from the desktop app.",
        icon: "plus",
        optional: true,
      },
      {
        key: "projects-controls",
        target: '[data-tour="projects-controls"]',
        title: "Sort & filter",
        content: "Sort by newest, oldest or name, or filter the list by typing.",
        icon: "filter",
        optional: true,
      },
      {
        key: "projects-table",
        target: '[data-tour="projects-table"]',
        title: "Every project",
        content: "Status, task progress and who's assigned. Open the ⋯ menu on a row to view details, assign members, or archive it.",
        icon: "kanban",
        optional: true,
      },
      {
        key: "projects-archives",
        target: '[data-tour="projects-archives"]',
        title: "Archived projects",
        content: "Paused projects live here instead of cluttering the active list — unarchive one any time from its row menu.",
        icon: "lock",
        optional: true,
      },
    ],
  },

  members: {
    id: "members",
    kind: "page",
    route: "/app/members",
    steps: [
      {
        key: "members-header",
        target: '[data-tour="members-header"]',
        title: "Invite a teammate",
        content: "Send an invite by email with a starting role — Member or Admin.",
        icon: "plus",
        optional: true,
      },
      {
        key: "members-table",
        target: '[data-tour="members-table"]',
        title: "People with access",
        content:
          "Change a member's role inline, or open the ⋯ menu to set their personal work targets, disable their access, or remove them entirely.",
        icon: "users",
        optional: true,
      },
      {
        key: "members-pending",
        target: '[data-tour="members-pending"]',
        title: "Pending invitations",
        content: "Invites that haven't been accepted yet — resend the email or revoke the invite from here.",
        icon: "userCog",
        optional: true,
      },
    ],
  },

  settings: {
    id: "settings",
    kind: "page",
    route: "/app/settings",
    steps: [
      {
        key: "settings-nav",
        target: '[data-tour="settings-nav"]',
        title: "Settings sections",
        content: "Account and Appearance are yours alone. Admins also get Screenshots, Tracking, Work targets and Organisation here.",
        placement: "right",
        icon: "settings",
        optional: true,
      },
      {
        key: "settings-panel",
        target: '[data-tour="settings-panel"]',
        title: "This section",
        content: "Whatever you select on the left opens here — change it and save from the button at the bottom of the panel.",
        icon: "check",
        optional: true,
      },
    ],
  },

  // ─── Welcome + walkthrough ──────────────────────────────────────────────
  welcome: {
    id: "welcome",
    kind: "welcome",
    steps: [
      centerStep(
        "welcome",
        "Welcome to TraxStaff",
        "This is your home base for time tracking — dashboard, timesheets, reports and screenshots, all in one place. Here's a quick look around.",
        { icon: "sparkles", showEstimate: true },
      ),
      navStep("dashboard", "Dashboard", "Today and this week's tracked time, customizable to how you like to see it.", { icon: "layout" }),
      navStep("timesheets", "Timesheets", "Every session you've tracked, filterable by date range.", { icon: "clock" }),
      navStep("reports", "Reports", "Hours, activity and time-by-project, exportable to CSV.", { icon: "barChart" }),
      navStep("screenshots", "Screenshots", "Captures taken automatically while the desktop tracker runs.", { icon: "image" }),
      navStep("insights", "Insights", "Team-wide productivity, presence and risk signals.", { icon: "compass", adminOnly: true }),
      navStep("projects", "Projects", "Create projects and manage who's assigned to each.", { icon: "kanban", adminOnly: true }),
      navStep("members", "Members", "Invite teammates and manage their access.", { icon: "users", adminOnly: true }),
      navStep("settings", "Settings", "Your account, plus (for admins) screenshot, tracking and target defaults for the whole org.", { icon: "settings" }),
      {
        key: "sidebar-collapse",
        target: '[data-tour="sidebar-collapse"]',
        title: "Give yourself more room",
        content: "This collapses the sidebar to a slim icon rail — handy on a laptop. Hover the rail to peek it open again without expanding it.",
        placement: "right",
        icon: "panelLeft",
        desktopOnly: true,
        optional: true,
        interact: { hint: "Click the collapse button to try it" },
      },
      {
        key: "mobile-menu",
        target: '[data-tour="mobile-menu"]',
        title: "Your menu",
        content: "Tap here any time to jump between pages — the sidebar lives behind this on a phone.",
        placement: "bottom",
        icon: "panelLeft",
        mobileOnly: true,
        optional: true,
      },
      {
        key: "launcher",
        target: '[data-tour="tour-launcher"]',
        title: "Replay any time",
        content: "Tap the help button whenever you want a tour of the page you're on, or this full walkthrough again.",
        placement: "bottom",
        icon: "replay",
      },
    ],
  },

  walkthrough: {
    id: "walkthrough",
    kind: "walkthrough",
    steps: [
      centerStep(
        "intro",
        "Let's take the full tour",
        "We'll walk through every page together — a few seconds on each. Step out any time with Skip tour.",
        { route: "/app", page: "Dashboard", icon: "compass", showEstimate: true },
      ),
      {
        key: "dash-kpis",
        route: "/app",
        page: "Dashboard",
        target: '[data-tour="dash-kpis"]',
        title: "Start here",
        content: "Active projects, ongoing and completed tasks, and hours worked this week.",
        icon: "gauge",
        optional: true,
      },
      {
        key: "dash-timeline",
        route: "/app",
        page: "Dashboard",
        target: '[data-tour="dash-timeline"]',
        title: "Today's timeline",
        content: "An hour-by-hour view of today, with a session strip showing exactly when you worked.",
        icon: "activity",
        optional: true,
      },
      {
        key: "go-timesheets",
        route: "/app",
        page: "Dashboard",
        target: '[data-tour="nav-timesheets"]',
        title: "On to Timesheets",
        content: "Every session you've tracked lives here.",
        placement: "right",
        icon: "pointer",
        desktopOnly: true,
        interact: { hint: "Click “Timesheets” in the sidebar" },
      },
      {
        key: "timesheets-table",
        route: "/app/timesheets",
        page: "Timesheets",
        target: '[data-tour="timesheets-table"]',
        title: "Timesheets",
        content: "Project, date, work hours and duration for every session, with manual entries and flags called out.",
        icon: "inbox",
        optional: true,
      },
      {
        key: "go-reports",
        route: "/app/timesheets",
        page: "Timesheets",
        target: '[data-tour="nav-reports"]',
        title: "On to Reports",
        content: "The same data, rolled up by project and over time.",
        placement: "right",
        icon: "pointer",
        desktopOnly: true,
        interact: { hint: "Click “Reports” in the sidebar" },
      },
      {
        key: "reports-by-project",
        route: "/app/reports",
        page: "Reports",
        target: '[data-tour="reports-by-project"]',
        title: "Reports",
        content: "Time by project, app & website usage, and a daily breakdown — exportable to CSV.",
        icon: "barChart",
        optional: true,
      },
      {
        key: "go-screenshots",
        route: "/app/reports",
        page: "Reports",
        target: '[data-tour="nav-screenshots"]',
        title: "On to Screenshots",
        content: "What the tracker actually captured while you worked.",
        placement: "right",
        icon: "pointer",
        desktopOnly: true,
        interact: { hint: "Click “Screenshots” in the sidebar" },
      },
      {
        key: "screenshots-results",
        route: "/app/screenshots",
        page: "Screenshots",
        target: '[data-tour="screenshots-results"]',
        title: "Screenshots",
        content: "Automatic captures with activity at the time. Members see that a capture happened; only admins see the image.",
        icon: "image",
        optional: true,
      },
      {
        key: "go-insights",
        route: "/app/screenshots",
        page: "Screenshots",
        target: '[data-tour="nav-insights"]',
        title: "On to Insights",
        content: "The team-wide view — presence, productivity and risk signals.",
        placement: "right",
        icon: "pointer",
        desktopOnly: true,
        adminOnly: true,
        interact: { hint: "Click “Insights” in the sidebar" },
      },
      {
        key: "insights-kpis",
        route: "/app/insights",
        page: "Insights",
        target: '[data-tour="insights-kpis"]',
        title: "Insights",
        content: "Who's online and tracking right now, average activity, and any open risk flags.",
        icon: "gauge",
        adminOnly: true,
        optional: true,
      },
      {
        key: "go-projects",
        route: "/app/insights",
        page: "Insights",
        target: '[data-tour="nav-projects"]',
        title: "On to Projects",
        content: "Where the work being tracked actually comes from.",
        placement: "right",
        icon: "pointer",
        desktopOnly: true,
        adminOnly: true,
        interact: { hint: "Click “Projects” in the sidebar" },
      },
      {
        key: "projects-table",
        route: "/app/projects",
        page: "Projects",
        target: '[data-tour="projects-table"]',
        title: "Projects",
        content: "Create projects, assign members, and track task progress on each one.",
        icon: "kanban",
        adminOnly: true,
        optional: true,
      },
      {
        key: "go-members",
        route: "/app/projects",
        page: "Projects",
        target: '[data-tour="nav-members"]',
        title: "On to Members",
        content: "Everyone assigned to that work, and their access.",
        placement: "right",
        icon: "pointer",
        desktopOnly: true,
        adminOnly: true,
        interact: { hint: "Click “Members” in the sidebar" },
      },
      {
        key: "members-table",
        route: "/app/members",
        page: "Members",
        target: '[data-tour="members-table"]',
        title: "Members",
        content: "Invite teammates, change roles, set individual work targets, or remove access.",
        icon: "users",
        adminOnly: true,
        optional: true,
      },
      centerStep(
        "settings",
        "Settings",
        "Your account lives here for everyone. Admins also set org-wide screenshot, idle-tracking and work-target defaults.",
        { route: "/app/settings", page: "Settings", icon: "settings" },
      ),
      centerStep(
        "outro",
        "That's TraxStaff",
        "Track from the desktop app, review it all here. The help button replays any of this whenever you want it — welcome aboard!",
        { route: "/app", page: "Dashboard", icon: "check" },
      ),
    ],
  },
};
