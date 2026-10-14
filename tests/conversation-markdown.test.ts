import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationExportFilename,
  conversationMarkdownDisposition,
  conversationToMarkdown,
  filenameFromContentDisposition,
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
