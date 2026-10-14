import assert from "node:assert/strict";
import test from "node:test";
import { conversationExportPath, conversationExportTargets } from "../src/export-targets.ts";

test("local mode offers the workspace chat and ignores other threads", () => {
  assert.deepEqual(
    conversationExportTargets({
      richThreads: false,
      mainId: "main-id",
      openId: "side-open",
      threads: [{ id: "side-open", name: "Aquarium" }],
    }),
    [
      {
        id: "local",
        title: "Main chat",
        detail: "Saved in this workspace",
        path: "/api/conversation/export",
      },
    ],
  );
  assert.equal(conversationExportPath(false, "anything"), "/api/conversation/export");
});

test("the picker exports each saved chat, not whichever chat is open", () => {
  const targets = conversationExportTargets({
    richThreads: true,
    mainId: "main-id",
    openId: "side-open",
    threads: [
      { id: "side-open", name: "Aquarium" },
      { id: "side-other", name: "   " },
      { id: "main-id", name: "Should not duplicate" },
      { id: "old", name: "Old", archived: true },
      { id: "bad id", name: "Nope" },
    ],
  });
  assert.deepEqual(
    targets.map((target) => [target.id, target.title, target.detail, target.path]),
    [
      ["main-id", "Main chat", "Your ongoing conversation", "/api/threads/main-id/export"],
      ["side-open", "Aquarium", "Open now", "/api/threads/side-open/export"],
      ["side-other", "Untitled conversation", "Side chat", "/api/threads/side-other/export"],
    ],
  );
  assert.equal(
    targets.some((target) => target.path.includes("side-open") && target.id !== "side-open"),
    false,
  );
  assert.equal(conversationExportPath(true, "user@thread"), "/api/threads/user%40thread/export");
});

test("archived picker keeps main chat and lists only archived side chats", () => {
  const targets = conversationExportTargets({
    richThreads: true,
    mainId: "main-id",
    openId: "main-id",
    includeArchived: true,
    threads: [
      { id: "active", name: "Active" },
      { id: "old", name: "Old", archived: true },
    ],
  });
  assert.deepEqual(
    targets.map((target) => [target.id, target.detail]),
    [
      ["main-id", "Open now"],
      ["old", "Archived"],
    ],
  );
});

test("unsafe thread ids are left out of the picker", () => {
  assert.equal(conversationExportPath(true, "../secret"), null);
  assert.equal(conversationExportPath(true, ""), null);
  const targets = conversationExportTargets({
    richThreads: true,
    mainId: "not safe",
    threads: [{ id: "ok-thread", name: "Ok" }],
  });
  assert.deepEqual(
    targets.map((target) => target.path),
    ["/api/threads/ok-thread/export"],
  );
});
