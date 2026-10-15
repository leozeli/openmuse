/** A saved conversation the user can export without opening it. */
export interface ConversationExportChoice {
  id: string;
  name?: string | null;
  archived?: boolean;
}

export interface ExportTarget {
  id: string;
  title: string;
  detail: string;
  path: string;
}

const threadIdPattern = /^[\w.@:=-]{1,128}$/;

/** API path for one chosen conversation. Null when the id cannot be exported. */
export function conversationExportPath(richThreads: boolean, id: string): string | null {
  if (!richThreads) return "/api/conversation/export";
  if (!threadIdPattern.test(id)) return null;
  return `/api/threads/${encodeURIComponent(id)}/export`;
}

/**
 * Conversations to offer in the export picker.
 * The open chat is only a label. Each path is that row's own transcript.
 */
export function conversationExportTargets(input: {
  richThreads: boolean;
  mainId: string;
  openId?: string;
  threads?: readonly ConversationExportChoice[];
  includeArchived?: boolean;
}): ExportTarget[] {
  if (!input.richThreads) {
    return [
      {
        id: "local",
        title: "Main chat",
        detail: "Saved in this workspace",
        path: "/api/conversation/export",
      },
    ];
  }
  const targets: ExportTarget[] = [];
  const seen = new Set<string>();
  const mainPath = conversationExportPath(true, input.mainId);
  if (mainPath) {
    seen.add(input.mainId);
    targets.push({
      id: input.mainId,
      title: "Main chat",
      detail: input.openId === input.mainId ? "Open now" : "Your ongoing conversation",
      path: mainPath,
    });
  }
  for (const thread of input.threads ?? []) {
    if (seen.has(thread.id)) continue;
    const archived = thread.archived === true;
    if (archived !== (input.includeArchived === true)) continue;
    const path = conversationExportPath(true, thread.id);
    if (!path) continue;
    seen.add(thread.id);
    let detail = "Side chat";
    if (archived) detail = "Archived";
    if (input.openId === thread.id) detail = "Open now";
    targets.push({
      id: thread.id,
      title: thread.name?.trim() || "Untitled conversation",
      detail,
      path,
    });
  }
  return targets;
}
