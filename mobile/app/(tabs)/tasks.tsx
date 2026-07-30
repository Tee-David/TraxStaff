import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/api/client";
import type { Project, Task } from "../../src/api/types";
import { ScreenFade, StaggerItem, useListEntrance } from "../../src/motion";
import { PickerField, PickerSheet } from "../../src/picker";
import { useTheme } from "../../src/ThemeProvider";
import { Colors, fonts, radius, spacing } from "../../src/theme";
import { Banner, Empty, Loading } from "../../src/ui";
import { useAsync } from "../../src/useAsync";

export default function TasksScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => createStyles(colors), [colors]);
  const projects = useAsync<Project[]>(() => api.projects(), []);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const listGeneration = useListEntrance(loadingTasks);

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  const loadTasks = async (id: string, quiet = false) => {
    if (!quiet) setLoadingTasks(true);
    setError(null);
    try {
      setTasks(await api.tasks(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load tasks.");
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    // Deliberately keyed on projectId alone: loadTasks is re-created every
    // render, so depending on it would refetch in a loop.
    if (projectId) void loadTasks(projectId);
  }, [projectId]);

  const create = async () => {
    const title = draft.trim();
    if (!title || !projectId) return;
    setCreating(true);
    setError(null);
    try {
      const task = await api.createTask(projectId, title);
      setTasks((prev) => [...prev, task]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that task.");
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (task: Task) => {
    const next = task.status === "done" ? "todo" : "done";
    setPendingId(task.id);
    setError(null);
    // Optimistic, but reverted on failure — a silent no-op would be worse than
    // a visible error.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    try {
      const updated = await api.updateTask(task.id, { status: next });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setError(err instanceof Error ? err.message : "Couldn't update that task.");
    } finally {
      setPendingId(null);
    }
  };

  if (projects.loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <Loading text={projects.slow ? "Waking the Trax server — this can take a minute." : "Loading projects…"} />
      </SafeAreaView>
    );
  }

  // Distinct from "this project has no tasks": with no projects at all there is
  // nothing to add a task to, and the composer below would be a dead control.
  if (!projects.error && (projects.data?.length ?? 0) === 0) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.header}>
          <Text style={s.title}>Tasks</Text>
        </View>
        <Empty text="No projects yet. An admin has to create one before there can be tasks." />
      </SafeAreaView>
    );
  }

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const project = projects.data?.find((p) => p.id === projectId) ?? null;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScreenFade style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.header}>
          <Text style={s.title}>Tasks</Text>
          {/* A dropdown, not a pill strip: past about five projects a strip
              pushes the rest off the right edge where nobody looks for them. */}
          <PickerField
            label="Project"
            value={project?.name ?? "Choose a project"}
            muted={!project}
            onPress={() => setPicking(true)}
          />
        </View>

        {projects.error ? (
          <View style={s.pad}>
            <Banner tone="error">{projects.error}</Banner>
          </View>
        ) : null}
        {error ? (
          <View style={s.pad}>
            <Banner tone="error">{error}</Banner>
          </View>
        ) : null}

        {loadingTasks ? (
          <Loading text="Loading tasks…" />
        ) : (
          <FlatList
            data={[...open, ...done]}
            keyExtractor={(t) => t.id}
            contentContainerStyle={s.list}
            refreshControl={
              <RefreshControl
                refreshing={false}
                onRefresh={() => projectId && void loadTasks(projectId, true)}
                tintColor={colors.brand}
              />
            }
            ListEmptyComponent={<Empty text="No tasks on this project yet. Add the first one below." />}
            renderItem={({ item, index }) => {
              const isDone = item.status === "done";
              return (
                <StaggerItem index={index} generation={listGeneration}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isDone }}
                    onPress={() => void toggle(item)}
                    disabled={pendingId === item.id}
                    style={({ pressed }) => [s.task, pressed && { backgroundColor: colors.surfaceAlt }]}
                  >
                    {pendingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Ionicons
                        name={isDone ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={isDone ? colors.success : colors.borderStrong}
                      />
                    )}
                    <Text style={[s.taskTitle, isDone && s.taskDone]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {item.priority === "urgent" ? (
                      <View style={s.urgent}>
                        <Text style={s.urgentText}>Urgent</Text>
                      </View>
                    ) : null}
                  </Pressable>
                </StaggerItem>
              );
            }}
          />
        )}

        <View style={s.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a task…"
            placeholderTextColor={colors.faint}
            style={s.composerInput}
            editable={!!projectId && !creating}
            onSubmitEditing={create}
            returnKeyType="done"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add task"
            onPress={create}
            disabled={!draft.trim() || creating}
            style={({ pressed }) => [
              s.composerBtn,
              { opacity: !draft.trim() || creating ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            {creating ? (
              <ActivityIndicator color={colors.onDark} />
            ) : (
              <Ionicons name="add" size={24} color={colors.onDark} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      </ScreenFade>

      <PickerSheet
        visible={picking}
        title="Choose a project"
        items={(projects.data ?? []).map((p) => ({
          id: p.id,
          label: p.name,
          sub: p.clientTag ?? undefined,
        }))}
        selectedId={projectId}
        emptyText="Nothing to choose yet. Ask an admin to create a project."
        onClose={() => setPicking(false)}
        onSelect={(id) => {
          setProjectId(id);
          setPicking(false);
        }}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text, letterSpacing: -0.8 },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, gap: spacing.sm },
  task: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  taskTitle: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text },
  taskDone: { color: colors.faint, textDecorationLine: "line-through" },
  urgent: { backgroundColor: colors.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  urgentText: { fontFamily: fonts.bodyMedium, fontSize: 10, color: colors.warning },
  composer: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
  },
  composerBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  });
}
