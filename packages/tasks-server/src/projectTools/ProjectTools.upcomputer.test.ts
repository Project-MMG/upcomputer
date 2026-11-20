import { NodeHttpServer } from "@effect/platform-node";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  RunId,
  ScheduledTaskUpsertInput,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { TaskAgentId, TaskAgentRunId } from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ServerSettings from "../../../../apps/server/src/serverSettings.ts";
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
            expect(input.scheduledTaskId).toBeDefined();
            scheduledThreads.push(input.threadId);
            const shell = shells.get(input.threadId)!;
            shells.set(input.threadId, {
              ...shell,
              activeRunId: RunId.make(`scheduled:${input.messageId}`),
            });
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
      ProjectTools.layer.pipe(
        Layer.provide(Composio.layer.pipe(Layer.provide(backend.layer))),
        Layer.provideMerge(botLayer),
      ),
      schedules,
    ).pipe(Layer.provide(database), Layer.provideMerge(configuration));
    const router = HttpRouter.serve(
      McpHttp.layerMcpTransport(ProjectToolMcp.layer).pipe(
        Layer.provide(services),
        Layer.provide(ServerSettings.layerTest()),
      ),
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

      const gate = yield* backend.holdSession;
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
    const gate = yield* backend.holdSession;
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
