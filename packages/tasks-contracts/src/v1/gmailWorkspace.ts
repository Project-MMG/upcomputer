import { ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { TaskAgentId } from "./agents.ts";
import { ProjectToolCursor, ProjectToolError } from "./projectTools.ts";

export const GmailWorkspaceLayout = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  order: Schema.Literals(["inbox-first", "thread-first"]),
});
export type GmailWorkspaceLayout = typeof GmailWorkspaceLayout.Type;

const botChat = {
  projectId: ProjectId,
  botId: TaskAgentId,
  threadId: ThreadId,
};
const GmailWorkspaceTarget = Schema.Struct(botChat);
export type GmailWorkspaceTarget = typeof GmailWorkspaceTarget.Type;

export const GmailThreadId = Schema.NonEmptyString.check(Schema.isMaxLength(128));

const inboxThread = Schema.Struct({
  threadId: GmailThreadId,
  subject: Schema.String,
  sender: Schema.String,
  preview: Schema.String,
  unread: Schema.Boolean,
});
const mail = Schema.Struct({
  messageId: Schema.NonEmptyString,
  subject: Schema.String,
  sender: Schema.String,
  receivedAt: Schema.String,
  body: Schema.String,
});
const inboxPage = Schema.Struct({
  threads: Schema.Array(inboxThread),
  nextPageToken: Schema.NullOr(ProjectToolCursor),
});
const threadPage = Schema.Struct({
  messages: Schema.Array(mail),
  nextPageToken: Schema.NullOr(ProjectToolCursor),
});
export type GmailInboxPage = typeof inboxPage.Type;
export type GmailThreadPage = typeof threadPage.Type;

const page = { pageToken: Schema.optional(ProjectToolCursor) };
const inboxInput = Schema.Struct({ ...botChat, ...page });
const threadInput = Schema.Struct({ ...botChat, ...page, gmailThreadId: GmailThreadId });
export type GmailInboxInput = typeof inboxInput.Type;
export type GmailThreadInput = typeof threadInput.Type;

export const GMAIL_WORKSPACE_RPC_NAMESPACE = "upcomputer.gmail-workspace.v1";
export const GMAIL_WORKSPACE_RPC_METHODS = {
  layout: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.layout`,
  inbox: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.inbox`,
  thread: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.thread`,
} as const;

const M = GMAIL_WORKSPACE_RPC_METHODS;
export const GmailWorkspaceRpcGroup = RpcGroup.make(
  Rpc.make(M.layout, {
    payload: GmailWorkspaceTarget,
    success: Schema.NullOr(GmailWorkspaceLayout),
    error: ProjectToolError,
  }),
  Rpc.make(M.inbox, { payload: inboxInput, success: inboxPage, error: ProjectToolError }),
  Rpc.make(M.thread, { payload: threadInput, success: threadPage, error: ProjectToolError }),
);
