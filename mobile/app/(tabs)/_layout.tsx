import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/ThemeProvider";
import { fonts } from "../../src/theme";

// What @react-navigation/bottom-tabs v7 actually lays out inside each tab, in
// dp: its own vertical padding, the icon wrapper (fixed at 28 tall, holding a
// 25dp glyph), and the label beneath. A `height` in `tabBarStyle` wins over the
// library's own measurement and is taken verbatim — it does not grow to fit —
// so if these don't add up the label is what gets clipped. The bar was 62dp
// against a 53dp+ content box, which is why the labels looked cut off.
const ITEM_PADDING = 5;
const ICON_BOX = 28;
const LABEL_SIZE = 11;
// Set explicitly: Outfit's own line box is taller than the glyphs need, and
// leaving it to the font is the other half of the cropped-label problem.
const LABEL_LINE = 15;
const BAR_PADDING_TOP = 6;
const BAR_PADDING_BOTTOM = 8;

export default function TabsLayout() {
  const { colors } = useTheme();
  // react-navigation's bottom-tabs normally folds the bottom safe-area inset
  // into both the bar's height and its bottom padding — but only when
  // `tabBarStyle` leaves `height` unset. The fixed `height` below bypasses that
  // (it wins the style merge over the library's own inset-aware value), so both
  // numbers add the inset back in by hand. Without this, the tab labels sit
  // flush against — or under — a gesture-nav pill or a 3-button Android nav bar.
  const insets = useSafeAreaInsets();

  // Labels scale with the OS font-size setting; a hard-coded bar height does
  // not, so at "Large"/"Largest" text the label ran past the bar and was cut.
  // Grow the bar with the scale instead, capped so an extreme setting can't
  // hand a quarter of the screen to the tab bar.
  const { fontScale } = useWindowDimensions();
  const labelHeight = Math.ceil(LABEL_LINE * Math.min(Math.max(fontScale, 1), 1.5));
  const barHeight =
    BAR_PADDING_TOP + ITEM_PADDING * 2 + ICON_BOX + labelHeight + BAR_PADDING_BOTTOM;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: barHeight + insets.bottom,
          paddingBottom: BAR_PADDING_BOTTOM + insets.bottom,
          paddingTop: BAR_PADDING_TOP,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: LABEL_SIZE,
          lineHeight: LABEL_LINE,
          // Android pads text by the font's own ascent/descent metrics on top
          // of the line box, which pushes a custom font's descenders out of the
          // bar. The explicit lineHeight above replaces what this padding was
          // (badly) providing.
          includeFontPadding: false,
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Timer",
          tabBarIcon: ({ color, size }) => <Ionicons name="timer-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="timesheets"
        options={{
          title: "Timesheets",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
