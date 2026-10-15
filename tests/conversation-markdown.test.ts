import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationExportFilename,
  conversationMarkdownDisposition,
  conversationSegmentFilename,
  conversationSegmentMessages,
  conversationToMarkdown,
  filenameFromContentDisposition,
  selectionToMarkdown,
} from "../packages/domain/src/conversation-markdown.ts";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("conversation Markdown keeps title, date, and speaker text", () => {
  const markdown = conversationToMarkdown({
    title: "Weekend plans",
    date: "2026-03-01T15:04:05.000Z",
    exportedAt: "2026-10-14T09:00:00.000Z",
    messages: [
      { id: "u1", role: "user", content: "Find a Saturday plan.\r\nKeep it short." },
      {
        id: "a1",
        role: "assistant",
        content: "Here is a **short** plan.\n\n- Walk\n- Lunch",
      },
    ],
  });
  assert.equal(
    markdown,
    `# Weekend plans

_2026-03-01_

## User

Find a Saturday plan.
Keep it short.

## Assistant

Here is a **short** plan.

- Walk
- Lunch
`,
  );
});

test("missing conversation date uses the export day", () => {
  const markdown = conversationToMarkdown({
    title: "",
    exportedAt: "2026-10-14T23:30:00.000Z",
    messages: [],
  });
  assert.equal(
    markdown,
    `# Conversation

_Exported 2026-10-14_

_No messages yet._
`,
  );
});

test("titles stay on one line and filenames are safe", () => {
  assert.equal(
    conversationToMarkdown({
      title: "Hello\n# injected",
      exportedAt: "not-a-date",
      messages: [{ role: "user", content: "Hi" }],
    }).split("\n")[0],
    "# Hello # injected",
  );
  assert.equal(
    conversationExportFilename("Café: Weekend plans!", new Date("2026-03-01T00:00:00.000Z")),
    "cafe-weekend-plans-2026-03-01.md",
  );
  assert.equal(
    conversationExportFilename("   ", new Date("2026-03-01T00:00:00.000Z")),
    "conversation-2026-03-01.md",
  );
  const disposition = conversationMarkdownDisposition("cafe-weekend-plans-2026-03-01.md");
  assert.equal(
    disposition,
    "attachment; filename=\"cafe-weekend-plans-2026-03-01.md\"; filename*=UTF-8''cafe-weekend-plans-2026-03-01.md",
  );
  assert.doesNotMatch(conversationMarkdownDisposition("bad\r\nname.md"), /[\r\n]/);
  assert.equal(
    filenameFromContentDisposition(conversationMarkdownDisposition("weekend-plans-2026-03-01.md")),
    "weekend-plans-2026-03-01.md",
  );
  assert.equal(filenameFromContentDisposition(null), null);
  assert.equal(filenameFromContentDisposition('attachment; filename="notes.txt"'), null);
  assert.equal(filenameFromContentDisposition("attachment; filename*=UTF-8''..%2Fsecret.md"), null);
});

test("images and tools are noted without their payloads", () => {
  const toolPayload = `{"html":"<script>${"x".repeat(40)}</script>","secret":"tool-secret-value"}`;
  const markdown = conversationToMarkdown({
    title: "Lookup",
    date: "2026-03-01T00:00:00.000Z",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is on this page?" },
          { type: "image", source: { type: "data", value: image, mimeType: "image/png" } },
          { type: "binary", mimeType: "application/pdf", filename: "../slip.pdf", data: image },
        ],
      },
      {
        role: "assistant",
        content: "Checking.",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "browse_web", arguments: toolPayload },
          },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: toolPayload },
      {
        role: "assistant",
        toolCalls: [{ id: "call-2", name: "search_web", args: toolPayload }],
      },
      { role: "tool", toolCallId: "call-orphan", content: toolPayload },
    ],
  });
  assert.match(
    markdown,
    /## User\n\nWhat is on this page\?\n\n_\[Image omitted\]_\n\n_\[File omitted: slip\.pdf\]_/,
  );
  assert.match(markdown, /## Assistant\n\nChecking\.\n\n_\[Tool: browse_web\]_/);
  assert.match(markdown, /_\[Tool: search_web\]_/);
  assert.match(markdown, /_\[Tool result omitted\]_/);
  assert.equal(markdown.includes("tool-secret-value"), false);
  assert.equal(markdown.includes(image), false);
  assert.equal(markdown.includes("<script>"), false);
});

test("hidden prompts and non-text turns are not copied into the file", () => {
  const markdown = conversationToMarkdown({
    messages: [
      null,
      "skip",
      { role: "system", content: "SYSTEM PROMPT secret-instructions" },
      { role: "developer", content: "DEVELOPER PROMPT secret-instructions" },
      { role: "reasoning", content: "chain-of-thought secret-instructions" },
      { role: "activity", activityType: "search", content: { secret: "secret-instructions" } },
      { role: "critic", content: "secret-instructions" },
      { role: "user", content: "   " },
      { role: "assistant", encryptedValue: "ciphertext-secret" },
    ],
  });
  assert.equal(markdown.includes("secret-instructions"), false);
  assert.equal(markdown.includes("ciphertext-secret"), false);
  assert.match(markdown, /_\[Reasoning omitted\]_/);
  assert.match(markdown, /_\[Activity: search\]_/);
  assert.match(markdown, /_\[Message omitted\]_/);
  assert.match(markdown, /_\[Encrypted message omitted\]_/);
});

const thread = [
  { id: "sys", role: "system", content: "SYSTEM PROMPT secret-instructions" },
  { id: "u1", role: "user", content: "First question" },
  {
    id: "a1",
    role: "assistant",
    content: "First reply",
    toolCalls: [
      { id: "call-1", type: "function", function: { name: "search_web", arguments: "{}" } },
    ],
  },
  { id: "t1", role: "tool", toolCallId: "call-1", content: "payload-secret" },
  { id: "u2", role: "user", content: "Second question" },
  { id: "a2", role: "assistant", content: "Second reply" },
];

test("a turn runs from the question through the reply before the next question", () => {
  const fromReply = conversationSegmentMessages(thread, { id: "a1", index: 0 }, "turn");
  const fromQuestion = conversationSegmentMessages(thread, { id: "u1", index: 99 }, "turn");
  assert.deepEqual(
    fromReply.map((message) => (message as { id: string }).id),
    ["u1", "a1", "t1"],
  );
  assert.deepEqual(fromQuestion, fromReply);
  const markdown = conversationToMarkdown({
    title: "Turn",
    exportedAt: "2026-10-15T03:00:00.000Z",
    messages: fromReply,
  });
  assert.match(markdown, /# Turn\n\n_Exported 2026-10-15_/);
  assert.match(markdown, /## User\n\nFirst question/);
  assert.match(markdown, /## Assistant\n\nFirst reply\n\n_\[Tool: search_web\]_/);
  assert.equal(markdown.includes("Second"), false);
  assert.equal(markdown.includes("secret-instructions"), false);
  assert.equal(markdown.includes("payload-secret"), false);
  assert.deepEqual(
    conversationSegmentMessages(thread, { id: "u2", index: 0 }, "turn").map(
      (message) => (message as { id: string }).id,
    ),
    ["u2", "a2"],
  );
});

test("one message is exported alone, and a missing id does not fall back to another index", () => {
  const slice = conversationSegmentMessages(thread, { id: "a1", index: 1 }, "message");
  assert.deepEqual(
    slice.map((message) => (message as { id: string }).id),
    ["a1"],
  );
  assert.equal(
    conversationSegmentMessages(thread, { id: "missing", index: 1 }, "message").length,
    0,
  );
  assert.equal(conversationSegmentMessages(thread, { id: "missing", index: 1 }, "turn").length, 0);
  const unmarked = [
    { role: "assistant", content: "Hello" },
    { role: "user", content: "Hi" },
  ];
  assert.equal(conversationSegmentMessages(unmarked, { index: 0 }, "turn").length, 1);
  assert.equal(
    (conversationSegmentMessages(unmarked, { index: 1 }, "message")[0] as { content: string })
      .content,
    "Hi",
  );
});

test("selection markdown keeps one speaker and leaves a mixed range unlabeled", () => {
  assert.equal(
    selectionToMarkdown({
      text: "  Saturday plan\u00a0",
      role: "assistant",
      exportedAt: "2026-10-15T03:00:00.000Z",
    }),
    `# Selection

_Exported 2026-10-15_

## Assistant

Saturday plan
`,
  );
  const mixed = selectionToMarkdown({
    text: "First question\nSecond reply",
    role: null,
    exportedAt: "2026-10-15T03:00:00.000Z",
  });
  assert.equal(mixed.includes("## User"), false);
  assert.equal(mixed.includes("## Assistant"), false);
  assert.match(mixed, /# Selection\n\n_Exported 2026-10-15_\n\nFirst question\nSecond reply\n/);
  assert.match(
    selectionToMarkdown({ text: "   ", exportedAt: "2026-10-15T00:00:00.000Z" }),
    /_No messages yet\._/,
  );
  assert.equal(
    conversationSegmentFilename("selection", new Date("2026-10-15T23:30:00.000Z")),
    "selection-2026-10-15.md",
  );
  assert.equal(
    conversationSegmentFilename("turn", new Date("2026-10-15T00:30:00.000Z")),
    "turn-2026-10-15.md",
  );
  assert.equal(
    conversationSegmentFilename("message", new Date("2026-03-01T00:00:00.000Z")),
    "message-2026-03-01.md",
  );
});
