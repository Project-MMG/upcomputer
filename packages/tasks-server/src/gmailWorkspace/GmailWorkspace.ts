import type { AuthSessionId } from "@t3tools/contracts";
import {
  type GmailDraftApprovalInput,
  type GmailDraftUpdateInput,
  type GmailInboxDecision,
  GmailMessageId,
  type GmailReplyDeliveryStatus,
  type GmailReplyDraft,
  GmailThreadId,
  GmailWorkspaceLayout,
  ProjectToolCursor,
  ProjectToolError,
  type GmailInboxInput,
  type GmailInboxPage,
  type GmailThreadInput,
  type GmailThreadPage,
  type GmailWorkspaceTarget,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { McpInvocationContext } from "../../../../apps/server/src/extensionApi.ts";
import { ProjectTools } from "../projectTools/ProjectTools.ts";

const layoutJson = Schema.fromJsonString(GmailWorkspaceLayout);
const decodeLayout = Schema.decodeUnknownEffect(layoutJson);
const encodeLayout = Schema.encodeEffect(layoutJson);
const storageError = (cause: unknown) =>
  new ProjectToolError({ code: "workspace-storage-unavailable", cause });

const gmailText = Schema.optional(Schema.NullOr(Schema.String));
const gmailMessage = Schema.Struct({
  messageId: GmailMessageId,
  threadId: Schema.optional(GmailThreadId),
  sender: gmailText,
  subject: gmailText,
  preview: gmailText,
  snippet: gmailText,
  messageText: gmailText,
  messageTimestamp: gmailText,
  labelIds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
const gmailPage = Schema.Struct({
  messages: Schema.optional(Schema.NullOr(Schema.Array(gmailMessage))),
  nextPageToken: Schema.optional(Schema.NullOr(ProjectToolCursor)),
});
const gmailInboxMessage = gmailMessage.mapFields((fields) => ({
  ...fields,
  threadId: GmailThreadId,
}));
const decodeThread = Schema.decodeUnknownEffect(gmailPage);
const decodeInbox = Schema.decodeUnknownEffect(
  gmailPage.mapFields((fields) => ({
    ...fields,
    messages: Schema.optional(Schema.NullOr(Schema.Array(gmailInboxMessage))),
  })),
);
const gmailSendReceipt = Schema.Struct({ id: GmailMessageId, threadId: GmailThreadId });
const decodeSendReceipt = Schema.decodeUnknownOption(
  Schema.Union([gmailSendReceipt, Schema.Struct({ response_data: gmailSendReceipt })]),
);
const messageTime = (message: typeof gmailMessage.Type) =>
  Date.parse(message.messageTimestamp ?? "") || 0;
const previewText = (message: typeof gmailMessage.Type) => message.preview ?? message.snippet ?? "";
const nextPage = (next: string | null | undefined, current?: string) =>
  next && next !== current ? next : null;
const invalidResponse = (cause: unknown) =>
  new ProjectToolError({ code: "composio-unavailable", cause });

const inboxAction = (pageToken?: string) => ({
  slug: "GMAIL_FETCH_EMAILS",
  arguments: {
    user_id: "me",
    query: "in:inbox",
    max_results: 30,
    include_payload: false,
    verbose: false,
    ...(pageToken ? { page_token: pageToken } : {}),
  },
});
const threadAction = (threadId: string, pageToken?: string) => ({
  slug: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  arguments: {
    user_id: "me",
    thread_id: threadId,
    ...(pageToken ? { page_token: pageToken } : {}),
  },
});
const replyAddress = (sender: string | null | undefined) => {
  const from = sender?.trim() ?? "";
  const address = /<([^<>]+)>$/u.exec(from)?.[1] ?? from;
  return /^[^\s@<>,;]+@[^\s@<>,;]+$/u.test(address) ? address : null;
};

type Caller = McpInvocationContext["Service"];
type ReplyToApprove = GmailReplyDraft & {
  readonly accountId: string;
  readonly messageId: string;
};
type InboxCheck = {
  readonly accountId: string;
  readonly candidates: ReadonlyArray<{
    readonly gmailThreadId: string;
    readonly messageId: string;
    readonly subject: string;
    readonly sender: string;
    readonly preview: string;
  }>;
  readonly nextPageToken: string | null;
};

export class GmailWorkspace extends Context.Service<
  GmailWorkspace,
  {
    readonly save: (
      caller: Caller,
      layout: GmailWorkspaceLayout,
    ) => Effect.Effect<GmailWorkspaceLayout, ProjectToolError>;
    readonly layout: (
      target: GmailWorkspaceTarget,
    ) => Effect.Effect<GmailWorkspaceLayout | null, ProjectToolError>;
    readonly inbox: (input: GmailInboxInput) => Effect.Effect<GmailInboxPage, ProjectToolError>;
    readonly thread: (input: GmailThreadInput) => Effect.Effect<GmailThreadPage, ProjectToolError>;
    readonly check: (
      caller: Caller,
      pageToken?: string,
    ) => Effect.Effect<InboxCheck, ProjectToolError>;
    readonly record: (
      caller: Caller,
      decision: typeof GmailInboxDecision.Type,
    ) => Effect.Effect<{ readonly recorded: boolean }, ProjectToolError>;
    readonly updateDraft: (
      input: GmailDraftUpdateInput,
    ) => Effect.Effect<GmailReplyDraft, ProjectToolError>;
    readonly approveDraft: (
      approvalSessionId: AuthSessionId,
      input: GmailDraftApprovalInput,
    ) => Effect.Effect<GmailReplyDeliveryStatus, ProjectToolError>;
  }
>()("@t3tools/tasks-server/gmailWorkspace/GmailWorkspace") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* ProjectTools;
  const uuid = (yield* SecureRandom.SecureRandom).uuidV4();

  const layout = Effect.fn("GmailWorkspace.layout")(function* (target: GmailWorkspaceTarget) {
    yield* tools.confirmBotChat(target);
    const [saved] = yield* sql<{ readonly json: string }>`SELECT layout_json AS json
      FROM gmail_workspaces WHERE project_id = ${target.projectId} AND bot_id = ${target.botId}`.pipe(
      Effect.mapError(storageError),
    );
    return saved ? yield* decodeLayout(saved.json).pipe(Effect.mapError(storageError)) : null;
  });
  const requireLayout = Effect.fn("GmailWorkspace.requireLayout")(function* (
    target: GmailWorkspaceTarget,
  ) {
    if ((yield* layout(target)) === null) {
      return yield* new ProjectToolError({ code: "workspace-unavailable" });
    }
  });

  const readInbox = Effect.fn("GmailWorkspace.readInbox")(function* (
    caller: Caller | GmailWorkspaceTarget,
    pageToken?: string,
  ) {
    const { data, accountId } = yield* tools.readConnectedBotAction(
      caller,
      "gmail",
      inboxAction(pageToken),
    );
    const page = yield* decodeInbox(data).pipe(Effect.mapError(invalidResponse));
    return {
      accountId,
      messages: (page.messages ?? []).toSorted((a, b) => messageTime(b) - messageTime(a)),
      nextPageToken: nextPage(page.nextPageToken, pageToken),
    };
  });

  const readThread = Effect.fn("GmailWorkspace.readThread")(function* (
    caller: Caller | GmailWorkspaceTarget,
    threadId: string,
    pageToken?: string,
    expectedAccountId?: string,
  ) {
    const { data, accountId, accountLabel } = yield* tools.readConnectedBotAction(
      caller,
      "gmail",
      threadAction(threadId, pageToken),
      expectedAccountId,
    );
    const page = yield* decodeThread(data).pipe(Effect.mapError(invalidResponse));
    if (
      !page.messages ||
      page.messages.some(
        (message) => message.threadId !== undefined && message.threadId !== threadId,
      )
    ) {
      return yield* new ProjectToolError({ code: "composio-unavailable" });
    }
    return {
      accountId,
      accountLabel,
      messages: page.messages.toSorted((a, b) => messageTime(a) - messageTime(b)),
      nextPageToken: page.nextPageToken || null,
    };
  });

  const draftColumns = sql`draft.id, draft.status, draft.revision, draft.recipient, draft.body,
    attempt.status AS "deliveryStatus"`;
  const draftWithAttempt = sql`gmail_workspace_replies AS draft
    LEFT JOIN gmail_workspace_reply_attempts AS attempt
      ON attempt.draft_id = draft.id AND attempt.revision = draft.revision`;
  const replySource = Effect.fn("GmailWorkspace.replySource")(function* (
    caller: Caller | GmailWorkspaceTarget,
    { accountId, gmailThreadId, messageId, body }: typeof GmailInboxDecision.Type,
  ) {
    const seenTokens = new Set<string>();
    let token: string | undefined;
    let message: typeof gmailMessage.Type | undefined;
    let latest: typeof gmailMessage.Type | undefined;
    while (true) {
      const page = yield* readThread(caller, gmailThreadId, token, accountId);
      message ??= page.messages.find((mail) => mail.messageId === messageId);
      const newest = page.messages.findLast((mail) => !mail.labelIds?.includes("DRAFT"));
      if (newest && (!latest || messageTime(newest) >= messageTime(latest))) latest = newest;
      if ((message && body === null) || page.nextPageToken === null) break;
      if (seenTokens.has(page.nextPageToken)) return yield* invalidResponse("Repeated Gmail page");
      seenTokens.add(page.nextPageToken);
      token = page.nextPageToken;
    }
    if (
      !message?.labelIds?.includes("INBOX") ||
      message.labelIds.includes("SENT") ||
      (body !== null && latest?.messageId !== message.messageId)
    ) {
      return yield* new ProjectToolError({ code: "workspace-message-changed" });
    }
    return message;
  });

  const loadReplyToApprove = Effect.fn("GmailWorkspace.loadReplyToApprove")(function* (
    input: GmailDraftApprovalInput,
  ) {
    const [draft] = yield* sql<ReplyToApprove>`
      SELECT ${draftColumns}, draft.account_id AS "accountId", draft.gmail_message_id AS "messageId"
      FROM ${draftWithAttempt}
      WHERE draft.id = ${input.draftId} AND draft.project_id = ${input.projectId}
        AND draft.bot_id = ${input.botId} AND draft.gmail_thread_id = ${input.gmailThreadId}
        AND draft.status = 'pending' AND draft.revision = ${input.revision}
    `.pipe(Effect.mapError(storageError));
    if (!draft) return yield* new ProjectToolError({ code: "workspace-draft-changed" });
    return draft;
  });

  return GmailWorkspace.of({
    layout,
    save: Effect.fn("GmailWorkspace.save")(function* (scope, nextLayout) {
      const owner = yield* tools.confirmCaller(scope);
      if (owner.threadId !== scope.thread?.threadId) {
        return yield* new ProjectToolError({ code: "not-a-bot" });
      }
      if (owner.plan) return yield* new ProjectToolError({ code: "plan-mode" });
      const json = yield* encodeLayout(nextLayout).pipe(Effect.mapError(storageError));
      yield* sql`INSERT INTO gmail_workspaces (project_id, bot_id, layout_json)
        VALUES (${owner.projectId}, ${owner.botId}, ${json})
        ON CONFLICT (project_id, bot_id) DO UPDATE SET layout_json = excluded.layout_json`.pipe(
        Effect.mapError(storageError),
      );
      return nextLayout;
    }),
    inbox: Effect.fn("GmailWorkspace.inbox")(function* (input) {
      yield* requireLayout(input);
      const page = yield* readInbox(input, input.pageToken);
      const threads = new Map<string, GmailInboxPage["threads"][number]>();
      for (const message of page.messages) {
        const { threadId } = message;
        const existing = threads.get(threadId);
        const unread = message.labelIds?.includes("UNREAD") === true;
        if (existing) {
          if (unread && !existing.unread) threads.set(threadId, { ...existing, unread });
          continue;
        }
        threads.set(threadId, {
          threadId,
          subject: message.subject ?? "",
          sender: message.sender ?? "",
          preview: previewText(message),
          unread,
        });
      }
      const pending = new Set<string>();
      if (threads.size > 0) {
        const rows = yield* sql<{ readonly threadId: string }>`
          SELECT DISTINCT gmail_thread_id AS "threadId" FROM gmail_workspace_replies
          WHERE project_id = ${input.projectId} AND bot_id = ${input.botId}
            AND account_id = ${page.accountId} AND status = 'pending'
            AND ${sql.in("gmail_thread_id", [...threads.keys()])}
            AND NOT EXISTS (
              SELECT 1 FROM gmail_workspace_reply_attempts AS attempt
              WHERE attempt.draft_id = gmail_workspace_replies.id
                AND attempt.revision = gmail_workspace_replies.revision
            )
        `.pipe(Effect.mapError(storageError));
        for (const row of rows) pending.add(row.threadId);
      }
      return {
        threads: [...threads.values()].map((thread) =>
          pending.has(thread.threadId) ? { ...thread, pendingReply: true as const } : thread,
        ),
        nextPageToken: page.nextPageToken,
      };
    }),
    thread: Effect.fn("GmailWorkspace.thread")(function* (input) {
      yield* requireLayout(input);
      const page = yield* readThread(input, input.gmailThreadId, input.pageToken);
      const { accountId, accountLabel: sendingAccount, messages } = page;
      const nextPageToken = nextPage(page.nextPageToken, input.pageToken);
      if (messages.length === 0) return { sendingAccount, messages: [], nextPageToken };
      const rows = yield* sql<GmailReplyDraft & { readonly messageId: string }>`
        SELECT ${draftColumns}, draft.gmail_message_id AS "messageId"
        FROM ${draftWithAttempt}
        WHERE draft.project_id = ${input.projectId} AND draft.bot_id = ${input.botId}
          AND draft.account_id = ${accountId} AND draft.gmail_thread_id = ${input.gmailThreadId}
          AND draft.status <> 'skipped'
          AND draft.gmail_message_id IN ${sql.in(messages.map((mail) => mail.messageId))}
      `.pipe(Effect.mapError(storageError));
      const drafts = new Map(rows.map(({ messageId, ...draft }) => [messageId, draft]));
      return {
        sendingAccount,
        messages: messages.map((message) => {
          const draft = drafts.get(message.messageId);
          return {
            messageId: message.messageId,
            subject: message.subject ?? "",
            sender: message.sender ?? "",
            receivedAt: message.messageTimestamp ?? "",
            body: message.messageText || previewText(message),
            ...(draft === undefined ? {} : { draft }),
          };
        }),
        nextPageToken,
      };
    }),
    check: Effect.fn("GmailWorkspace.check")(function* (caller, pageToken) {
      const owner = yield* tools.confirmCaller(caller);
      yield* requireLayout(owner);
      const { accountId, messages, nextPageToken } = yield* readInbox(caller, pageToken);
      if ((yield* tools.confirmCaller(caller)).runId !== owner.runId) {
        return yield* new ProjectToolError({ code: "policy-changed" });
      }
      const newest = new Map<string, (typeof gmailInboxMessage)["Type"]>();
      for (const message of messages) {
        if (!newest.has(message.threadId)) newest.set(message.threadId, message);
      }
      if (newest.size === 0) return { accountId, candidates: [], nextPageToken };
      const recorded = yield* sql<{ readonly messageId: string }>`
        SELECT gmail_message_id AS "messageId" FROM gmail_workspace_replies
        WHERE project_id = ${owner.projectId} AND bot_id = ${owner.botId}
          AND account_id = ${accountId}
          AND ${sql.in(
            "gmail_message_id",
            [...newest.values()].map((mail) => mail.messageId),
          )}
      `.pipe(Effect.mapError(storageError));
      const reviewed = new Set(recorded.map(({ messageId }) => messageId));
      const candidates = [...newest.values()]
        .filter(({ messageId }) => !reviewed.has(messageId))
        .map((mail) => ({
          gmailThreadId: mail.threadId,
          messageId: mail.messageId,
          subject: (mail.subject ?? "").slice(0, 256),
          sender: (mail.sender ?? "").slice(0, 256),
          preview: previewText(mail).slice(0, 1_000),
        }));
      return { accountId, candidates, nextPageToken };
    }),
    record: Effect.fn("GmailWorkspace.record")(function* (caller, decision) {
      const owner = yield* tools.confirmCaller(caller);
      if (owner.plan) return yield* new ProjectToolError({ code: "plan-mode" });
      yield* requireLayout(owner);
      const message = yield* replySource(caller, decision);
      const { accountId, gmailThreadId, messageId, body } = decision;
      const recipient = body === null ? null : replyAddress(message.sender);
      if (body !== null && recipient === null) {
        return yield* new ProjectToolError({ code: "workspace-recipient-unavailable" });
      }
      return yield* tools.withConnectedBotReadAccess(
        caller,
        "gmail",
        [inboxAction(), threadAction(gmailThreadId)],
        (currentAccountId) =>
          Effect.gen(function* () {
            const current = yield* tools.confirmCaller(caller);
            if (current.runId !== owner.runId || current.plan) {
              return yield* new ProjectToolError({ code: "policy-changed" });
            }
            if (currentAccountId !== accountId) {
              return yield* new ProjectToolError({ code: "workspace-account-changed" });
            }
            const id = yield* uuid;
            const rows = yield* sql`INSERT INTO gmail_workspace_replies (
              id, project_id, bot_id, account_id, gmail_thread_id, gmail_message_id,
              status, recipient, body
            )
            VALUES (${id}, ${owner.projectId}, ${owner.botId}, ${accountId},
              ${gmailThreadId}, ${messageId}, ${body === null ? "skipped" : "pending"}, ${recipient}, ${body})
            ON CONFLICT (project_id, bot_id, account_id, gmail_message_id) DO NOTHING
            RETURNING id`.pipe(Effect.mapError(storageError));
            return { recorded: rows.length > 0 };
          }),
      );
    }),
    updateDraft: Effect.fn("GmailWorkspace.updateDraft")(function* (input) {
      yield* requireLayout(input);
      const currentStatus = input.change.kind === "restore" ? "dismissed" : "pending";
      const change =
        input.change.kind === "edit"
          ? sql`body = ${input.change.body}`
          : sql`status = ${currentStatus === "dismissed" ? "pending" : "dismissed"}`;
      return yield* tools.withConnectedBotReadAccess(
        input,
        "gmail",
        [threadAction(input.gmailThreadId)],
        (accountId) =>
          Effect.gen(function* () {
            const [draft] = yield* sql<GmailReplyDraft>`
              UPDATE gmail_workspace_replies
              SET ${change}, revision = revision + 1
              WHERE id = ${input.draftId} AND project_id = ${input.projectId} AND bot_id = ${input.botId}
                AND account_id = ${accountId} AND gmail_thread_id = ${input.gmailThreadId}
                AND status = ${currentStatus} AND revision = ${input.revision}
                AND NOT EXISTS (
                  SELECT 1 FROM gmail_workspace_reply_attempts AS attempt
                  WHERE attempt.draft_id = gmail_workspace_replies.id
                    AND attempt.revision = gmail_workspace_replies.revision
                    AND (attempt.status <> 'failed' OR ${input.change.kind} <> 'edit')
                )
              RETURNING id, status, revision, recipient, body
            `.pipe(Effect.mapError(storageError));
            if (!draft) return yield* new ProjectToolError({ code: "workspace-draft-changed" });
            return draft;
          }),
      );
    }),
    approveDraft: Effect.fn("GmailWorkspace.approveDraft")(function* (approvalSessionId, input) {
      yield* requireLayout(input);
      const draft = yield* loadReplyToApprove(input);
      if (draft.deliveryStatus) return draft.deliveryStatus;
      const { accountId, messageId, body, recipient } = draft;
      const { gmailThreadId } = input;
      const source = yield* replySource(input, { accountId, gmailThreadId, messageId, body });
      if (replyAddress(source.sender) !== recipient) {
        return yield* new ProjectToolError({ code: "workspace-message-changed" });
      }
      return yield* tools.sendApprovedGmailReply(
        input,
        { accountId, gmailThreadId, body, recipient },
        Effect.fn("GmailWorkspace.attemptReply")(function* (execute) {
          // An interrupted or unconfirmed send keeps this claim and cannot be retried.
          const [claim] = yield* sql`
            INSERT INTO gmail_workspace_reply_attempts (draft_id, revision, approval_session_id, status)
            SELECT id, revision, ${approvalSessionId}, 'uncertain'
            FROM gmail_workspace_replies
            WHERE id = ${draft.id} AND revision = ${draft.revision} AND status = 'pending'
            ON CONFLICT (draft_id, revision) DO NOTHING
            RETURNING draft_id
          `.pipe(Effect.mapError(storageError));
          if (!claim) {
            const current = yield* loadReplyToApprove(input);
            if (current.deliveryStatus) return current.deliveryStatus;
            return yield* new ProjectToolError({ code: "workspace-draft-changed" });
          }
          const outcome = yield* Effect.match(execute, {
            onSuccess: (data) => {
              const receipt = Option.getOrUndefined(decodeSendReceipt(data));
              const message =
                receipt && ("response_data" in receipt ? receipt.response_data : receipt);
              return message?.threadId === gmailThreadId
                ? ({ status: "sent", messageId: message.id } as const)
                : ({ status: "uncertain", messageId: null } as const);
            },
            onFailure: ({ code, status }) => ({
              status:
                code === "action-outcome-unknown" || code === "action-failed" || status === 408
                  ? ("uncertain" as const)
                  : ("failed" as const),
              messageId: null,
            }),
          });
          if (outcome.status !== "uncertain") {
            yield* sql`UPDATE gmail_workspace_reply_attempts
              SET status = ${outcome.status}, gmail_message_id = ${outcome.messageId}
              WHERE draft_id = ${draft.id} AND revision = ${draft.revision}
            `.pipe(Effect.mapError(storageError));
          }
          return outcome.status;
        }),
      );
    }),
  });
});

export const layer = Layer.effect(GmailWorkspace, make);
