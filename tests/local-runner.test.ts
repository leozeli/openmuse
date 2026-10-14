import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { agentRunnerPath } from "../apps/server/src/agent.ts";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";

const phrase = "Remember the aquarium trip";

function configFor(dataDir: string): Config {
  return {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir,
    agentBackend: "sample",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: ["http://localhost:8081"],
  };
}

async function sessionToken(app: Awaited<ReturnType<typeof createApp>>["app"]) {
  const session = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(session.status, 200, await session.clone().text());
  return (await session.json()).token as string;
}

test("the API boots without an Intelligence key and keeps a stable local main thread", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-local-boot-"));
  const db = await createStore();
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const calls: unknown[] = [];
  t.mock.method(CopilotKitIntelligence.prototype, "getOrCreateThread", async (input: unknown) => {
    calls.push(input);
    throw new Error("Intelligence should not be used");
  });
  const { app } = await createApp(db, configFor(directory));
  const token = await sessionToken(app);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  assert.equal((await app.request("/api/health")).status, 200);
  const workspace = await app.request("/api/workspace", { headers });
  const body = await workspace.text();
  assert.equal(JSON.parse(body).runtime.richThreads, false);
  const first = await (await app.request("/api/main-thread", { headers })).json();
  const reopened = await (await app.request("/api/main-thread", { headers })).json();
  assert.match(first.threadId, /^[0-9a-f-]{36}$/i);
  assert.equal(first.existing, true);
  assert.equal(reopened.threadId, first.threadId);
  assert.equal(calls.length, 0);
  const sqlite = new DatabaseSync(agentRunnerPath(directory), { readOnly: true });
  try {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    const names = new Set(tables.map((table) => table.name));
    for (const name of ["agent_runs", "run_state", "schema_version"]) assert.ok(names.has(name));
  } finally {
    sqlite.close();
  }
});

test("a local conversation survives restart through the workspace store and sqlite runner", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-local-restart-"));
  const postgres = join(directory, "postgres");
  let db: Store | undefined;
  t.after(async () => {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  });
  db = await createStore({ dataDir: postgres });
  let { app } = await createApp(db, configFor(directory));
  const token = await sessionToken(app);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const message = { id: randomUUID(), role: "user", content: phrase };
  const saved = await app.request("/api/conversation", {
    method: "PUT",
    headers,
    body: JSON.stringify({ messages: [message] }),
  });
  assert.equal(saved.status, 200, await saved.clone().text());
  const run = await app.request("/api/copilotkit/agent/default/run", {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId: "local-main",
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: "Show my calendar" }],
      tools: [],
      context: [],
      state: {},
    }),
  });
  const streamed = await run.text();
  assert.equal(run.status, 200, streamed);
  assert.match(streamed, /Your local calendar has/);
  await db.close();

  db = await createStore({ dataDir: postgres });
  ({ app } = await createApp(db, configFor(directory)));
  const reloaded = await app.request("/api/conversation", { headers });
  assert.equal(reloaded.status, 200, await reloaded.clone().text());
  assert.deepEqual((await reloaded.json()).messages, [message]);
  const sqlite = new DatabaseSync(agentRunnerPath(directory), { readOnly: true });
  try {
    const row = sqlite
      .prepare("SELECT events FROM agent_runs WHERE thread_id = ?")
      .get("local-main") as { events: string } | undefined;
    assert.match(row?.events ?? "", /Your local calendar has/);
  } finally {
    sqlite.close();
  }
  const replay = await app.request("/api/copilotkit/agent/default/connect", {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId: "local-main",
      runId: randomUUID(),
      messages: [],
      tools: [],
      context: [],
      state: {},
    }),
  });
  const replayed = await replay.text();
  assert.equal(replay.status, 200, replayed);
  assert.match(replayed, /Your local calendar has/);
});
