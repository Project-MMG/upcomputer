// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - A standalone ACP subprocess reads its checkout and calls the local MCP server.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import {
  assignHandoffPrompt,
  checkInboxPrompt,
  createInboxPrompt,
  customerQuestion,
  firstDraftOpening,
  gmailFixtureDraftNote,
  gmailFixtureEditedReply,
  gmailFixtureLayoutNote,
  gmailFixtureReplacement,
  gmailFixtureSelectedText,
  handoff,
  handoffDescription,
  inboxBotId,
  inboxInstructions,
  receipt,
  rejectedQuestion,
  retro,
  websiteBotId,
} from "./gmail-workspace-data.ts";

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
type ToolResult = {
  readonly isError?: boolean;
  readonly content: readonly { readonly text: string }[];
  readonly structuredContent?: { readonly code: string };
};
type ToolCall = (name: string, args: object) => Promise<ToolResult>;

const model = { modelId: "workspace", name: "Scripted Gmail workspace" };
const models = { currentModelId: model.modelId, availableModels: [model] };
const sessions = new Map<string, Session>();
let sequence = 0;
const send = (frame: object) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);

async function withMcp<A>(
  endpoint: string,
  authorization: string,
  run: (call: ToolCall) => Promise<A>,
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
  let id = 1;
  try {
    return await run(async (name, args) => {
      const response = await post(++id, "tools/call", { name, arguments: args });
      const reply = (await response.json()) as { result?: ToolResult; error?: { message: string } };
      if (!response.ok || !reply.result) {
        throw new Error(reply.error?.message ?? `MCP call returned ${response.status}.`);
      }
      return reply.result;
    });
  } finally {
    await fetch(url, { method: "DELETE", headers });
  }
}

function readResult(result: ToolResult): unknown {
  if (result.isError) throw new Error(result.content[0]?.text ?? "Fixture MCP tool failed.");
  return JSON.parse(result.content[0]?.text ?? "null");
}

async function completedHandoff(call: ToolCall) {
  const { task } = readResult(await call("task_get", { id: handoff.id })) as {
    readonly task: {
      readonly status: string;
      readonly description: string;
      readonly output: string;
    };
  };
  if (task.status !== "Done" || task.description !== handoffDescription || !task.output)
    throw new Error("The Website task did not return a completed result for the scoped brief.");
  return task.output;
}

async function assignHandoff(call: ToolCall) {
  const { agents } = readResult(await call("task_context", {})) as {
    readonly agents: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly startTags: ReadonlyArray<string>;
    }>;
  };
  const owner = agents.find(({ id }) => id === websiteBotId);
  if (!owner) throw new Error("The Website bot was not available to Chief in this project.");
  readResult(
    await call("task_create", {
      id: handoff.id,
      title: handoff.title,
      description: handoffDescription,
      status: "To Do",
      audience: "agent",
      tags: owner.startTags,
    }),
  );
  return `Assigned the delivery FAQ check to ${owner.name}.`;
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
  const annotation =
    /<context kind="gmail-workspace-annotation" id="([^"]+)">\n(.+)\n<\/context>/u.exec(text);
  const read = (path: string) => NodeFSP.readFile(NodePath.join(session.cwd, path), "utf8");
  const output = await withMcp(endpoint, authorization, async (call) => {
    if (text.includes("Assigned task:") && text.includes(`- id: ${handoff.id}`)) {
      const brief = /\nDescription:\n([\s\S]*?)\nMetadata:/u.exec(text)?.[1]?.trim();
      if (
        !text.includes(`- agentId: ${websiteBotId}`) ||
        brief !== handoffDescription ||
        [
          "jordan@example.test",
          customerQuestion.threadId,
          customerQuestion.subject,
          customerQuestion.messageText,
        ].some((mail) => text.includes(mail))
      )
        throw new Error("The Website run received the wrong owner or handoff context.");
      const faq = await read(handoff.sitePath);
      if (
        !faq.includes("The delivery FAQ gives an initial estimate.") ||
        faq.includes("order tracking")
      )
        throw new Error("The fixture site did not support the proposed FAQ change.");
      const result = { status: "Done", summary: handoff.result, blocked: false, events: [] };
      return `Website reviewed the delivery FAQ.\n\n~~~task_agent_result\n${JSON.stringify(result)}\n~~~`;
    }
    if (text.includes(assignHandoffPrompt)) return assignHandoff(call);
    if (
      text.includes("A task-agent run finished for a task created in this chat:") &&
      text.includes(handoff.id)
    ) {
      return `Website reported: ${await completedHandoff(call)}`;
    }
    if (text.includes(handoff.preparePrompt)) {
      if (!(await read(handoff.sourcePath)).includes("## Delivery estimates"))
        throw new Error("The Inbox bot could not verify the source for the handoff.");
      return `Website handoff ready.\n\n${handoffDescription}`;
    }
    if (text.includes(retro.prompt)) {
      const [procedure, source, outcome] = await Promise.all([
        read(retro.skill),
        read(handoff.sourcePath),
        completedHandoff(call),
      ]);
      const proposal = /^Propose: (.+)$/mu.exec(procedure)?.[1];
      if (!proposal || !source.includes("## Delivery estimates"))
        throw new Error("The retrospective needs its local instructions and source.");
      const file = NodePath.join(session.cwd, retro.path);
      await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
      await NodeFSP.writeFile(
        file,
        [
          "# Inbox retrospective",
          "",
          `Evidence: ${handoff.id} and ${handoff.source}`,
          `Outcome: ${outcome}`,
          `Proposed improvement: ${proposal}`,
          "Owner: Inbox",
          "",
        ].join("\n"),
      );
      return "Saved the Inbox retrospective for operator review.";
    }
    if (annotation?.[1] && annotation[2]) {
      const { botId, target } = JSON.parse(annotation[2]) as {
        readonly botId: string;
        readonly target: {
          readonly kind: string;
          readonly revision: number;
          readonly gmailThreadId?: string;
          readonly start?: number;
          readonly text?: string;
          readonly control?: string;
          readonly order?: string;
        };
      };
      if (botId !== inboxBotId) throw new Error("Annotation did not go to the Email bot.");
      const annotationId = annotation[1];
      if (target.kind === "draft") {
        if (
          !text.includes(gmailFixtureDraftNote) ||
          target.gmailThreadId !== customerQuestion.threadId ||
          target.start !== gmailFixtureEditedReply.indexOf(gmailFixtureSelectedText) ||
          target.text !== gmailFixtureSelectedText
        )
          throw new Error(
            "The Gmail draft annotation did not carry the reviewed selection and note.",
          );
        readResult(
          await call("gmail_workspace_apply_annotation", {
            annotationId,
            change: { replacement: gmailFixtureReplacement },
          }),
        );
        return "Revised the selected reply text.";
      }
      if (
        !text.includes(gmailFixtureLayoutNote) ||
        target.kind !== "layout" ||
        target.control !== "inbox" ||
        target.order !== "thread-first" ||
        target.revision !== 2
      )
        throw new Error("The Gmail layout annotation did not carry the selected control and note.");
      readResult(
        await call("gmail_workspace_apply_annotation", {
          annotationId,
          change: { position: "first" },
        }),
      );
      return "Moved the inbox above the thread reader.";
    }
    const [shared, playbook, voice] = await Promise.all([
      read("AGENTS.md"),
      read("inbox/AGENTS.md"),
      read("inbox/voice.md"),
    ]);
    const signoff = /^Sign-off: (.+)$/mu.exec(voice)?.[1];
    if (!signoff) throw new Error("The approved fixture voice needs a sign-off.");
    if (text.includes(createInboxPrompt) || revised) {
      const prefix = /^Workspace title prefix: (.+)$/mu.exec(shared)?.[1];
      const row = (revised ? /^Revise: (.+) \((.+)\)$/mu : /^Create: (.+) \((.+)\)$/mu).exec(
        playbook,
      );
      if (!prefix || !row?.[1] || !row[2])
        throw new Error("The fixture playbook did not describe a layout.");
      const result = readResult(
        await call("gmail_workspace_save", { title: `${prefix} ${row[1]}`, order: row[2] }),
      ) as { readonly title: string };
      const guidance = text.includes(inboxInstructions)
        ? " Loaded the approved voice guidance."
        : "";
      return `Saved ${result.title} from the Inbox playbook.${guidance}`;
    }
    if (!text.includes(checkInboxPrompt) || !playbook.includes("gmail_workspace_check")) {
      throw new Error("The fixture playbook did not describe inbox review.");
    }
    const checked = await call("gmail_workspace_check", {});
    const errorCode = checked.structuredContent?.code;
    if (checked.isError) return `Gmail check blocked by ${errorCode}.`;
    const { accountId, candidates } = readResult(checked) as {
      readonly accountId: string;
      readonly candidates: ReadonlyArray<{
        readonly gmailThreadId: string;
        readonly messageId: string;
      }>;
    };
    if (candidates.length === 0) return "No new inbox messages to review.";
    let drafted = 0;
    for (const { gmailThreadId, messageId } of candidates) {
      const draft =
        messageId === customerQuestion.messageId
          ? `${firstDraftOpening} and get back to you.`
          : messageId === rejectedQuestion.messageId
            ? "Hi Morgan, we’ll check with the courier about the delivery instructions."
            : null;
      if (draft === null && messageId !== receipt.messageId)
        throw new Error("Unexpected inbox candidate in the fixture.");
      const record = readResult(
        await call("gmail_workspace_record_reply", {
          accountId,
          gmailThreadId,
          messageId,
          body: draft === null ? null : `${draft}\n\n${signoff}`,
        }),
      ) as { readonly recorded: boolean };
      if (record.recorded && draft !== null) drafted += 1;
    }
    return `Gmail check queued ${drafted} reply draft.`;
  });
  send({
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: output,
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
