import * as NodeWS from "@effect/platform-node/NodeWS";
import type * as NodeServices from "@effect/platform-node/NodeServices";
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
import { expect } from "e2e";
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
  PROJECT_TOOLS_RPC_METHODS,
  ProjectToolsRpcGroup,
  TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import {
  customerQuestion,
  gmailFixtureDeliveryFile,
  gmailFixtureKey,
  gmailFixtureSender,
  gmailFixtureSendLog,
  gmailListAction,
  gmailReplyAction,
  gmailThreadAction,
  receipt,
} from "./fixtures/gmail-workspace-data.ts";
import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("gmailFixture"), model: "workspace" };
type FixtureConnection = { readonly origin: string; readonly token: string };

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
  return { client, projectId: project.id };
});

const seedEmailBot = Effect.fn("GmailWorkspaceScenario.seedEmailBot")(function* (
  fixture: FixtureConnection,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const secrets = path.join(T3_HOME, "userdata", "secrets");
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
    projectId,
    allowedProjectIds: [projectId],
    name: "Email",
    config: {
      role: "Email",
      modelSelection,
      runtimeMode: "approval-required",
      instructions:
        "Read AGENTS.md and bots/email/AGENTS.md at the start of chat and background runs. Use gmail_workspace_save when asked to create or revise the workspace.",
    },
  });
  const connector = { projectId, app: "gmail" };
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "start" });
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "finish" });
  for (const slug of [gmailListAction, gmailThreadAction, gmailReplyAction]) {
    yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({
      projectId,
      slug,
      audience: { kind: "selected", botIds: [bot.agent.id] },
      fixedInputs: {},
    });
  }
  return { threadId: bot.threadId };
});

const scheduleCheck = Effect.fn("GmailWorkspaceScenario.scheduleCheck")(function* (
  fixture: FixtureConnection,
  threadId: ThreadId,
) {
  const { client, projectId } = yield* gmailScenarioClient(fixture);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.writeFileString(path.join(T3_HOME, gmailFixtureDeliveryFile), "");
  const now = yield* DateTime.now;
  const { task } = yield* client[WS_METHODS.scheduledTasksUpsert]({
    projectId,
    threadId,
    threadMode: "continue",
    title: "Check VT's Gmail inbox",
    prompt: "Read AGENTS.md and bots/email/AGENTS.md. Check the Gmail inbox for new mail.",
    enabled: true,
    schedule: { type: "once", runAt: DateTime.formatIso(DateTime.addDuration(now, 4_000)) },
    workspaceStrategy: { type: "root" },
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  return task.id;
});

const runCheck = Effect.fn("GmailWorkspaceScenario.runCheck")(function* (
  fixture: FixtureConnection,
  id: ScheduledTaskId,
) {
  const { client } = yield* gmailScenarioClient(fixture);
  yield* client[WS_METHODS.scheduledTasksRunNow]({ id });
});

const changeAccess = Effect.fn("GmailWorkspaceScenario.changeAccess")(function* (
  fixture: FixtureConnection,
  change: "revoke" | "replace-account",
) {
  const { client, projectId } = yield* gmailScenarioClient(fixture);
  const connector = { projectId, app: "gmail" };
  const list = { projectId, slug: gmailListAction, fixedInputs: {} };
  if (change === "revoke") {
    yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({ ...list, audience: null });
    return;
  }
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "start" });
  yield* client[PROJECT_TOOLS_RPC_METHODS.connection]({ ...connector, operation: "finish" });
  yield* client[PROJECT_TOOLS_RPC_METHODS.grant]({
    ...list,
    audience: { kind: "selected", botIds: [TaskAgentId.make("vt-email")] },
  });
});

const runFixture = <A, E>(
  work: Effect.Effect<A, E, NodeServices.NodeServices | HttpClient.HttpClient | Scope.Scope>,
) => runPromise(work.pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)));

const fixtureSends = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(T3_HOME, gmailFixtureSendLog);
  if (!(yield* fs.exists(file))) return [];
  return (yield* fs.readFileString(file))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
});

test(
  "The Email bot queues a Gmail reply and sends the reviewed revision once",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("VT Home Repo", {
      "AGENTS.md":
        "# VT Home Repo\n\nUse the VT prefix for internal workspaces.\n\nWorkspace title prefix: VT\nSign-off: The VT team\n",
      "bots/email/AGENTS.md":
        "# Email bot\n\nRead shared AGENTS.md before acting. Use gmail_workspace_save for workspace changes.\n\nCreate: Inbox (inbox-first)\nRevise: Customer Mail (thread-first)\nReview with: gmail_workspace_check\nDraft for customer questions and record receipts as requiring no reply. Use the shared sign-off.\n",
    });
    const { cli } = makeState(T3_HOME);
    const issued = await runPromise(cli(["auth", "session", "issue", "--token-only"]));
    const fixture = {
      origin: app.baseUrl ?? "",
      token: issued.stdout.trim().split("\n").at(-1) ?? "",
    };
    const thread = await runFixture(seedEmailBot(fixture));
    await t3.open(thread);

    const opener = screen.getByRole("button", "Open Gmail inbox");
    const composer = screen.getByRole("textbox");
    const submit = screen.getByRole("button", "Submit message");
    const controls = () =>
      browser.evaluate<string[]>(
        'Array.from(document.querySelectorAll("[data-workspace-control]"), (node) => node.getAttribute("data-workspace-control"))',
      );
    await expect(opener).toBeHidden();
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill("Create the Gmail workspace using our Home Repo and Email playbook.");
    await submit.tap();
    await expect(opener).toBeVisible({ timeout: 45_000 });
    await opener.tap();
    await expect(screen.getByRole("heading", "VT Inbox")).toBeVisible();
    const questionRow = screen.getByRole("button", customerQuestion.subject, { exact: false });
    const receiptRow = screen.getByRole("button", receipt.subject, { exact: false });
    const draft = screen.getByRole("heading", "Reply draft");
    const draftReady = screen.getByText("Draft ready");
    const dismissed = screen.getByText("Draft dismissed");
    const noNewMail = screen.getByText("No new inbox messages to review.");
    const draftText = screen.getByText("Hi Jordan, we’ll check the date for order VT-204", {
      exact: false,
    });
    await expect(receiptRow).toBeVisible();
    await questionRow.tap();
    await expect(screen.getByText(customerQuestion.messageText)).toBeHidden();
    expect(await controls()).toEqual(["inbox", "thread"]);
    await app.screenshot("created-inbox");

    await composer.fill("Revise the Gmail workspace using our Email playbook.");
    await submit.tap();
    await expect(screen.getByRole("heading", "VT Customer Mail")).toBeVisible({ timeout: 45_000 });
    expect(await controls()).toEqual(["thread", "inbox"]);
    await expect(draft).toBeHidden();
    await app.screenshot("revised-inbox");

    const scheduleId = await runFixture(scheduleCheck(fixture, thread.threadId));
    await expect(screen.getByText("Gmail check queued 1 reply draft.")).toBeVisible({
      timeout: 45_000,
    });
    await expect(screen.getByText(customerQuestion.messageText)).toBeVisible();
    await expect(draftReady).toHaveCount(1);
    await expect(draft).toHaveCount(1);
    await expect(screen.getByText(gmailFixtureSender)).toBeVisible();
    await expect(screen.getByText("jordan@example.test")).toBeVisible();
    await expect(draftText).toBeVisible();
    await app.screenshot("queued-reply");
    await receiptRow.tap();
    await expect(screen.getByText(receipt.messageText)).toBeVisible();
    await expect(draft).toBeHidden();

    await questionRow.tap();
    await screen.getByRole("button", "Edit draft").tap();
    const edited = "Hi Jordan, I’ll verify the delivery date and follow up this afternoon.";
    await screen.getByRole("textbox", "Reply text").fill(edited);
    await screen.getByRole("button", "Save draft").tap();
    await expect(screen.getByText(edited)).toBeVisible();
    await runFixture(runCheck(fixture, scheduleId));
    await expect(noNewMail).toHaveCount(1);

    const reopen = async () => {
      await screen.getByRole("button", "Close Gmail inbox").tap();
      await expect(screen.getByRole("heading", "VT Customer Mail")).toBeHidden();
      await browser.reload();
      await opener.tap();
      await questionRow.tap();
    };
    await reopen();
    await expect(screen.getByRole("heading", "VT Customer Mail")).toBeVisible();
    expect(await controls()).toEqual(["thread", "inbox"]);
    await expect(screen.getByText(edited)).toBeVisible();
    await app.screenshot("reopened-edited-draft");
    await screen.getByRole("button", "Dismiss draft").tap();
    await expect(dismissed).toBeVisible();
    await expect(draftReady).toBeHidden();
    await runFixture(runCheck(fixture, scheduleId));
    await expect(noNewMail).toHaveCount(2);
    await reopen();
    await expect(dismissed).toBeVisible();
    await expect(draft).toBeHidden();
    await app.screenshot("reopened-dismissed-draft");
    await screen.getByRole("button", "Restore draft").tap();
    await expect(screen.getByText(edited)).toBeVisible();
    await expect(draftReady).toHaveCount(1);
    await app.screenshot("restored-edited-draft");
    const approve = screen.getByRole("button", "Approve & send");
    const sent = screen.getByRole("heading", "Reply sent");
    await expect(approve).toBeEnabled();
    await expect(screen.getByText(gmailFixtureSender)).toBeVisible();
    await expect(screen.getByText("jordan@example.test")).toBeVisible();
    expect(await runFixture(fixtureSends)).toEqual([]);
    await app.screenshot("reviewed-reply");
    await approve.tap();
    await expect(sent).toBeVisible();
    await expect(draftReady).toBeHidden();
    await expect(approve).toBeHidden();
    await reopen();
    await expect(sent).toBeVisible();
    await expect(screen.getByText(edited)).toBeVisible();
    await expect(approve).toBeHidden();
    await app.screenshot("sent-reply-after-reopen");
    const sends = [
      {
        account: expect.stringMatching(/^account-/u),
        tool_slug: gmailReplyAction,
        arguments: {
          user_id: "me",
          thread_id: customerQuestion.threadId,
          recipient_email: "jordan@example.test",
          message_body: edited,
          is_html: false,
          include_signature: false,
        },
      },
    ];
    expect(await runFixture(fixtureSends)).toEqual(sends);

    await runFixture(changeAccess(fixture, "revoke"));
    await runFixture(runCheck(fixture, scheduleId));
    await expect(screen.getByText("Gmail check blocked by not-assigned.")).toBeVisible();
    await expect(
      screen.getByText("This action is unavailable to this bot in its current project."),
    ).toBeVisible();
    await expect(draft).toBeHidden();
    await app.screenshot("blocked-check");

    await runFixture(changeAccess(fixture, "replace-account"));
    await runFixture(runCheck(fixture, scheduleId));
    await expect(draftReady).toHaveCount(1);
    await expect(draftText).toBeVisible();
    await expect(dismissed).toBeHidden();
    await expect(screen.getByText(edited)).toBeHidden();
    await app.screenshot("replacement-account");
    expect(await runFixture(fixtureSends)).toEqual(sends);
  },
);
