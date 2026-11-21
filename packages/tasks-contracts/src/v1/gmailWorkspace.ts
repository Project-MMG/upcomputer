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
export const GmailMessageId = Schema.NonEmptyString.check(Schema.isMaxLength(128));
export const GMAIL_REPLY_BODY_LIMIT = 12_000;
const GmailReplyBody = Schema.String.check(
  Schema.isMaxLength(GMAIL_REPLY_BODY_LIMIT),
  Schema.isPattern(/\S/u),
);
const GmailDraftId = Schema.NonEmptyString.check(Schema.isMaxLength(128));
const GmailDraftRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const GmailReplyDraft = Schema.Struct({
  id: GmailDraftId,
  status: Schema.Literals(["pending", "dismissed"]),
  revision: GmailDraftRevision,
  recipient: Schema.String,
  body: GmailReplyBody,
});
export type GmailReplyDraft = typeof GmailReplyDraft.Type;

const inboxThread = Schema.Struct({
  threadId: GmailThreadId,
  subject: Schema.String,
  sender: Schema.String,
  preview: Schema.String,
  unread: Schema.Boolean,
  pendingReply: Schema.optionalKey(Schema.Literal(true)),
});
const mail = Schema.Struct({
  messageId: Schema.NonEmptyString,
  subject: Schema.String,
  sender: Schema.String,
  receivedAt: Schema.String,
  body: Schema.String,
  draft: Schema.optionalKey(GmailReplyDraft),
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

export const GmailInboxCheck = Schema.Struct(page);
export const GmailInboxDecision = Schema.Struct({
  accountId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  gmailThreadId: GmailThreadId,
  messageId: GmailMessageId,
  body: Schema.NullOr(GmailReplyBody),
});
const updateDraftInput = Schema.Struct({
  ...botChat,
  gmailThreadId: GmailThreadId,
  draftId: GmailDraftId,
  revision: GmailDraftRevision,
  change: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("edit"), body: GmailReplyBody }),
    Schema.Struct({ kind: Schema.Literal("dismiss") }),
  ]),
});
export type GmailDraftUpdateInput = typeof updateDraftInput.Type;

export const GMAIL_WORKSPACE_RPC_NAMESPACE = "upcomputer.gmail-workspace.v1";
export const GMAIL_WORKSPACE_RPC_METHODS = {
  layout: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.layout`,
  inbox: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.inbox`,
  thread: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.thread`,
  updateDraft: `${GMAIL_WORKSPACE_RPC_NAMESPACE}.updateDraft`,
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
  Rpc.make(M.updateDraft, {
    payload: updateDraftInput,
    success: GmailReplyDraft,
    error: ProjectToolError,
  }),
);
