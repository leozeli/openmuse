import assert from "node:assert/strict";
import { test } from "node:test";
import { pointFromContextMenu, readSegmentSelection } from "../src/segment-export.ts";

const userNode = { kind: "user" };
const assistantNode = { kind: "assistant" };

test("a highlight inside one message keeps that speaker", () => {
  const previous = globalThis.window;
  globalThis.window = {
    getSelection: () => ({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => " Saturday\u00a0plan ",
      getRangeAt: () => ({ startContainer: userNode, endContainer: userNode }),
    }),
  } as unknown as Window & typeof globalThis;
  try {
    assert.deepEqual(
      readSegmentSelection([
        {
          id: "u1",
          role: "user",
          contains: (node) => node === (userNode as unknown as Node),
        },
        {
          id: "a1",
          role: "assistant",
          contains: (node) => node === (assistantNode as unknown as Node),
        },
      ]),
      { text: "Saturday plan", role: "user" },
    );
  } finally {
    globalThis.window = previous;
  }
});

test("a highlight across messages stays unlabeled, and an empty range is ignored", () => {
  const previous = globalThis.window;
  globalThis.window = {
    getSelection: () => ({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "question\nreply",
      getRangeAt: () => ({ startContainer: userNode, endContainer: assistantNode }),
    }),
  } as unknown as Window & typeof globalThis;
  try {
    assert.deepEqual(
      readSegmentSelection([
        {
          id: "u1",
          role: "user",
          contains: (node) => node === (userNode as unknown as Node),
        },
        {
          id: "a1",
          role: "assistant",
          contains: (node) => node === (assistantNode as unknown as Node),
        },
      ]),
      { text: "question\nreply", role: null },
    );
    globalThis.window = {
      getSelection: () => ({
        isCollapsed: true,
        rangeCount: 1,
        toString: () => "hidden",
        getRangeAt: () => ({ startContainer: userNode, endContainer: userNode }),
      }),
    } as unknown as Window & typeof globalThis;
    assert.equal(readSegmentSelection([]), null);
  } finally {
    globalThis.window = previous;
  }
});

test("context menu position prefers viewport coordinates", () => {
  assert.deepEqual(
    pointFromContextMenu({
      clientX: 12,
      clientY: 40,
      pageX: 99,
      pageY: 100,
    }),
    { x: 12, y: 40 },
  );
  assert.deepEqual(pointFromContextMenu({ nativeEvent: { pageX: 8, pageY: 9 } }), { x: 8, y: 9 });
  assert.deepEqual(pointFromContextMenu({}), { x: 0, y: 0 });
});
