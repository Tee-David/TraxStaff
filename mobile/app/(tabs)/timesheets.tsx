import { useMemo } from "react";
import { RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import type { Session } from "../../src/api/types";
import { clampSeconds, dayLabel, fmtShort, fmtTime, localDayKey } from "../../src/format";
import { colors, fonts, radius, spacing } from "../../src/theme";
import { Banner, Empty, Loading } from "../../src/ui";
import { useAsync } from "../../src/useAsync";

const DAYS_BACK = 30;

function sessionSeconds(s: Session): number {
  const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
  return clampSeconds((end - new Date(s.startedAt).getTime()) / 1000);
}

export default function TimesheetsScreen() {
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
        data: data.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
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
          </View>
        }
        ListEmptyComponent={
          sessions.error ? null : <Empty text="No time recorded in the last 30 days." />
        }
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{section.title}</Text>
            <Text style={s.sectionTotal}>{fmtShort(section.total)}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={s.row}>
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
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function Badge({ text, tone }: { text: string; tone?: "warn" }) {
  return (
    <View style={[s.badge, tone === "warn" && { backgroundColor: colors.accentSoft }]}>
      <Text style={[s.badgeText, tone === "warn" && { color: colors.warning }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
  header: { gap: spacing.xs, marginBottom: spacing.md },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text, letterSpacing: -0.8 },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
