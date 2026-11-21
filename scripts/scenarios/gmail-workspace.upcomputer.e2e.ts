import * as NodeWS from "@effect/platform-node/NodeWS";
import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION,
  OrchestrationV2ShellSnapshot,
  ProviderDriverKind,
  ProviderInstanceId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import {
  BOTS_RPC_METHODS,
  BotsRpcGroup,
  PROJECT_TOOLS_RPC_METHODS,
  ProjectToolsRpcGroup,
  TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import {
  customerQuestion,
  gmailFixtureKey,
  gmailListAction,
  gmailThreadAction,
  receipt,
} from "./fixtures/gmail-workspace-data.ts";
import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

const seedEmailBot = Effect.fn("GmailWorkspaceScenario.seedEmailBot")(function* (origin: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const secrets = path.join(T3_HOME, "userdata", "secrets");
  yield* fs.makeDirectory(secrets, { recursive: true, mode: 0o700 });
  yield* fs.writeFileString(path.join(secrets, "composio-api-key.bin"), gmailFixtureKey, {
    mode: 0o600,
  });
  const { cli } = makeState(T3_HOME);
  const issued = yield* cli(["auth", "session", "issue", "--token-only"]);
  const token = issued.stdout.trim().split("\n").at(-1) ?? "";
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
  const project = snapshot.projects.find(({ title }) => title === "VT Home Repo");
  if (!project) return yield* Effect.die("VT Home Repo was not seeded.");
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
  const client = yield* RpcClient.make(WsRpcGroup.merge(BotsRpcGroup, ProjectToolsRpcGroup)).pipe(
    Effect.provideContext(yield* Layer.build(protocol)),
  );
  const instanceId = ProviderInstanceId.make("gmailFixture");
  yield* client[WS_METHODS.serverUpdateSettings]({
    patch: {},
    providerInstanceMutation: {
      operation: "upsert",
      instanceId,
      instance: {
        driver: ProviderDriverKind.make("acpRegistry"),
        displayName: "Gmail fixture (scripted)",
        config: {
          source: "local",
          commandPath: process.execPath,
          commandArgs: [
            yield* path.fromFileUrl(
              new URL("./fixtures/gmail-workspace-agent.ts", import.meta.url),
            ),
          ],
        },
      },
    },
  });
  const bot = yield* client[BOTS_RPC_METHODS.save]({
    id: TaskAgentId.make("vt-email"),
    projectId: project.id,
    allowedProjectIds: [project.id],
    name: "Email",
    config: {
      role: "Email",
      modelSelection: { instanceId, model: "workspace" },
      runtimeMode: "approval-required",
      instructions:
        "Read AGENTS.md and bots/email/AGENTS.md at the start of chat and background runs. Use gmail_workspace_save when asked to create or revise the workspace.",
    },
  });
  const connector = { projectId: project.id, app: "gmail" };
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "start" });
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "finish" });
  for (const slug of [gmailListAction, gmailThreadAction]) {
    yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({
      projectId: project.id,
      slug,
      audience: { kind: "selected", botIds: [bot.agent.id] },
      fixedInputs: {},
    });
  }
  return { threadId: bot.threadId };
});

test(
  "The Email bot builds, revises and reopens its Gmail inbox",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("VT Home Repo", {
      "AGENTS.md":
        "# VT Home Repo\n\nUse the VT prefix for internal workspaces.\n\nWorkspace title prefix: VT\n",
      "bots/email/AGENTS.md":
        "# Email bot\n\nRead shared AGENTS.md before acting. Use gmail_workspace_save for workspace changes.\n\nCreate: Inbox (inbox-first)\nRevise: Customer Mail (thread-first)\n",
    });
    const thread = await runPromise(
      seedEmailBot(app.baseUrl ?? "").pipe(Effect.provide(FetchHttpClient.layer), Effect.scoped),
    );
    await t3.open(thread);

    const opener = screen.getByRole("button", "Open Gmail inbox");
    const composer = screen.getByRole("textbox");
    const controls = () =>
      browser.evaluate<string[]>(
        'Array.from(document.querySelectorAll("[data-workspace-control]"), (node) => node.getAttribute("data-workspace-control"))',
      );
    await expect(opener).toBeHidden();
    await composer.fill("Create the Gmail workspace using our Home Repo and Email playbook.");
    await composer.press("Enter");
    await expect(opener).toBeVisible();
    await opener.tap();
    await expect(screen.getByRole("heading", "VT Inbox")).toBeVisible();
    await expect(screen.getByRole("button", receipt.subject, { exact: false })).toBeVisible();
    await screen.getByRole("button", customerQuestion.subject, { exact: false }).tap();
    await expect(screen.getByText(customerQuestion.messageText)).toBeVisible();
    expect(await controls()).toEqual(["inbox", "thread"]);
    await app.screenshot("created-inbox");

    await composer.fill("Revise the Gmail workspace using our Email playbook.");
    await composer.press("Enter");
    await expect(screen.getByRole("heading", "VT Customer Mail")).toBeVisible();
    expect(await controls()).toEqual(["thread", "inbox"]);
    await expect(screen.getByText(customerQuestion.messageText)).toBeVisible();
    await app.screenshot("revised-inbox");

    await screen.getByRole("button", "Close Gmail inbox").tap();
    await expect(screen.getByRole("heading", "VT Customer Mail")).toBeHidden();
    await browser.reload();
    await opener.tap();
    await expect(screen.getByRole("heading", "VT Customer Mail")).toBeVisible();
    expect(await controls()).toEqual(["thread", "inbox"]);
    await screen.getByRole("button", receipt.subject, { exact: false }).tap();
    await expect(screen.getByText(receipt.messageText)).toBeVisible();
    await app.screenshot("reopened-inbox");
  },
);
