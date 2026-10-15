import { useThreads } from "@copilotkit/react-native/headless";
import { Download } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { downloadConversationMarkdown } from "./export-conversation";
import { conversationExportTargets, type ExportTarget } from "./export-targets";
import { Button, colors, ErrorNotice, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

/** Picker for saving one saved chat as Markdown without leaving the dialog. */
export function ExportConversationSheet({
  onClose,
  richThreads,
  mainId,
  openId,
}: {
  onClose: () => void;
  richThreads: boolean;
  mainId: string;
  openId?: string;
}) {
  const { api } = useWorkspace();
  const threads = useThreads({
    agentId: "default",
    enabled: richThreads,
    includeArchived: true,
    limit: 20,
  });
  const [archived, setArchived] = useState(false);
  const [exportError, setExportError] = useState<{ id: string; message: string }>();
  const [exportingId, setExportingId] = useState<string>();
  const choices = conversationExportTargets({
    richThreads,
    mainId,
    openId,
    includeArchived: archived,
    threads: threads.threads,
  });
  async function downloadTarget(target: ExportTarget) {
    setExportError(undefined);
    setExportingId(target.id);
    try {
      await downloadConversationMarkdown(api, target.path);
    } catch (e) {
      setExportError({ id: target.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExportingId(undefined);
    }
  }
  return (
    <Sheet
      title="Export conversation"
      subtitle="Choose a chat to download. You stay on this screen."
      onClose={onClose}
    >
      <View style={{ gap: 14 }}>
        {richThreads && (
          <Button small onPress={() => setArchived(!archived)}>
            {archived ? "Show active" : "Archived"}
          </Button>
        )}
        {richThreads && threads.isLoading && <ActivityIndicator color={colors.blueDark} />}
        <ErrorNotice error={threads.error?.message} />
        {choices.map((target) => (
          <View
            key={target.id}
            style={{
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
              gap: 8,
            }}
          >
            <Text style={s.heading}>{target.title}</Text>
            <Text style={s.muted}>{target.detail}</Text>
            <Button
              small
              icon={Download}
              label={`Download Markdown: ${target.title}`}
              busy={exportingId === target.id}
              disabled={!!exportingId}
              onPress={() => void downloadTarget(target)}
            >
              Download Markdown
            </Button>
            {exportError?.id === target.id && <ErrorNotice error={exportError.message} />}
          </View>
        ))}
        {choices.length === 0 && <Text style={s.muted}>No conversations to export.</Text>}
        {richThreads && threads.hasMoreThreads && (
          <Button small busy={threads.isFetchingMoreThreads} onPress={threads.fetchMoreThreads}>
            Load more conversations
          </Button>
        )}
      </View>
    </Sheet>
  );
}
