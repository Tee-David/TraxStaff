import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import type { Project, Task } from "../../src/api/types";
import { fmtClock, fmtShort, startOfToday, startOfWeek } from "../../src/format";
import { colors, fonts, radius, shadow, spacing } from "../../src/theme";
import { useTracker } from "../../src/tracker/TrackerContext";
import { Banner, Button, Empty, Loading } from "../../src/ui";
import { useAsync } from "../../src/useAsync";

export default function TimerScreen() {
  const { state, available, interrupted, acknowledgeInterrupted, pendingCount, syncError, start, stop, sync } =
    useTracker();

  const projects = useAsync<Project[]>(() => api.projects(), []);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [picking, setPicking] = useState<"project" | "task" | null>(null);
  const [busy, setBusy] = useState(false);

  const todayRange = useMemo(
    () => ({ from: startOfToday().toISOString(), to: new Date(Date.now() + 60_000).toISOString() }),
    []
  );
  const weekRange = useMemo(
    () => ({ from: startOfWeek().toISOString(), to: new Date(Date.now() + 60_000).toISOString() }),
    []
  );

  const today = useAsync(() => api.summary(todayRange), []);
  const week = useAsync(() => api.summary(weekRange), []);

  // Reflect whatever the ledger says is running — the native module, not this
  // screen, is the source of truth for what is being tracked.
  useEffect(() => {
    if (state.tracking) {
      setProjectId(state.projectId);
      setTaskId(state.taskId);
    }
  }, [state.tracking, state.projectId, state.taskId]);

  const project = projects.data?.find((p) => p.id === projectId) ?? null;
  const tasks = (project?.tasks ?? []).filter((t) => t.status !== "done");
  const task = tasks.find((t) => t.id === taskId) ?? null;

  const refreshTotals = useCallback(() => {
    void today.reload(true);
    void week.reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStart = async () => {
    if (!project) return;
    setBusy(true);
    try {
      await start(project, task);
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      await stop();
      refreshTotals();
    } finally {
      setBusy(false);
    }
  };

  if (projects.loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <Loading text={projects.slow ? "Waking the Trax server — this can take a minute." : "Loading projects…"} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              void projects.reload(true);
              refreshTotals();
              void sync();
            }}
            tintColor={colors.brand}
          />
        }
      >
        <View style={s.header}>
          <Text style={s.wordmark}>trax</Text>
          <Text style={s.date}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>

        {!available ? (
          <Banner tone="warn">
            The tracker module isn&apos;t in this build, so the timer can&apos;t run. Install the
            development build or the release APK.
          </Banner>
        ) : null}

        {projects.error ? <Banner tone="error">{projects.error}</Banner> : null}

        {interrupted.length > 0 ? (
          <Pressable onPress={acknowledgeInterrupted}>
            <Banner tone="warn">
              {`A timer was stopped by ${
                interrupted.some((i) => i.closeReason === "recovered_after_reboot") ? "a restart" : "the system"
              }. ${fmtShort(
                interrupted.reduce((sum, i) => sum + (i.creditedSeconds ?? 0), 0)
              )} was saved up to the last confirmed moment. Tap to dismiss.`}
            </Banner>
          </Pressable>
        ) : null}

        {state.staleBoot ? (
          <Banner tone="warn">
            This timer started before the device restarted, so it can no longer be measured. Stop it to
            keep the time recorded so far.
          </Banner>
        ) : null}

        {/* Hero: the timer is the point of the screen. */}
        <View style={s.hero}>
          <Selector
            label="Project"
            value={project?.name ?? "Choose a project"}
            muted={!project}
            disabled={state.tracking}
            onPress={() => setPicking("project")}
          />
          <Selector
            label="Task (optional)"
            value={task?.title ?? (tasks.length ? "None" : "No open tasks")}
            muted={!task}
            disabled={state.tracking || !project || tasks.length === 0}
            onPress={() => setPicking("task")}
          />

          <View style={s.clockWrap}>
            <Text style={s.clock}>{fmtClock(state.creditedSeconds)}</Text>
            <Text style={s.clockNote}>
              {state.tracking ? "Counted by the device, not by this screen" : "Not tracking"}
            </Text>
          </View>

          {state.tracking ? (
            <Button label="Stop timer" variant="danger" onPress={onStop} busy={busy} />
          ) : (
            <Button
              label="Start timer"
              variant="accent"
              onPress={onStart}
              busy={busy}
              disabled={!project || !available}
            />
          )}
        </View>

        <View style={s.totals}>
          <Total label="Today" value={fmtShort(today.data?.totalSeconds)} error={!!today.error} />
          <Total label="This week" value={fmtShort(week.data?.totalSeconds)} error={!!week.error} />
        </View>

        <View style={s.syncRow}>
          <Ionicons
            name={syncError ? "cloud-offline-outline" : pendingCount ? "cloud-upload-outline" : "cloud-done-outline"}
            size={16}
            color={syncError ? colors.danger : colors.faint}
          />
          <Text style={[s.syncText, syncError && { color: colors.danger }]}>
            {syncError
              ? syncError
              : pendingCount
                ? `${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} waiting to sync`
                : "All entries synced"}
          </Text>
          {pendingCount || syncError ? (
            <Pressable onPress={() => void sync()} hitSlop={8}>
              <Text style={s.syncAction}>Sync now</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={s.footnote}>
          Trax mobile records time only. No screenshots, no activity score, no location — see Profile
          for the full list.
        </Text>
      </ScrollView>

      <PickerSheet
        visible={picking === "project"}
        title="Choose a project"
        onClose={() => setPicking(null)}
        items={(projects.data ?? []).map((p) => ({
          id: p.id,
          label: p.name,
          sub: p.clientTag ?? undefined,
        }))}
        selectedId={projectId}
        onSelect={(id) => {
          setProjectId(id);
          setTaskId(null);
          setPicking(null);
        }}
      />
      <PickerSheet
        visible={picking === "task"}
        title="Choose a task"
        onClose={() => setPicking(null)}
        items={[
          { id: "", label: "No task" },
          ...tasks.map((t: Task) => ({ id: t.id, label: t.title, sub: t.priority })),
        ]}
        selectedId={taskId ?? ""}
        onSelect={(id) => {
          setTaskId(id || null);
          setPicking(null);
        }}
      />
    </SafeAreaView>
  );
}

function Selector({
  label,
  value,
  muted,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  muted?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.selector, { opacity: disabled ? 0.55 : pressed ? 0.8 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.selectorLabel}>{label}</Text>
        <Text style={[s.selectorValue, muted && { color: colors.faint }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {!disabled ? <Ionicons name="chevron-down" size={18} color={colors.faint} /> : null}
    </Pressable>
  );
}

function Total({ label, value, error }: { label: string; value: string; error: boolean }) {
  return (
    <View style={s.total}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={[s.totalValue, error && { color: colors.faint }]}>{error ? "—" : value}</Text>
    </View>
  );
}

function PickerSheet({
  visible,
  title,
  items,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: { id: string; label: string; sub?: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.sheet}>
        <Text style={s.sheetTitle}>{title}</Text>
        {items.length === 0 ? (
          <Empty text="Nothing to choose yet. Ask an admin to create a project." />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelect(item.id)}
                style={({ pressed }) => [s.sheetRow, pressed && { backgroundColor: colors.surfaceAlt }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.sheetRowLabel}>{item.label}</Text>
                  {item.sub ? <Text style={s.sheetRowSub}>{item.sub}</Text> : null}
                </View>
                {item.id === selectedId ? (
                  <Ionicons name="checkmark" size={20} color={colors.brand} />
                ) : null}
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  wordmark: { fontFamily: fonts.heading, fontSize: 26, color: colors.brand, letterSpacing: -1 },
  date: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted },

  hero: {
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  selector: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectorLabel: { fontFamily: fonts.bodyMedium, fontSize: 11, color: "#a7abe0", letterSpacing: 0.6 },
  selectorValue: { fontFamily: fonts.bodySemi, fontSize: 16, color: "#fff" },

  clockWrap: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.xs },
  clock: {
    fontFamily: fonts.heading,
    fontSize: 56,
    color: "#fff",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  clockNote: { fontFamily: fonts.body, fontSize: 12, color: "#a7abe0" },

  totals: { flexDirection: "row", gap: spacing.md },
  total: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  totalLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.textMuted },
  totalValue: { fontFamily: fonts.heading, fontSize: 26, color: colors.text, letterSpacing: -0.8 },

  syncRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  syncText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.faint },
  syncAction: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.accent },

  footnote: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, lineHeight: 18 },

  backdrop: { flex: 1, backgroundColor: "rgba(13,16,32,0.45)" },
  sheet: {
    maxHeight: "60%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetTitle: { fontFamily: fonts.headingMedium, fontSize: 18, color: colors.text },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetRowLabel: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.text },
  sheetRowSub: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },
});
