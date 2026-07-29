// The one way Trax mobile asks "which of these?". Both the timer and the tasks
// screen mount the same sheet, so a project is chosen identically wherever you
// are — and a fix to the filtering or the keyboard handling lands in both.

import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, fonts, radius, spacing } from "./theme";
import { Empty } from "./ui";

export type PickerItem = { id: string; label: string; sub?: string };

// Below this every option is already on screen and a search box is chrome, not
// help. Six is roughly where a list stops fitting on a small phone.
const SEARCH_FROM = 6;

/**
 * The control that opens a picker: a label, the current value, and a chevron.
 *
 * Replaces the horizontal pill strip the tasks screen used to have — a strip
 * silently hides its later options off the right edge, which is exactly the
 * failure mode a picker exists to avoid.
 */
export function PickerField({
  label,
  value,
  muted,
  disabled,
  tone = "light",
  onPress,
}: {
  label: string;
  value: string;
  /** The value is a placeholder, not a real choice. */
  muted?: boolean;
  disabled?: boolean;
  /** `onBrand` for the navy timer hero, `light` for a normal page background. */
  tone?: "light" | "onBrand";
  onPress: () => void;
}) {
  const onBrand = tone === "onBrand";
  const hint = onBrand ? colors.onBrandMuted : colors.faint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={disabled ? undefined : "Opens a list to choose from"}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        f.field,
        onBrand ? f.fieldOnBrand : f.fieldLight,
        { opacity: disabled ? 0.55 : pressed ? 0.8 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[f.label, onBrand && { color: colors.onBrandMuted, letterSpacing: 0.6 }]}>
          {label}
        </Text>
        <Text
          style={[f.value, onBrand && { color: colors.onDark }, muted && { color: hint }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
      {!disabled ? <Ionicons name="chevron-down" size={18} color={hint} /> : null}
    </Pressable>
  );
}

/** Bottom sheet of options, filterable once the list is long enough to need it. */
export function PickerSheet({
  visible,
  title,
  items,
  selectedId,
  onSelect,
  onClose,
  emptyText = "Nothing to choose yet.",
}: {
  visible: boolean;
  title: string;
  items: PickerItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Shown when the caller has no options at all — distinct from "no match". */
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");

  // A filter left over from the last time the sheet was open would hide options
  // with no visible reason why.
  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      needle
        ? items.filter((i) => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(needle))
        : items,
    [items, needle]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={s.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title.toLowerCase()}`}
        />
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          {items.length >= SEARCH_FROM ? (
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={colors.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={s.search}
                accessibilityLabel={`Search ${title.toLowerCase()}`}
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={() => setQuery("")}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {items.length === 0 ? (
            <Empty text={emptyText} />
          ) : filtered.length === 0 ? (
            <Empty text={`Nothing here matches “${query.trim()}”.`} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              // Without this a tap while the keyboard is up only dismisses the
              // keyboard and the row never registers.
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === selectedId }}
                  onPress={() => onSelect(item.id)}
                  style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>{item.label}</Text>
                    {item.sub ? <Text style={s.rowSub}>{item.sub}</Text> : null}
                  </View>
                  {item.id === selectedId ? (
                    <Ionicons name="checkmark" size={20} color={colors.brand} />
                  ) : null}
                </Pressable>
              )}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const f = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  fieldLight: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldOnBrand: { backgroundColor: "rgba(255,255,255,0.10)" },
  label: { fontFamily: fonts.bodyMedium, fontSize: 11, color: colors.textMuted, letterSpacing: 0.6 },
  value: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text },
});

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(13,16,32,0.45)" },
  sheet: {
    maxHeight: "72%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { flex: 1, fontFamily: fonts.headingMedium, fontSize: 18, color: colors.text },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
  },
  search: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.text },
  rowSub: { fontFamily: fonts.body, fontSize: 12, color: colors.faint },
});
