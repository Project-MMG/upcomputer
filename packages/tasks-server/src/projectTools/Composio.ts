import {
  ProjectToolError,
  ProjectToolSlug,
  type ProjectToolAction,
  type ProjectToolActionDetails,
  type ProjectToolApp,
  type ProjectToolAppDetails,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { ServerSecretStore } from "../../../../apps/server/src/extensionApi.ts";

const baseUrl = "https://backend.composio.dev/api/v3.1";
const sessionPath = "/tool_router/session";
const keyName = "composio-api-key";
const pageSize = 25;

const appSchema = Schema.Struct({
  slug: ProjectToolSlug,
  name: Schema.String,
  meta: Schema.optional(
    Schema.Struct({ description: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
});
const appDetailsSchema = appSchema.mapFields((fields) => ({
  ...fields,
  no_auth: Schema.optional(Schema.Boolean),
  composio_managed_auth: Schema.optional(Schema.Array(Schema.Unknown)),
  composio_managed_auth_schemes: Schema.optional(Schema.Array(Schema.String)),
  auth_config_details: Schema.optional(Schema.Array(Schema.Struct({ mode: Schema.String }))),
}));
const toolSchema = Schema.Struct({
  slug: ProjectToolSlug,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  human_description: Schema.optional(Schema.NullOr(Schema.String)),
  toolkit: Schema.Struct({ slug: ProjectToolSlug, name: Schema.optional(Schema.String) }),
  no_auth: Schema.optional(Schema.Boolean),
  is_deprecated: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
const toolDetailsSchema = toolSchema.mapFields((fields) => ({
  ...fields,
  input_parameters: Schema.JsonObject,
}));
const accountSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  user_id: Schema.optional(Schema.String),
  toolkit: Schema.Struct({ slug: ProjectToolSlug }),
  status: Schema.String,
  is_disabled: Schema.optional(Schema.Boolean),
  auth_config: Schema.optional(Schema.Struct({ is_disabled: Schema.optional(Schema.Boolean) })),
  alias: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        val: Schema.optional(
          Schema.Struct({
            displayName: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    ),
  ),
});
const sessionSchema = Schema.Struct({ session_id: Schema.NonEmptyString });
const linkSchema = Schema.Struct({
  connected_account_id: Schema.NonEmptyString,
  redirect_url: Schema.String,
});
const executionSchema = Schema.Struct({
  result_type: Schema.String,
  data: Schema.optional(Schema.Json),
});

const pageSchema = <S extends Schema.Top>(item: S) =>
  Schema.Struct({
    items: Schema.Array(item),
    next_cursor: Schema.optional(Schema.NullOr(Schema.String)),
  });

const toApp = (app: typeof appSchema.Type): ProjectToolApp => ({
  slug: app.slug,
  name: app.name,
  description: app.meta?.description ?? "",
});

const toAction = (tool: typeof toolSchema.Type): ProjectToolAction => ({
  slug: tool.slug,
  name: tool.name,
  description: tool.human_description || tool.description || "",
  app: tool.toolkit.slug,
  appName: tool.toolkit.name ?? tool.toolkit.slug,
  requiresAccount: tool.no_auth !== true,
  effect:
    tool.tags?.includes("readOnlyHint") === true &&
    !tool.tags.some((tag) => ["createHint", "updateHint", "destructiveHint"].includes(tag))
      ? "read"
      : "write",
});

const isJsonObject = Schema.is(Schema.JsonObject);

function inputSchema(input: Schema.JsonObject): Schema.JsonObject {
  if (
    input.type === "object" ||
    isJsonObject(input.properties) ||
    typeof input.$ref === "string" ||
    ["allOf", "anyOf", "oneOf"].some((key) => Array.isArray(input[key]))
  )
    return input;
  // The catalog also publishes field maps with a boolean required flag per field.
  const entries = Object.entries(input);
  if (!entries.every(([, field]) => isJsonObject(field))) return input;
  return {
    type: "object",
    properties: Object.fromEntries(
      entries.map(([name, field]) => [
        name,
        Object.fromEntries(
          Object.entries(field as Schema.JsonObject).filter(
            ([key, value]) => key !== "required" || typeof value !== "boolean",
          ),
        ),
      ]),
    ),
    required: entries.flatMap(([name, field]) =>
      isJsonObject(field) && field.required === true ? [name] : [],
    ),
    additionalProperties: false,
  };
}

interface Page<A> {
  readonly items: ReadonlyArray<A>;
  readonly nextCursor: string | null;
}

interface CatalogInput {
  readonly query?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number;
}

interface Account {
  readonly label: string;
  readonly status: "active" | "pending" | "unavailable";
}

interface ActionSession {
  readonly userId: string;
  readonly action: ProjectToolAction;
  readonly accountId: string | null;
}

export class Composio extends Context.Service<
  Composio,
  {
    readonly configured: Effect.Effect<boolean, ProjectToolError>;
    readonly apps: (
      input: CatalogInput,
      userId: string,
    ) => Effect.Effect<Page<ProjectToolApp>, ProjectToolError>;
    readonly app: (slug: string) => Effect.Effect<ProjectToolAppDetails, ProjectToolError>;
    readonly actions: (
      input: CatalogInput & { readonly app?: string | undefined },
    ) => Effect.Effect<Page<ProjectToolAction>, ProjectToolError>;
    readonly assignedActions: (
      slugs: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<ProjectToolActionDetails>, ProjectToolError>;
    readonly action: (
      slug: string,
    ) => Effect.Effect<ProjectToolActionDetails | null, ProjectToolError>;
    readonly account: (
      id: string,
      userId: string,
      app: string,
    ) => Effect.Effect<Account | null, ProjectToolError>;
    readonly link: (
      userId: string,
      app: string,
    ) => Effect.Effect<{ readonly id: string; readonly url: string }, ProjectToolError>;
    readonly removeAccount: (
      id: string,
      userId: string,
      app: string,
    ) => Effect.Effect<void, ProjectToolError>;
    readonly createActionSession: (input: ActionSession) => Effect.Effect<string, ProjectToolError>;
    readonly closeSession: (session: string) => Effect.Effect<void>;
    readonly execute: (
      session: string,
      action: ProjectToolAction,
      args: Schema.JsonObject,
    ) => Effect.Effect<Schema.Json, ProjectToolError>;
  }
>()("@t3tools/tasks-server/projectTools/Composio") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const secrets = yield* ServerSecretStore;
  const readKey = secrets.get(keyName).pipe(
    Effect.map((bytes) =>
      Option.match(bytes, {
        onNone: () => "",
        onSome: (value) => new TextDecoder().decode(value).trim(),
      }),
    ),
    Effect.mapError((cause) => new ProjectToolError({ code: "credentials-unavailable", cause })),
  );

  // A response or HTTP error may contain credentials. Keep only its status and failure code.
  const request = Effect.fn("Composio.request")(function* <
    S extends Schema.Top & Schema.ConstraintDecoder<unknown>,
  >(
    schema: S,
    path: string,
    options: {
      readonly method?: "GET" | "POST" | "DELETE";
      readonly query?: URLSearchParams;
      readonly body?: Schema.JsonObject;
      readonly executingWrite?: boolean;
    } = {},
  ) {
    const key = yield* readKey;
    if (!key) return yield* new ProjectToolError({ code: "missing-key" });
    const { method = "GET", query, body, executingWrite } = options;
    const url = `${baseUrl}${path}${query?.size ? `?${query}` : ""}`;
    const req = HttpClientRequest.make(method)(url, { headers: { "x-api-key": key } });
    const failure = () =>
      new ProjectToolError({
        code: executingWrite ? "action-outcome-unknown" : "composio-unavailable",
      });
    return yield* Effect.gen(function* () {
      const response = yield* http
        .execute(body === undefined ? req : HttpClientRequest.bodyJsonUnsafe(req, body))
        .pipe(Effect.mapError(failure));
      if (response.status === 404 && method !== "POST") return null;
      if (response.status < 200 || response.status >= 300) {
        return yield* new ProjectToolError({
          code:
            executingWrite && response.status >= 500
              ? "action-outcome-unknown"
              : "composio-rejected",
          status: response.status,
        });
      }
      const data =
        method === "DELETE" ? undefined : yield* response.json.pipe(Effect.mapError(failure));
      return yield* Schema.decodeEffect(schema)(data).pipe(Effect.mapError(failure));
    }).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.timeoutOrElse({
        duration: path.endsWith("/execute") ? "60 seconds" : "15 seconds",
        orElse: () => Effect.fail(failure()),
      }),
    );
  });

  const list = Effect.fn("Composio.list")(function* <
    S extends Schema.Top & Schema.ConstraintDecoder<unknown>,
  >(schema: S, path: string, query: URLSearchParams) {
    const page = yield* request(pageSchema(schema), path, { query });
    if (!page) return yield* new ProjectToolError({ code: "composio-unavailable" });
    return { items: page.items, nextCursor: page.next_cursor || null };
  });
  const catalogQuery = (input: CatalogInput, queryParam: "search" | "query") => {
    const params = new URLSearchParams({
      limit: String(input.limit ?? pageSize),
      include_deprecated: "false",
    });
    if (input.query?.trim()) params.set(queryParam, input.query.trim());
    if (input.cursor) params.set("cursor", input.cursor);
    return params;
  };

  const app = Effect.fn("Composio.app")(function* (slug: string) {
    const toolkit = yield* request(appDetailsSchema, `/toolkits/${encodeURIComponent(slug)}`);
    if (!toolkit || toolkit.slug !== slug)
      return yield* new ProjectToolError({ code: "app-unavailable" });
    const details = toApp(toolkit);
    if (toolkit.no_auth === true) {
      return { ...details, setup: "no-account" } as const;
    }
    if (toolkit.composio_managed_auth?.length || toolkit.composio_managed_auth_schemes?.length) {
      return { ...details, setup: "connect" } as const;
    }
    if (
      toolkit.no_auth === undefined &&
      toolkit.auth_config_details?.every(({ mode }) => mode.toLowerCase() === "no_auth")
    )
      return { ...details, setup: "no-account" } as const;
    const configs = yield* list(
      Schema.Struct({ id: Schema.NonEmptyString }),
      "/auth_configs",
      new URLSearchParams({ toolkit_slug: slug, limit: "1" }),
    );
    return {
      ...details,
      setup: configs.items.length > 0 ? "connect" : "auth-config-required",
    } as const;
  });

  const account = Effect.fn("Composio.account")(function* (
    id: string,
    userId: string,
    app: string,
  ) {
    // Composio is removing user_id from responses, so verify ownership with its user filter.
    const page = yield* list(
      accountSchema,
      "/connected_accounts",
      new URLSearchParams({
        connected_account_ids: id,
        user_ids: userId,
        toolkit_slugs: app,
        limit: "1",
      }),
    );
    const [found] = page.items;
    if (
      !found ||
      found.id !== id ||
      found.toolkit.slug !== app ||
      (found.user_id && found.user_id !== userId)
    )
      return null;
    const disabled = found.is_disabled === true || found.auth_config?.is_disabled === true;
    return {
      label: (found.state?.val?.displayName || found.alias || found.id).slice(0, 200),
      status:
        !disabled && found.status === "ACTIVE"
          ? "active"
          : !disabled && ["INITIALIZING", "INITIATED"].includes(found.status)
            ? "pending"
            : "unavailable",
    } as const;
  });

  const createSession = Effect.fn("Composio.createSession")(function* (
    userId: string,
    app: string,
    options: Schema.JsonObject,
  ) {
    const session = yield* request(sessionSchema, sessionPath, {
      method: "POST",
      body: {
        user_id: userId,
        toolkits: { enable: [app] },
        instant: false,
        workbench: { enable: false },
        proxy_execute: { enable: false },
        search: { enable: false },
        execute: { enable_multi_execute: false },
        ...options,
      },
    });
    if (!session) return yield* new ProjectToolError({ code: "composio-unavailable" });
    return session.session_id;
  });
  const sessionUrl = (id: string) => `${sessionPath}/${encodeURIComponent(id)}`;
  const closeSession = Effect.fn("Composio.closeSession")(function* (id: string) {
    yield* request(Schema.Unknown, sessionUrl(id), { method: "DELETE" }).pipe(Effect.ignore);
  });

  return Composio.of({
    configured: readKey.pipe(Effect.map(Boolean)),
    apps: Effect.fn("Composio.apps")(function* (input, userId) {
      const query = catalogQuery(input, "search");
      query.set("type", "all");
      query.set("user_id", userId);
      const page = yield* list(appSchema, "/toolkits", query);
      return { ...page, items: page.items.map(toApp) };
    }),
    app,
    actions: Effect.fn("Composio.actions")(function* (input) {
      const query = catalogQuery(input, "query");
      if (input.app) query.set("toolkit_slug", input.app);
      const page = yield* list(toolSchema, "/tools", query);
      return { ...page, items: page.items.map(toAction) };
    }),
    assignedActions: Effect.fn("Composio.assignedActions")(function* (slugs) {
      if (slugs.length === 0) return [];
      const page = yield* list(
        toolDetailsSchema,
        "/tools",
        new URLSearchParams({
          tool_slugs: slugs.join(","),
          limit: String(slugs.length),
          include_deprecated: "false",
        }),
      );
      const allowed = new Set(slugs);
      return page.items
        .filter(({ slug, is_deprecated }) => allowed.has(slug) && is_deprecated !== true)
        .map((tool) => ({
          ...toAction(tool),
          inputSchema: inputSchema(tool.input_parameters),
        }));
    }),
    action: Effect.fn("Composio.action")(function* (slug) {
      const tool = yield* request(toolDetailsSchema, `/tools/${encodeURIComponent(slug)}`);
      return tool?.slug === slug && tool.is_deprecated !== true
        ? { ...toAction(tool), inputSchema: inputSchema(tool.input_parameters) }
        : null;
    }),
    account,
    link: Effect.fn("Composio.link")(function* (userId, appSlug) {
      const toolkit = yield* app(appSlug);
      if (toolkit.setup === "no-account")
        return yield* new ProjectToolError({ code: "account-not-needed" });
      if (toolkit.setup === "auth-config-required")
        return yield* new ProjectToolError({ code: "auth-config-required" });
      return yield* Effect.acquireUseRelease(
        createSession(userId, appSlug, { manage_connections: { enable: true } }),
        (session) =>
          Effect.gen(function* () {
            const link = yield* request(linkSchema, `${sessionUrl(session)}/link`, {
              method: "POST",
              body: { toolkit: appSlug },
            });
            if (!link || URL.parse(link.redirect_url)?.protocol !== "https:") {
              return yield* new ProjectToolError({ code: "composio-unavailable" });
            }
            return { id: link.connected_account_id, url: link.redirect_url };
          }),
        closeSession,
      );
    }),
    removeAccount: Effect.fn("Composio.removeAccount")(function* (id, userId, app) {
      if (yield* account(id, userId, app)) {
        yield* request(Schema.Unknown, `/connected_accounts/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      }
    }),
    createActionSession: Effect.fn("Composio.createActionSession")(function* ({
      userId,
      action,
      accountId,
    }) {
      return yield* createSession(userId, action.app, {
        tools: { [action.app]: { enable: [action.slug] } },
        manage_connections: { enable: false },
        ...(accountId === null ? {} : { connected_accounts: { [action.app]: [accountId] } }),
      });
    }),
    closeSession,
    execute: Effect.fn("Composio.execute")(function* (session, action, args) {
      // The session pins the account. A request-level selector requires multi-account mode.
      const result = yield* request(executionSchema, `${sessionUrl(session)}/execute`, {
        method: "POST",
        body: {
          tool_slug: action.slug,
          arguments: args,
        },
        executingWrite: action.effect === "write",
      });
      if (result?.result_type === "completed") return result.data ?? null;
      return yield* new ProjectToolError({
        code:
          result?.result_type === "input_required" ? "composio-approval-required" : "action-failed",
      });
    }),
  });
});

export const layer = Layer.effect(Composio, make);
