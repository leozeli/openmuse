/** Saved task, browser, and report text shown on a tool card in the chat. */
export interface ExportToolCard {
  task?: unknown;
  browsers?: unknown;
  files?: unknown;
  artifacts?: unknown;
}

/** Tool call id to the card the chat hydrates for that call. */
export type ExportToolCards = Readonly<Record<string, ExportToolCard>>;

/** One conversation rendered as a Markdown download. */
export interface ConversationMarkdownInput {
  title?: string | null;
  /** Conversation date, ISO-8601, when storage has one. */
  date?: string | null;
  /** Download time. Used when `date` is missing. */
  exportedAt?: string | null;
  messages: readonly unknown[];
  /** Readable task and report cards. Absent calls stay a short tool note. */
  toolCards?: ExportToolCards;
}

const speakers = { user: "User", assistant: "Assistant" } as const;

/**
 * Render user and assistant text as labeled sections.
 * A saved task is written as the card in the chat: title, status, result,
 * browser, and report fields. Other tool payloads, images, and hidden
 * prompts stay a short note or are left out.
 */
export function conversationToMarkdown(input: ConversationMarkdownInput): string {
  const title = oneLine(input.title) || "Conversation";
  const date = calendarDay(input.date);
  const exported = calendarDay(input.exportedAt);
  const header = [`# ${title}`];
  if (date) header.push("", `_${date}_`);
  else if (exported) header.push("", `_Exported ${exported}_`);
  const sections = transcriptSections(input.messages, input.toolCards);
  const body = sections.length > 0 ? sections.join("\n\n") : "_No messages yet._";
  return `${header.join("\n")}\n\n${body}\n`;
}

export function conversationExportFilename(title?: string | null, when = new Date()): string {
  const instant = Number.isFinite(when.getTime()) ? when : new Date();
  const slug = oneLine(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "conversation"}-${instant.toISOString().slice(0, 10)}.md`;
}

export function conversationMarkdownDisposition(filename: string): string {
  const ascii = filename.replace(/[^A-Za-z0-9._-]/g, "") || "conversation.md";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(ascii)}`;
}

export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (!match?.[1]) return null;
  try {
    const name = decodeURIComponent(match[1]);
    return /^[\w.-]+\.md$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

const segmentTitles = { selection: "Selection", turn: "Turn", message: "Message" } as const;

export type ConversationSegmentKind = keyof typeof segmentTitles;

/** Where a right-clicked message sits in the loaded transcript. */
export interface ConversationSegmentTarget {
  id?: string | null;
  /**
   * Index in the transcript that was on screen when the menu opened.
   * Used when `id` is empty, and to prefer that row among duplicate ids.
   */
  index: number;
  /** Role and text of the clicked row, so a repeated id does not select a different copy. */
  fingerprint?: string | null;
}

/**
 * Download name for one segment. The day is the UTC calendar day of `when`.
 * `selection-YYYY-MM-DD.md`, `turn-YYYY-MM-DD.md`, or `message-YYYY-MM-DD.md`.
 */
export function conversationSegmentFilename(
  kind: ConversationSegmentKind,
  when = new Date(),
): string {
  return conversationExportFilename(segmentTitles[kind], when);
}

/**
 * Messages for one dialogue turn: the user message that opened it, the reply,
 * and any tool or other non-user messages before the next user message.
 * Right-clicking the reply uses that same turn. A message with no user before
 * it starts at the beginning of that leading run.
 */
export function conversationSegmentMessages(
  messages: readonly unknown[],
  target: ConversationSegmentTarget,
  kind: "turn" | "message",
): unknown[] {
  const index = segmentIndex(messages, target, kind);
  if (index < 0) return [];
  if (kind === "message") return [messages[index] as unknown];
  const { start, end } = turnBounds(messages, index);
  return messages.slice(start, end);
}

/**
 * Pick the transcript whose turn around this message is the most complete.
 * A short in-memory list loses to the saved conversation when that copy
 * still has the question and the follow-up replies.
 */
export function preferSegmentTranscript(
  transcripts: readonly (readonly unknown[])[],
  target: ConversationSegmentTarget,
): readonly unknown[] {
  let best: readonly unknown[] = [];
  let bestSize = -1;
  for (const transcript of transcripts) {
    const size = conversationSegmentMessages(transcript, target, "turn").length;
    if (size > bestSize) {
      best = transcript;
      bestSize = size;
    }
  }
  return best;
}

/** Markdown and filename for one segment. The heading and the file name use the same kind. */
export function conversationSegmentDownload(
  messages: readonly unknown[],
  target: ConversationSegmentTarget,
  kind: "turn" | "message",
  when = new Date(),
  toolCards?: ExportToolCards,
): { markdown: string; filename: string } | null {
  const slice = conversationSegmentMessages(messages, target, kind);
  if (slice.length === 0) return null;
  return {
    markdown: conversationToMarkdown({
      title: segmentTitles[kind],
      exportedAt: when.toISOString(),
      messages: slice,
      toolCards,
    }),
    filename: conversationSegmentFilename(kind, when),
  };
}

/** Assistant tool calls paired with the tool message, when the transcript has one. */
export function conversationToolCalls(
  messages: readonly unknown[],
): { id: string; name: string; result: unknown }[] {
  const calls: { id: string; name: string; result: unknown }[] = [];
  const byId = new Map<string, { id: string; name: string; result: unknown }>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role === "assistant") {
      for (const call of toolCalls(record.toolCalls)) {
        if (!call.id || byId.has(call.id)) continue;
        const entry = { id: call.id, name: call.name, result: undefined as unknown };
        byId.set(call.id, entry);
        calls.push(entry);
      }
    } else if (record.role === "tool" && typeof record.toolCallId === "string") {
      const entry = byId.get(record.toolCallId);
      if (entry && entry.result === undefined) entry.result = record.content;
    }
  }
  return calls;
}

/** Task id stored on a delegate_task (or similar) tool result. */
export function taskIdFromToolResult(result: unknown): string | null {
  let value = result;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return null;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.taskId === "string" ? record.taskId : record.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Stable identity of one message, used to tell two rows with the same id apart. */
export function conversationMessageFingerprint(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "";
  const text = typeof record.content === "string" ? record.content.slice(0, 80) : "";
  const tools = Array.isArray(record.toolCalls) ? record.toolCalls.length : 0;
  return `${role}:${tools}:${text}`;
}

/**
 * Highlighted text in the same shape as a conversation download.
 * A range inside one message keeps that speaker. A range across messages
 * stays plain text, so the file does not invent speakers.
 */
export function selectionToMarkdown(input: {
  text: string;
  role?: "user" | "assistant" | null;
  exportedAt?: string | null;
}): string {
  const text = selectionText(input.text);
  const role = input.role === "user" || input.role === "assistant" ? input.role : null;
  if (role) {
    return conversationToMarkdown({
      title: segmentTitles.selection,
      exportedAt: input.exportedAt,
      messages: text ? [{ role, content: text }] : [],
    });
  }
  const stamped = conversationToMarkdown({
    title: segmentTitles.selection,
    exportedAt: input.exportedAt,
    messages: text ? [{ role: "user", content: text }] : [],
  });
  if (!text) return stamped;
  return stamped.replace("\n\n## User\n\n", "\n\n");
}

function segmentIndex(
  messages: readonly unknown[],
  target: ConversationSegmentTarget,
  kind: "turn" | "message",
): number {
  const id = typeof target.id === "string" ? target.id.trim() : "";
  const fingerprint = typeof target.fingerprint === "string" ? target.fingerprint : "";
  const matches: number[] = [];
  if (id) {
    messages.forEach((message, index) => {
      if (messageId(message) === id) matches.push(index);
    });
  }
  const sameText = fingerprint
    ? matches.filter((index) => conversationMessageFingerprint(messages[index]) === fingerprint)
    : [];
  const candidates = sameText.length > 0 ? sameText : matches;
  if (candidates.length === 1) return candidates[0] as number;
  if (candidates.length > 1) {
    const clicked = candidates.includes(target.index) ? target.index : -1;
    // Export this message stays on the row that was opened.
    if (kind === "message" && clicked >= 0) return clicked;
    // A repeated id must not stick to an earlier stub and drop the rest of the turn.
    let best = candidates[0] as number;
    for (const index of candidates) {
      const span = turnSpan(messages, index);
      const bestSpan = turnSpan(messages, best);
      if (span > bestSpan || (span === bestSpan && index === clicked)) best = index;
    }
    return best;
  }
  if (id) return -1;
  if (!Number.isInteger(target.index) || target.index < 0 || target.index >= messages.length)
    return -1;
  return target.index;
}

function turnBounds(messages: readonly unknown[], index: number): { start: number; end: number } {
  const start = turnStart(messages, index);
  let end = start + 1;
  while (end < messages.length && messageRole(messages[end]) !== "user") end += 1;
  return { start, end };
}

function turnSpan(messages: readonly unknown[], index: number): number {
  const { start, end } = turnBounds(messages, index);
  return end - start;
}

function turnStart(messages: readonly unknown[], index: number): number {
  if (messageRole(messages[index]) === "user") return index;
  let start = index;
  while (start > 0 && messageRole(messages[start - 1]) !== "user") start -= 1;
  if (start > 0 && messageRole(messages[start - 1]) === "user") return start - 1;
  return start;
}

function messageId(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const id = (message as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function messageRole(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role : null;
}

function selectionText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function renderToolCard(card: ExportToolCard | undefined): string {
  if (!card) return "";
  const blocks = [
    renderTask(card.task),
    ...listOf(card.browsers).map(renderBrowser),
    ...newestFiles(card.files).map(renderFile),
    ...listOf(card.artifacts).map(renderArtifact),
  ].filter(Boolean);
  return blocks.join("\n\n");
}

function renderTask(value: unknown): string {
  const task = recordOf(value);
  if (!task || typeof task.title !== "string" || typeof task.status !== "string") return "";
  const plan = listOf(task.plan)
    .map(recordOf)
    .filter((step) => step !== null);
  const done = plan.filter((step) => step.status === "succeeded").length;
  const status = statusLabel(task.status);
  const steps = plan.length ? ` · ${done}/${plan.length} steps` : "";
  const next = plan.find((step) => step.status === "running" || step.status === "waiting");
  const preview = firstText(
    task.question,
    task.error,
    visibleResult(textOf(task.result)),
    next?.title,
  );
  const lines = [`### ${oneLine(task.title) || "Task"}`, "", `${status}${steps}`];
  if (preview) lines.push("", preview);
  if (task.status === "waiting_approval") lines.push("", "Review requested");
  else if (task.status === "waiting_input") lines.push("", "Your input is needed");
  return lines.join("\n");
}

function renderBrowser(value: unknown): string {
  const browser = recordOf(value);
  if (!browser || typeof browser.url !== "string") return "";
  const status = typeof browser.status === "string" ? browser.status : "";
  const detail =
    status === "closed"
      ? "Session saved"
      : status === "error"
        ? "Needs attention"
        : textOf(browser.title);
  const lines = ["### Browser"];
  if (detail) lines.push("", detail);
  if (browser.url.trim()) lines.push("", browser.url.trim());
  return lines.join("\n");
}

function renderFile(value: unknown): string {
  const file = recordOf(value);
  if (!file || typeof file.name !== "string" || !file.name.trim()) return "";
  const pages = typeof file.pageCount === "number" ? file.pageCount : 0;
  const pageLabel = pages === 1 ? "1 page" : `${pages} pages`;
  const heading = oneLine(file.name.replace(/\.pdf$/i, "")) || "File";
  const pdf = pages ? `PDF · ${pageLabel}` : "PDF";
  return `### ${heading}\n\n${file.name.trim()}\n\n${pdf}`;
}

function renderArtifact(value: unknown): string {
  const artifact = recordOf(value);
  if (!artifact || typeof artifact.title !== "string") return "";
  const kind = typeof artifact.kind === "string" ? statusLabel(artifact.kind) : "";
  const summary = textOf(artifact.summary);
  const lines = [`### ${oneLine(artifact.title) || "Result"}`];
  if (kind) lines.push("", kind);
  if (summary) lines.push("", summary);
  const data = recordOf(artifact.data);
  if (data) {
    for (const [key, field] of Object.entries(data)) {
      const body = renderField(field);
      const label = fieldLabel(key);
      if (label && body) lines.push("", `**${label}**`, "", body);
    }
  }
  return lines.join("\n");
}

function renderField(value: unknown): string {
  const data = recordOf(value);
  if (data) {
    return Object.entries(data)
      .map(([name, item]) => {
        const text = renderValue(item);
        return text ? `${name}: ${text.replace(/\n+/g, " ")}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return renderValue(value);
}

function renderValue(value: unknown): string {
  if (typeof value === "string") return value.replace(/\r\n/g, "\n").trim().slice(0, 20000);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const lines = value
      .slice(0, 100)
      .map((item) => renderValue(item))
      .filter(Boolean);
    const more = value.length > 100 ? `\n\n_[${value.length - 100} more items]_` : "";
    return `${lines.join("\n\n")}${more}`.trim();
  }
  const data = recordOf(value);
  if (!data) return "";
  return Object.entries(data)
    .map(([name, item]) => {
      const text = renderValue(item).replace(/\n+/g, " ");
      return text ? `${name}: ${text}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

function newestFiles(value: unknown): unknown[] {
  return listOf(value)
    .filter((item) => recordOf(item)?.name)
    .sort((a, b) => textOf(recordOf(b)?.createdAt).localeCompare(textOf(recordOf(a)?.createdAt)))
    .slice(0, 1);
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textOf(value);
    if (text) return visibleResult(text);
  }
  return "";
}

function visibleResult(value: string): string {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? "Reply saved in your local Sent mail."
    : value;
}

function statusLabel(value: string): string {
  const clean = value.replace(/_/g, " ").trim();
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}` : "";
}

function fieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 80);
}

function transcriptSections(messages: readonly unknown[], toolCards?: ExportToolCards): string[] {
  const sections: string[] = [];
  const notedTools = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const role = record.role;
    if (role === "user" || role === "assistant") {
      const parts = contentParts(record.content);
      if (role === "assistant") {
        for (const call of toolCalls(record.toolCalls)) {
          if (call.id) notedTools.add(call.id);
          const card = call.id ? renderToolCard(toolCards?.[call.id]) : "";
          parts.push(card || note(`Tool: ${call.name}`));
        }
      }
      if (parts.length === 0 && typeof record.encryptedValue === "string" && record.encryptedValue)
        parts.push(note("Encrypted message omitted"));
      if (parts.length > 0) sections.push(`## ${speakers[role]}\n\n${parts.join("\n\n")}`);
      continue;
    }
    if (role === "tool") {
      const id = typeof record.toolCallId === "string" ? record.toolCallId : "";
      if (id && notedTools.has(id)) continue;
      if (id) notedTools.add(id);
      sections.push(note("Tool result omitted"));
      continue;
    }
    if (role === "activity") {
      const activityType = oneLine(
        typeof record.activityType === "string" ? record.activityType : "",
      );
      sections.push(note(activityType ? `Activity: ${activityType}` : "Activity omitted"));
      continue;
    }
    if (role === "reasoning") {
      sections.push(note("Reasoning omitted"));
      continue;
    }
    // System and developer messages stay in the app's hidden prompt, not the download.
    if (role === "system" || role === "developer") continue;
    if (typeof role === "string") sections.push(note("Message omitted"));
  }
  return sections;
}

function contentParts(content: unknown): string[] {
  if (typeof content === "string") {
    const text = content.replace(/\r\n/g, "\n").trim();
    return text ? [text] : [];
  }
  if (Array.isArray(content)) return content.flatMap((part) => partPieces(part));
  if (content && typeof content === "object") return partPieces(content);
  return [];
}

function partPieces(part: unknown): string[] {
  if (typeof part === "string") {
    const text = part.replace(/\r\n/g, "\n").trim();
    return text ? [text] : [];
  }
  if (!part || typeof part !== "object") return [note("Attachment omitted")];
  const record = part as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "text" && typeof record.text === "string") {
    const text = record.text.replace(/\r\n/g, "\n").trim();
    return text ? [text] : [];
  }
  if (type === "image") return [note(omitted("Image", record.filename))];
  if (type === "audio") return [note(omitted("Audio", record.filename))];
  if (type === "video") return [note(omitted("Video", record.filename))];
  if (type === "document" || type === "binary") return [note(omitted("File", record.filename))];
  return [note("Attachment omitted")];
}

function toolCalls(value: unknown): { id?: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((call) => {
    if (!call || typeof call !== "object") return { name: "tool" };
    const record = call as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    const direct = typeof record.name === "string" ? record.name : "";
    const fn = record.function;
    const nested =
      fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string"
        ? ((fn as Record<string, unknown>).name as string)
        : "";
    return { id, name: oneLine(direct || nested) || "tool" };
  });
}

function omitted(kind: string, filename: unknown): string {
  const name = safeFilename(filename);
  return name ? `${kind} omitted: ${name}` : `${kind} omitted`;
}

function safeFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const base = value
    .split(/[/\\]/)
    .pop()
    ?.replace(/[^\w .\-()]+/g, "")
    .trim();
  return base ? base.slice(0, 80) : null;
}

function note(label: string): string {
  const clean = label
    .replace(/[\r\n\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `_[${clean || "Attachment omitted"}]_`;
}

function oneLine(value: string | null | undefined): string {
  let text = "";
  for (const char of value || "") text += char.charCodeAt(0) < 32 ? " " : char;
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function calendarDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  return instant.toISOString().slice(0, 10);
}
