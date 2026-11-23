import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  type AuthEnvironmentScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  ComposerContextId,
  EnvironmentId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  ProjectId,
  RunId,
  RpcScopeAuthorization,
  ScheduledTaskUpsertInput,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  BOT_APPS_RPC_METHODS,
  BotAppsRpcGroup,
  GMAIL_WORKSPACE_RPC_METHODS,
  GmailWorkspaceRpcGroup,
  type GmailWorkspaceAnnotationInput,
  TaskAgentId,
  TaskAgentRunId,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";
import { RpcTest } from "effect/rpc";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
import * as RpcAuthorization from "../../../../apps/server/src/auth/RpcAuthorization.ts";
import * as BackgroundNotices from "../../../../apps/server/src/background/BackgroundNotices.ts";
import * as ManagedPolicy from "../../../../apps/server/src/policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../../../../apps/server/src/project/ManagedProjectFolders.ts";
import * as ScheduledTaskService from "../../../../apps/server/src/scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../../../../apps/server/src/scheduling/Scheduler.ts";
import * as SecretRequests from "../../../../apps/server/src/secrets/SecretRequests.ts";
import * as SqlitePersistence from "../../../../apps/server/src/persistence/Sqlite.ts";
import * as ThreadLaunch from "../../../../apps/server/src/orchestration-v2/ThreadLaunchService.ts";
import {
  ProjectStoreV2,
  runExperimentalFeatureMigrations,
  ServerEnvironment,
  ServerSecretStore,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import * as McpHttp from "../../../../apps/server/src/mcp/McpHttpServer.ts";
import type { McpThreadInvocationScope } from "../../../../apps/server/src/mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../../../../apps/server/src/mcp/McpSessionRegistry.ts";
import {
  idleThreadProjection,
  liveThreadShell,
} from "../../../../apps/server/src/mcp/McpToolAccess.testkit.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import * as Bots from "../bots/BotService.ts";
import * as BotApps from "../botApps/BotApps.ts";
import * as BotAppsMcp from "../botApps/mcp.ts";
import { BOT_APPS_RPC_CONTRIBUTION } from "../botApps/rpc.ts";
import { shopifyStoreAction } from "../botApps/shopifyStore.ts";
import * as GmailWorkspace from "../gmailWorkspace/GmailWorkspace.ts";
import * as GmailWorkspaceMcp from "../gmailWorkspace/mcp.ts";
import { GMAIL_WORKSPACE_RPC_CONTRIBUTION } from "../gmailWorkspace/rpc.ts";
import {
  customerQuestion,
  gmailListAction,
  gmailReplyAction,
  gmailThreadAction,
  receipt,
} from "../../../../scripts/scenarios/fixtures/gmail-workspace-data.ts";
import {
  klaviyoApp,
  klaviyoCampaignValues,
  klaviyoFlowValues,
  klaviyoGetAccount,
  klaviyoGetCampaign,
  klaviyoGetFlow,
  klaviyoGetSegment,
  lifecycleFlowProposal,
  lifecycleProposal,
} from "../../../../scripts/scenarios/fixtures/lifecycle-data.ts";
import {
  googleAdsApp,
  googleAdsSearch,
  metaAdsApp,
  metaAdsCreatives,
  metaAdsInsights,
  paidMediaProposal,
} from "../../../../scripts/scenarios/fixtures/paid-media-data.ts";
import {
  postizAction,
  postizApp,
  postizScheduleFixture,
  socialProposal,
} from "../../../../scripts/scenarios/fixtures/social-calendar-data.ts";
import {
  searchAction,
  searchApp,
  websiteProposal,
  websiteReport,
} from "../../../../scripts/scenarios/fixtures/website-bot-app-data.ts";
import {
  otherShop,
  shopifyApp,
  shopifyProposal,
  shopifyRead,
  shopifyResponse,
} from "../../../../scripts/scenarios/fixtures/shopify-store-data.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import { TASKS_SERVER_FEATURE } from "../serverFeature.ts";
import * as Composio from "./Composio.ts";
import * as ProjectTools from "./ProjectTools.ts";
import * as ProjectToolMcp from "./ProjectToolMcp.ts";
import {
  fixtureKey,
  makeComposioFixture,
  publicRead,
  read,
  unknownEffect,
  write,
} from "./ProjectTools.upcomputer.testkit.ts";

const environment = EnvironmentId.make("project-tools-test");
const firstProject = ProjectId.make("first-project");
const secondProject = ProjectId.make("second-project");
const all = { kind: "all" } as const;
const scheduleInput = Schema.decodeEffect(ScheduledTaskUpsertInput);

const mcpSession = Effect.fn("ProjectToolsTest.mcpSession")(function* (token: string) {
  const client = yield* HttpClient.HttpClient;
  const authorization = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  const init = yield* client.post("/mcp", {
    headers: authorization,
    body: HttpBody.jsonUnsafe({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      },
    }),
  });
  expect(init.status).toBe(200);
  const sessionId = init.headers["mcp-session-id"];
  expect(sessionId).toBeTruthy();
  const headers = {
    ...authorization,
    "mcp-session-id": sessionId!,
    "mcp-protocol-version": "2025-06-18",
  };
  let id = 1;
  const call = Effect.fn("ProjectToolsTest.call")(function* (
    name: string,
    args: Schema.JsonObject,
  ) {
    const response = yield* client.post("/mcp", {
      headers,
      body: HttpBody.jsonUnsafe({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    expect(response.status).toBe(200);
    const body = (yield* response.json) as {
      readonly result: {
        readonly isError?: boolean;
        readonly content: readonly { readonly text: string }[];
        readonly structuredContent?: { readonly code: string };
      };
    };
    return body.result;
  });
  return {
    proposeLifecycle: (args: Schema.JsonObject) => call("bot_app_propose_lifecycle", args),
    proposeOutbound: (args: Schema.JsonObject) => call("bot_app_propose_outbound", args),
    outboundHandoff: (opportunityId: string) =>
      call("bot_app_get_outbound_handoff", { opportunityId }),
    proposePaidMedia: (args: Schema.JsonObject) => call("bot_app_propose_paid_media", args),
    proposeShopify: (args: Schema.JsonObject) => call("bot_app_propose_shopify_store", args),
    shopifyCatalog: () => call("bot_app_get_shopify_catalog_follow_ups", {}),
    proposeApp: (args: Schema.JsonObject) => call("bot_app_propose", args),
    proposeCalendar: (args: Schema.JsonObject) => call("bot_app_propose_social_calendar", args),
    appProposal: () => call("bot_app_get_proposal", {}),
    saveWorkspace: (args: Schema.JsonObject) => call("gmail_workspace_save", args),
    checkWorkspace: () => call("gmail_workspace_check", {}),
    recordReply: (args: Schema.JsonObject) => call("gmail_workspace_record_reply", args),
    applyAnnotation: (args: Schema.JsonObject) => call("gmail_workspace_apply_annotation", args),
    read: (slug: string, args: Schema.JsonObject = {}) =>
      call("project_tool_read", { slug, arguments: args }),
    write: (slug: string, args: Schema.JsonObject = {}) =>
      call("project_tool_write", { slug, arguments: args }),
    search: (args: Schema.JsonObject = {}) => call("project_tools_search", args),
  };
});

class Fixture extends Context.Service<
  Fixture,
  {
    readonly backend: ReturnType<typeof makeComposioFixture>;
    readonly shells: Map<ThreadId, OrchestrationV2ThreadShell>;
    readonly scheduledThreads: ThreadId[];
    readonly annotationMessages: Map<ThreadId, OrchestrationV2ConversationMessage>;
    readonly enableComposio: () => void;
    readonly authenticate: (id: ThreadId) => ReturnType<typeof mcpSession>;
  }
>()("t3/mcp/ProjectTools.upcomputer.test/Fixture") {}

const fixtureLayer = Layer.unwrap(
  Effect.sync(() => {
    const backend = makeComposioFixture();
    const shells = new Map<ThreadId, OrchestrationV2ThreadShell>();
    const scopes = new Map<string, McpThreadInvocationScope>();
    const receipts = new Set<string>();
    const scheduledThreads: ThreadId[] = [];
    const annotationRuns = new Map<ThreadId, OrchestrationV2Run>();
    const annotationMessages = new Map<ThreadId, OrchestrationV2ConversationMessage>();
    let hasKey = false;
    const configuration = Layer.mergeAll(
      NodeCrypto.layer,
      NodeServices.layer,
      Layer.mock(ProjectStoreV2)({
        getShell: (projectId) =>
          projectId === firstProject || projectId === secondProject
            ? Effect.succeedSome({} as never)
            : Effect.succeedNone,
      }),
      Layer.mock(ThreadManagementService)({
        getThreadShell: (id) => Effect.sync(() => shells.get(id) ?? null),
        getThreadRecords: (id) => Effect.sync(() => idleThreadProjection(shells.get(id)!)),
        getProjectThreadRecords: ({ threadId }, _fields, filter) =>
          Effect.sync(() => {
            const run = annotationRuns.get(threadId);
            return {
              ...idleThreadProjection(shells.get(threadId)!),
              runs: run && filter?.runIds?.includes(run.id) ? [run] : [],
            };
          }),
        getMessagesById: (threadId, ids) =>
          Effect.sync(() => {
            const message = annotationMessages.get(threadId);
            return new Map(message && ids.includes(message.id) ? [[message.id, message]] : []);
          }),
        hasReceipt: (id) => Effect.sync(() => receipts.has(id)),
        dispatch: (command) =>
          Effect.sync(() => {
            receipts.add(command.commandId);
            if (command.type === "thread.create") {
              shells.set(command.threadId, {
                ...liveThreadShell(command.threadId),
                projectId: command.projectId,
                title: command.title,
                modelSelection: command.modelSelection,
                runtimeMode: command.runtimeMode,
                interactionMode: command.interactionMode,
              });
            }
            if (command.type === "thread.project.move") {
              const shell = shells.get(command.threadId)!;
              shells.set(command.threadId, { ...shell, projectId: command.projectId });
            }
            return {} as never;
          }),
        sendToThread: (input) =>
          Effect.sync(() => {
            const shell = shells.get(input.threadId)!;
            if (input.scheduledTaskId !== undefined) scheduledThreads.push(input.threadId);
            const runId = RunId.make(`test:${input.messageId}`);
            shells.set(input.threadId, {
              ...shell,
              activeRunId: runId,
            });
            if (input.context) {
              annotationRuns.set(input.threadId, {
                id: runId,
                threadId: input.threadId,
                ordinal: 1,
                providerInstanceId: shell.modelSelection.instanceId,
                modelSelection: shell.modelSelection,
                providerThreadId: null,
                userMessageId: input.messageId,
                rootNodeId: null,
                activeAttemptId: null,
                status: "running",
                requestedAt: shell.updatedAt,
                startedAt: shell.updatedAt,
                completedAt: null,
                checkpointId: null,
                contextHandoffId: null,
              });
              annotationMessages.set(input.threadId, {
                id: input.messageId,
                threadId: input.threadId,
                runId,
                nodeId: null,
                role: "user",
                createdBy: input.createdBy,
                creationSource: input.creationSource,
                text: input.text,
                context: input.context,
                attachments: [],
                streaming: false,
                createdAt: shell.updatedAt,
                updatedAt: shell.updatedAt,
              });
            }
            return {} as never;
          }),
      }),
      Layer.mock(TaskAgentService)({ scheduleTaskChanged: () => Effect.void }),
      Layer.mock(ServerEnvironment)({ getEnvironmentId: Effect.succeed(environment) }),
      Layer.mock(ServerSecretStore)({
        get: (name) =>
          Effect.sync(() => {
            expect(name).toBe("composio-api-key");
            return hasKey ? Option.some(new TextEncoder().encode(fixtureKey)) : Option.none();
          }),
      }),
      Layer.mock(McpSessionRegistry.McpSessionRegistry)({
        resolve: (token) => Effect.sync(() => scopes.get(token)),
      }),
    );
    const database = Layer.effectDiscard(
      runExperimentalFeatureMigrations(TASKS_SERVER_FEATURE.migrations ?? []),
    ).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
    const schedules = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Scheduler.layer,
          ManagedPolicy.layerTest(),
          Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
        ),
      ),
    );
    const botLayer = Bots.layer.pipe(
      Layer.provideMerge(TaskRepositoryLive),
      Layer.provide(BackgroundNotices.layer),
    );
    const services = Layer.merge(
      Layer.merge(GmailWorkspace.layer, BotApps.layer).pipe(
        Layer.provideMerge(ProjectTools.layer),
        Layer.provide(Composio.layer.pipe(Layer.provide(backend.layer))),
        Layer.provideMerge(botLayer),
      ),
      schedules,
    ).pipe(Layer.provideMerge(database), Layer.provideMerge(configuration));
    const router = HttpRouter.serve(
      McpHttp.layerMcpTransport(
        Layer.mergeAll(ProjectToolMcp.layer, GmailWorkspaceMcp.layer, BotAppsMcp.layer),
      ).pipe(Layer.provide(services), Layer.provide(ServerSettings.layerTest())),
      { disableListenLog: true, disableLogger: true },
    );

    const authenticate = Effect.fn("ProjectToolsTest.authenticate")(function* (threadId: ThreadId) {
      const token = `test-token-${scopes.size}`;
      const shell = shells.get(threadId)!;
      scopes.set(token, {
        environmentId: environment,
        requestNamespace: token,
        thread: {
          threadId,
          providerSessionId: token,
          providerInstanceId: shell.providerInstanceId,
        },
        client: undefined,
        capabilities: new Set(["orchestration"]),
        issuedAt: 1,
      });
      return yield* mcpSession(token);
    });
    return Layer.mergeAll(
      services,
      router,
      Layer.succeed(Fixture, {
        backend,
        shells,
        scheduledThreads,
        annotationMessages,
        enableComposio: () => {
          hasKey = true;
        },
        authenticate,
      }),
    );
  }),
);

const testLayer = fixtureLayer.pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const addBot = Effect.fn("ProjectToolsTest.addBot")(function* (name: string, projectId: ProjectId) {
  const bots = yield* Bots.BotService;
  const modelSelection = liveThreadShell(ThreadId.make(name)).modelSelection;
  return yield* bots.save({
    id: TaskAgentId.make(name),
    projectId,
    allowedProjectIds: [projectId],
    name,
    config: {
      modelSelection,
      role: "Reviewer",
      instructions: "Review the project.",
      runtimeMode: "approval-required",
    },
  });
});

const content = (result: {
  readonly isError?: boolean;
  readonly content: readonly { readonly text: string }[];
}) => {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]!.text) as unknown;
};
const code = (result: {
  readonly isError?: boolean;
  readonly structuredContent?: { readonly code: string };
}) => {
  expect(result.isError).toBe(true);
  return result.structuredContent?.code;
};

const approvalSession = AuthSessionId.make("gmail-reviewer");
const botAppsClient = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  RpcTest.makeClient(BotAppsRpcGroup.middleware(RpcScopeAuthorization)).pipe(
    Effect.provide(
      Layer.merge(
        BOT_APPS_RPC_CONTRIBUTION.handlers({ currentSessionId: approvalSession }),
        RpcAuthorization.layer(
          scopes,
          new Map(Object.entries(BOT_APPS_RPC_CONTRIBUTION.requiredScopes)),
        ),
      ),
    ),
  );

const approveMethod = GMAIL_WORKSPACE_RPC_METHODS.approveDraft;
const annotateMethod = GMAIL_WORKSPACE_RPC_METHODS.annotate;
const gmailWorkspaceClient = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  RpcTest.makeClient(GmailWorkspaceRpcGroup.middleware(RpcScopeAuthorization)).pipe(
    Effect.provide(
      Layer.merge(
        GMAIL_WORKSPACE_RPC_CONTRIBUTION.handlers({ currentSessionId: approvalSession }),
        RpcAuthorization.layer(
          scopes,
          new Map(Object.entries(GMAIL_WORKSPACE_RPC_CONTRIBUTION.requiredScopes)),
        ),
      ),
    ),
  );

const connectGmail = Effect.fn("ProjectToolsTest.connectGmail")(function* (projectId: ProjectId) {
  const tools = yield* ProjectTools.ProjectTools;
  const { backend } = yield* Fixture;
  const connection = { projectId, app: "gmail" };
  yield* tools.connection({ ...connection, operation: "start" });
  const account = Array.from(backend.accounts.values()).at(-1)!;
  account.status = "ACTIVE";
  account.label = "support@vt.example.test";
  yield* tools.connection({ ...connection, operation: "finish" });
  return account;
});

const queuedReply = Effect.fn("ProjectToolsTest.queuedReply")(function* () {
  const tools = yield* ProjectTools.ProjectTools;
  const workspace = yield* GmailWorkspace.GmailWorkspace;
  const { authenticate, backend, enableComposio } = yield* Fixture;
  enableComposio();
  const bot = yield* addBot("Email", firstProject);
  const mcp = yield* authenticate(bot.threadId);
  const projectId = firstProject;
  const account = yield* connectGmail(projectId);
  const grant = {
    projectId,
    audience: { kind: "selected", botIds: [bot.agent.id] },
    fixedInputs: {},
  } as const;
  for (const slug of [gmailListAction, gmailThreadAction, gmailReplyAction]) {
    yield* tools.grant({ ...grant, slug });
  }
  const gmailThreadId = customerQuestion.threadId;
  expect(
    content(yield* mcp.saveWorkspace({ title: "VT Inbox", order: "inbox-first" })),
  ).toBeTruthy();
  expect(
    content(
      yield* mcp.recordReply({
        accountId: account.id,
        gmailThreadId,
        messageId: customerQuestion.messageId,
        body: "Thanks for your message.",
      }),
    ),
  ).toEqual({ recorded: true });
  const target = { projectId, botId: bot.agent.id, threadId: bot.threadId, gmailThreadId };
  const review = yield* workspace.thread(target);
  expect(review.sendingAccount).toBe(account.label);
  const draft = review.messages.at(-1)?.draft;
  if (!draft) return yield* Effect.die("Expected a queued Gmail reply.");
  return {
    account,
    approval: { ...target, draftId: draft.id, revision: draft.revision },
    grant: { ...grant, slug: gmailReplyAction },
    mcp,
    sends: () => backend.calls.filter((call) => call.slug === gmailReplyAction),
  };
});

it.effect("saves and replaces a bot's Gmail layout and reads the project's connected inbox", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const workspace = yield* GmailWorkspace.GmailWorkspace;
    const { backend, shells, enableComposio, authenticate } = yield* Fixture;
    enableComposio();
    const bot = yield* addBot("Email", firstProject);
    const target = { projectId: firstProject, botId: bot.agent.id, threadId: bot.threadId };
    const api = yield* authenticate(bot.threadId);
    expect(yield* workspace.layout(target)).toBeNull();
    expect((yield* Effect.flip(workspace.inbox(target))).code).toBe("workspace-unavailable");
    const initial = { title: "VT Inbox", order: "inbox-first" } as const;
    const revised = { title: "VT Customer Mail", order: "thread-first" } as const;
    expect(content(yield* api.saveWorkspace(initial))).toEqual(initial);
    expect(yield* workspace.layout(target)).toBeNull();
    expect(content(yield* api.saveWorkspace(revised))).toEqual(revised);
    expect((yield* api.saveWorkspace({ ...revised, order: "side-by-side" })).isError).toBe(true);

    const shell = shells.get(bot.threadId)!;
    shells.set(bot.threadId, { ...shell, activeRunId: null });
    expect(yield* workspace.layout(target)).toBeNull();
    const connection = { projectId: firstProject, app: "gmail" };
    for (const projectId of [secondProject, firstProject]) {
      yield* tools.connection({ ...connection, projectId, operation: "start" });
      const account = Array.from(backend.accounts.values()).at(-1)!;
      account.status = "ACTIVE";
      yield* tools.connection({ ...connection, projectId, operation: "finish" });
    }
    const account = Array.from(backend.accounts.values()).at(-1)!;
    const grant = {
      projectId: firstProject,
      audience: { kind: "selected", botIds: [bot.agent.id] },
      fixedInputs: {},
    } as const;
    yield* tools.grant({ ...grant, slug: gmailListAction });
    expect(yield* workspace.layout(target)).toBeNull();
    yield* tools.grant({ ...grant, slug: gmailThreadAction });
    expect(yield* workspace.layout(target)).toEqual({ ...revised, revision: 2 });
    expect(yield* workspace.inbox(target)).toEqual({
      threads: [
        {
          threadId: customerQuestion.threadId,
          subject: customerQuestion.subject,
          sender: customerQuestion.sender,
          preview: customerQuestion.preview,
          unread: true,
        },
        {
          threadId: receipt.threadId,
          subject: receipt.subject,
          sender: receipt.sender,
          preview: receipt.preview,
          unread: false,
        },
      ],
      nextPageToken: null,
    });
    expect(
      (yield* workspace.thread({
        ...target,
        gmailThreadId: customerQuestion.threadId,
      })).messages.at(-1),
    ).toMatchObject({
      messageId: customerQuestion.messageId,
      body: customerQuestion.messageText,
    });
    expect(backend.calls).toEqual([
      expect.objectContaining({
        slug: gmailListAction,
        account: account.id,
        userId: account.user_id,
        arguments: {
          user_id: "me",
          query: "in:inbox",
          max_results: 30,
          include_payload: false,
          verbose: false,
        },
      }),
      expect.objectContaining({
        slug: gmailThreadAction,
        account: account.id,
        userId: account.user_id,
        arguments: { user_id: "me", thread_id: customerQuestion.threadId },
      }),
    ]);

    shells.set(bot.threadId, shell);
    const checked = content(yield* api.checkWorkspace());
    expect(checked).toMatchObject({
      accountId: account.id,
      candidates: [
        { gmailThreadId: customerQuestion.threadId, messageId: customerQuestion.messageId },
        { gmailThreadId: receipt.threadId, messageId: receipt.messageId },
      ],
    });
    const proposal = {
      accountId: account.id,
      gmailThreadId: customerQuestion.threadId,
      messageId: customerQuestion.messageId,
      body: "Thanks for your message.",
    };
    const original = yield* Effect.all([api.recordReply(proposal), api.recordReply(proposal)], {
      concurrency: 2,
    });
    expect(original.map(content)).toEqual(
      expect.arrayContaining([{ recorded: true }, { recorded: false }]),
    );
    const thread = { ...target, gmailThreadId: customerQuestion.threadId };
    const draft = (yield* workspace.thread(thread)).messages.at(-1)?.draft;
    if (!draft) return yield* Effect.die("Expected the message's pending draft.");
    expect(draft).toMatchObject({
      status: "pending",
      recipient: "jordan@example.test",
      body: proposal.body,
      revision: 1,
    });
    const edit = { ...thread, draftId: draft.id, revision: draft.revision };
    const body = "I’ll check the delivery date and follow up.\n";
    expect(yield* workspace.updateDraft({ ...edit, change: { kind: "edit", body } })).toMatchObject(
      {
        body,
        revision: 2,
      },
    );
    expect(
      (yield* Effect.flip(workspace.updateDraft({ ...edit, change: { kind: "dismiss" } }))).code,
    ).toBe("workspace-draft-changed");
    expect(content(yield* api.recordReply(proposal))).toEqual({ recorded: false });
    expect((yield* workspace.thread(thread)).messages.at(-1)?.draft).toMatchObject({
      status: "pending",
      body,
      revision: 2,
    });
    const dismissed = yield* workspace.updateDraft({
      ...edit,
      revision: 2,
      change: { kind: "dismiss" },
    });
    expect(dismissed).toMatchObject({ status: "dismissed", revision: 3 });
    const restore = { ...edit, change: { kind: "restore" } } as const;
    expect((yield* Effect.flip(workspace.updateDraft(restore))).code).toBe(
      "workspace-draft-changed",
    );
    const restored = yield* workspace.updateDraft({ ...restore, revision: dismissed.revision });
    expect(restored).toMatchObject({ status: "pending", body, revision: 4 });
    yield* tools.connection({ ...connection, operation: "start" });
    Array.from(backend.accounts.values()).at(-1)!.status = "ACTIVE";
    yield* tools.connection({ ...connection, operation: "finish" });
    expect(
      (yield* Effect.flip(
        workspace.updateDraft({
          ...edit,
          revision: restored.revision,
          change: { kind: "dismiss" },
        }),
      )).code,
    ).toBe("workspace-draft-changed");
    expect(code(yield* api.recordReply(proposal))).toBe("workspace-account-changed");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects mismatched bot chats, revoked Gmail access and conflicting fixed inputs", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const workspace = yield* GmailWorkspace.GmailWorkspace;
    const { backend, shells, enableComposio, authenticate } = yield* Fixture;
    enableComposio();
    const bot = yield* addBot("Email", firstProject);
    const other = yield* addBot("Other bot", firstProject);
    const target = { projectId: firstProject, botId: bot.agent.id, threadId: bot.threadId };
    const api = yield* authenticate(bot.threadId);
    const layout = { title: "VT Inbox", order: "inbox-first" } as const;
    const shell = shells.get(bot.threadId)!;
    shells.set(bot.threadId, { ...shell, projectId: secondProject });
    expect(code(yield* api.saveWorkspace(layout))).toBe("not-a-bot");
    shells.set(bot.threadId, { ...shell, interactionMode: "plan" });
    expect(code(yield* api.saveWorkspace(layout))).toBe("plan-mode");
    shells.set(bot.threadId, shell);
    expect(content(yield* api.saveWorkspace(layout))).toEqual(layout);
    for (const mismatched of [
      { ...target, projectId: secondProject },
      { ...target, botId: other.agent.id },
      { ...target, threadId: other.threadId },
    ]) {
      expect((yield* Effect.flip(workspace.layout(mismatched))).code).toBe("not-a-bot");
      expect((yield* Effect.flip(workspace.inbox(mismatched))).code).toBe("not-a-bot");
      expect(
        (yield* Effect.flip(
          workspace.thread({ ...mismatched, gmailThreadId: customerQuestion.threadId }),
        )).code,
      ).toBe("not-a-bot");
    }

    const connection = { projectId: firstProject, app: "gmail" };
    yield* tools.connection({ ...connection, operation: "start" });
    const account = Array.from(backend.accounts.values())[0]!;
    account.status = "ACTIVE";
    yield* tools.connection({ ...connection, operation: "finish" });
    const grant = {
      projectId: firstProject,
      audience: { kind: "selected", botIds: [bot.agent.id] },
      fixedInputs: {},
    } as const;
    expect((yield* Effect.flip(workspace.inbox(target))).code).toBe("not-assigned");
    expect(code(yield* api.checkWorkspace())).toBe("not-assigned");
    yield* tools.grant({
      ...grant,
      slug: gmailListAction,
      fixedInputs: { user_id: "different@example.test" },
    });
    expect((yield* Effect.flip(workspace.inbox(target))).code).toBe("workspace-input-conflict");
    expect(code(yield* api.checkWorkspace())).toBe("workspace-input-conflict");
    yield* tools.grant({
      ...grant,
      slug: gmailThreadAction,
      fixedInputs: { thread_id: receipt.threadId },
    });
    expect(
      (yield* Effect.flip(
        workspace.thread({ ...target, gmailThreadId: customerQuestion.threadId }),
      )).code,
    ).toBe("workspace-input-conflict");
    yield* tools.grant({ ...grant, slug: gmailListAction });
    const decision = {
      accountId: account.id,
      gmailThreadId: customerQuestion.threadId,
      messageId: customerQuestion.messageId,
      body: "A fixture reply.",
    };
    expect(code(yield* api.recordReply(decision))).toBe("workspace-input-conflict");
    shells.set(bot.threadId, { ...shell, interactionMode: "plan" });
    expect(code(yield* api.recordReply(decision))).toBe("plan-mode");
    shells.set(bot.threadId, shell);
    yield* tools.grant({ ...grant, slug: gmailListAction, audience: null });
    expect(yield* workspace.layout(target)).toBeNull();
    expect((yield* Effect.flip(workspace.inbox(target))).code).toBe("not-assigned");
    yield* tools.grantApp({ ...connection, audience: { kind: "all" } });
    expect(yield* workspace.layout(target)).toEqual({ ...layout, revision: 1 });
    yield* tools.grant({ ...grant, slug: gmailListAction });
    yield* tools.connection({ ...connection, operation: "disconnect" });
    expect((yield* Effect.flip(workspace.inbox(target))).code).toBe("account-unavailable");
    expect(yield* workspace.layout(target)).toBeNull();
    expect(backend.calls).toEqual([]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("revises only the annotation's exact draft range in the owning bot turn", () =>
  Effect.gen(function* () {
    const { approval, grant, mcp, sends } = yield* queuedReply();
    const { annotationMessages, authenticate } = yield* Fixture;
    const workspace = yield* GmailWorkspace.GmailWorkspace;
    const tools = yield* ProjectTools.ProjectTools;
    const reader = yield* gmailWorkspaceClient([AuthOrchestrationReadScope]);
    const operator = yield* gmailWorkspaceClient([AuthOrchestrationOperateScope]);
    const other = yield* addBot("Other Email", secondProject);
    const otherMcp = yield* authenticate(other.threadId);
    const { draftId, gmailThreadId, revision, ...owner } = approval;
    const target = {
      kind: "draft",
      draftId,
      gmailThreadId,
      revision,
      start: 7,
      text: "for your",
    } as const;
    const input = { ...owner, target, note: "Use “for the” here." };
    expect((yield* Effect.flip(reader[annotateMethod](input)))._tag).toBe(
      "EnvironmentAuthorizationError",
    );
    for (const mismatch of [
      { projectId: other.projectId },
      { botId: other.agent.id },
      { threadId: other.threadId },
    ]) {
      expect(yield* Effect.flip(operator[annotateMethod]({ ...input, ...mismatch }))).toMatchObject(
        {
          code: "not-a-bot",
        },
      );
    }
    expect(
      yield* Effect.flip(
        operator[annotateMethod]({
          ...input,
          target: { ...target, gmailThreadId: receipt.threadId },
        }),
      ),
    ).toMatchObject({ code: "workspace-draft-changed" });
    expect(
      yield* Effect.flip(
        operator[annotateMethod]({
          ...input,
          target: { ...target, start: 0 },
        }),
      ),
    ).toMatchObject({ code: "workspace-annotation-invalid" });
    yield* operator[annotateMethod](input);
    const message = annotationMessages.get(owner.threadId)!;
    const annotationId = ComposerContextId.make(message.id);
    expect(message.text).toContain(input.note);
    expect(message.context?.records).toMatchObject([
      {
        contextId: annotationId,
        payload: { ...owner, target },
      },
    ]);
    const edit = { annotationId, change: { replacement: "for the" } };
    expect(code(yield* otherMcp.applyAnnotation(edit))).toBe("workspace-annotation-required");
    expect(
      code(
        yield* mcp.applyAnnotation({
          annotationId,
          change: { position: "first" },
        }),
      ),
    ).toBe("workspace-annotation-invalid");

    const newer = yield* workspace.updateDraft({
      ...approval,
      change: { kind: "edit", body: "Thanks for your message. Here is my own edit." },
    });
    expect(code(yield* mcp.applyAnnotation(edit))).toBe("workspace-draft-changed");
    expect((yield* workspace.thread(approval)).messages.at(-1)?.draft?.body).toBe(newer.body);

    yield* operator[annotateMethod]({ ...input, target: { ...target, revision: newer.revision } });
    expect(code(yield* mcp.applyAnnotation(edit))).toBe("workspace-annotation-required");
    const currentEdit = { ...edit, annotationId: annotationMessages.get(owner.threadId)!.id };
    const readGrant = { ...grant, slug: gmailThreadAction };
    yield* tools.grant({ ...readGrant, audience: null });
    expect(code(yield* mcp.applyAnnotation(currentEdit))).toBe("not-assigned");
    yield* tools.grant(readGrant);
    expect(content(yield* mcp.applyAnnotation(currentEdit))).toMatchObject({
      id: draftId,
      body: "Thanks for the message. Here is my own edit.",
      revision: newer.revision + 1,
      status: "pending",
    });
    expect(code(yield* mcp.applyAnnotation(currentEdit))).toBe("workspace-draft-changed");
    expect(
      yield* Effect.flip(operator[approveMethod]({ ...approval, revision: newer.revision })),
    ).toMatchObject({
      code: "workspace-draft-changed",
    });
    expect(sends()).toEqual([]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("moves the annotated Gmail control while preserving a newer layout", () =>
  Effect.gen(function* () {
    const workspace = yield* GmailWorkspace.GmailWorkspace;
    const tools = yield* ProjectTools.ProjectTools;
    const { annotationMessages, authenticate, enableComposio, shells } = yield* Fixture;
    enableComposio();
    const bot = yield* addBot("Email layout", firstProject);
    yield* connectGmail(firstProject);
    yield* tools.grantApp({ projectId: firstProject, app: "gmail", audience: { kind: "all" } });
    const mcp = yield* authenticate(bot.threadId);
    const owner = { projectId: bot.projectId, botId: bot.agent.id, threadId: bot.threadId };
    const original = { title: "Mail", order: "thread-first" } as const;
    const newer = { title: "Newer mail layout", order: "thread-first" } as const;
    const originalTurn = shells.get(bot.threadId)!;
    yield* mcp.saveWorkspace(original);
    const input = {
      ...owner,
      target: { kind: "layout", control: "inbox", order: original.order, revision: 1 },
      note: "Move the inbox above the thread reader.",
    } satisfies GmailWorkspaceAnnotationInput;
    yield* workspace.annotate(input);
    const edit = {
      annotationId: annotationMessages.get(bot.threadId)!.id,
      change: { position: "first" },
    };
    expect(code(yield* mcp.saveWorkspace(newer))).toBe("workspace-annotation-required");
    const annotationTurn = shells.get(bot.threadId)!;
    shells.set(bot.threadId, originalTurn);
    expect(content(yield* mcp.saveWorkspace(newer))).toEqual(newer);
    shells.set(bot.threadId, annotationTurn);
    expect(code(yield* mcp.applyAnnotation(edit))).toBe("workspace-layout-changed");
    expect(yield* workspace.layout(owner)).toEqual({ ...newer, revision: 2 });
    expect((yield* Effect.flip(workspace.annotate(input))).code).toBe("workspace-layout-changed");

    yield* workspace.annotate({ ...input, target: { ...input.target, revision: 2 } });
    const currentEdit = { ...edit, annotationId: annotationMessages.get(bot.threadId)!.id };
    const expected = { ...newer, order: "inbox-first", revision: 3 };
    expect(content(yield* mcp.applyAnnotation(currentEdit))).toEqual(expected);
    expect(yield* workspace.layout(owner)).toEqual(expected);
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "sends the authenticated review once when approvals race and gates direct Gmail writes",
  () =>
    Effect.gen(function* () {
      const { account, approval, mcp, sends } = yield* queuedReply();
      const { authenticate, backend } = yield* Fixture;
      const tools = yield* ProjectTools.ProjectTools;
      const workspace = yield* GmailWorkspace.GmailWorkspace;
      const sql = yield* SqlClient.SqlClient;
      const reader = yield* gmailWorkspaceClient([AuthOrchestrationReadScope]);
      expect((yield* Effect.flip(reader[approveMethod](approval)))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      const operator = yield* gmailWorkspaceClient([AuthOrchestrationOperateScope]);
      const body = "I’ll confirm the delivery date.\n\nThanks,\nThe VT team\n";
      const { revision } = yield* workspace.updateDraft({
        ...approval,
        change: { kind: "edit", body },
      });
      expect(yield* Effect.flip(operator[approveMethod](approval))).toMatchObject({
        code: "workspace-draft-changed",
      });
      const request = { ...approval, revision };
      const args = {
        user_id: "me",
        thread_id: customerQuestion.threadId,
        recipient_email: "jordan@example.test",
        message_body: body,
        is_html: false,
        include_signature: false,
      };
      expect(code(yield* mcp.write(gmailReplyAction, args))).toBe("workspace-approval-required");
      yield* tools.grantApp({ projectId: firstProject, app: "gmail", audience: all });
      yield* tools.grant({
        projectId: firstProject,
        slug: gmailReplyAction,
        audience: null,
        fixedInputs: {},
      });
      expect(code(yield* mcp.write(gmailReplyAction, args))).toBe("workspace-approval-required");
      expect(
        content(yield* mcp.search({ app: "gmail", query: "Reply to email thread" })),
      ).toMatchObject({
        actions: [],
      });
      expect(sends()).toEqual([]);
      const gate = yield* backend.holdSession(gmailReplyAction);
      const first = yield* operator[approveMethod](request).pipe(Effect.forkScoped);
      yield* Deferred.await(gate.entered);
      expect(yield* operator[approveMethod](request)).toBe("sent");
      yield* Deferred.succeed(gate.proceed, undefined);
      expect(yield* Fiber.join(first)).toBe("sent");
      expect(yield* operator[approveMethod](request)).toBe("sent");
      expect(sends()).toEqual([
        {
          userId: account.user_id,
          account: account.id,
          slug: gmailReplyAction,
          arguments: args,
        },
      ]);
      expect((yield* workspace.thread(approval)).messages.at(-1)?.draft).toMatchObject({
        deliveryStatus: "sent",
        body,
        revision,
      });
      expect(
        yield* sql`SELECT approval_session_id, gmail_message_id FROM gmail_workspace_reply_attempts`,
      ).toEqual([{ approval_session_id: approvalSession, gmail_message_id: "19bf77729bcb3a99" }]);
      const other = yield* addBot("Other Email", secondProject);
      const otherAccount = yield* connectGmail(secondProject);
      yield* tools.grantApp({ projectId: secondProject, app: "gmail", audience: all });
      const otherMcp = yield* authenticate(other.threadId);
      expect(content(yield* otherMcp.write(gmailReplyAction, args))).toHaveProperty(
        "response_data",
      );
      expect(sends().map(({ account }) => account)).toEqual([account.id, otherAccount.id]);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("rechecks the Gmail approval grant and the reviewed account before sending", () =>
  Effect.gen(function* () {
    const { approval, grant, sends } = yield* queuedReply();
    const tools = yield* ProjectTools.ProjectTools;
    const { backend } = yield* Fixture;
    const client = yield* gmailWorkspaceClient([AuthOrchestrationOperateScope]);
    const approve = client[approveMethod](approval);
    yield* tools.grant({ ...grant, fixedInputs: { cc: ["unreviewed@example.test"] } });
    expect(yield* Effect.flip(approve)).toMatchObject({ code: "workspace-input-conflict" });
    yield* tools.grant(grant);
    const gate = yield* backend.holdSession(gmailReplyAction);
    const inFlight = yield* approve.pipe(Effect.flip, Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    yield* tools.grant({ ...grant, audience: null });
    yield* Deferred.succeed(gate.proceed, undefined);
    expect(yield* Fiber.join(inFlight)).toMatchObject({ code: "not-assigned" });
    yield* tools.grant(grant);
    const editingGate = yield* backend.holdSession(gmailReplyAction);
    const stale = yield* approve.pipe(Effect.flip, Effect.forkScoped);
    yield* Deferred.await(editingGate.entered);
    const workspace = yield* GmailWorkspace.GmailWorkspace;
    const edited = yield* workspace.updateDraft({
      ...approval,
      change: { kind: "edit", body: "Check the date and follow up." },
    });
    yield* Deferred.succeed(editingGate.proceed, undefined);
    expect(yield* Fiber.join(stale)).toMatchObject({ code: "workspace-draft-changed" });
    yield* connectGmail(firstProject);
    expect(
      yield* Effect.flip(client[approveMethod]({ ...approval, revision: edited.revision })),
    ).toMatchObject({ code: "workspace-account-changed" });
    expect(sends()).toEqual([]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("keeps uncertain delivery on the draft and blocks reapproval or edits", () =>
  Effect.gen(function* () {
    const { approval, sends } = yield* queuedReply();
    const { backend } = yield* Fixture;
    const workspace = yield* GmailWorkspace.GmailWorkspace;
    const client = yield* gmailWorkspaceClient([AuthOrchestrationOperateScope]);
    backend.failWrite(gmailReplyAction, 403);
    expect(yield* client[approveMethod](approval)).toBe("failed");
    expect(yield* client[approveMethod](approval)).toBe("failed");
    expect(sends()).toHaveLength(1);
    const change = { kind: "edit", body: "I’ll verify the delivery date this afternoon." } as const;
    const revised = yield* workspace.updateDraft({ ...approval, change });
    const request = { ...approval, revision: revised.revision };
    backend.failWrite(gmailReplyAction);
    expect(yield* client[approveMethod](request)).toBe("uncertain");
    expect((yield* workspace.thread(approval)).messages.at(-1)?.draft).toMatchObject({
      deliveryStatus: "uncertain",
      revision: revised.revision,
    });
    expect(yield* client[approveMethod](request)).toBe("uncertain");
    expect(yield* Effect.flip(workspace.updateDraft({ ...request, change }))).toMatchObject({
      code: "workspace-draft-changed",
    });
    expect(sends()).toHaveLength(2);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("searches the full paginated catalog and manages a verified project account", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const { backend, enableComposio } = yield* Fixture;
    expect(yield* tools.settings(firstProject)).toMatchObject({
      configured: false,
      accounts: [],
      assignments: [],
    });
    expect((yield* Effect.flip(tools.actions({ projectId: firstProject }))).code).toBe(
      "missing-key",
    );
    enableComposio();
    const apps = yield* tools.apps({ projectId: firstProject });
    expect(apps.items[0]?.slug).toBe("fixture");
    const more = yield* tools.apps({ projectId: firstProject, cursor: apps.nextCursor! });
    expect(more.items[0]?.slug).toBe("public");
    expect(
      (yield* tools.apps({ projectId: firstProject, query: "configuration" })).items[0]?.slug,
    ).toBe("config");
    const first = yield* tools.actions({
      projectId: firstProject,
      app: "fixture",
      query: "repository",
    });
    const second = yield* tools.actions({
      projectId: firstProject,
      app: "fixture",
      query: "repository",
      cursor: first.nextCursor!,
    });
    expect(first.items[0]).toMatchObject({ slug: read, effect: "read", requiresAccount: true });
    expect(second.items[0]).toMatchObject({ slug: write, effect: "write", requiresAccount: true });
    expect(yield* tools.action(firstProject, unknownEffect)).toMatchObject({ effect: "write" });
    expect((yield* tools.app(firstProject, "public")).setup).toBe("no-account");
    expect((yield* tools.app(firstProject, "config")).setup).toBe("auth-config-required");
    expect(
      (yield* Effect.flip(
        tools.connection({ projectId: firstProject, app: "config", operation: "start" }),
      )).code,
    ).toBe("auth-config-required");
    const app = { projectId: firstProject, app: "fixture" };
    const begin = yield* tools.connection({ ...app, operation: "start" });
    expect(begin.url).toMatch(/^https:\/\/connect\.composio\.dev\/link\//);
    expect((yield* tools.settings(firstProject)).accounts).toEqual([
      { app: "fixture", account: null, pending: true },
    ]);
    expect((yield* Effect.flip(tools.connection({ ...app, operation: "finish" }))).code).toBe(
      "pending-account",
    );
    const account = Array.from(backend.accounts.values())[0]!;
    account.status = "ACTIVE";
    account.label = "First account";
    const owner = account.user_id;
    account.user_id = "someone-else";
    expect((yield* Effect.flip(tools.connection({ ...app, operation: "finish" }))).code).toBe(
      "failed-account",
    );
    account.user_id = owner;
    yield* tools.connection({ ...app, operation: "finish" });
    yield* tools.grant({
      projectId: firstProject,
      slug: read,
      audience: all,
      fixedInputs: { repository: "org/repo" },
    });
    expect(yield* tools.settings(firstProject)).toMatchObject({
      accounts: [
        {
          app: "fixture",
          pending: false,
          account: { label: "First account", status: "connected" },
        },
      ],
      assignments: [{ action: { slug: read }, status: "available" }],
    });
    expect((yield* tools.settings(secondProject)).accounts).toEqual([]);
    yield* tools.connection({ ...app, operation: "start" });
    expect((yield* tools.settings(firstProject)).accounts[0]).toMatchObject({
      pending: true,
      account: { label: "First account", status: "connected" },
    });
    const replacement = Array.from(backend.accounts.values()).find(({ id }) => id !== account.id)!;
    replacement.status = "ACTIVE";
    replacement.label = "Replacement account";
    yield* tools.connection({ ...app, operation: "finish" });
    expect(backend.accounts.has(account.id)).toBe(false);
    expect((yield* tools.settings(firstProject)).accounts[0]?.account?.label).toBe(
      "Replacement account",
    );
    replacement.status = "EXPIRED";
    expect((yield* tools.settings(firstProject)).assignments[0]?.status).toBe(
      "account-unavailable",
    );
    yield* tools.connection({ ...app, operation: "disconnect" });
    expect(backend.accounts.size).toBe(0);
    expect((yield* tools.settings(firstProject)).assignments[0]?.status).toBe("account-required");
    backend.hideAction(read);
    expect((yield* tools.settings(firstProject)).assignments[0]?.status).toBe("action-unavailable");
    yield* tools.grant({ projectId: firstProject, slug: read, audience: null, fixedInputs: {} });
    expect((yield* tools.settings(firstProject)).assignments).toEqual([]);
    expect(backend.sessions.size).toBe(0);
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "enforces current project, audience, account, arguments, and Plan mode on authenticated calls",
  () =>
    Effect.gen(function* () {
      const tools = yield* ProjectTools.ProjectTools;
      const bots = yield* Bots.BotService;
      const { backend, shells, enableComposio, authenticate } = yield* Fixture;
      enableComposio();
      const first = yield* addBot("Repo bot", firstProject);
      const otherProject = yield* addBot("Other project bot", secondProject);
      const api = yield* authenticate(first.threadId);
      const other = yield* authenticate(otherProject.threadId);
      const app = { projectId: firstProject, app: "fixture" };
      yield* tools.connection({ ...app, operation: "start" });
      const account = Array.from(backend.accounts.values())[0]!;
      account.status = "ACTIVE";
      yield* tools.connection({ ...app, operation: "finish" });
      const grantRead = {
        projectId: firstProject,
        slug: read,
        audience: all,
        fixedInputs: { repository: "org/approved" },
      };
      yield* tools.grant(grantRead);
      yield* tools.grant({
        projectId: firstProject,
        slug: publicRead,
        audience: all,
        fixedInputs: {},
      });
      const selected = { kind: "selected", botIds: [first.agent.id] } as const;
      const grantWrite = { ...grantRead, slug: write, audience: selected };
      yield* tools.grant(grantWrite);
      expect(
        (yield* Effect.flip(tools.grant({ ...grantWrite, fixedInputs: { repository: false } })))
          .code,
      ).toBe("invalid-fixed-inputs");
      expect(
        (yield* Effect.flip(
          tools.grant({
            ...grantWrite,
            audience: { kind: "selected", botIds: [otherProject.agent.id] },
          }),
        )).code,
      ).toBe("invalid-bots");

      const future = yield* addBot("New bot", firstProject);
      const futureApi = yield* authenticate(future.threadId);
      expect(content(yield* futureApi.search({ query: "repository" }))).toEqual({
        actions: [
          expect.objectContaining({
            slug: read,
            inputSchema: expect.objectContaining({ required: ["repository"] }),
            fixedInputs: ["repository"],
          }),
        ],
        nextOffset: null,
      });
      expect(backend.catalogRequests.at(-1)?.searchParams.get("tool_slugs")).toBe(read);
      expect(content(yield* other.search())).toEqual({ actions: [], nextOffset: null });
      expect(code(yield* other.read(read))).toBe("not-assigned");
      expect(code(yield* futureApi.write(write, { note: "blocked" }))).toBe("not-assigned");
      expect(code(yield* api.read(write, { note: "blocked" }))).toBe("wrong-action-type");
      expect(code(yield* api.write(write))).toBe("invalid-arguments");
      expect(backend.calls).toEqual([]);
      expect(content(yield* futureApi.read(read, { repository: "org/wrong" }))).toEqual({
        slug: read,
        arguments: { repository: "org/approved" },
      });
      expect(backend.calls.at(-1)).toMatchObject({
        slug: read,
        userId: account.user_id,
        account: account.id,
        arguments: { repository: "org/approved" },
      });
      expect(content(yield* api.read(publicRead))).toEqual({ slug: publicRead, arguments: {} });
      expect(backend.calls.at(-1)?.account).toBeUndefined();
      expect(content(yield* api.write(write, { note: "fixture only" }))).toEqual({
        slug: write,
        arguments: { repository: "org/approved", note: "fixture only" },
      });
      expect(backend.calls.at(-1)).toMatchObject({
        slug: write,
        account: account.id,
        userId: account.user_id,
      });
      backend.failWrite();
      const beforeAmbiguous = backend.calls.length;
      expect(code(yield* api.write(write, { note: "uncertain" }))).toBe("action-outcome-unknown");
      expect(backend.calls.length).toBe(beforeAmbiguous + 1);
      const shell = shells.get(first.threadId)!;
      shells.set(first.threadId, { ...shell, interactionMode: "plan" });
      expect(content(yield* api.search({ query: "note" }))).toEqual({
        actions: [],
        nextOffset: null,
      });
      expect(code(yield* api.write(write, { note: "no plan writes" }))).toBe("plan-mode");
      expect(content(yield* api.read(read))).toMatchObject({ slug: read });
      shells.set(first.threadId, shell);
      account.status = "EXPIRED";
      expect(code(yield* api.read(read))).toBe("account-unavailable");
      account.status = "ACTIVE";

      const gate = yield* backend.holdSession();
      const inFlight = yield* api
        .write(write, { note: "revoked during setup" })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(gate.entered);
      const beforeRevoke = backend.calls.length;
      yield* tools.grant({ ...grantWrite, audience: { kind: "selected", botIds: [] } });
      yield* Deferred.succeed(gate.proceed, undefined);
      expect(code(yield* Fiber.join(inFlight))).toBe("not-assigned");
      expect(code(yield* api.write(write, { note: "revoked in the same MCP session" }))).toBe(
        "not-assigned",
      );
      expect(backend.calls.length).toBe(beforeRevoke);
      yield* tools.grant({
        ...grantRead,
        audience: { kind: "selected", botIds: [future.agent.id] },
      });
      expect(code(yield* api.read(read))).toBe("not-assigned");

      yield* tools.grant({
        projectId: secondProject,
        slug: publicRead,
        audience: all,
        fixedInputs: {},
      });
      yield* bots.save({
        id: first.agent.id,
        name: first.agent.name,
        projectId: secondProject,
        allowedProjectIds: [secondProject],
        config: first.agent.config,
      });
      expect(code(yield* api.read(read))).toBe("not-assigned");
      expect(content(yield* api.read(publicRead))).toMatchObject({ slug: publicRead });
      expect(backend.calls.at(-1)?.userId).not.toBe(account.user_id);
      expect(backend.sessions.size).toBe(0);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("gives three bots full access, no access, and one action for the same app", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const { backend, enableComposio, authenticate, shells } = yield* Fixture;
    enableComposio();
    const full = yield* addBot("Full access", firstProject);
    const none = yield* addBot("No access", firstProject);
    const limited = yield* addBot("One action", firstProject);
    const fullApi = yield* authenticate(full.threadId);
    const noneApi = yield* authenticate(none.threadId);
    const limitedApi = yield* authenticate(limited.threadId);
    const app = { projectId: firstProject, app: "fixture" };
    yield* tools.connection({ ...app, operation: "start" });
    const account = Array.from(backend.accounts.values())[0]!;
    account.status = "ACTIVE";
    yield* tools.connection({ ...app, operation: "finish" });
    yield* tools.grant({
      projectId: firstProject,
      slug: read,
      audience: { kind: "selected", botIds: [full.agent.id, limited.agent.id] },
      fixedInputs: { repository: "org/allowed" },
    });
    yield* tools.grantApp({
      ...app,
      audience: { kind: "selected", botIds: [full.agent.id] },
    });

    expect(content(yield* fullApi.search())).toMatchObject({
      apps: [expect.objectContaining({ slug: "fixture" })],
    });
    expect(content(yield* fullApi.search({ app: "fixture" }))).toMatchObject({
      actions: [expect.objectContaining({ slug: read, fixedInputs: ["repository"] })],
      nextCursor: "second",
    });
    expect(content(yield* fullApi.search({ app: "fixture", cursor: "second" }))).toMatchObject({
      actions: [expect.objectContaining({ slug: write, fixedInputs: [] })],
    });
    expect(content(yield* limitedApi.search({ app: "fixture" }))).toEqual({
      actions: [expect.objectContaining({ slug: read })],
      nextOffset: null,
    });
    expect(content(yield* noneApi.search())).toEqual({ actions: [], nextOffset: null });
    expect(code(yield* noneApi.read(read))).toBe("not-assigned");
    expect(code(yield* limitedApi.write(write))).toBe("not-assigned");
    expect(code(yield* fullApi.read(publicRead))).toBe("not-assigned");
    expect(content(yield* fullApi.read(read, { repository: "org/override" }))).toMatchObject({
      arguments: { repository: "org/allowed" },
    });
    expect(
      content(yield* fullApi.write(write, { repository: "org/allowed", note: "fixture" })),
    ).toMatchObject({ slug: write });
    expect(backend.calls.at(-1)?.account).toBe(account.id);

    const shell = shells.get(full.threadId)!;
    shells.set(full.threadId, { ...shell, interactionMode: "plan" });
    expect(code(yield* fullApi.write(write))).toBe("plan-mode");
    expect(content(yield* fullApi.search({ app: "fixture", cursor: "second" }))).toMatchObject({
      actions: [],
    });
    shells.set(full.threadId, shell);
    const gate = yield* backend.holdSession();
    const inFlight = yield* fullApi
      .write(write, { repository: "org/allowed", note: "revoked" })
      .pipe(Effect.forkScoped);
    yield* Deferred.await(gate.entered);
    yield* tools.grantApp({ ...app, audience: null });
    yield* Deferred.succeed(gate.proceed, undefined);
    expect(code(yield* Fiber.join(inFlight))).toBe("not-assigned");
    expect(content(yield* limitedApi.read(read))).toMatchObject({ slug: read });

    yield* tools.grantApp({ ...app, audience: all });
    const newBot = yield* addBot("New full access", firstProject);
    const newApi = yield* authenticate(newBot.threadId);
    expect(content(yield* newApi.search())).toMatchObject({
      apps: [expect.objectContaining({ slug: "fixture" })],
    });
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "reviews a report against its assigned property, account, and exact proposal revision",
  () =>
    Effect.gen(function* () {
      const tools = yield* ProjectTools.ProjectTools;
      const { backend, authenticate, enableComposio } = yield* Fixture;
      enableComposio();
      const website = yield* addBot("Website", firstProject);
      const other = yield* addBot("Other", firstProject);
      const elsewhere = yield* addBot("Elsewhere", secondProject);
      const owner = {
        threadId: website.threadId,
        botId: website.agent.id,
        projectId: firstProject,
      };
      const api = yield* authenticate(website.threadId);
      const otherApi = yield* authenticate(other.threadId);
      const connection = { projectId: firstProject, app: searchApp.slug };
      yield* tools.connection({ ...connection, operation: "start" });
      const account = Array.from(backend.accounts.values())[0]!;
      account.status = "ACTIVE";
      account.label = "Assigned Search Console";
      backend.accounts.set("ambient", {
        ...account,
        id: "ambient",
        label: "Ambient Search Console",
      });
      yield* tools.connection({ ...connection, operation: "finish" });

      const grant = {
        projectId: firstProject,
        slug: searchAction.slug,
        fixedInputs: { site_url: websiteProposal.source.property },
        audience: { kind: "selected", botIds: [website.agent.id] } as const,
      };
      yield* tools.grantApp({ ...connection, audience: grant.audience });
      expect(code(yield* api.proposeApp(websiteProposal))).toBe("fixed-inputs-required");
      yield* tools.grantApp({ ...connection, audience: null });
      yield* tools.grant(grant);
      expect(
        code(
          yield* api.proposeApp({
            ...websiteProposal,
            source: { ...websiteProposal.source, property: "sc-domain:ambient.example.test" },
          }),
        ),
      ).toBe("fixed-inputs-required");
      expect(code(yield* otherApi.proposeApp(websiteProposal))).toBe("not-assigned");
      expect(backend.calls).toHaveLength(0);
      expect(content(yield* api.proposeApp(websiteProposal))).toMatchObject({
        title: websiteProposal.title,
      });
      expect(backend.calls).toEqual([
        expect.objectContaining({
          userId: account.user_id,
          slug: searchAction.slug,
          account: account.id,
          arguments: expect.objectContaining({
            site_url: websiteProposal.source.property,
            row_limit: 1,
          }),
        }),
      ]);

      const reader = yield* botAppsClient([AuthOrchestrationReadScope]);
      const operator = yield* botAppsClient([
        AuthOrchestrationReadScope,
        AuthOrchestrationOperateScope,
      ]);
      const getState = operator[BOT_APPS_RPC_METHODS.state];
      const review = operator[BOT_APPS_RPC_METHODS.review];
      const { proposal, saved } = yield* getState(owner);
      expect(saved).toBeNull();
      if (proposal?.status !== "available") throw new Error("Expected an available proposal");
      expect(proposal.snapshot).toMatchObject({
        definition: websiteProposal,
        report: {
          accountLabel: account.label,
          metrics: [
            { label: "Clicks", value: 18 },
            { label: "Impressions", value: 620 },
          ],
        },
      });
      const input = { ...owner, revision: proposal.snapshot.revision };
      const decision = { kind: "approve" } as const;
      expect(
        yield* Effect.flip(reader[BOT_APPS_RPC_METHODS.review]({ ...input, decision })),
      ).toMatchObject({ _tag: "EnvironmentAuthorizationError" });
      expect(yield* Effect.flip(getState({ ...owner, botId: other.agent.id }))).toMatchObject({
        code: "not-a-bot",
      });
      expect(yield* Effect.flip(getState({ ...owner, projectId: secondProject }))).toMatchObject({
        code: "not-a-bot",
      });
      expect(
        yield* getState({
          projectId: secondProject,
          threadId: elsewhere.threadId,
          botId: elsewhere.agent.id,
        }),
      ).toEqual({ saved: null, proposal: null });
      yield* review({
        ...input,
        decision: { kind: "annotate", note: "Show which sizes are supported." },
      });
      expect(yield* Effect.flip(review({ ...input, decision }))).toMatchObject({
        code: "proposal-changed",
      });
      const annotated = (yield* getState(owner)).proposal;
      if (annotated?.status !== "available") throw new Error("Expected a review note");
      expect(content(yield* api.appProposal())).toMatchObject({
        note: "Show which sizes are supported.",
      });
      yield* review({ ...owner, revision: annotated.snapshot.revision, decision });
      expect(yield* getState(owner)).toEqual({ saved: annotated, proposal: null });
      expect(backend.calls).toHaveLength(1);

      backend.setSearchReport({ responseAggregationType: "byPage" });
      expect(code(yield* api.proposeApp(websiteProposal))).toBe("report-empty");
      backend.setSearchReport({
        ...websiteReport,
        rows: [{ ...websiteReport.rows[0], keys: ["https://ambient.example.test/"] }],
      });
      expect(code(yield* api.proposeApp(websiteProposal))).toBe("report-invalid");
      expect(yield* getState(owner)).toEqual({ saved: annotated, proposal: null });
      backend.setSearchReport({ successful: true, data: websiteReport });
      const revised = content(yield* api.proposeApp(websiteProposal));
      const revision = Schema.decodeUnknownEffect(Schema.Struct({ revision: Schema.String }));
      yield* review({
        ...owner,
        ...(yield* revision(revised)),
        decision: { kind: "annotate", note: "Check the October 1 count." },
      });
      const previous = yield* revision(content(yield* api.appProposal()));
      expect(
        content(
          yield* api.proposeApp({
            ...websiteProposal,
            source: {
              ...websiteProposal.source,
              window: { start: "2026-10-02", end: "2026-10-31" },
            },
            replacesRevision: previous.revision,
          }),
        ),
      ).toMatchObject({ title: websiteProposal.title });
      const pending = (yield* getState(owner)).proposal;
      expect(pending).toMatchObject({ status: "available", snapshot: { note: "" } });
      expect((yield* getState(owner)).saved).toEqual(annotated);
      if (pending?.status !== "available") throw new Error("Expected a pending replacement");
      expect(
        yield* Effect.flip(
          review({
            ...owner,
            revision: pending.snapshot.revision,
            decision: { kind: "remove" },
          }),
        ),
      ).toMatchObject({ code: "saved-app-changed" });

      yield* tools.grant({ ...grant, audience: null });
      expect(yield* getState(owner)).toEqual({
        saved: { status: "unavailable", revision: annotated.snapshot.revision },
        proposal: { status: "unavailable", revision: pending.snapshot.revision },
      });
      expect(
        yield* Effect.flip(review({ ...owner, revision: pending.snapshot.revision, decision })),
      ).toMatchObject({ code: "not-assigned" });
      yield* tools.grant(grant);
      expect(yield* getState(owner)).toEqual({ saved: annotated, proposal: pending });
      yield* tools.connection({ ...connection, operation: "disconnect" });
      yield* tools.connection({ ...connection, operation: "start" });
      const replacement = Array.from(backend.accounts.values()).find(
        ({ status }) => status === "INITIATED",
      )!;
      replacement.status = "ACTIVE";
      replacement.label = account.label;
      yield* tools.connection({ ...connection, operation: "finish" });
      expect((yield* getState(owner)).saved?.status).toBe("unavailable");
      expect(
        yield* Effect.flip(review({ ...owner, revision: pending.snapshot.revision, decision })),
      ).toMatchObject({ code: "source-unavailable" });
      yield* review({
        ...owner,
        revision: annotated.snapshot.revision,
        decision: { kind: "remove" },
      });
      expect(yield* getState(owner)).toEqual({
        saved: null,
        proposal: { status: "unavailable", revision: pending.snapshot.revision },
      });
      yield* review({
        ...owner,
        revision: pending.snapshot.revision,
        decision: { kind: "dismiss" },
      });
      expect((yield* getState(owner)).proposal).toBeNull();
    }).pipe(Effect.provide(testLayer)),
);

it.effect("reviews Social captions for the scoped destinations and keeps the asset approval", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const { backend, authenticate, enableComposio } = yield* Fixture;
    enableComposio();
    const social = yield* addBot("Social", firstProject);
    const other = yield* addBot("Other", firstProject);
    const target = { threadId: social.threadId, botId: social.agent.id, projectId: firstProject };
    const api = yield* authenticate(social.threadId);
    const otherApi = yield* authenticate(other.threadId);
    const connection = { projectId: firstProject, app: postizApp.slug };
    yield* tools.connection({ ...connection, operation: "start" });
    const account = Array.from(backend.accounts.values())[0]!;
    account.status = "ACTIVE";
    account.label = "Assigned workspace";
    backend.accounts.set("ambient", { ...account, id: "ambient", label: "Personal workspace" });
    yield* tools.connection({ ...connection, operation: "finish" });
    expect(code(yield* api.proposeCalendar(socialProposal))).toBe("not-assigned");
    const grant = {
      projectId: firstProject,
      slug: postizAction.slug,
      fixedInputs: { group: socialProposal.source.group },
      audience: { kind: "selected", botIds: [social.agent.id] } as const,
    };
    yield* tools.grant(grant);
    expect(code(yield* otherApi.proposeCalendar(socialProposal))).toBe("not-assigned");
    expect(
      code(
        yield* api.proposeCalendar({
          ...socialProposal,
          source: { kind: "postiz", group: "another-workspace" },
        }),
      ),
    ).toBe("fixed-inputs-required");
    expect(backend.calls).toHaveLength(0);

    const { asset, posts } = socialProposal.contentPackage;
    const [facebook, instagram, ...rest] = posts;
    expect(
      code(
        yield* api.proposeCalendar({
          ...socialProposal,
          contentPackage: { asset, posts: [{ ...facebook, destination: instagram.destination }] },
        }),
      ),
    ).toBe("postiz-destination-unavailable");
    const operator = yield* botAppsClient([
      AuthOrchestrationReadScope,
      AuthOrchestrationOperateScope,
    ]);
    const state = operator[BOT_APPS_RPC_METHODS.state];
    const review = operator[BOT_APPS_RPC_METHODS.review];
    expect(yield* state(target)).toEqual(expect.objectContaining({ proposal: null, saved: null }));
    expect(yield* Effect.flip(state({ ...target, projectId: secondProject }))).toMatchObject({
      code: "not-a-bot",
    });

    expect(content(yield* api.proposeCalendar(socialProposal))).toMatchObject({
      title: socialProposal.title,
    });
    const original = (yield* state(target)).proposal;
    if (original?.status !== "available") throw new Error("Expected a Social calendar");
    expect(original.snapshot).toMatchObject({
      kind: "social-calendar",
      definition: { contentPackage: { asset, posts } },
      report: {
        accountLabel: account.label,
        destinations: [
          { integrationId: facebook.destination.integrationId, label: "Workshop Facebook" },
          { integrationId: instagram.destination.integrationId, label: "Workshop Instagram" },
          { integrationId: "workshop-yt", label: "Workshop YouTube" },
        ],
      },
    });
    const approve = { kind: "approve" } as const;
    yield* review({ ...target, revision: original.snapshot.revision, decision: approve });
    content(yield* api.proposeCalendar(socialProposal));
    const draft = (yield* state(target)).proposal;
    if (draft?.status !== "available") throw new Error("Expected a package draft");
    const note = "Lead with the dry fit.";
    yield* review({
      ...target,
      revision: draft.snapshot.revision,
      decision: { kind: "annotate-caption", channel: "instagram", note },
    });
    expect(
      yield* Effect.flip(
        review({
          ...target,
          revision: draft.snapshot.revision,
          decision: approve,
        }),
      ),
    ).toMatchObject({ code: "proposal-changed" });
    const annotated = (yield* state(target)).proposal;
    if (annotated?.status !== "available") throw new Error("Expected an annotated caption");
    expect(content(yield* api.appProposal())).toMatchObject({
      captionNotes: [{ channel: "instagram", note }],
    });

    const updated = { ...socialProposal, replacesRevision: annotated.snapshot.revision };
    expect(
      code(
        yield* api.proposeCalendar({
          ...updated,
          contentPackage: {
            posts,
            asset: {
              ...asset,
              approval: { ...asset.approval, approvedAt: "2026-11-21T16:00:00Z" },
            },
          },
        }),
      ),
    ).toBe("asset-approval-changed");
    const revisedPosts = [facebook, { ...instagram, caption: "Start with a dry fit." }, ...rest];
    content(
      yield* api.proposeCalendar({ ...updated, contentPackage: { asset, posts: revisedPosts } }),
    );
    const revised = (yield* state(target)).proposal;
    if (revised?.status !== "available") throw new Error("Expected a revised package");
    expect(revised.snapshot).toMatchObject({
      definition: { contentPackage: { asset, posts: revisedPosts } },
      captionNotes: [{ channel: "instagram", note }],
    });
    expect((yield* state(target)).saved).toEqual(original);
    expect(
      yield* Effect.flip(
        review({
          ...target,
          revision: annotated.snapshot.revision,
          decision: approve,
        }),
      ),
    ).toMatchObject({ code: "proposal-changed" });

    yield* tools.grant({ ...grant, audience: null });
    const unavailable = yield* state(target);
    expect(unavailable.saved?.status).toBe("unavailable");
    expect(unavailable.proposal?.status).toBe("unavailable");
    expect(
      yield* Effect.flip(
        review({
          ...target,
          revision: revised.snapshot.revision,
          decision: approve,
        }),
      ),
    ).toMatchObject({ code: "not-assigned" });
    yield* tools.grant(grant);
    expect(yield* state(target)).toEqual(
      expect.objectContaining({ saved: original, proposal: revised }),
    );
    expect(backend.calls).toHaveLength(4);
    for (const call of backend.calls) {
      expect(call).toEqual({
        userId: account.user_id,
        slug: postizAction.slug,
        account: account.id,
        arguments: grant.fixedInputs,
      });
    }

    yield* tools.grant({ ...grant, audience: null });
    yield* review({
      ...target,
      revision: revised.snapshot.revision,
      decision: { kind: "dismiss" },
    });
    content(
      yield* api.proposeCalendar({
        ...socialProposal,
        source: { kind: "local" },
        contentPackage: {
          asset,
          posts: [{ ...instagram, destination: { kind: "local", label: "Local Instagram" } }],
        },
      }),
    );
    expect((yield* state(target)).proposal).toMatchObject({
      status: "available",
      snapshot: { report: null, definition: { source: { kind: "local" } } },
    });
    expect(backend.calls).toHaveLength(4);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("delivers exact Social fixture approvals once and retains uncertain attempts", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const sql = yield* SqlClient.SqlClient;
    const { backend, authenticate, enableComposio } = yield* Fixture;
    enableComposio();
    const social = yield* addBot("Social", firstProject);
    const other = yield* addBot("Other", firstProject);
    const target = { threadId: social.threadId, botId: social.agent.id, projectId: firstProject };
    const api = yield* authenticate(social.threadId);
    const otherApi = yield* authenticate(other.threadId);
    const connection = { projectId: firstProject, app: postizApp.slug };
    yield* tools.connection({ ...connection, operation: "start" });
    const account = Array.from(backend.accounts.values())[0]!;
    account.status = "ACTIVE";
    account.label = "Workshop Postiz";
    yield* tools.connection({ ...connection, operation: "finish" });
    const assigned = {
      projectId: firstProject,
      fixedInputs: { group: socialProposal.source.group },
      audience: { kind: "selected", botIds: [social.agent.id] } as const,
    };
    const readGrant = { ...assigned, slug: postizAction.slug };
    const writeGrant = { ...assigned, slug: postizScheduleFixture.slug };
    yield* tools.grant(readGrant);
    yield* tools.grantApp({ ...connection, audience: assigned.audience });
    expect(code(yield* otherApi.proposeCalendar(socialProposal))).toBe("not-assigned");

    const operator = yield* botAppsClient([
      AuthOrchestrationReadScope,
      AuthOrchestrationOperateScope,
    ]);
    const readOnly = yield* botAppsClient([AuthOrchestrationReadScope]);
    const state = operator[BOT_APPS_RPC_METHODS.state];
    const review = operator[BOT_APPS_RPC_METHODS.review];
    const writes = () => backend.calls.filter(({ slug }) => slug === postizScheduleFixture.slug);
    const propose = Effect.fn("SocialFixtureTest.propose")(function* (
      input: Schema.JsonObject = socialProposal,
    ) {
      content(yield* api.proposeCalendar(input));
      const proposal = (yield* state(target)).proposal;
      if (proposal?.status !== "available") throw new Error("Expected a Social proposal");
      return proposal.snapshot.revision;
    });
    const save = (revision: string) =>
      review({ ...target, revision, decision: { kind: "approve" } });
    const delivery = {
      ...target,
      revision: yield* propose(),
      decision: { kind: "schedule-social-fixture", channel: "instagram" } as const,
    };
    expect(yield* Effect.flip(review(delivery))).toMatchObject({ code: "saved-app-changed" });
    yield* save(delivery.revision);
    expect(yield* Effect.flip(review(delivery))).toMatchObject({ code: "not-assigned" });
    expect(writes()).toHaveLength(0);

    yield* tools.grant(writeGrant);
    expect(content(yield* api.search({ query: postizScheduleFixture.slug }))).toMatchObject({
      actions: [],
    });
    expect(
      content(yield* api.search({ app: postizApp.slug, query: postizScheduleFixture.slug })),
    ).toMatchObject({ actions: [] });
    expect(content(yield* api.read(postizAction.slug))).toMatchObject({ successful: true });
    expect(code(yield* api.write(postizScheduleFixture.slug))).toBe("social-approval-required");
    expect(code(yield* otherApi.write(postizScheduleFixture.slug))).toBe(
      "social-approval-required",
    );
    expect(yield* Effect.flip(readOnly[BOT_APPS_RPC_METHODS.review](delivery))).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
    });
    expect(yield* Effect.flip(review({ ...delivery, projectId: secondProject }))).toMatchObject({
      code: "not-a-bot",
    });
    expect(
      yield* Effect.flip(
        review({ ...delivery, decision: { ...delivery.decision, channel: "tiktok" } }),
      ),
    ).toMatchObject({ code: "social-schedule-unavailable" });
    expect(writes()).toHaveLength(0);

    const { asset, posts } = socialProposal.contentPackage;
    const [facebook, instagram, ...rest] = posts;
    const caption = "Start with a dry fit.";
    const draftGate = yield* backend.holdSession(postizScheduleFixture.slug);
    const oldApproval = yield* Effect.forkChild(Effect.flip(review(delivery)));
    yield* Deferred.await(draftGate.entered);
    const revised = yield* propose({
      ...socialProposal,
      contentPackage: { asset, posts: [facebook, { ...instagram, caption }, ...rest] },
    });
    yield* Deferred.succeed(draftGate.proceed, undefined);
    expect(yield* Fiber.join(oldApproval)).toMatchObject({ code: "saved-app-changed" });
    expect((yield* state(target)).saved).not.toHaveProperty("socialSchedule");
    expect(yield* Effect.flip(review(delivery))).toMatchObject({ code: "saved-app-changed" });
    yield* save(revised);
    expect(yield* Effect.flip(review(delivery))).toMatchObject({ code: "saved-app-changed" });
    const approved = { ...delivery, revision: revised };
    const gate = yield* backend.holdSession(postizScheduleFixture.slug);
    const approval = yield* Effect.forkChild(Effect.flip(review(approved)));
    yield* Deferred.await(gate.entered);
    yield* tools.grant({ ...writeGrant, audience: null });
    yield* Deferred.succeed(gate.proceed, undefined);
    expect(yield* Fiber.join(approval)).toMatchObject({ code: "not-assigned" });
    expect(writes()).toHaveLength(0);
    yield* tools.grant({ ...writeGrant, fixedInputs: { group: "other-group" } });
    expect(yield* Effect.flip(review(approved))).toMatchObject({
      code: "workspace-input-conflict",
    });
    yield* tools.grant(writeGrant);

    yield* Effect.all([review(approved), review(approved)], { concurrency: 2 });
    expect(writes()).toEqual([
      {
        slug: postizScheduleFixture.slug,
        account: account.id,
        userId: account.user_id,
        arguments: {
          group: socialProposal.source.group,
          integration_id: instagram.destination.integrationId,
          publish_at: instagram.publishAt,
          caption,
          media_url: asset.mediaUrl,
        },
      },
    ]);
    expect((yield* state(target)).saved).toMatchObject({
      socialSchedule: expect.arrayContaining([
        {
          channel: "instagram",
          delivery: { status: "scheduled", receiptId: "fixture-post-receipt", matchesPost: true },
        },
      ]),
    });

    const uncertain = {
      ...approved,
      decision: { ...approved.decision, channel: "facebook" as const },
    };
    backend.failWrite(postizScheduleFixture.slug, 502);
    yield* review(uncertain);
    yield* review(uncertain);
    expect(writes()).toHaveLength(2);
    const edited = yield* propose({
      ...socialProposal,
      contentPackage: {
        asset,
        posts: [
          {
            ...facebook,
            caption: "A different caption",
            publishAt: facebook.publishAt.replace("Z", ".000Z"),
          },
        ],
      },
    });
    yield* save(edited);
    expect(yield* Effect.flip(review({ ...uncertain, revision: edited }))).toMatchObject({
      code: "social-schedule-already-attempted",
    });
    expect(writes()).toHaveLength(2);
    expect((yield* state(target)).saved).toMatchObject({
      socialSchedule: [
        { channel: "facebook", delivery: { status: "uncertain", matchesPost: false } },
      ],
    });
    expect(
      yield* sql`SELECT status, provider_receipt_id FROM social_schedule_attempts ORDER BY status`,
    ).toEqual([
      { status: "scheduled", provider_receipt_id: "fixture-post-receipt" },
      { status: "uncertain", provider_receipt_id: null },
    ]);

    const newRevision = yield* propose(socialProposal);
    yield* save(newRevision);
    const newApproval = {
      ...approved,
      revision: newRevision,
      decision: { ...approved.decision, channel: "youtube" as const },
    };
    backend.failWrite(postizScheduleFixture.slug, 403);
    yield* review(newApproval);
    yield* review(newApproval);
    expect((yield* state(target)).saved).toMatchObject({
      socialSchedule: expect.arrayContaining([
        { channel: "youtube", delivery: { status: "failed", matchesPost: true } },
      ]),
    });
    expect(writes()).toHaveLength(3);
    const retryRevision = yield* propose(socialProposal);
    yield* save(retryRevision);
    expect((yield* state(target)).saved).toMatchObject({
      socialSchedule: expect.arrayContaining([
        { channel: "youtube", delivery: { status: "ready" } },
      ]),
    });
    const retry = { ...newApproval, revision: retryRevision };
    account.status = "EXPIRED";
    expect(yield* Effect.flip(review(retry))).toMatchObject({ code: "account-unavailable" });
    yield* tools.connection({ ...connection, operation: "disconnect" });
    yield* tools.connection({ ...connection, operation: "start" });
    const replacement = Array.from(backend.accounts.values()).at(-1)!;
    replacement.status = "ACTIVE";
    replacement.label = account.label;
    yield* tools.connection({ ...connection, operation: "finish" });
    expect(yield* Effect.flip(review(retry))).toMatchObject({ code: "account-unavailable" });
    expect((yield* state(target)).saved?.status).toBe("unavailable");
    expect(writes()).toHaveLength(3);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("applies bot grants to an own background run and a schedule bound to its chat", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const bots = yield* Bots.BotService;
    const repository = yield* TaskRepository;
    const schedules = yield* ScheduledTaskService.ScheduledTaskService;
    const { backend, shells, scheduledThreads, enableComposio, authenticate } = yield* Fixture;
    enableComposio();
    const bot = yield* addBot("Scheduled bot", firstProject);
    const grant = {
      projectId: firstProject,
      slug: publicRead,
      audience: { kind: "selected", botIds: [bot.agent.id] } as const,
      fixedInputs: {},
    };
    yield* tools.grant(grant);
    const task = yield* bots.assign({
      agentId: bot.agent.id,
      requestId: "fixture",
      title: "Background",
      description: "Read public data.",
    });
    const background = ThreadId.make("own-task-run");
    const shell = shells.get(bot.threadId)!;
    shells.set(background, { ...liveThreadShell(background), projectId: firstProject });
    yield* repository.createAgentRun({
      id: TaskAgentRunId.make("own-task-run"),
      taskId: task.id,
      agentId: bot.agent.id,
      threadId: background,
      modelSelection: shell.modelSelection,
      status: "running",
      startedAt: task.createdAt,
      completedAt: null,
      triggerRunId: null,
      continuesRunId: null,
    });
    const backgroundApi = yield* authenticate(background);
    expect(content(yield* backgroundApi.read(publicRead))).toMatchObject({ slug: publicRead });
    const unrelated = ThreadId.make("other-worker");
    shells.set(unrelated, { ...liveThreadShell(unrelated), projectId: firstProject });
    const unrelatedApi = yield* authenticate(unrelated);
    expect(code(yield* unrelatedApi.read(publicRead))).toBe("not-a-bot");

    const schedule = yield* schedules.upsert(
      yield* scheduleInput({
        title: "Read public data",
        prompt: "Read public data for this project.",
        enabled: false,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: firstProject,
        threadId: bot.threadId,
        threadMode: "continue",
        workspaceStrategy: { type: "root" },
        modelSelection: shell.modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
      }),
    );
    expect((yield* schedules.runNow({ id: schedule.task.id })).threadId).toBe(bot.threadId);
    expect(scheduledThreads).toEqual([bot.threadId]);
    const scheduledApi = yield* authenticate(bot.threadId);
    expect(content(yield* scheduledApi.read(publicRead))).toMatchObject({ slug: publicRead });
    expect(backend.calls[0]?.userId).toBe(backend.calls[1]?.userId);
    yield* tools.grant({ ...grant, audience: null });
    expect(code(yield* scheduledApi.read(publicRead))).toBe("not-assigned");
    expect(code(yield* backgroundApi.read(publicRead))).toBe("not-assigned");
    yield* bots.save({
      id: bot.agent.id,
      name: bot.agent.name,
      projectId: secondProject,
      allowedProjectIds: [secondProject],
      config: bot.agent.config,
    });
    expect(code(yield* backgroundApi.read(publicRead))).toBe("not-a-bot");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("saves a review-only budget proposal backed by both scoped ads accounts", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const { backend, enableComposio, authenticate } = yield* Fixture;
    enableComposio();
    const bot = yield* addBot("Paid Media", firstProject);
    const anotherBot = yield* addBot("Other", firstProject);
    const target = { projectId: firstProject, botId: bot.agent.id, threadId: bot.threadId };
    const caller = yield* authenticate(bot.threadId);
    const unassigned = yield* authenticate(anotherBot.threadId);
    const connect = Effect.fn("ProjectToolsTest.connectAdsAccount")(function* (app: string) {
      const connection = { projectId: firstProject, app };
      yield* tools.connection({ ...connection, operation: "start" });
      const account = Array.from(backend.accounts.values()).find(
        ({ status }) => status === "INITIATED",
      );
      if (!account) throw new Error("Expected an initiated fixture account.");
      account.status = "ACTIVE";
      account.label = app;
      yield* tools.connection({ ...connection, operation: "finish" });
      return account;
    });
    const google = yield* connect(googleAdsApp.slug);
    const meta = yield* connect(metaAdsApp.slug);

    const audience = { kind: "selected", botIds: [bot.agent.id] } as const;
    const { source } = paidMediaProposal;
    const grant = (slug: string, fixedInputs: Schema.JsonObject) => ({
      projectId: firstProject,
      slug,
      fixedInputs,
      audience,
    });
    yield* tools.grant(grant(googleAdsSearch.slug, { customer_id: source.googleCustomerId }));
    yield* tools.grant(grant(metaAdsInsights.slug, { object_id: source.metaAdAccountId }));
    const creativeGrant = grant(metaAdsCreatives.slug, { ad_account_id: source.metaAdAccountId });
    expect(code(yield* caller.proposePaidMedia(paidMediaProposal))).toBe("not-assigned");
    expect(backend.calls).toHaveLength(0);
    yield* tools.grant(creativeGrant);
    const wrongSource = { ...source, metaAdAccountId: "act_" + "4".repeat(12) };
    expect(
      code(yield* caller.proposePaidMedia({ ...paidMediaProposal, source: wrongSource })),
    ).toBe("fixed-inputs-required");
    expect(
      code(
        yield* caller.proposePaidMedia({
          ...paidMediaProposal,
          source: { ...source, googleCustomerId: "5".repeat(10) },
        }),
      ),
    ).toBe("fixed-inputs-required");
    expect(code(yield* unassigned.proposePaidMedia(paidMediaProposal))).toBe("not-assigned");
    expect(backend.calls).toHaveLength(0);

    const operator = yield* botAppsClient([
      AuthOrchestrationReadScope,
      AuthOrchestrationOperateScope,
    ]);
    const state = operator[BOT_APPS_RPC_METHODS.state];
    const review = operator[BOT_APPS_RPC_METHODS.review];
    backend.setPaidMediaReport({ proposal: { ...paidMediaProposal, source: wrongSource } });
    expect(code(yield* caller.proposePaidMedia(paidMediaProposal))).toBe(
      "paid-media-source-mismatch",
    );
    backend.setPaidMediaReport({ sharedBudget: true });
    expect(code(yield* caller.proposePaidMedia(paidMediaProposal))).toBe(
      "paid-media-budget-unavailable",
    );
    expect(yield* state(target)).toEqual(expect.objectContaining({ saved: null, proposal: null }));
    backend.setPaidMediaReport(undefined);
    const beforeRead = backend.calls.length;
    expect(content(yield* caller.proposePaidMedia(paidMediaProposal))).toMatchObject({
      title: paidMediaProposal.title,
    });
    const reportCalls = backend.calls.slice(beforeRead);
    expect(reportCalls).toHaveLength(5);
    expect(reportCalls.filter((call) => call.slug === googleAdsSearch.slug)).toEqual(
      expect.arrayContaining(
        ["FROM customer", "FROM ad_group_ad", "FROM campaign"].map((query) =>
          expect.objectContaining({
            userId: google.user_id,
            account: google.id,
            arguments: {
              customer_id: source.googleCustomerId,
              query: expect.stringContaining(query),
            },
          }),
        ),
      ),
    );
    expect(reportCalls.filter((call) => call.account === meta.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: metaAdsInsights.slug,
          userId: meta.user_id,
          arguments: expect.objectContaining({
            object_id: source.metaAdAccountId,
            time_range: { since: source.window.start, until: source.window.end },
          }),
        }),
        expect.objectContaining({
          slug: metaAdsCreatives.slug,
          arguments: expect.objectContaining({ ad_account_id: source.metaAdAccountId, limit: 5 }),
        }),
      ]),
    );
    const { proposal } = yield* state(target);
    if (proposal?.status !== "available") throw new Error("Expected a Paid Media proposal.");
    expect(proposal.snapshot).toMatchObject({
      kind: "paid-media",
      definition: paidMediaProposal,
      report: {
        campaignName: "Core search campaign",
        currentDailyBudgetMicros: 75_000_000,
        google: {
          currency: "USD",
          spend: 1234.5,
          conversions: 42.5,
          creative: [{ text: "Tools for everyday projects" }],
        },
        meta: {
          currency: "EUR",
          spend: 842.1,
          conversions: 17,
          creative: [{ text: "Make something this weekend · Explore the workshop collection." }],
        },
      },
    });
    expect(yield* Effect.flip(state({ ...target, projectId: secondProject }))).toMatchObject({
      code: "not-a-bot",
    });

    const approve = {
      ...target,
      revision: proposal.snapshot.revision,
      decision: { kind: "approve" },
    } as const;
    yield* review({
      ...approve,
      decision: { kind: "annotate", note: "Confirm completed orders." },
    });
    expect(yield* Effect.flip(review(approve))).toMatchObject({ code: "proposal-changed" });
    const annotated = (yield* state(target)).proposal;
    if (annotated?.status !== "available")
      throw new Error("Expected the annotated budget proposal.");
    expect(content(yield* caller.appProposal())).toMatchObject({
      note: "Confirm completed orders.",
    });
    const latest = { ...approve, revision: annotated.snapshot.revision };
    yield* tools.grant({ ...creativeGrant, audience: null });
    expect((yield* state(target)).proposal).toEqual({
      status: "unavailable",
      revision: latest.revision,
    });
    expect(yield* Effect.flip(review(latest))).toMatchObject({ code: "not-assigned" });

    yield* tools.grant(creativeGrant);
    yield* review(latest);
    expect(yield* state(target)).toEqual(
      expect.objectContaining({ saved: annotated, proposal: null }),
    );
    expect(backend.calls).toHaveLength(beforeRead + 5);

    backend.setPaidMediaReport({ includeMetaConversion: false });
    expect(content(yield* caller.proposePaidMedia(paidMediaProposal))).toMatchObject({
      title: paidMediaProposal.title,
    });
    expect((yield* state(target)).proposal).toMatchObject({
      status: "available",
      snapshot: { report: { meta: { conversions: null } } },
    });
    yield* tools.connection({
      projectId: firstProject,
      app: metaAdsApp.slug,
      operation: "disconnect",
    });
    yield* connect(metaAdsApp.slug);
    expect((yield* state(target)).saved).toEqual({
      status: "unavailable",
      revision: latest.revision,
    });
  }).pipe(Effect.provide(testLayer)),
);

it.effect(
  "saves Shopify exceptions and scopes catalog follow-ups to the verified store and bot",
  () =>
    Effect.gen(function* () {
      const tools = yield* ProjectTools.ProjectTools;
      const apps = yield* BotApps.BotApps;
      const { backend, enableComposio, authenticate } = yield* Fixture;
      enableComposio();
      const commerce = yield* addBot("Store operations", firstProject);
      const website = yield* addBot("Website", firstProject);
      const caller = yield* authenticate(commerce.threadId);
      const unassigned = yield* authenticate(website.threadId);
      const target = {
        projectId: firstProject,
        botId: commerce.agent.id,
        threadId: commerce.threadId,
      };
      const connection = { projectId: firstProject, app: shopifyApp.slug };
      yield* tools.connection({ ...connection, operation: "start" });
      const [account] = Array.from(backend.accounts.values());
      if (!account) throw new Error("Expected a fixture Shopify account.");
      account.status = "ACTIVE";
      account.label = "Workshop store";
      backend.accounts.set("other-shop", { ...account, id: "other-shop" });
      yield* tools.connection({ ...connection, operation: "finish" });

      const audience = { kind: "selected", botIds: [commerce.agent.id] } as const;
      const { input } = shopifyStoreAction(shopifyProposal.source.store);
      const grant = {
        projectId: firstProject,
        slug: shopifyRead.slug,
        fixedInputs: input.requiredFixedInputs,
        audience,
      };
      yield* tools.grantApp({ ...connection, audience });
      expect(code(yield* caller.proposeShopify(shopifyProposal))).toBe("fixed-inputs-required");
      yield* tools.grantApp({ ...connection, audience: null });
      yield* tools.grant(grant);
      expect(
        code(
          yield* caller.proposeShopify({
            ...shopifyProposal,
            source: { ...shopifyProposal.source, store: otherShop },
          }),
        ),
      ).toBe("fixed-inputs-required");
      expect(code(yield* unassigned.proposeShopify(shopifyProposal))).toBe("not-assigned");
      expect(backend.calls).toEqual([]);

      backend.setShopifyReport({
        successful: true,
        data: { data: { ...shopifyResponse, shop: { myshopifyDomain: otherShop } } },
      });
      expect(code(yield* caller.proposeShopify(shopifyProposal))).toBe("shopify-store-mismatch");
      backend.setShopifyReport({
        data: shopifyResponse,
        errors: [{ message: "Partial response" }],
      });
      expect(code(yield* caller.proposeShopify(shopifyProposal))).toBe("shopify-report-invalid");
      expect(yield* apps.state(target)).toMatchObject({ saved: null, proposal: null });

      backend.setShopifyReport({
        successful: true,
        data: JSON.stringify({ data: shopifyResponse }),
      });
      expect(content(yield* caller.proposeShopify(shopifyProposal))).toMatchObject({
        title: shopifyProposal.title,
      });
      const { proposal } = yield* apps.state(target);
      if (proposal?.status !== "available") throw new Error("Expected a Shopify proposal.");
      expect(proposal.snapshot).toMatchObject({
        kind: "shopify-store",
        definition: shopifyProposal,
        report: {
          accountLabel: account.label,
          catalog: [{ productId: "101", product: "Workshop apron" }],
          inventory: [
            {
              productId: "101",
              variantId: "201",
              product: "Workshop apron",
              variant: "Canvas",
              available: 0,
            },
          ],
          orders: [{ orderId: "401", order: "#1401" }],
        },
      });
      expect(content(yield* caller.shopifyCatalog())).toBeNull();
      yield* apps.review(
        {
          ...target,
          revision: proposal.snapshot.revision,
          decision: { kind: "approve" },
        },
        approvalSession,
      );
      expect(yield* apps.state(target)).toMatchObject({ saved: proposal, proposal: null });
      const followUps = [
        {
          product: "Workshop apron",
          outcome: "Verify and prepare missing product media for the product page.",
          source: "https://" + shopifyProposal.source.store + "/admin/products/101",
        },
      ];
      expect(content(yield* caller.shopifyCatalog())).toEqual(followUps);
      expect(content(yield* unassigned.shopifyCatalog())).toBeNull();
      expect(backend.calls).toEqual(
        Array.from({ length: 3 }, () => ({
          userId: account.user_id,
          slug: shopifyRead.slug,
          account: account.id,
          arguments: input.arguments,
        })),
      );

      yield* tools.grant({ ...grant, audience: null });
      expect((yield* apps.state(target)).saved).toEqual({
        status: "unavailable",
        revision: proposal.snapshot.revision,
      });
      expect(code(yield* caller.shopifyCatalog())).toBe("not-assigned");
      yield* tools.grant(grant);
      expect(content(yield* caller.shopifyCatalog())).toEqual(followUps);
      yield* tools.connection({ ...connection, operation: "disconnect" });
      yield* tools.connection({ ...connection, operation: "start" });
      const replacement = Array.from(backend.accounts.values()).find(
        ({ status }) => status === "INITIATED",
      );
      if (!replacement) throw new Error("Expected a replacement Shopify account.");
      replacement.status = "ACTIVE";
      replacement.label = account.label;
      yield* tools.connection({ ...connection, operation: "finish" });
      expect((yield* apps.state(target)).saved?.status).toBe("unavailable");
      expect(code(yield* caller.shopifyCatalog())).toBe("source-unavailable");
      expect(backend.calls).toHaveLength(3);
    }).pipe(Effect.provide(testLayer)),
);

it.effect("reviews a Klaviyo email plan under the selected bot and verified account", () =>
  Effect.gen(function* () {
    const tools = yield* ProjectTools.ProjectTools;
    const { backend, enableComposio, authenticate } = yield* Fixture;
    enableComposio();
    const bot = yield* addBot("Lifecycle", firstProject);
    const other = yield* addBot("Other", firstProject);
    const foreign = yield* addBot("Foreign Lifecycle", secondProject);
    const target = { projectId: firstProject, botId: bot.agent.id, threadId: bot.threadId };
    const caller = yield* authenticate(bot.threadId);
    const unassigned = yield* authenticate(other.threadId);
    const anotherProject = yield* authenticate(foreign.threadId);
    const connection = { projectId: firstProject, app: klaviyoApp.slug };
    const connect = Effect.fn("ProjectToolsTest.connectKlaviyoAccount")(function* () {
      yield* tools.connection({ ...connection, operation: "start" });
      const account = [...backend.accounts.values()].find(({ status }) => status === "INITIATED");
      if (!account) throw new Error("Expected a pending Klaviyo fixture account.");
      account.status = "ACTIVE";
      account.label = "Workshop email";
      yield* tools.connection({ ...connection, operation: "finish" });
      return account;
    });
    const account = yield* connect();
    const { source } = lifecycleProposal;
    const grant = (slug: string, fixedInputs: Schema.JsonObject = {}) => ({
      projectId: firstProject,
      slug,
      fixedInputs,
      audience: { kind: "selected", botIds: [bot.agent.id] } as const,
    });
    const accountGrant = grant(klaviyoGetAccount.slug, { id: source.accountId });
    const reportGrant = grant(klaviyoCampaignValues.slug);
    yield* tools.grant(accountGrant);
    yield* tools.grant(grant(klaviyoGetCampaign.slug));
    yield* tools.grant(grant(klaviyoGetSegment.slug));
    expect(code(yield* caller.proposeLifecycle(lifecycleProposal))).toBe("not-assigned");
    yield* tools.grant(grant(klaviyoCampaignValues.slug, { page_cursor: "unapproved-page" }));
    expect(code(yield* caller.proposeLifecycle(lifecycleProposal))).toBe("fixed-inputs-required");
    yield* tools.grant(reportGrant);
    expect(code(yield* unassigned.proposeLifecycle(lifecycleProposal))).toBe("not-assigned");
    expect(code(yield* anotherProject.proposeLifecycle(lifecycleProposal))).toBe("not-assigned");
    expect(
      code(
        yield* caller.proposeLifecycle({
          ...lifecycleProposal,
          source: { ...source, accountId: "fixture-foreign-account" },
        }),
      ),
    ).toBe("fixed-inputs-required");
    expect(backend.calls).toHaveLength(0);

    const reader = yield* botAppsClient([AuthOrchestrationReadScope]);
    const operator = yield* botAppsClient([
      AuthOrchestrationReadScope,
      AuthOrchestrationOperateScope,
    ]);
    const state = operator[BOT_APPS_RPC_METHODS.state];
    const review = operator[BOT_APPS_RPC_METHODS.review];
    backend.setLifecycleReport({ accountId: "fixture-foreign-account" });
    expect(code(yield* caller.proposeLifecycle(lifecycleProposal))).toBe(
      "lifecycle-source-mismatch",
    );
    expect(backend.calls.map(({ slug }) => slug)).toEqual([klaviyoGetAccount.slug]);
    for (const [fixture, error] of [
      [{ reportId: "fixture-other-campaign" }, "lifecycle-source-mismatch"],
      [{ empty: true }, "lifecycle-report-empty"],
      [{ partial: true }, "lifecycle-report-invalid"],
    ] as const) {
      backend.setLifecycleReport(fixture);
      expect(code(yield* caller.proposeLifecycle(lifecycleProposal))).toBe(error);
      expect(yield* state(target)).toEqual(
        expect.objectContaining({ saved: null, proposal: null }),
      );
    }

    backend.setLifecycleReport(undefined);
    const firstRead = backend.calls.length;
    expect(content(yield* caller.proposeLifecycle(lifecycleProposal))).toMatchObject({
      title: lifecycleProposal.title,
    });
    const calls = backend.calls.slice(firstRead);
    expect(calls.map(({ slug }) => slug)).toEqual([
      klaviyoGetAccount.slug,
      klaviyoGetCampaign.slug,
      klaviyoGetSegment.slug,
      klaviyoCampaignValues.slug,
    ]);
    expect(
      calls.every((call) => call.account === account.id && call.userId === account.user_id),
    ).toBe(true);
    expect(calls.at(-1)?.arguments).toMatchObject({
      data__attributes__filter: `equals(campaign_id,"${source.record.id}")`,
      data__attributes__timeframe: {
        start: "2026-10-01T00:00:00Z",
        end: "2026-10-14T23:59:59.999Z",
      },
      data__attributes__statistics: ["delivered", "clicks", "unsubscribes"],
    });
    const { proposal } = yield* state(target);
    if (proposal?.status !== "available") throw new Error("Expected the Klaviyo proposal.");
    expect(proposal.snapshot).toMatchObject({
      kind: "lifecycle",
      definition: lifecycleProposal,
      report: {
        accountName: "Workshop email",
        accountTimeZone: "America/Los_Angeles",
        record: {
          name: "Autumn workshop roundup",
          sendTime: "2026-10-06T16:00:00Z",
          included: [source.segmentId],
          smartSending: true,
        },
        segment: {
          name: "Repeat workshop subscribers",
          requiresEmailOptIn: true,
          profileCount: 1800,
        },
        performance: { delivered: 1800, clicks: 123, unsubscribes: 6 },
      },
    });
    expect(JSON.stringify(proposal.snapshot)).not.toContain("fixture-only-condition");
    expect(yield* Effect.flip(state({ ...target, projectId: secondProject }))).toMatchObject({
      code: "not-a-bot",
    });
    expect(
      yield* state({ projectId: firstProject, botId: other.agent.id, threadId: other.threadId }),
    ).toEqual(expect.objectContaining({ saved: null, proposal: null }));
    const approval = {
      ...target,
      revision: proposal.snapshot.revision,
      decision: { kind: "approve" },
    } as const;
    expect(yield* Effect.flip(reader[BOT_APPS_RPC_METHODS.review](approval))).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
    });
    yield* review({
      ...approval,
      decision: { kind: "annotate", note: "Confirm subscriber eligibility before scheduling." },
    });
    expect(yield* Effect.flip(review(approval))).toMatchObject({ code: "proposal-changed" });
    const annotated = (yield* state(target)).proposal;
    if (annotated?.status !== "available")
      throw new Error("Expected the annotated Klaviyo proposal.");
    const latest = { ...approval, revision: annotated.snapshot.revision };
    yield* tools.grant({ ...reportGrant, audience: null });
    expect((yield* state(target)).proposal).toEqual({
      status: "unavailable",
      revision: latest.revision,
    });
    expect(yield* Effect.flip(review(latest))).toMatchObject({ code: "not-assigned" });
    expect(code(yield* caller.appProposal())).toBe("not-assigned");
    yield* tools.grant(reportGrant);
    yield* review(latest);
    expect(yield* state(target)).toEqual(
      expect.objectContaining({ saved: annotated, proposal: null }),
    );
    expect(backend.calls).toHaveLength(firstRead + calls.length);

    yield* tools.grant(grant(klaviyoGetFlow.slug));
    yield* tools.grant(grant(klaviyoFlowValues.slug));
    backend.setLifecycleReport({ optionalConsent: true });
    expect(content(yield* caller.proposeLifecycle(lifecycleFlowProposal))).toMatchObject({
      title: lifecycleFlowProposal.title,
    });
    expect(content(yield* caller.appProposal())).toMatchObject({
      report: {
        record: {
          kind: "flow",
          name: "Workshop welcome",
          trigger: "Added to List",
          delays: [{ value: 2, unit: "days" }],
        },
        segment: { requiresEmailOptIn: false },
        performance: { delivered: 1800, clicks: 123, unsubscribes: 6 },
      },
    });
    yield* tools.connection({ ...connection, operation: "disconnect" });
    yield* connect();
    expect((yield* state(target)).saved).toEqual({
      status: "unavailable",
      revision: latest.revision,
    });
  }).pipe(Effect.provide(testLayer)),
);

it.effect("saves decisions on manual opportunities and releases only the scoped referral", () =>
  Effect.gen(function* () {
    const { backend, authenticate } = yield* Fixture;
    const outbound = yield* addBot("Outbound", firstProject);
    const inbox = yield* addBot("Inbox", firstProject);
    const foreign = yield* addBot("Foreign Inbox", secondProject);
    const target = {
      projectId: firstProject,
      botId: outbound.agent.id,
      threadId: outbound.threadId,
    };
    const caller = yield* authenticate(outbound.threadId);
    const other = yield* authenticate(inbox.threadId);
    const anotherProject = yield* authenticate(foreign.threadId);
    const link = {
      id: "workshop",
      title: "Workshop setup question",
      source: {
        kind: "link",
        label: "Workshop thread",
        url: "https://community.example.test/workshop",
      },
      reason: "The thread asks for a setup checklist.",
      draftReply: "I can share our setup checklist if that would help.",
      ownerId: outbound.agent.id,
    } as const;
    const support = {
      id: "support",
      title: "Missing workshop guide",
      source: { kind: "export", label: "Group export", reference: "imports/group.csv, row 2" },
      reason: "A customer needs help finding their guide.",
      draftReply: "We can look up your guide through customer support.",
      ownerId: inbox.agent.id,
    } as const;
    const title = "Opportunity queue";
    expect(
      code(
        yield* caller.proposeOutbound({
          title,
          opportunities: [{ ...support, ownerId: foreign.agent.id }],
        }),
      ),
    ).toBe("outbound-owner-unavailable");

    const proposed = yield* caller.proposeOutbound({ title, opportunities: [link, support] });
    expect(proposed.isError, proposed.content[0]?.text).not.toBe(true);
    expect(content(proposed)).toMatchObject({ title });
    expect(content(yield* caller.outboundHandoff(support.id))).toBeNull();
    expect(content(yield* other.appProposal())).toBeNull();
    expect(content(yield* anotherProject.appProposal())).toBeNull();

    const reader = yield* botAppsClient([AuthOrchestrationReadScope]);
    const operator = yield* botAppsClient([
      AuthOrchestrationReadScope,
      AuthOrchestrationOperateScope,
    ]);
    const state = operator[BOT_APPS_RPC_METHODS.state];
    const review = operator[BOT_APPS_RPC_METHODS.review];
    const draft = (yield* reader[BOT_APPS_RPC_METHODS.state](target)).proposal;
    if (draft?.status !== "available") throw new Error("Expected a readable opportunity queue.");
    expect(draft.snapshot).toMatchObject({
      definition: {
        opportunities: [
          { ...link, ownerName: "Outbound", disposition: "pending" },
          { ...support, ownerName: "Inbox", disposition: "pending" },
        ],
      },
    });
    expect(yield* Effect.flip(state({ ...target, botId: inbox.agent.id }))).toMatchObject({
      code: "not-a-bot",
    });
    expect(yield* Effect.flip(state({ ...target, projectId: secondProject }))).toMatchObject({
      code: "not-a-bot",
    });
    const approval = {
      ...target,
      revision: draft.snapshot.revision,
      decision: {
        kind: "approve-outbound",
        decisions: [
          { id: link.id, disposition: "keep-draft" },
          { id: support.id, disposition: "handoff" },
        ],
        note: "Send the export reference to Inbox for review.",
      },
    } as const;
    expect(yield* Effect.flip(reader[BOT_APPS_RPC_METHODS.review](approval))).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
    });
    expect(
      yield* Effect.flip(review({ ...approval, decision: { kind: "approve" } })),
    ).toMatchObject({ code: "outbound-decisions-changed" });
    expect(
      yield* Effect.result(
        review({
          ...approval,
          decision: {
            ...approval.decision,
            decisions: [{ id: link.id, disposition: "pending" }, approval.decision.decisions[1]],
          },
        }),
      ),
    ).toMatchObject({ _tag: "Failure", failure: { code: "outbound-decisions-pending" } });
    expect(yield* state(target)).toEqual(expect.objectContaining({ saved: null, proposal: draft }));
    expect(
      yield* Effect.flip(
        review({
          ...approval,
          decision: {
            ...approval.decision,
            decisions: [{ id: "other", disposition: "skip" }, approval.decision.decisions[1]],
          },
        }),
      ),
    ).toMatchObject({ code: "outbound-decisions-changed" });
    expect(
      yield* Effect.flip(
        review({
          ...approval,
          decision: {
            ...approval.decision,
            decisions: [{ id: link.id, disposition: "handoff" }, approval.decision.decisions[1]],
          },
        }),
      ),
    ).toMatchObject({ code: "outbound-handoff-unavailable" });
    yield* review({ ...approval, decision: { kind: "annotate", note: "Check the source." } });
    expect(yield* Effect.flip(review(approval))).toMatchObject({ code: "proposal-changed" });
    const latest = (yield* state(target)).proposal;
    if (latest?.status !== "available")
      throw new Error("Expected the annotated opportunity queue.");
    yield* review({ ...approval, revision: latest.snapshot.revision });
    expect(yield* state(target)).toMatchObject({
      proposal: null,
      saved: {
        snapshot: {
          note: approval.decision.note,
          definition: {
            opportunities: [
              { ...link, disposition: "keep-draft" },
              { ...support, disposition: "handoff" },
            ],
          },
        },
      },
    });
    expect(content(yield* caller.outboundHandoff(link.id))).toBeNull();
    expect(content(yield* caller.outboundHandoff(support.id))).toEqual({
      ...support,
      ownerName: "Inbox",
      disposition: "handoff",
    });
    expect(content(yield* other.outboundHandoff(support.id))).toBeNull();
    expect(content(yield* anotherProject.outboundHandoff(support.id))).toBeNull();
    const tasks = yield* TaskRepository;
    yield* tasks.upsertAgent({ ...inbox.agent, enabled: false });
    expect(code(yield* caller.outboundHandoff(support.id))).toBe("outbound-owner-unavailable");
    yield* tasks.upsertAgent(inbox.agent);
    expect(content(yield* caller.outboundHandoff(support.id))).toMatchObject({
      ownerName: "Inbox",
    });
    expect(backend.calls).toHaveLength(0);
  }).pipe(Effect.provide(testLayer)),
);
