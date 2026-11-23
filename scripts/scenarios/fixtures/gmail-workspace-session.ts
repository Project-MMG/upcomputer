import * as NodeWS from "@effect/platform-node/NodeWS";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION,
  OrchestrationV2ShellSnapshot,
  ProviderDriverKind,
  ProviderInstanceId,
  type ScheduledTaskId,
  type ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import {
  BOTS_RPC_METHODS,
  BotsRpcGroup,
  GMAIL_WORKSPACE_RPC_METHODS,
  type GmailDraftApprovalInput,
  GmailWorkspaceRpcGroup,
  PROJECT_TOOLS_RPC_METHODS,
  ProjectToolsRpcGroup,
  TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import {
  checkInboxPrompt,
  customerQuestion,
  gmailFixtureDeliveryFile,
  gmailFixtureKey,
  gmailFixtureRejectionFile,
  gmailFixtureSendLog,
  gmailListAction,
  gmailThreadAction,
  inboxBotId,
  inboxInstructions,
  inboxProjectTitle,
  websiteBotId,
} from "./gmail-workspace-data.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("gmailFixture"), model: "workspace" };
type FixtureConnection = { readonly origin: string; readonly token: string; readonly home: string };

const gmailScenarioClient = Effect.fn("GmailWorkspaceScenario.client")(function* ({
  origin,
  token,
}: FixtureConnection) {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader(
          ORCHESTRATION_PROTOCOL_HEADER,
          String(ORCHESTRATION_PROTOCOL_VERSION),
        ),
      ),
    ),
    HttpClient.filterStatusOk,
  );
  const snapshot = yield* http
    .get(`${origin}/api/orchestration/shell`)
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(OrchestrationV2ShellSnapshot)));
  const project = snapshot.projects.find(({ title }) => title === inboxProjectTitle);
  if (!project) return yield* Effect.die(`${inboxProjectTitle} was not seeded.`);
  const { ticket } = yield* http
    .post(`${origin}/api/auth/websocket-ticket`)
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ ticket: Schema.String }))),
    );
  const socket = new URL("/ws", origin);
  socket.protocol = "ws:";
  socket.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
  socket.searchParams.set("wsTicket", ticket);
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(socket.href)),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(NodeWS.layerWebSocketConstructor),
  );
  const client = yield* RpcClient.make(
    WsRpcGroup.merge(BotsRpcGroup, ProjectToolsRpcGroup, GmailWorkspaceRpcGroup),
  ).pipe(Effect.provideContext(yield* Layer.build(protocol)));
  return { client, projectId: project.id };
});

export const seedEmailBot = Effect.fn("GmailWorkspaceScenario.seedEmailBot")(function* (
  fixture: FixtureConnection,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const secrets = path.join(fixture.home, "userdata", "secrets");
  yield* fs.makeDirectory(secrets, { recursive: true, mode: 0o700 });
  yield* fs.writeFileString(path.join(secrets, "composio-api-key.bin"), gmailFixtureKey, {
    mode: 0o600,
  });
  const { client, projectId } = yield* gmailScenarioClient(fixture);
  yield* client[WS_METHODS.serverUpdateSettings]({
    patch: {},
    providerInstanceMutation: {
      operation: "upsert",
      instanceId: modelSelection.instanceId,
      instance: {
        driver: ProviderDriverKind.make("acpRegistry"),
        displayName: "Gmail fixture (scripted)",
        config: {
          source: "local",
          commandPath: process.execPath,
          commandArgs: [
            yield* path.fromFileUrl(new URL("./gmail-workspace-agent.ts", import.meta.url)),
          ],
        },
      },
    },
  });
  const bot = yield* client[BOTS_RPC_METHODS.save]({
    id: TaskAgentId.make(inboxBotId),
    projectId,
    allowedProjectIds: [projectId],
    name: "Email",
    config: {
      role: "Email",
      modelSelection,
      runtimeMode: "approval-required",
      instructions: inboxInstructions,
    },
  });
  const chief = yield* client[BOTS_RPC_METHODS.save]({
    id: TaskAgentId.make("chief"),
    projectId,
    allowedProjectIds: [projectId],
    name: "Chief",
    config: {
      role: "Coordinator",
      modelSelection,
      runtimeMode: "approval-required",
      instructions: "Coordinate project tasks using a source, outcome, and owner.",
    },
  });
  yield* client[BOTS_RPC_METHODS.save]({
    id: TaskAgentId.make(websiteBotId),
    projectId,
    allowedProjectIds: [projectId],
    name: "Website",
    config: {
      role: "Website",
      modelSelection,
      runtimeMode: "approval-required",
      instructions: "Use the approved site documentation for project follow-ups.",
    },
  });
  const connector = { projectId, app: "gmail" };
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "start" });
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "finish" });
  yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({
    projectId,
    slug: gmailListAction,
    audience: { kind: "selected", botIds: [bot.agent.id] },
    fixedInputs: {},
  });
  yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({
    projectId,
    slug: gmailThreadAction,
    audience: { kind: "selected", botIds: [bot.agent.id] },
    fixedInputs: {},
  });
  return { threadId: bot.threadId, chiefThreadId: chief.threadId };
});

export const scheduleCheck = Effect.fn("GmailWorkspaceScenario.scheduleCheck")(function* (
  fixture: FixtureConnection,
  threadId: ThreadId,
) {
  const { client, projectId } = yield* gmailScenarioClient(fixture);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(fixture.home, gmailFixtureDeliveryFile), "");
  const now = yield* DateTime.now;
  const { task } = yield* client[WS_METHODS.scheduledTasksUpsert]({
    projectId,
    threadId,
    threadMode: "continue",
    title: "Check the Gmail inbox",
    prompt: checkInboxPrompt,
    enabled: true,
    schedule: { type: "once", runAt: DateTime.formatIso(DateTime.addDuration(now, 4_000)) },
    workspaceStrategy: { type: "root" },
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  return task.id;
});

export const runCheck = Effect.fn("GmailWorkspaceScenario.runCheck")(function* (
  fixture: FixtureConnection,
  id: ScheduledTaskId,
) {
  const { client } = yield* gmailScenarioClient(fixture);
  yield* client[WS_METHODS.scheduledTasksRunNow]({ id });
});

export const changeAccess = Effect.fn("GmailWorkspaceScenario.changeAccess")(function* (
  fixture: FixtureConnection,
  change: "revoke" | "restore" | "replace-account",
) {
  const { client, projectId } = yield* gmailScenarioClient(fixture);
  if (change === "replace-account") {
    const connector = { projectId, app: "gmail" };
    yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "start" });
    yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "finish" });
  }
  yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({
    projectId,
    slug: gmailListAction,
    fixedInputs: {},
    audience:
      change === "revoke" ? null : { kind: "selected", botIds: [TaskAgentId.make(inboxBotId)] },
  });
});

export const runFixture = <A, E>(
  work: Effect.Effect<A, E, NodeServices.NodeServices | HttpClient.HttpClient | Scope.Scope>,
) =>
  Effect.runPromise(
    work.pipe(Effect.scoped, Effect.provide([NodeServices.layer, FetchHttpClient.layer])),
  );

export const fixtureSends = Effect.fn("GmailWorkspaceScenario.fixtureSends")(function* (
  fixture: FixtureConnection,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(fixture.home, gmailFixtureSendLog);
  if (!(yield* fs.exists(file))) return [];
  return (yield* fs.readFileString(file))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
});

export const deliverRejection = Effect.fn("GmailWorkspaceScenario.deliverRejection")(function* (
  fixture: FixtureConnection,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(fixture.home, gmailFixtureRejectionFile), "");
});

export const readApproval = Effect.fn("GmailWorkspaceScenario.readApproval")(function* (
  fixture: FixtureConnection,
  threadId: ThreadId,
) {
  const { client, projectId } = yield* gmailScenarioClient(fixture);
  const target = {
    projectId,
    botId: TaskAgentId.make(inboxBotId),
    threadId,
    gmailThreadId: customerQuestion.threadId,
  };
  const page = yield* client[GMAIL_WORKSPACE_RPC_METHODS.thread](target);
  const draft = page.messages.find(
    ({ messageId }) => messageId === customerQuestion.messageId,
  )?.draft;
  if (!draft) return yield* Effect.die("Expected the customer question to have a draft.");
  return { ...target, draftId: draft.id, revision: draft.revision };
});

export const approve = Effect.fn("GmailWorkspaceScenario.approve")(function* (
  fixture: FixtureConnection,
  reviewed: GmailDraftApprovalInput,
) {
  const { client } = yield* gmailScenarioClient(fixture);
  return yield* client[GMAIL_WORKSPACE_RPC_METHODS.approveDraft](reviewed);
});
