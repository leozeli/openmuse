import "./config.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { HttpAgent } from "@ag-ui/client";
import {
  type AgentsFactory,
  type CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
} from "@copilotkit/runtime/v2";
import { SqliteAgentRunner } from "@copilotkit/sqlite-runner";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import type { AgentService } from "./engine/service.ts";
import { createJevAdapter, type JevAdapter } from "./jev/adapter.ts";

/** File-backed CopilotKit runner used when Intelligence is not configured. */
export function agentRunnerPath(dataDir: string) {
  return join(dataDir, "agent-runner.sqlite");
}

export function agentConfigured(config: Config) {
  return (
    config.agentBackend === "sample" ||
    (config.agentBackend === "agui"
      ? Boolean(config.agentUrl)
      : Boolean(
          config.model &&
            (process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              process.env.GOOGLE_API_KEY),
        ))
  );
}
export function makeRuntime(
  config: Config,
  service: AgentService,
  auth: Auth,
  intelligence?: CopilotKitIntelligence,
) {
  // Built on first use, then shared so live mode reuses one TypeSafe client across requests.
  let jevAdapter: JevAdapter | undefined;
  const sharedJevAdapter = () => (jevAdapter ??= createJevAdapter(config));
  const agents: AgentsFactory = async ({ request }) => ({
    default:
      config.agentBackend === "sample"
        ? new ConversationAgent(
            config,
            service,
            await auth.owner(request.headers.get("authorization") ?? undefined),
            sharedJevAdapter(),
          )
        : config.agentBackend === "agui"
          ? new HttpAgent({
              url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
              headers: config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {},
            })
          : new ConversationAgent(
              config,
              service,
              await auth.owner(request.headers.get("authorization") ?? undefined),
              sharedJevAdapter(),
            ),
  });
  // The shared CopilotKit sink carries this tag onto existing PostHog events.
  const telemetryProperties = { accessibility_title: "OpenMuse" };
  // Intelligence and runner are mutually exclusive. A project key keeps Rich Threads;
  // otherwise runs persist in a SQLite file under DATA_DIR.
  if (intelligence) {
    return createCopilotHonoHandler({
      runtime: new CopilotRuntime({
        agents,
        intelligence,
        telemetryProperties,
        identifyUser: async (request) => ({
          id: await auth.owner(request.headers.get("authorization") ?? undefined),
          name: "OpenMuse user",
        }),
        generateThreadNames: false,
      }),
      basePath: "/api/copilotkit",
    });
  }
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  return createCopilotHonoHandler({
    runtime: new CopilotRuntime({
      agents,
      telemetryProperties,
      runner: new SqliteAgentRunner({ dbPath: agentRunnerPath(config.dataDir) }),
    }),
    basePath: "/api/copilotkit",
  });
}
