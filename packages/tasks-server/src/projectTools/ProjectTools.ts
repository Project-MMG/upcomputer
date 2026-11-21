import type { OrchestrationV2ThreadShell, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import {
  ProjectToolError,
  ProjectToolGrant,
  ProjectToolAppGrant,
  type ProjectToolAction,
  type ProjectToolActionDetails,
  type ProjectToolActionsInput,
  type ProjectToolApp,
  type ProjectToolAppGrantInput,
  type ProjectToolAppsInput,
  type ProjectToolAssignment,
  type ProjectToolAudience,
  type ProjectToolConnectionInput,
  type ProjectToolGrantInput,
  type ProjectToolSettings,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";

import {
  type McpInvocationContext,
  ProjectStoreV2,
  ServerEnvironment,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { BotService } from "../bots/BotService.ts";
import { makeArgumentValidator } from "./actionArguments.ts";
import { Composio } from "./Composio.ts";

type Invocation = McpInvocationContext["Service"];
type Connector = Composio["Service"];
type BotAccess = {
  readonly projectId: ProjectId;
  readonly botId: TaskAgentId;
  readonly threadId: ThreadId;
};
type ActionCaller = BotAccess & {
  readonly plan: boolean;
  readonly runId: RunId | null;
};
type ActionInput = {
  readonly slug: string;
  readonly arguments: Schema.JsonObject;
};
type AssignedAction = ProjectToolActionDetails & { readonly fixedInputs: ReadonlyArray<string> };
type AccessError = Effect.Effect<never, ProjectToolError>;
type ConnectorOutput<Method extends "apps" | "app" | "actions"> = ReturnType<Connector[Method]>;

interface AccountRow {
  readonly app: string;
  readonly accountId: string | null;
  readonly label: string | null;
  readonly pendingId: string | null;
}

const grantJson = Schema.fromJsonString(ProjectToolGrant);
const decodeGrant = Schema.decodeUnknownEffect(grantJson);
const encodeGrant = Schema.encodeEffect(grantJson);
const appGrantJson = Schema.fromJsonString(ProjectToolAppGrant);
const decodeAppGrant = Schema.decodeUnknownEffect(appGrantJson);
const encodeAppGrant = Schema.encodeEffect(appGrantJson);
const searchPageSize = 12;

const storageError = (cause: unknown) =>
  new ProjectToolError({ code: "storage-unavailable", cause });

const fail = (code: ProjectToolError["code"]): AccessError =>
  Effect.fail(new ProjectToolError({ code }));

const includesBot = (grant: { readonly audience: ProjectToolAudience }, botId: TaskAgentId) =>
  grant.audience.kind === "all" || grant.audience.botIds.includes(botId);

const sameActionAccess = (saved: ProjectToolAction, current: ProjectToolAction) =>
  saved.app === current.app &&
  saved.effect === current.effect &&
  saved.requiresAccount === current.requiresAccount;

export class ProjectTools extends Context.Service<
  ProjectTools,
  {
    readonly settings: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectToolSettings, ProjectToolError>;
    readonly apps: (input: typeof ProjectToolAppsInput.Type) => ConnectorOutput<"apps">;
    readonly app: (projectId: ProjectId, slug: string) => ConnectorOutput<"app">;
    readonly actions: (input: typeof ProjectToolActionsInput.Type) => ConnectorOutput<"actions">;
    readonly action: (
      projectId: ProjectId,
      slug: string,
    ) => Effect.Effect<ProjectToolActionDetails, ProjectToolError>;
    readonly connection: (
      input: ProjectToolConnectionInput,
    ) => Effect.Effect<{ readonly url: string | null }, ProjectToolError>;
    readonly grant: (input: ProjectToolGrantInput) => Effect.Effect<void, ProjectToolError>;
    readonly grantApp: (input: ProjectToolAppGrantInput) => Effect.Effect<void, ProjectToolError>;
    readonly search: (
      scope: Invocation,
      input: {
        readonly query?: string | undefined;
        readonly offset?: number | undefined;
        readonly app?: string | undefined;
        readonly cursor?: string | undefined;
      },
    ) => Effect.Effect<
      {
        readonly actions: ReadonlyArray<AssignedAction>;
        readonly nextOffset: number | null;
        readonly apps?: ReadonlyArray<ProjectToolApp>;
        readonly nextCursor?: string | null;
      },
      ProjectToolError
    >;
    readonly execute: (
      scope: Invocation,
      effect: ProjectToolAction["effect"],
      input: ActionInput,
    ) => Effect.Effect<Schema.Json, ProjectToolError>;
    readonly confirmCaller: (scope: Invocation) => Effect.Effect<ActionCaller, ProjectToolError>;
    readonly confirmBotChat: (target: BotAccess) => Effect.Effect<BotAccess, ProjectToolError>;
    readonly readConnectedBotAction: (
      target: BotAccess,
      app: string,
      input: ActionInput,
    ) => Effect.Effect<Schema.Json, ProjectToolError>;
  }
>()("@t3tools/tasks-server/projectTools/ProjectTools") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const bots = yield* BotService;
  const projects = yield* ProjectStoreV2;
  const threads = yield* ThreadManagementService;
  const server = yield* ServerEnvironment;
  const composio = yield* Composio;
  const environmentId = yield* server.getEnvironmentId;
  const lock = yield* KeyedLock.make<ProjectId>();
  const validate = makeArgumentValidator();

  const userId = (projectId: ProjectId) =>
    `upcomputer:${encodeURIComponent(environmentId)}:${encodeURIComponent(projectId)}`;
  const requireProject = Effect.fn("ProjectTools.requireProject")(function* (id: ProjectId) {
    const project = yield* projects.getShell(id).pipe(Effect.mapError(storageError));
    if (Option.isNone(project)) return yield* fail("missing-project");
  });
  const projectBots = Effect.fn("ProjectTools.projectBots")(function* (id: ProjectId) {
    const all = yield* bots.list.pipe(Effect.mapError(storageError));
    return all
      .filter((bot) => bot.projectId === id)
      .map(({ agent }) => ({ id: agent.id, name: agent.name }));
  });
  const validateAudience = Effect.fn("ProjectTools.validateAudience")(function* (
    projectId: ProjectId,
    audience: ProjectToolGrantInput["audience"],
  ) {
    if (audience?.kind !== "selected") return audience;
    const botIds = Arr.dedupe(audience.botIds);
    if (!Arr.isArrayNonEmpty(botIds)) return null;
    const allowed = new Set((yield* projectBots(projectId)).map(({ id }) => id));
    if (botIds.some((id) => !allowed.has(id))) return yield* fail("invalid-bots");
    return { kind: "selected", botIds } as const;
  });
  const selectAccounts = sql<AccountRow>`SELECT app, account_id AS "accountId",
    account_label AS label, pending_id AS "pendingId" FROM project_tool_accounts`;

  const getAccount = Effect.fn("ProjectTools.getAccount")(function* (
    projectId: ProjectId,
    app: string,
  ) {
    const [row] =
      yield* sql<AccountRow>`${selectAccounts} WHERE project_id = ${projectId} AND app = ${app}`.pipe(
        Effect.mapError(storageError),
      );
    return row;
  });
  const listGrants = Effect.fn("ProjectTools.listGrants")(function* (projectId: ProjectId) {
    const rows = yield* sql<{ readonly json: string }>`SELECT grant_json AS json
      FROM project_tool_grants WHERE project_id = ${projectId} ORDER BY slug`.pipe(
      Effect.mapError(storageError),
    );
    return yield* Effect.forEach(rows, ({ json }) =>
      decodeGrant(json).pipe(Effect.mapError(storageError)),
    );
  });
  const listAppGrants = Effect.fn("ProjectTools.listAppGrants")(function* (projectId: ProjectId) {
    const rows = yield* sql<{ readonly json: string }>`SELECT grant_json AS json
      FROM project_tool_app_grants WHERE project_id = ${projectId} ORDER BY app`.pipe(
      Effect.mapError(storageError),
    );
    return yield* Effect.forEach(rows, ({ json }) =>
      decodeAppGrant(json).pipe(
        Effect.mapError(storageError),
        Effect.map((grant) => ({ grant, json })),
      ),
    );
  });
  const action = Effect.fn("ProjectTools.catalogAction")(function* (slug: string) {
    const found = yield* composio.action(slug);
    if (!found) return yield* fail("action-unavailable");
    return found;
  });
  const activeAccount = Effect.fn("ProjectTools.activeAccount")(function* (
    projectId: ProjectId,
    app: string,
    id: string,
  ) {
    const account = yield* composio.account(id, userId(projectId), app);
    if (account?.status !== "active") return yield* fail("account-unavailable");
    return account;
  });
  const requireAccount = Effect.fn("ProjectTools.requireAccount")(function* (
    projectId: ProjectId,
    app: string,
  ) {
    const row = yield* getAccount(projectId, app);
    if (!row?.accountId) return yield* fail("account-unavailable");
    return yield* activeAccount(projectId, app, row.accountId);
  });
  const connectedApps = Effect.fn("ProjectTools.connectedApps")(function* (
    projectId: ProjectId,
    apps: ReadonlySet<string>,
  ) {
    return new Set(
      yield* Effect.forEach(
        apps,
        (app) =>
          requireAccount(projectId, app).pipe(
            Effect.as(app),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 4 },
      ),
    );
  });

  const liveThread = Effect.fn("ProjectTools.liveThread")(function* (threadId: ThreadId) {
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(storageError));
    if (thread === null || thread.deletedAt !== null || thread.archivedAt !== null) {
      return yield* fail("not-a-bot");
    }
    return thread;
  });
  const botForThread = Effect.fn("ProjectTools.botForThread")(function* (
    thread: OrchestrationV2ThreadShell,
  ) {
    const bot = yield* bots.forThread(thread.id).pipe(Effect.mapError(storageError));
    if (bot === null || bot.projectId !== thread.projectId) return yield* fail("not-a-bot");
    yield* requireProject(bot.projectId);
    return { projectId: bot.projectId, botId: bot.agent.id, threadId: bot.threadId };
  });
  const confirmCaller = Effect.fn("ProjectTools.confirmCaller")(function* (scope: Invocation) {
    const caller = scope.thread;
    if (scope.environmentId !== environmentId || caller === undefined || caller.subagent) {
      return yield* fail("not-a-bot");
    }
    const thread = yield* liveThread(caller.threadId);
    if (thread.activeRunId === null || thread.providerInstanceId !== caller.providerInstanceId) {
      return yield* fail("not-a-bot");
    }
    return {
      ...(yield* botForThread(thread)),
      runId: thread.activeRunId,
      plan: thread.interactionMode === "plan",
    };
  });
  const confirmBotChat = Effect.fn("ProjectTools.confirmBotChat")(function* (target: BotAccess) {
    const thread = yield* liveThread(target.threadId);
    const bot = yield* botForThread(thread);
    if (
      bot.threadId !== target.threadId ||
      bot.projectId !== target.projectId ||
      bot.botId !== target.botId
    )
      return yield* fail("not-a-bot");
    return { ...bot, runId: null, plan: false };
  });

  const loadAccess = Effect.fn("ProjectTools.loadAccess")(function* (
    caller: ActionCaller,
    effect: ProjectToolAction["effect"],
    target: string | ProjectToolActionDetails,
  ) {
    if (caller.plan && effect === "write") return yield* fail("plan-mode");
    const slug = typeof target === "string" ? target : target.slug;
    const [row] = yield* sql<{ readonly json: string }>`SELECT grant_json AS json
      FROM project_tool_grants WHERE project_id = ${caller.projectId} AND slug = ${slug}`.pipe(
      Effect.mapError(storageError),
    );
    const stored = row ? yield* decodeGrant(row.json).pipe(Effect.mapError(storageError)) : null;
    const direct = stored && includesBot(stored, caller.botId) ? stored : null;
    const full = direct
      ? []
      : (yield* listAppGrants(caller.projectId)).filter(({ grant }) =>
          includesBot(grant, caller.botId),
        );
    if (!direct && !full.length) return yield* fail("not-assigned");
    if (direct && direct.action.effect !== effect) return yield* fail("wrong-action-type");
    const live = typeof target === "string" ? yield* action(slug) : target;
    const appGrant = full.find(({ grant }) => grant.app.slug === live.app);
    if (!direct && !appGrant) return yield* fail("not-assigned");
    if (direct && !sameActionAccess(direct.action, live)) return yield* fail("action-changed");
    if (live.effect !== effect) return yield* fail("wrong-action-type");
    const requiresAccount = live.requiresAccount || appGrant?.grant.app.setup === "connect";
    const accountId = requiresAccount
      ? ((yield* getAccount(caller.projectId, live.app))?.accountId ?? null)
      : null;
    if (requiresAccount && accountId === null) return yield* fail("account-unavailable");
    return {
      ...caller,
      live,
      accountId,
      fixedInputs: direct?.fixedInputs ?? {},
      policy: direct ? row?.json : appGrant?.json,
    };
  });

  const executeAction = Effect.fn("ProjectTools.executeAction")(function* (
    authorize: Effect.Effect<ActionCaller, ProjectToolError>,
    effect: ProjectToolAction["effect"],
    input: ActionInput,
    connectedApp?: string,
  ) {
    const initial = yield* loadAccess(yield* authorize, effect, input.slug);
    const { live } = initial;
    if (connectedApp !== undefined) {
      if (live.app !== connectedApp || initial.accountId === null) {
        return yield* fail("account-unavailable");
      }
      if (
        Object.entries(input.arguments).some(
          ([key, value]) =>
            Object.hasOwn(initial.fixedInputs, key) &&
            !Equal.equals(initial.fixedInputs[key], value),
        )
      )
        return yield* fail("workspace-input-conflict");
    }
    const args = { ...input.arguments, ...initial.fixedInputs };
    yield* validate(live.inputSchema, args);
    if (initial.accountId !== null) {
      yield* activeAccount(initial.projectId, live.app, initial.accountId);
    }
    const session = {
      userId: userId(initial.projectId),
      action: live,
      accountId: initial.accountId,
    };
    return yield* Effect.acquireUseRelease(
      composio.createActionSession(session),
      (id) =>
        Effect.gen(function* () {
          const current = yield* loadAccess(yield* authorize, effect, live);
          if (
            current.runId !== initial.runId ||
            current.botId !== initial.botId ||
            current.projectId !== initial.projectId ||
            current.policy !== initial.policy ||
            current.accountId !== initial.accountId
          )
            return yield* fail("policy-changed");
          return yield* composio.execute(id, live, args);
        }),
      composio.closeSession,
    );
  });

  return ProjectTools.of({
    settings: Effect.fn("ProjectTools.settings")(function* (projectId) {
      yield* requireProject(projectId);
      const [configured, savedAccounts, grants, appGrants, currentBots] = yield* Effect.all(
        [
          composio.configured,
          sql<AccountRow>`${selectAccounts} WHERE project_id = ${projectId} ORDER BY app`.pipe(
            Effect.mapError(storageError),
          ),
          listGrants(projectId),
          listAppGrants(projectId),
          projectBots(projectId),
        ],
        { concurrency: "unbounded" },
      );
      const accounts = yield* Effect.forEach(
        savedAccounts,
        (row) =>
          Effect.gen(function* () {
            let account: ProjectToolSettings["accounts"][number]["account"] = null;
            if (row.accountId !== null) {
              const current = configured
                ? yield* composio
                    .account(row.accountId, userId(projectId), row.app)
                    .pipe(Effect.option)
                : Option.none();
              account = {
                label:
                  (Option.isSome(current) ? current.value?.label : null) ??
                  row.label ??
                  row.accountId,
                status: Option.isNone(current)
                  ? "unverified"
                  : current.value?.status === "active"
                    ? "connected"
                    : "unavailable",
              };
            }
            return { app: row.app, account, pending: row.pendingId !== null };
          }),
        { concurrency: 4 },
      );
      const live = configured
        ? yield* Effect.forEach(
            Arr.chunksOf(
              grants.map(({ action }) => action.slug),
              20,
            ),
            (slugs) =>
              composio.assignedActions(slugs).pipe(
                Effect.match({
                  onSuccess: (actions) => ({ actions, unverified: [] }),
                  onFailure: () => ({ actions: [], unverified: slugs }),
                }),
              ),
            { concurrency: 4 },
          )
        : [];
      const actions = new Map(
        live.flatMap((page) => page.actions.map((item) => [item.slug, item] as const)),
      );
      const unverified = new Set(live.flatMap((page) => page.unverified));
      const accountsByApp = new Map(accounts.map((entry) => [entry.app, entry.account]));
      const assignments = grants.map((grant): ProjectToolAssignment => {
        const { action: saved, audience } = grant;
        const current = actions.get(saved.slug);
        const account = accountsByApp.get(saved.app);
        if (!configured || unverified.has(saved.slug)) return { ...grant, status: "unverified" };
        if (!current) return { ...grant, status: "action-unavailable" };
        if (!sameActionAccess(saved, current)) return { ...grant, status: "action-changed" };
        if (saved.requiresAccount) {
          if (!account) return { ...grant, status: "account-required" };
          if (account.status !== "connected") return { ...grant, status: "account-unavailable" };
        }
        if (
          audience.kind === "selected" &&
          !currentBots.some(({ id }) => audience.botIds.includes(id))
        ) {
          return { ...grant, status: "no-selected-bots" };
        }
        return { ...grant, status: "available" };
      });
      return {
        configured,
        accounts,
        assignments,
        appGrants: appGrants.map(({ grant }) => grant),
        bots: currentBots,
      };
    }),
    apps: Effect.fn("ProjectTools.apps")(function* (input) {
      yield* requireProject(input.projectId);
      return yield* composio.apps(input, userId(input.projectId));
    }),
    app: Effect.fn("ProjectTools.app")(function* (projectId, slug) {
      yield* requireProject(projectId);
      return yield* composio.app(slug);
    }),
    actions: Effect.fn("ProjectTools.actions")(function* (input) {
      yield* requireProject(input.projectId);
      return yield* composio.actions(input);
    }),
    action: Effect.fn("ProjectTools.action")(function* (projectId, slug) {
      yield* requireProject(projectId);
      return yield* action(slug);
    }),
    connection: Effect.fn("ProjectTools.connection")(function* ({ projectId, app, operation }) {
      yield* requireProject(projectId);
      return yield* lock.withLock(
        projectId,
        Effect.gen(function* () {
          const current = yield* getAccount(projectId, app);
          const projectUser = userId(projectId);
          if (operation === "disconnect") {
            yield* sql`DELETE FROM project_tool_accounts WHERE project_id = ${projectId} AND app = ${app}`.pipe(
              Effect.mapError(storageError),
            );
            yield* Effect.forEach(
              new Set([current?.accountId, current?.pendingId]),
              (id) => (id ? composio.removeAccount(id, projectUser, app) : Effect.void),
              { concurrency: 2, discard: true },
            ).pipe(Effect.mapError(() => new ProjectToolError({ code: "account-removal-failed" })));
            return { url: null };
          }
          if (operation === "start") {
            const link = yield* composio.link(projectUser, app);
            yield* sql`INSERT INTO project_tool_accounts (project_id, app, pending_id)
            VALUES (${projectId}, ${app}, ${link.id})
            ON CONFLICT (project_id, app) DO UPDATE SET pending_id = excluded.pending_id`.pipe(
              Effect.mapError(storageError),
              Effect.onError(() =>
                composio.removeAccount(link.id, projectUser, app).pipe(Effect.ignore),
              ),
            );
            if (
              current?.pendingId &&
              current.pendingId !== link.id &&
              current.pendingId !== current.accountId
            ) {
              yield* composio
                .removeAccount(current.pendingId, projectUser, app)
                .pipe(Effect.ignore);
            }
            return { url: link.url };
          }
          const pendingId = current?.pendingId;
          if (!pendingId) return yield* fail("no-pending-account");
          const account = yield* composio.account(pendingId, projectUser, app);
          if (account?.status === "pending") return yield* fail("pending-account");
          if (account?.status !== "active") return yield* fail("failed-account");
          if (current.accountId && current.accountId !== pendingId) {
            yield* composio.removeAccount(current.accountId, projectUser, app);
          }
          yield* sql`UPDATE project_tool_accounts SET account_id = ${pendingId},
          account_label = ${account.label}, pending_id = NULL
          WHERE project_id = ${projectId} AND app = ${app}`.pipe(Effect.mapError(storageError));
          return { url: null };
        }),
      );
    }),
    grant: Effect.fn("ProjectTools.grant")(function* ({ projectId, slug, audience, fixedInputs }) {
      yield* requireProject(projectId);
      yield* lock.withLock(
        projectId,
        Effect.gen(function* () {
          const storedAudience = yield* validateAudience(projectId, audience);
          if (!storedAudience) {
            yield* sql`DELETE FROM project_tool_grants WHERE project_id = ${projectId} AND slug = ${slug}`.pipe(
              Effect.mapError(storageError),
            );
            return;
          }
          const { inputSchema, ...details } = yield* action(slug);
          if (details.requiresAccount) yield* requireAccount(projectId, details.app);
          yield* validate(inputSchema, fixedInputs, true);
          const json = yield* encodeGrant({
            action: details,
            audience: storedAudience,
            fixedInputs,
          }).pipe(Effect.mapError(storageError));
          yield* sql`INSERT INTO project_tool_grants (project_id, slug, grant_json)
          VALUES (${projectId}, ${slug}, ${json})
          ON CONFLICT (project_id, slug) DO UPDATE SET grant_json = excluded.grant_json`.pipe(
            Effect.mapError(storageError),
          );
        }),
      );
    }),
    grantApp: Effect.fn("ProjectTools.grantApp")(function* ({ projectId, app, audience }) {
      yield* requireProject(projectId);
      yield* lock.withLock(
        projectId,
        Effect.gen(function* () {
          const storedAudience = yield* validateAudience(projectId, audience);
          if (!storedAudience) {
            yield* sql`DELETE FROM project_tool_app_grants WHERE project_id = ${projectId} AND app = ${app}`.pipe(
              Effect.mapError(storageError),
            );
            return;
          }
          const details = yield* composio.app(app);
          if (details.setup === "auth-config-required") return yield* fail("auth-config-required");
          if (details.setup === "connect") yield* requireAccount(projectId, app);
          const json = yield* encodeAppGrant({ app: details, audience: storedAudience }).pipe(
            Effect.mapError(storageError),
          );
          yield* sql`INSERT INTO project_tool_app_grants (project_id, app, grant_json)
            VALUES (${projectId}, ${app}, ${json})
            ON CONFLICT (project_id, app) DO UPDATE SET grant_json = excluded.grant_json`.pipe(
            Effect.mapError(storageError),
          );
        }),
      );
    }),
    search: Effect.fn("ProjectTools.search")(function* (scope, { query, offset = 0, app, cursor }) {
      const { projectId, botId, plan } = yield* confirmCaller(scope);
      const [savedActions, savedApps] = yield* Effect.all([
        listGrants(projectId),
        listAppGrants(projectId),
      ]);
      const assigned = savedActions.filter((grant) => includesBot(grant, botId));
      const full = savedApps.flatMap(({ grant }) => (includesBot(grant, botId) ? [grant.app] : []));
      const fullApp = full.find(({ slug }) => slug === app);
      if (fullApp) {
        const toolkit = fullApp.slug;
        const connected = yield* connectedApps(projectId, new Set([toolkit]));
        if (fullApp.setup === "connect" && !connected.has(toolkit)) {
          return { actions: [], nextOffset: null, nextCursor: null };
        }
        const page = yield* composio.actions({
          app: toolkit,
          query,
          cursor,
          limit: searchPageSize,
        });
        const eligible = page.items.filter(
          (item) =>
            item.app === toolkit &&
            (!plan || item.effect === "read") &&
            (!item.requiresAccount || connected.has(toolkit)),
        );
        const details = yield* composio.assignedActions(eligible.map(({ slug }) => slug));
        const overrides = new Map(assigned.map((grant) => [grant.action.slug, grant]));
        return {
          actions: details.flatMap((item) => {
            if (
              item.app !== toolkit ||
              (plan && item.effect !== "read") ||
              (item.requiresAccount && !connected.has(toolkit))
            )
              return [];
            const override = overrides.get(item.slug);
            if (override && !sameActionAccess(override.action, item)) return [];
            return [{ ...item, fixedInputs: Object.keys(override?.fixedInputs ?? {}) }];
          }),
          nextOffset: null,
          nextCursor: page.nextCursor === cursor ? null : page.nextCursor,
        };
      }
      const words = query?.toLowerCase().trim().split(/\s+/).filter(Boolean) ?? [];
      const matches = assigned.filter(({ action }) => {
        const { slug, name, appName, description, effect } = action;
        if ((app && app !== action.app) || (plan && effect !== "read")) return false;
        const text = `${slug} ${name} ${appName} ${description}`.toLowerCase();
        return words.every((word) => text.includes(word));
      });
      const page = matches.slice(offset, offset + searchPageSize);
      const browsableApps = app ? [] : full;
      const current = new Map(
        (yield* composio.assignedActions(page.map(({ action }) => action.slug))).map((item) => [
          item.slug,
          item,
        ]),
      );
      const connected = yield* connectedApps(
        projectId,
        new Set([
          ...page.filter(({ action }) => action.requiresAccount).map(({ action }) => action.app),
          ...browsableApps.filter((toolkit) => toolkit.setup === "connect").map(({ slug }) => slug),
        ]),
      );
      const apps = browsableApps.flatMap(({ slug, name, description, setup }) =>
        setup === "no-account" || connected.has(slug) ? [{ slug, name, description }] : [],
      );
      return {
        actions: page.flatMap((grant) => {
          const item = current.get(grant.action.slug);
          return item &&
            sameActionAccess(grant.action, item) &&
            (!item.requiresAccount || connected.has(item.app))
            ? [{ ...item, fixedInputs: Object.keys(grant.fixedInputs) }]
            : [];
        }),
        nextOffset: offset + page.length < matches.length ? offset + page.length : null,
        ...(apps.length ? { apps } : {}),
      };
    }),
    confirmCaller,
    confirmBotChat,
    execute: Effect.fn("ProjectTools.execute")((scope, effect, input) =>
      executeAction(confirmCaller(scope), effect, input),
    ),
    readConnectedBotAction: Effect.fn("ProjectTools.readConnectedBotAction")((target, app, input) =>
      executeAction(confirmBotChat(target), "read", input, app),
    ),
  });
});

export const layer = Layer.effect(ProjectTools, make);
