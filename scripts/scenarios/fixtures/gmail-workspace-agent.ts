// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - A standalone ACP subprocess reads its checkout and calls the local MCP server.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

type McpServer = {
  readonly name: string;
  readonly env?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
};
type Session = { readonly cwd: string; readonly mcpServers: ReadonlyArray<McpServer> };
type Prompt = {
  readonly sessionId: string;
  readonly prompt: ReadonlyArray<{ readonly text?: string }>;
};
type Message = { readonly id?: string | number; readonly method: string; readonly params: unknown };

const model = { modelId: "workspace", name: "Scripted Gmail workspace" };
const models = { currentModelId: model.modelId, availableModels: [model] };
const sessions = new Map<string, Session>();
let sequence = 0;
const send = (frame: object) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);

async function saveLayout(
  endpoint: string,
  authorization: string,
  layout: { readonly title: string; readonly order: string },
) {
  const url = new URL(endpoint);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    throw new Error("Expected an isolated local MCP server.");
  const headers = new Headers({
    authorization,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  const post = (id: number, method: string, params: object) =>
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  const opened = await post(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "gmail-workspace-scenario", version: "1" },
  });
  const sessionId = opened.headers.get("mcp-session-id");
  if (!opened.ok || !sessionId) throw new Error(`MCP initialization returned ${opened.status}.`);
  await opened.json();
  headers.set("mcp-session-id", sessionId);
  headers.set("mcp-protocol-version", "2025-06-18");
  try {
    const saved = await post(2, "tools/call", { name: "gmail_workspace_save", arguments: layout });
    const reply = (await saved.json()) as {
      result?: { isError?: boolean; content: readonly { text: string }[] };
      error?: { message: string };
    };
    if (!saved.ok || !reply.result || reply.result.isError) {
      throw new Error(
        reply.result?.content[0]?.text ??
          reply.error?.message ??
          `MCP save returned ${saved.status}.`,
      );
    }
    return JSON.parse(reply.result.content[0]?.text ?? "null") as typeof layout;
  } finally {
    await fetch(url, { method: "DELETE", headers });
  }
}

async function runPrompt({ sessionId, prompt }: Prompt) {
  const session = sessions.get(sessionId);
  const server = session?.mcpServers.find(({ name }) => name === "t3-code");
  const endpoint = server?.env?.find(({ name }) => name === "T3_ACP_MCP_ENDPOINT")?.value;
  const authorization = server?.env?.find(({ name }) => name === "T3_ACP_MCP_AUTHORIZATION")?.value;
  if (!session || !endpoint || !authorization)
    throw new Error("No Up.computer MCP connection in the bot's ACP session.");
  const text = prompt.map((part) => part.text ?? "").join("\n");
  const revised = text.includes("Revise the Gmail workspace");
  if (!revised && !text.includes("Read AGENTS.md and bots/email/AGENTS.md")) {
    throw new Error("The turn did not include the bot's Home Repo instructions.");
  }
  const [shared, playbook] = await Promise.all([
    NodeFSP.readFile(NodePath.join(session.cwd, "AGENTS.md"), "utf8"),
    NodeFSP.readFile(NodePath.join(session.cwd, "bots/email/AGENTS.md"), "utf8"),
  ]);
  const prefix = /^Workspace title prefix: (.+)$/m.exec(shared)?.[1];
  const row = (revised ? /^Revise: (.+) \((.+)\)$/m : /^Create: (.+) \((.+)\)$/m).exec(playbook);
  if (prefix === undefined || !row?.[1] || !row[2])
    throw new Error("The fixture playbook did not describe a layout.");
  const result = await saveLayout(endpoint, authorization, {
    title: `${prefix} ${row[1]}`,
    order: row[2],
  });
  send({
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Saved ${result.title} from the Home Repo and Email playbook.`,
        },
      },
    },
  });
  return { stopReason: "end_turn" };
}

async function handle(message: Message) {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [],
      };
    case "session/new":
    case "session/load": {
      const params = message.params as Session & { readonly sessionId?: string };
      const sessionId = params.sessionId ?? `gmail-fixture-${process.pid}-${++sequence}`;
      sessions.set(sessionId, params);
      return { ...(message.method === "session/new" ? { sessionId } : {}), models };
    }
    case "session/prompt":
      return runPrompt(message.params as Prompt);
    default:
      return {};
  }
}

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line) as Message;
  if (message.id === undefined) return;
  void handle(message).then(
    (result) => send({ id: message.id, result }),
    (error: unknown) =>
      send({
        id: message.id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      }),
  );
});
