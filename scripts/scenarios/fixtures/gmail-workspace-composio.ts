// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Standalone preload for the isolated scenario server.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  gmailActionData,
  gmailActions,
  gmailApp,
  gmailFixtureDeliveryFile,
  gmailFixtureKey,
  gmailFixtureSender,
  gmailFixtureSendLog,
  gmailReplyAction,
} from "./gmail-workspace-data.ts";

interface Session {
  readonly user_id: string;
  readonly toolkits: { readonly enable: readonly string[] };
  readonly tools?: { readonly gmail: { readonly enable: readonly string[] } };
  readonly connected_accounts?: { readonly gmail: readonly string[] };
  readonly manage_connections: { readonly enable: boolean };
}

const sessions = new Map<string, Session>();
const accounts = new Map<string, string>();
const realFetch = globalThis.fetch;
let sequence = 0;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== "https://backend.composio.dev") return realFetch(input, init);
  const request = new Request(input, init);
  if (request.headers.get("x-api-key") !== gmailFixtureKey)
    return new Response(null, { status: 401 });
  const path = url.pathname.replace(/^\/api\/v3\.1/, "");
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const notFound = () => json({ error: "No matching fixture route" }, 404);
  if (path === "/toolkits") return json({ items: [gmailApp] });
  if (path === "/toolkits/gmail") return json(gmailApp);
  if (path === "/tools") return json({ items: gmailActions });
  if (path.startsWith("/tools/")) {
    const action = gmailActions.find(({ slug }) => path === `/tools/${slug}`);
    return action ? json(action) : notFound();
  }
  if (path === "/connected_accounts") {
    const id = url.searchParams.get("connected_account_ids") ?? "";
    const user = accounts.get(id);
    return json({
      items:
        user &&
        url.searchParams.get("user_ids") === user &&
        url.searchParams.get("toolkit_slugs") === "gmail"
          ? [
              {
                id,
                user_id: user,
                toolkit: { slug: "gmail" },
                status: "ACTIVE",
                alias: gmailFixtureSender,
              },
            ]
          : [],
    });
  }
  if (path.startsWith("/connected_accounts/") && request.method === "DELETE") {
    const id = path.slice("/connected_accounts/".length);
    return accounts.delete(id) ? json({ deleted: true }) : notFound();
  }
  if (path === "/tool_router/session" && request.method === "POST") {
    const session = (await request.json()) as Session;
    if (session.toolkits.enable.join() !== "gmail") return notFound();
    const id = `session-${++sequence}`;
    sessions.set(id, session);
    return json({ session_id: id }, 201);
  }
  const [, id = "", operation] = /^\/tool_router\/session\/([^/]+)(?:\/([^/]+))?$/.exec(path) ?? [];
  const session = sessions.get(id);
  if (!session) return notFound();
  if (request.method === "DELETE") {
    sessions.delete(id);
    return json({ deleted: true });
  }
  if (operation === "link" && session.manage_connections.enable) {
    const account = `account-${++sequence}`;
    accounts.set(account, session.user_id);
    return json(
      { connected_account_id: account, redirect_url: `https://example.test/link/${account}` },
      201,
    );
  }
  if (operation === "execute" && !session.manage_connections.enable) {
    const call = (await request.json()) as {
      tool_slug: string;
      arguments: { user_id?: string; thread_id?: string };
    };
    const account = session.connected_accounts?.gmail[0] ?? "";
    if (
      session.tools?.gmail.enable.join() !== call.tool_slug ||
      accounts.get(account) !== session.user_id ||
      call.arguments.user_id !== "me"
    )
      return json({ result_type: "failed" });
    const home = process.env.T3CODE_HOME;
    const data = gmailActionData(
      call.tool_slug,
      call.arguments.thread_id,
      !!home && NodeFS.existsSync(NodePath.join(home, gmailFixtureDeliveryFile)),
    );
    if (data && call.tool_slug === gmailReplyAction) {
      if (!home) return json({ result_type: "failed" });
      NodeFS.appendFileSync(
        NodePath.join(home, gmailFixtureSendLog),
        `${JSON.stringify({ account, ...call })}\n`,
        { mode: 0o600 },
      );
    }
    if (data) return json({ result_type: "completed", data });
  }
  return notFound();
};
