import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import type { Session } from "../../src/api/types";
import { DayTimeline, MeterRow } from "../../src/charts";
import { clampSeconds, dayLabel, fmtShort, fmtTime, localDayKey } from "../../src/format";
import { useTheme } from "../../src/ThemeProvider";
import { Colors, fonts, radius, spacing } from "../../src/theme";
import { Banner, Empty, Loading } from "../../src/ui";
import { useAsync } from "../../src/useAsync";

const DAYS_BACK = 30;
// Enough rows to show where the time actually goes without turning the header
// into a second screen; anything past this is rolled into "Other".
const BREAKDOWN_ROWS = 5;

function sessionSeconds(s: Session): number {
  const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
  return clampSeconds((end - new Date(s.startedAt).getTime()) / 1000);
}

export default function TimesheetsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const from = useMemo(() => new Date(Date.now() - DAYS_BACK * 86_400_000).toISOString(), []);
  const sessions = useAsync<Session[]>(() => api.sessions({ from }), []);

  const sections = useMemo(() => {
    const byDay = new Map<string, Session[]>();
    for (const s of sessions.data ?? []) {
      // Grouped by LOCAL day. The server groups by UTC in /reports/timesheet,
      // which puts a 9pm entry on the wrong day for anyone east of Greenwich.
      const key = localDayKey(new Date(s.startedAt));
      const list = byDay.get(key) ?? [];
      list.push(s);
      byDay.set(key, list);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, data]) => ({
        key,
        title: dayLabel(key),
        total: data.reduce((sum, s) => sum + sessionSeconds(s), 0),
        // A running session has no endedAt; the timeline draws it up to now.
        spans: data.map((s) => ({
          start: new Date(s.startedAt).getTime(),
          end: s.endedAt ? new Date(s.endedAt).getTime() : Date.now(),
        })),
        data: data.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      }));
  }, [sessions.data]);

  // Per-project split of the same window. Bars are relative to the biggest row,
  // not to the total, so a long tail of small projects stays readable.
  const breakdown = useMemo(() => {
    const byProject = new Map<string, number>();
    for (const s of sessions.data ?? []) {
      byProject.set(s.project.name, (byProject.get(s.project.name) ?? 0) + sessionSeconds(s));
    }
    const ranked = [...byProject.entries()].sort((a, b) => b[1] - a[1]);
    const head = ranked.slice(0, BREAKDOWN_ROWS);
    const tail = ranked.slice(BREAKDOWN_ROWS).reduce((sum, [, secs]) => sum + secs, 0);
    if (tail > 0) head.push([`${ranked.length - BREAKDOWN_ROWS} more projects`, tail]);
    const top = head[0]?.[1] ?? 0;
    return head.map(([name, seconds]) => ({
      name,
      seconds,
      fraction: top > 0 ? seconds / top : 0,
    }));
  }, [sessions.data]);

  if (sessions.loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <Loading
          text={sessions.slow ? "Waking the Trax server — this can take a minute." : "Loading your timesheet…"}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void sessions.reload(true)} tintColor={colors.brand} />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.title}>Timesheets</Text>
            <Text style={s.sub}>Your last {DAYS_BACK} days, from every device.</Text>
            {sessions.error ? <Banner tone="error">{sessions.error}</Banner> : null}
            {breakdown.length > 0 ? (
              <View style={s.breakdown}>
                <Text style={s.breakdownTitle}>By project</Text>
                {breakdown.map((row) => (
                  <MeterRow
                    key={row.name}
                    label={row.name}
                    value={fmtShort(row.seconds)}
                    fraction={row.fraction}
                  />
                ))}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          sessions.error ? null : <Empty text="No time recorded in the last 30 days." />
        }
        renderSectionHeader={({ section }) => (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              <Text style={s.sectionTotal}>{fmtShort(section.total)}</Text>
            </View>
            <DayTimeline spans={section.spans} />
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.project.name}, ${fmtShort(sessionSeconds(item))}, opens entry details`}
            onPress={() =>
              router.push({ pathname: "/session/[id]", params: { id: item.id, at: item.startedAt } })
            }
            style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {item.project.name}
                {item.task ? ` · ${item.task.title}` : ""}
              </Text>
              <Text style={s.rowMeta}>
                {fmtTime(item.startedAt)} — {item.endedAt ? fmtTime(item.endedAt) : "running"}
                {item.endReason === "abrupt_exit" ? " · interrupted" : ""}
              </Text>
              {item.notes.length > 0 ? (
                <Text style={s.rowNote} numberOfLines={2}>
                  {item.notes[item.notes.length - 1].body}
                </Text>
              ) : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={s.rowDuration}>{fmtShort(sessionSeconds(item))}</Text>
              {item.isManual ? <Badge text="Manual" /> : null}
              {item.tamperSuspected ? <Badge text="Flagged" tone="warn" /> : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.faint} style={{ alignSelf: "center" }} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function Badge({ text, tone }: { text: string; tone?: "warn" }) {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[s.badge, tone === "warn" && { backgroundColor: colors.accentSoft }]}>
      <Text style={[s.badgeText, tone === "warn" && { color: colors.warning }]}>{text}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
  header: { gap: spacing.xs, marginBottom: spacing.md },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text, letterSpacing: -0.8 },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  breakdown: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  breakdownTitle: {
    fontFamily: fonts.headingMedium,
    fontSize: 15,
    color: colors.text,
    paddingTop: spacing.sm,
  },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm, gap: spacing.sm },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  sectionTitle: { fontFamily: fonts.headingMedium, fontSize: 16, color: colors.text },
  sectionTotal: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.brand },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.text },
  rowMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },
  rowNote: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, fontStyle: "italic" },
  rowDuration: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  badge: { backgroundColor: colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.textMuted },
  });
}
