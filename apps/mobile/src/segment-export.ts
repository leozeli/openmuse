export type SelectionHost = {
  id: string;
  role: "user" | "assistant";
  contains: (node: Node) => boolean;
};

export type SegmentContextEvent = {
  preventDefault?: () => void;
  stopPropagation?: () => void;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  nativeEvent?: {
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
  };
};

type TextSelection = {
  isCollapsed: boolean;
  rangeCount: number;
  toString: () => string;
  getRangeAt: (index: number) => { startContainer: Node; endContainer: Node };
};

/** Highlighted chat text, labeled only when the range stays inside one message. */
export function readSegmentSelection(
  hosts: readonly SelectionHost[],
): { text: string; role: "user" | "assistant" | null } | null {
  const view = (globalThis as { window?: { getSelection?: () => TextSelection | null } }).window;
  if (!view || typeof view.getSelection !== "function") return null;
  const selection = view.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection
    .toString()
    .replace(/\u00a0/g, " ")
    .trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const start = hosts.find((host) => host.contains(range.startContainer));
  const end = hosts.find((host) => host.contains(range.endContainer));
  const role = start && end && start.id === end.id ? start.role : null;
  return { text, role };
}

/** Viewport point for a context menu. `clientX` wins over page coordinates. */
export function pointFromContextMenu(event: SegmentContextEvent): { x: number; y: number } {
  const native = event.nativeEvent;
  return {
    x: firstNumber(event.clientX, native?.clientX, event.pageX, native?.pageX),
    y: firstNumber(event.clientY, native?.clientY, event.pageY, native?.pageY),
  };
}

function firstNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}
