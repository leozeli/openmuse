import { type ComponentProps, type ReactNode, useEffect } from "react";
import {
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SegmentContextEvent } from "./segment-export";
import { colors, s } from "./ui";

export function MessageSegmentFrame({
  hint,
  style,
  onContextMenu,
  onLongPress,
  onHost,
  children,
}: {
  hint: string;
  style: ViewStyle;
  onContextMenu: (event: SegmentContextEvent) => void;
  onLongPress: () => void;
  onHost: (node: Element | null) => void;
  children: ReactNode;
}) {
  if (Platform.OS === "web") {
    const props = {
      accessibilityHint: hint,
      style,
      ref: (node: unknown) => {
        onHost(typeof Element !== "undefined" && node instanceof Element ? node : null);
      },
      onContextMenu: (event: SegmentContextEvent) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onContextMenu(event);
      },
    };
    return <View {...(props as unknown as ComponentProps<typeof View>)}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityHint={hint}
      delayLongPress={480}
      onLongPress={onLongPress}
      style={style}
    >
      {children}
    </Pressable>
  );
}

export function MessageSegmentMenu({
  anchor,
  hasSelection,
  onExportSelection,
  onExportTurn,
  onExportMessage,
  onClose,
}: {
  anchor: { x: number; y: number } | null;
  hasSelection: boolean;
  onExportSelection: () => void;
  onExportTurn: () => void;
  onExportMessage: () => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const menuWidth = 280;
  const menuHeight = hasSelection ? 248 : 196;
  let left = anchor ? anchor.x : Math.max(12, (width - menuWidth) / 2);
  let top = anchor ? anchor.y : undefined;
  if (anchor) {
    if (left + menuWidth > width - 8) left = Math.max(8, width - menuWidth - 8);
    if (left < 8) left = 8;
    if (top !== undefined && top + menuHeight > height - 8)
      top = Math.max(8, anchor.y - menuHeight);
    if (top !== undefined && top < 8) top = 8;
  }
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityLabel="Dismiss export menu"
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <View
          accessibilityRole="menu"
          accessibilityLabel="Export as Markdown"
          style={{
            position: "absolute",
            left,
            top,
            bottom: top === undefined ? Math.max(insets.bottom, 12) : undefined,
            width: menuWidth,
            backgroundColor: colors.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.line,
            padding: 8,
            gap: 2,
          }}
        >
          <Text style={[s.label, { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 }]}>
            Export as Markdown
          </Text>
          {hasSelection && (
            <MenuItem
              label="Export selection"
              detail="Highlighted text"
              onPress={onExportSelection}
            />
          )}
          <MenuItem
            label="Export this turn"
            detail="From the question through the reply"
            onPress={onExportTurn}
          />
          <MenuItem
            label="Export this message"
            detail="Only this message"
            onPress={onExportMessage}
          />
        </View>
      </View>
    </Modal>
  );
}

function MenuItem({
  label,
  detail,
  onPress,
}: {
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: pressed ? colors.sky : "transparent",
      })}
    >
      <Text style={[s.text, { fontWeight: "600" }]}>{label}</Text>
      <Text style={s.small}>{detail}</Text>
    </Pressable>
  );
}
