import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { conversationToMarkdown } from "../packages/domain/src/conversation-markdown.ts";

let db: Store, directory: string, localToken: string, richToken: string;
let localApp: Awaited<ReturnType<typeof createApp>>["app"];
let richApp: Awaited<ReturnType<typeof createApp>>["app"];

function configFor(dataDir: string, intelligenceApiKey?: string): Config {
  return {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
    ...(intelligenceApiKey ? { intelligenceApiKey } : {}),
  };
}
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-export-"));
  db = await createStore();
  ({ app: localApp } = await createApp(db, configFor(directory)));
  ({ app: richApp } = await createApp(
    db,
    configFor(join(directory, "rich"), "test-project-key-never-sent"),
  ));
  const session = async (app: typeof localApp) => {
    const response = await app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).token as string;
  };
  localToken = await session(localApp);
  richToken = await session(richApp);
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("local Markdown export requires a session and stays with that owner", async () => {
  assert.equal((await localApp.request("/api/conversation/export")).status, 401);
  const empty = await localApp.request("/api/conversation/export", {
    headers: headers(localToken),
  });
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.match(
    await empty.text(),
    /# Main chat\n\n_Exported \d{4}-\d{2}-\d{2}_\n\n_No messages yet\._/,
  );

  await db.put("other-user", "conversations", {
    id: "default",
    messages: [{ id: "other", role: "user", content: "other-owner-secret" }],
  });
  await db.put("local-user", "conversations", {
    id: "default",
    messages: [
      { id: "user-1", role: "user", content: "Pack the permission slip" },
      { id: "assistant-1", role: "assistant", content: "I can fill that form." },
    ],
  });
  const saved = await localApp.request("/api/conversation/export?userId=other-user", {
    headers: headers(localToken),
  });
  assert.equal(saved.status, 200);
  const body = await saved.text();
  assert.match(body, /## User\n\nPack the permission slip/);
  assert.match(body, /## Assistant\n\nI can fill that form\./);
  assert.equal(body.includes("other-owner-secret"), false);
  assert.match(
    saved.headers.get("content-disposition") || "",
    /filename="main-chat-\d{4}-\d{2}-\d{2}\.md"/,
  );
  assert.equal(
    (await localApp.request("/api/threads/thread-1/export", { headers: headers(localToken) }))
      .status,
    404,
  );

  await db.put("local-user", "tasks", {
    id: "task-wecom",
    title: "企微调研",
    prompt: "hidden-task-prompt",
    kind: "agent",
    status: "succeeded",
    plan: [
      { id: "s1", title: "Search", status: "succeeded" },
      { id: "s2", title: "Read", status: "succeeded" },
      { id: "s3", title: "Write", status: "succeeded" },
    ],
    evidence: [],
    input: {},
    state: {},
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    attempts: 1,
    artifactIds: [],
    result: "调研完成，报告已保存。",
  });
  await db.put("local-user", "agent-artifacts", {
    id: "art-wecom",
    taskId: "task-wecom",
    kind: "report",
    title: "企微调研报告",
    summary: "Public pages describe the product.",
    data: { EVIDENCE: ["Pricing page lists the public API."] },
    createdAt: "2026-10-15T00:00:00.000Z",
  });
  await db.put("local-user", "conversations", {
    id: "default",
    messages: [
      { id: "u4", role: "user", content: "你先看这来" },
      {
        id: "a4",
        role: "assistant",
        content: "那我先按公开资料做企微调研。",
        toolCalls: [
          {
            id: "call-wecom",
            type: "function",
            function: { name: "delegate_task", arguments: '{"prompt":"secret-task"}' },
          },
        ],
      },
      { id: "t1", role: "tool", toolCallId: "call-wecom", content: '{"id":"task-wecom"}' },
      { id: "a5", role: "assistant", content: "已创建后台调研任务，目前排队中。" },
    ],
  });
  const hydrated = await localApp.request("/api/conversation/export", {
    headers: headers(localToken),
  });
  assert.equal(hydrated.status, 200);
  const report = await hydrated.text();
  assert.match(report, /### 企微调研\n\nSucceeded · 3\/3 steps/);
  assert.match(report, /调研完成，报告已保存。/);
  assert.match(report, /### 企微调研报告\n\nReport\n\nPublic pages describe the product\./);
  assert.match(report, /\*\*EVIDENCE\*\*\n\nPricing page lists the public API\./);
  assert.match(report, /已创建后台调研任务/);
  assert.equal(report.includes("_[Tool: delegate_task]_"), false);
  assert.equal(report.includes("secret-task"), false);
  assert.equal(report.includes("hidden-task-prompt"), false);
});

test("Rich Threads export loads the selected thread for the session owner", async (t) => {
  const threadCalls: { threadId: string; userId: string }[] = [];
  const messageCalls: { threadId: string; userId: string }[] = [];
  t.mock.method(
    CopilotKitIntelligence.prototype,
    "getThread",
    async (input: { threadId: string; userId: string }) => {
      threadCalls.push(input);
      return {
        id: input.threadId,
        name: input.userId === "local-user" ? "Weekend plans" : "Stolen",
        createdAt: "2026-03-01T15:04:05.000Z",
      };
    },
  );
  t.mock.method(
    CopilotKitIntelligence.prototype,
    "getThreadMessages",
    async (input: { threadId: string; userId: string }) => {
      messageCalls.push(input);
      return {
        messages: [
          {
            id: "user-1",
            role: "user",
            content:
              input.userId === "local-user" ? "Pack the permission slip" : "other-owner-secret",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "Checking.",
            toolCalls: [
              { id: "call-1", name: "browse_web", args: '{"secret":"tool-secret-value"}' },
            ],
          },
          { id: "tool-1", role: "tool", toolCallId: "call-1", content: "tool-secret-value" },
        ],
      };
    },
  );
  assert.equal((await richApp.request("/api/threads/thread-1/export")).status, 401);
  const response = await richApp.request("/api/threads/thread-1/export?userId=forged", {
    headers: headers(richToken),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const markdown = await response.text();
  assert.equal(
    markdown,
    conversationToMarkdown({
      title: "Weekend plans",
      date: "2026-03-01T15:04:05.000Z",
      messages: [
        { id: "user-1", role: "user", content: "Pack the permission slip" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Checking.",
          toolCalls: [{ id: "call-1", name: "browse_web", args: '{"secret":"tool-secret-value"}' }],
        },
        { id: "tool-1", role: "tool", toolCallId: "call-1", content: "tool-secret-value" },
      ],
    }),
  );
  assert.equal(markdown.includes("other-owner-secret"), false);
  assert.equal(markdown.includes("tool-secret-value"), false);
  assert.deepEqual(threadCalls, [{ threadId: "thread-1", userId: "local-user" }]);
  assert.deepEqual(messageCalls, [{ threadId: "thread-1", userId: "local-user" }]);
  assert.match(
    response.headers.get("content-disposition") || "",
    /filename="weekend-plans-2026-03-01\.md"/,
  );

  threadCalls.length = 0;
  messageCalls.length = 0;
  assert.equal(
    (await richApp.request("/api/threads/not%20safe/export", { headers: headers(richToken) }))
      .status,
    404,
  );
  assert.equal(threadCalls.length, 0);
  assert.equal(messageCalls.length, 0);

  const missedMessages: unknown[] = [];
  t.mock.method(CopilotKitIntelligence.prototype, "getThread", async () => {
    throw Object.assign(new Error("missing thread"), { status: 404 });
  });
  t.mock.method(CopilotKitIntelligence.prototype, "getThreadMessages", async (input: unknown) => {
    missedMessages.push(input);
    return { messages: [] };
  });
  const missing = await richApp.request("/api/threads/thread-404/export", {
    headers: headers(richToken),
  });
  assert.equal(missing.status, 404);
  assert.equal(missedMessages.length, 0);

  t.mock.method(CopilotKitIntelligence.prototype, "getThread", async () => {
    throw new Error("test-project-key-never-sent");
  });
  const failed = await richApp.request("/api/threads/thread-1/export", {
    headers: headers(richToken),
  });
  assert.equal(failed.status, 502);
  const body = await failed.text();
  assert.match(body, /Conversation could not be exported/);
  assert.equal(body.includes("test-project-key-never-sent"), false);
});
