import { expect } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  gmailActionData,
  gmailActions,
  gmailApp,
  gmailFixtureKey,
} from "../../../../scripts/scenarios/fixtures/gmail-workspace-data.ts";
import {
  postizAction,
  postizApp,
  postizChannels,
  socialProposal,
} from "../../../../scripts/scenarios/fixtures/social-calendar-data.ts";
import {
  searchAction,
  searchApp,
  websiteReport,
} from "../../../../scripts/scenarios/fixtures/website-bot-app-data.ts";
import {
  shopifyApp,
  shopifyRead,
  shopifyResponse,
} from "../../../../scripts/scenarios/fixtures/shopify-store-data.ts";

export const read = "FIXTURE_READ_REPO";
export const write = "FIXTURE_CREATE_REPO_NOTE";
export const publicRead = "PUBLIC_LIST_ITEMS";
export const unknownEffect = "FIXTURE_UNCLASSIFIED";
export const fixtureKey = gmailFixtureKey;

const repo = { type: "string", minLength: 1 };
const tool = (
  slug: string,
  name: string,
  tags: string[],
  auth: boolean,
  input: Schema.JsonObject,
) => ({
  slug,
  name,
  description: `Catalog description for ${name}.`,
  toolkit: { slug: auth ? "fixture" : "public", name: auth ? "Fixture" : "Public" },
  tags,
  no_auth: !auth,
  input_parameters: input,
});

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeBody = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const matchesQuery = (item: unknown, query: string) =>
  JSON.stringify(item).toLowerCase().includes(query);
const sessionConfig = Schema.Struct({
  user_id: Schema.String,
  toolkits: Schema.Struct({ enable: Schema.Tuple([Schema.String]) }),
  instant: Schema.Literal(false),
  workbench: Schema.Struct({ enable: Schema.Literal(false) }),
  proxy_execute: Schema.Struct({ enable: Schema.Literal(false) }),
  search: Schema.Struct({ enable: Schema.Literal(false) }),
  execute: Schema.Struct({ enable_multi_execute: Schema.Literal(false) }),
  tools: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        enable: Schema.Tuple([Schema.String]),
      }),
    ),
  ),
  connected_accounts: Schema.optional(Schema.Record(Schema.String, Schema.Tuple([Schema.String]))),
  manage_connections: Schema.Struct({ enable: Schema.Boolean }),
});
const decodeSession = Schema.decodeUnknownSync(sessionConfig, { onExcessProperty: "error" });
const execution = Schema.Struct({
  tool_slug: Schema.String,
  account: Schema.optional(Schema.String),
  arguments: Schema.JsonObject,
});
const decodeExecution = Schema.decodeUnknownSync(execution);

interface FixtureAccount {
  readonly id: string;
  readonly toolkit: { readonly slug: string };
  user_id: string;
  status: "INITIATED" | "ACTIVE" | "EXPIRED";
  label: string;
}

export const makeComposioFixture = () => {
  const calls: Array<{
    readonly userId: string;
    readonly slug: string;
    readonly account?: string | undefined;
    readonly arguments: Schema.JsonObject;
  }> = [];
  const catalogRequests: URL[] = [];
  const accounts = new Map<string, FixtureAccount>();
  const sessions = new Map<string, typeof sessionConfig.Type>();
  const tools = [
    tool(read, "Read repository", ["readOnlyHint"], true, {
      repository: { ...repo, required: true },
    }),
    tool(write, "Create repository note", ["createHint"], true, {
      type: "object",
      properties: { repository: repo, note: { type: "string", minLength: 1 } },
      required: ["repository", "note"],
      additionalProperties: false,
    }),
    tool(publicRead, "List public items", ["readOnlyHint"], false, {}),
    tool(unknownEffect, "Unclassified operation", [], true, {}),
    ...gmailActions,
    shopifyRead,
    searchAction,
    postizAction,
  ];
  const apps = [
    {
      slug: "fixture",
      name: "Fixture",
      meta: { description: "Manage repository notes" },
      no_auth: false,
      composio_managed_auth: [{ managed_app_id: "managed-fixture" }],
    },
    { slug: "public", name: "Public", no_auth: true },
    { slug: "config", name: "Needs configuration", no_auth: false },
    gmailApp,
    shopifyApp,
    searchApp,
    postizApp,
  ];
  let sequence = 0;
  let nextWriteFailure: { readonly slug: string; readonly status: number } | undefined;
  let searchReport: unknown = websiteReport;
  let shopifyReport: unknown = { successful: true, data: { data: shopifyResponse } };
  let nextSessionGate:
    | {
        readonly slug: string | undefined;
        readonly entered: Deferred.Deferred<void>;
        readonly proceed: Deferred.Deferred<void>;
      }
    | undefined;

  const http = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      expect(request.headers["x-api-key"]).toBe(fixtureKey);
      expect(url.origin).toBe("https://backend.composio.dev");
      const path = url.pathname.replace(/^\/api\/v3\.1/, "");
      const response = (value: unknown, status = 200) =>
        HttpClientResponse.fromWeb(request, Response.json(value, { status }));
      const body: unknown =
        request.body._tag === "Uint8Array"
          ? yield* decodeBody(new TextDecoder().decode(request.body.body)).pipe(Effect.orDie)
          : undefined;
      const paginate = (items: readonly unknown[]) => {
        const index = url.searchParams.get("cursor") === "second" ? 1 : 0;
        return response({
          items: items.slice(index, index + 1),
          next_cursor: items.length > index + 1 ? "second" : null,
        });
      };
      if (path === "/toolkits" || path === "/tools") {
        catalogRequests.push(new URL(url));
        const assigned = url.searchParams.get("tool_slugs");
        if (assigned !== null) {
          return response({
            items: tools.filter(({ slug }) => assigned.split(",").includes(slug)),
            next_cursor: null,
          });
        }
        const query = (
          url.searchParams.get("query") ??
          url.searchParams.get("search") ??
          ""
        ).toLowerCase();
        const appSlug = url.searchParams.get("toolkit_slug");
        return path === "/tools"
          ? paginate(
              tools.filter(
                (item) => (!appSlug || item.toolkit.slug === appSlug) && matchesQuery(item, query),
              ),
            )
          : paginate(appSlug ? [] : apps.filter((item) => matchesQuery(item, query)));
      }
      if (path.startsWith("/toolkits/")) {
        const app = apps.find(({ slug }) => path === `/toolkits/${slug}`);
        return app ? response(app) : response({}, 404);
      }
      if (path.startsWith("/tools/")) {
        const item = tools.find(({ slug }) => path === `/tools/${slug}`);
        return item ? response(item) : response({}, 404);
      }
      if (path === "/auth_configs") {
        const items =
          url.searchParams.get("toolkit_slug") === shopifyApp.slug
            ? [{ id: "shopify-auth-config-fixture" }]
            : [];
        return response({ items, next_cursor: null });
      }
      if (path === "/connected_accounts") {
        const account = accounts.get(url.searchParams.get("connected_account_ids") ?? "");
        if (
          !account ||
          account.user_id !== url.searchParams.get("user_ids") ||
          account.toolkit.slug !== url.searchParams.get("toolkit_slugs")
        ) {
          return response({ items: [], next_cursor: null });
        }
        return response({
          items: [
            {
              id: account.id,
              toolkit: account.toolkit,
              status: account.status,
              state: { val: { displayName: account.label, access_token: "never-return-this" } },
            },
          ],
          next_cursor: null,
        });
      }
      if (path.startsWith("/connected_accounts/") && request.method === "DELETE") {
        const id = path.split("/").at(-1)!;
        if (!accounts.delete(id)) return response({}, 404);
        return response({ deleted: true });
      }
      if (path === "/tool_router/session" && request.method === "POST") {
        const settings = decodeSession(body);
        const toolSlug = settings.tools?.[settings.toolkits.enable[0]]?.enable[0];
        if (
          nextSessionGate &&
          toolSlug &&
          (!nextSessionGate.slug || nextSessionGate.slug === toolSlug)
        ) {
          const gate = nextSessionGate;
          nextSessionGate = undefined;
          yield* Deferred.succeed(gate.entered, undefined);
          yield* Deferred.await(gate.proceed);
        }
        const id = `session-${++sequence}`;
        sessions.set(id, settings);
        return response(
          { session_id: id, mcp: { url: "https://private-session.example/mcp" } },
          201,
        );
      }
      const [, sessionId, operation] =
        /^\/tool_router\/session\/([^/]+)(?:\/([^/]+))?$/.exec(path) ?? [];
      const session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (!session || sessionId === undefined) return response({}, 404);
      const [app] = session.toolkits.enable;
      if (request.method === "DELETE") {
        sessions.delete(sessionId);
        return response({ deleted: true });
      }
      if (operation === "link") {
        expect(session.manage_connections.enable).toBe(true);
        expect(decodeObject(body).toolkit).toBe(app);
        const id = `account-${++sequence}`;
        accounts.set(id, {
          id,
          user_id: session.user_id,
          toolkit: { slug: app },
          status: "INITIATED",
          label: id,
        });
        return response(
          { connected_account_id: id, redirect_url: `https://connect.composio.dev/link/${id}` },
          201,
        );
      }
      if (operation === "execute") {
        const input = decodeExecution(body);
        if (input.account !== undefined) {
          return response({ error: "Account selection requires multi-account mode." }, 400);
        }
        expect(session.manage_connections.enable).toBe(false);
        expect(session.tools?.[app]?.enable).toEqual([input.tool_slug]);
        const action = tools.find(({ slug }) => slug === input.tool_slug);
        expect(action?.toolkit.slug).toBe(app);
        const account = session.connected_accounts?.[app]?.[0];
        expect(account !== undefined).toBe(action?.no_auth === false);
        if (account !== undefined) {
          expect(accounts.get(account)).toMatchObject({
            user_id: session.user_id,
            status: "ACTIVE",
          });
        }
        calls.push({
          userId: session.user_id,
          slug: input.tool_slug,
          account,
          arguments: input.arguments,
        });
        if (input.tool_slug === shopifyRead.slug) {
          return response({ result_type: "completed", data: shopifyReport });
        }
        if (input.tool_slug === nextWriteFailure?.slug) {
          const { status } = nextWriteFailure;
          nextWriteFailure = undefined;
          return response({ error: "fixture write error" }, status);
        }
        if (input.tool_slug === postizAction.slug) {
          expect(input.arguments).toEqual({ group: socialProposal.source.group });
          return response({
            result_type: "completed",
            data: { successful: true, data: { structuredContent: postizChannels } },
          });
        }
        return response({
          result_type: "completed",
          data:
            input.tool_slug === searchAction.slug
              ? searchReport
              : (gmailActionData(input.tool_slug, input.arguments.thread_id) ?? {
                  slug: input.tool_slug,
                  arguments: input.arguments,
                }),
        });
      }
      return response({}, 404);
    }),
  );

  return {
    layer: Layer.succeed(HttpClient.HttpClient, http),
    calls,
    accounts,
    catalogRequests,
    sessions,
    setShopifyReport: (report: unknown) => {
      shopifyReport = report;
    },
    setSearchReport: (report: unknown) => {
      searchReport = report;
    },
    hideAction: (slug: string) => {
      const index = tools.findIndex((item) => item.slug === slug);
      if (index !== -1) tools.splice(index, 1);
    },
    failWrite: (slug = write, status = 502) => {
      nextWriteFailure = { slug, status };
    },
    holdSession: Effect.fn("ComposioFixture.holdSession")(function* (slug?: string) {
      const entered = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      nextSessionGate = { slug, entered, proceed };
      return { entered, proceed };
    }),
  };
};
