import {
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
  messageId: Schema.NonEmptyString,
  threadId: Schema.optional(GmailThreadId),
  sender: gmailText,
  subject: gmailText,
  preview: gmailText,
  snippet: gmailText,
  messageText: gmailText,
  messageTimestamp: gmailText,
  labelIds: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
});
const decodePage = Schema.decodeUnknownEffect(
  Schema.Struct({
    messages: Schema.optional(Schema.NullOr(Schema.Array(gmailMessage))),
    nextPageToken: Schema.optional(Schema.NullOr(ProjectToolCursor)),
  }),
);
const messageTime = (message: typeof gmailMessage.Type) =>
  Date.parse(message.messageTimestamp ?? "") || 0;
const previewText = (message: typeof gmailMessage.Type) => message.preview ?? message.snippet ?? "";
const nextPage = (next: string | null | undefined, current?: string) =>
  next && next !== current ? next : null;
const invalidResponse = (cause: unknown) =>
  new ProjectToolError({ code: "composio-unavailable", cause });

export class GmailWorkspace extends Context.Service<
  GmailWorkspace,
  {
    readonly save: (
      caller: McpInvocationContext["Service"],
      layout: GmailWorkspaceLayout,
    ) => Effect.Effect<GmailWorkspaceLayout, ProjectToolError>;
    readonly layout: (
      target: GmailWorkspaceTarget,
    ) => Effect.Effect<GmailWorkspaceLayout | null, ProjectToolError>;
    readonly inbox: (input: GmailInboxInput) => Effect.Effect<GmailInboxPage, ProjectToolError>;
    readonly thread: (input: GmailThreadInput) => Effect.Effect<GmailThreadPage, ProjectToolError>;
  }
>()("@t3tools/tasks-server/gmailWorkspace/GmailWorkspace") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* ProjectTools;

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
      const data = yield* tools.readConnectedBotAction(input, "gmail", {
        slug: "GMAIL_FETCH_EMAILS",
        arguments: {
          user_id: "me",
          query: "in:inbox",
          max_results: 30,
          include_payload: false,
          verbose: false,
          ...(input.pageToken ? { page_token: input.pageToken } : {}),
        },
      });
      const page = yield* decodePage(data).pipe(Effect.mapError(invalidResponse));
      const threads = new Map<string, GmailInboxPage["threads"][number]>();
      for (const message of (page.messages ?? []).toSorted(
        (a, b) => messageTime(b) - messageTime(a),
      )) {
        const { threadId } = message;
        if (threadId === undefined)
          return yield* new ProjectToolError({ code: "composio-unavailable" });
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
      return {
        threads: [...threads.values()],
        nextPageToken: nextPage(page.nextPageToken, input.pageToken),
      };
    }),
    thread: Effect.fn("GmailWorkspace.thread")(function* (input) {
      yield* requireLayout(input);
      const data = yield* tools.readConnectedBotAction(input, "gmail", {
        slug: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
        arguments: {
          user_id: "me",
          thread_id: input.gmailThreadId,
          ...(input.pageToken ? { page_token: input.pageToken } : {}),
        },
      });
      const page = yield* decodePage(data).pipe(Effect.mapError(invalidResponse));
      if (
        !page.messages ||
        page.messages.some(
          ({ threadId }) => threadId !== undefined && threadId !== input.gmailThreadId,
        )
      ) {
        return yield* new ProjectToolError({ code: "composio-unavailable" });
      }
      return {
        messages: page.messages
          .toSorted((a, b) => messageTime(a) - messageTime(b))
          .map((message) => ({
            messageId: message.messageId,
            subject: message.subject ?? "",
            sender: message.sender ?? "",
            receivedAt: message.messageTimestamp ?? "",
            body: message.messageText || previewText(message),
          })),
        nextPageToken: nextPage(page.nextPageToken, input.pageToken),
      };
    }),
  });
});

export const layer = Layer.effect(GmailWorkspace, make);
