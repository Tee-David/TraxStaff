import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import type { Session } from "../../src/api/types";
import { DayTimeline } from "../../src/charts";
import { clampSeconds, dayLabel, fmtShort, fmtTime, localDayKey } from "../../src/format";
import { colors, fonts, radius, spacing } from "../../src/theme";
import { Banner, Button, Card, Empty, Field, Heading, Loading, Title } from "../../src/ui";
import { useAsync } from "../../src/useAsync";

/**
 * One time entry, in full: when it ran, how it ended, and its notes.
 *
 * There is no `GET /sessions/:id` on the backend — only the filtered list — so
 * the entry is fetched by narrowing the list to the second it started, passed
 * through as `at`. That keeps the payload to one row and still survives a cold
 * open of the route (a deep link, or a reload while this screen is on top).
 */

const END_REASON: Record<string, string> = {
  stopped: "Stopped by you",
  idle_timeout: "Stopped after a period with no activity",
  abrupt_exit: "Interrupted — the app or the device stopped before it could close",
};

export default function SessionDetail() {
  const router = useRouter();
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>();

  const range = useMemo(() => {
    const t = at ? Date.parse(at) : NaN;
    // ±1s around the known start pins the query to this one row. Without `at`
    // (a hand-typed link) fall back to the same 30-day window the list uses.
    return Number.isFinite(t)
      ? { from: new Date(t - 1_000).toISOString(), to: new Date(t + 1_000).toISOString() }
      : { from: new Date(Date.now() - 30 * 86_400_000).toISOString() };
  }, [at]);

  const query = useAsync<Session[]>(() => api.sessions(range), [id, at]);
  const session = query.data?.find((s) => s.id === id) ?? null;

  // Notes added here are appended locally rather than by refetching — the list
  // endpoint costs a full round trip against a dyno that may be asleep.
  const [added, setAdded] = useState<Session["notes"]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const notes = [...(session?.notes ?? []), ...added];

  const addNote = async () => {
    const body = draft.trim();
    if (!body || !session || saving) return;
    setSaving(true);
    setNoteError(null);
    try {
      const note = await api.addNote(session.id, body);
      setAdded((prev) => [...prev, note]);
      setDraft("");
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Couldn't save that note.");
    } finally {
      setSaving(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/timesheets"));

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to timesheets"
          onPress={back}
          hitSlop={10}
          style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.brand} />
        </Pressable>
        <Text style={s.barTitle}>Time entry</Text>
      </View>

      {query.loading ? (
        <Loading
          text={query.slow ? "Waking the Trax server — this can take a minute." : "Loading this entry…"}
        />
      ) : query.error ? (
        <View style={s.pad}>
          <Banner tone="error">{query.error}</Banner>
          <Button label="Try again" variant="ghost" onPress={() => void query.reload()} />
        </View>
      ) : !session ? (
        <Empty text="That entry is no longer in your timesheet." />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <View style={{ gap: spacing.xs }}>
              <Title>{session.project.name}</Title>
              <Text style={s.sub}>
                {session.task ? session.task.title : "No task"}
                {session.project.clientTag ? ` · ${session.project.clientTag}` : ""}
              </Text>
            </View>

            <Card style={{ gap: spacing.md }}>
              <View style={s.durationRow}>
                <Text style={s.duration}>{fmtShort(sessionSeconds(session))}</Text>
                <Text style={s.day}>{dayLabel(localDayKey(new Date(session.startedAt)))}</Text>
              </View>

              <DayTimeline spans={[spanOf(session)]} />

              <View style={{ gap: spacing.sm }}>
                <Row label="Started" value={fmtTime(session.startedAt)} />
                <Row label="Ended" value={session.endedAt ? fmtTime(session.endedAt) : "Still running"} />
                <Row
                  label="How it ended"
                  value={
                    session.endedAt
                      ? (session.endReason ? END_REASON[session.endReason] : null) ?? "Stopped"
                      : "—"
                  }
                />
                <Row label="Entered" value={session.isManual ? "Added by hand" : "Tracked by a timer"} />
                <Row label="Device" value={`${session.deviceId.slice(0, 8)}…`} />
              </View>

              {session.isManual && session.manualReason ? (
                <Banner tone="info">{session.manualReason}</Banner>
              ) : null}

              {session.tamperSuspected ? (
                <Banner tone="warn">
                  This entry is flagged for review. A flag never deletes time — an admin will look at
                  it with you.
                </Banner>
              ) : null}
            </Card>

            <View style={{ gap: spacing.sm }}>
              <Heading>Notes</Heading>
              {notes.length === 0 ? (
                <Empty text="No notes on this entry yet." />
              ) : (
                notes.map((note) => (
                  <View key={note.id} style={s.note}>
                    <Text style={s.noteBody}>{note.body}</Text>
                    <Text style={s.noteMeta}>{fmtTime(note.createdAt)}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={{ gap: spacing.md }}>
              <Field
                label="Add a note"
                value={draft}
                onChangeText={setDraft}
                placeholder="What was this time for?"
                editable={!saving}
                multiline
                maxLength={500}
                style={s.noteInput}
              />
              {noteError ? <Banner tone="error">{noteError}</Banner> : null}
              <Button
                label="Save note"
                onPress={() => void addNote()}
                busy={saving}
                disabled={!draft.trim()}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function spanOf(session: Session) {
  return {
    start: new Date(session.startedAt).getTime(),
    end: session.endedAt ? new Date(session.endedAt).getTime() : Date.now(),
  };
}

function sessionSeconds(session: Session): number {
  const span = spanOf(session);
  return clampSeconds((span.end - span.start) / 1000);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  barTitle: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.textMuted },
  pad: { padding: spacing.lg, gap: spacing.md },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },

  durationRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  duration: { fontFamily: fonts.heading, fontSize: 30, color: colors.text, letterSpacing: -1 },
  day: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted },

  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.textMuted },
  rowValue: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.text, textAlign: "right" },

  note: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  noteBody: { fontFamily: fonts.body, fontSize: 14, color: colors.text, lineHeight: 21 },
  noteMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.faint },
  noteInput: { height: 92, paddingTop: spacing.md, textAlignVertical: "top" },
});
