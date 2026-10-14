import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { filenameFromContentDisposition } from "../../../packages/domain/src/conversation-markdown.ts";
import type { MuseApi } from "./api";

export class ConversationExportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConversationExportError";
  }
}

/** Download a conversation Markdown file through the signed-in session. */
export async function downloadConversationMarkdown(api: MuseApi, path: string): Promise<void> {
  const response = await fetch(api.url(path), {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const body = await response.text();
  if (!response.ok) {
    let message = `Could not export this conversation (${response.status}).`;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) message = parsed.error;
    } catch {
      // HTML and plain-text failures keep the status message above.
    }
    throw new ConversationExportError(message, response.status);
  }
  const filename =
    filenameFromContentDisposition(response.headers.get("Content-Disposition")) ??
    "conversation.md";
  await saveMarkdownFile(body, filename);
}

export async function saveMarkdownFile(markdown: string, filename: string): Promise<void> {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "") || "conversation.md";
  if (Platform.OS === "web") {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }
  if (!FileSystem.cacheDirectory) throw new Error("Saving is not available on this device.");
  const target = `${FileSystem.cacheDirectory}${safeName}`;
  await FileSystem.writeAsStringAsync(target, markdown, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing is not available on this device.");
  await Sharing.shareAsync(target, {
    mimeType: "text/markdown",
    UTI: "net.daringfireball.markdown",
    dialogTitle: "Download Markdown",
  });
}
