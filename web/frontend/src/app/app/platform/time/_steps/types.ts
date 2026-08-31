import { addDays, todayKey, weekStart } from "@/lib/platform";

/**
 * One state object for the whole wizard, passed down with a single `update`.
 *
 * Deliberately flat and deliberately one object: a wizard whose steps each own
 * a slice of the answer needs every step to know about the others to validate,
 * and prop-drilling twenty setters is how that turns unreadable.
 */

/**
 * What the operator says they are doing.
 *
 * This is the whole simplification. `fill`, `recordAs` and which endpoint gets
 * called are all DERIVED from this (see `derive` below) rather than being
 * separate controls, so the words "top up", "replace" and "record as" never
 * appear on screen as things to configure.
 */
export type Intent = "add" | "rewrite" | "activity" | "fix";

export const INTENTS: {
  id: Intent;
  title: string;
  blurb: string;
  /** Shown on the rail once chosen. */
  short: string;
}[] = [
  {
    id: "add",
    title: "Add hours someone worked",
    blurb:
      "They were offsite and the tracker was not running. Tops each day up to the target, fitted around whatever they did track.",
    short: "Add hours",
  },
  {
    id: "rewrite",
    title: "Rewrite a period",
    blurb:
      "Replace the hours already entered for a period with new figures. Captured tracker sessions are left alone unless you say otherwise.",
    short: "Rewrite a period",
  },
  {
    id: "activity",
    title: "Change activity only",
    blurb: "The hours are right but the activity percentage is not. Nothing about the hours changes.",
    short: "Activity only",
  },
  {
    id: "fix",
    title: "Fix a session the tracker got wrong",
    blurb:
      "A machine left running overnight, a session that never stopped. Trim it to the hours actually worked, or remove it.",
    short: "Fix a session",
  },
];

export type PeriodMode = "day" | "week" | "range" | "days";

export interface WizardState {
  intent: Intent | null;

  // Who
  orgId: string;
  many: boolean;
  userId: string;
  userIds: string[];
  projectId: string;

  // When
  mode: PeriodMode;
  date: string;
  from: string;
  to: string;
  picked: string[];

  // How much
  amountKind: "total" | "perDay";
  hours: string;
  activityPct: string;

  // Advanced — every one of these has a default that is right almost always.
  natural: boolean;
  activityJitter: string;
  lengthJitterPct: string;
  startJitterMinutes: string;
  breakMinutes: string;
  includeWeekends: boolean;
  matchMemberPattern: boolean;
  recordAsTracked: boolean;
  replaceCaptured: boolean;
  includeCaptured: boolean;

  // Fix-a-session
  sessionId: string;
  newEnd: string;

  reason: string;
}

export function initialState(): WizardState {
  const today = todayKey();
  const monday = weekStart(today);
  return {
    intent: null,

    orgId: "",
    many: false,
    userId: "",
    userIds: [],
    projectId: "",

    mode: "week",
    date: today,
    from: monday,
    to: addDays(monday, 6),
    picked: [],

    amountKind: "total",
    hours: "40",
    activityPct: "45",

    // On by default. Off produces a week of identical days at an identical
    // percentage, which no real week looks like.
    natural: true,
    activityJitter: "9",
    lengthJitterPct: "15",
    startJitterMinutes: "20",
    breakMinutes: "0",
    includeWeekends: false,
    matchMemberPattern: true,
    recordAsTracked: false,
    replaceCaptured: false,
    includeCaptured: true,

    sessionId: "",
    newEnd: "",

    reason: "",
  };
}

/**
 * The API-facing settings the chosen intent implies.
 *
 * Kept in one place so the mapping from plain language to the API's vocabulary
 * is auditable, rather than scattered across the steps that happen to need it.
 */
export function derive(intent: Intent | null) {
  return {
    fill: intent === "rewrite" ? ("replace" as const) : ("topUp" as const),
    needsProject: intent === "add" || intent === "rewrite",
    needsAmount: intent === "add" || intent === "rewrite",
    isActivityOnly: intent === "activity",
    isFixSession: intent === "fix",
    /** Only "rewrite" can be pointed at captured tracker sessions. */
    canReplaceCaptured: intent === "rewrite",
  };
}

/** Zeroed jitter when "vary it naturally" is off, so the figures come out exact. */
export function jitterFor(s: WizardState) {
  return s.natural
    ? {
        activityJitter: Number(s.activityJitter),
        lengthJitterPct: Number(s.lengthJitterPct),
        startJitterMinutes: Number(s.startJitterMinutes),
      }
    : { activityJitter: 0, lengthJitterPct: 0, startJitterMinutes: 0 };
}

/** The period fields the API expects, for whichever mode is selected. */
export function periodBody(s: WizardState) {
  if (s.mode === "day" || s.mode === "week") return { mode: s.mode, date: s.date };
  if (s.mode === "days") return { mode: "days" as const, days: s.picked };
  return { mode: "range" as const, from: s.from, to: s.to };
}
