/** One conversation rendered as a Markdown download. */
export interface ConversationMarkdownInput {
  title?: string | null;
  /** Conversation date, ISO-8601, when storage has one. */
  date?: string | null;
  /** Download time. Used when `date` is missing. */
  exportedAt?: string | null;
  messages: readonly unknown[];
}

const speakers = { user: "User", assistant: "Assistant" } as const;

/**
 * Render user and assistant text as labeled sections.
 * Images, tool payloads, and hidden system prompts are noted or left out
 * so the file stays readable and does not embed those parts.
 */
export function conversationToMarkdown(input: ConversationMarkdownInput): string {
  const title = oneLine(input.title) || "Conversation";
  const date = calendarDay(input.date);
  const exported = calendarDay(input.exportedAt);
  const header = [`# ${title}`];
  if (date) header.push("", `_${date}_`);
  else if (exported) header.push("", `_Exported ${exported}_`);
  const sections = transcriptSections(input.messages);
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
  /** Index in the full message list when the menu opened. Used only when `id` is empty. */
  index: number;
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
  const index = segmentIndex(messages, target);
  if (index < 0) return [];
  if (kind === "message") return [messages[index] as unknown];
  const start = turnStart(messages, index);
  let end = start + 1;
  while (end < messages.length && messageRole(messages[end]) !== "user") end += 1;
  return messages.slice(start, end);
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

function segmentIndex(messages: readonly unknown[], target: ConversationSegmentTarget): number {
  const id = typeof target.id === "string" ? target.id.trim() : "";
  if (id) return messages.findIndex((message) => messageId(message) === id);
  if (!Number.isInteger(target.index) || target.index < 0 || target.index >= messages.length)
    return -1;
  return target.index;
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

function transcriptSections(messages: readonly unknown[]): string[] {
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
          parts.push(note(`Tool: ${call.name}`));
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
