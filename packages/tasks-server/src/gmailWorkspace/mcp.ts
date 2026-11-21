import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { GmailWorkspaceLayout } from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import {
  McpInvocationContext,
  McpToolAccess,
  resultToolkitRegistration,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { GmailWorkspace } from "./GmailWorkspace.ts";

const toolkit = Toolkit.make(
  Tool.make("gmail_workspace_save", {
    description:
      "Save or replace the Gmail workspace for this bot's permanent chat. Set its title and choose inbox-first or thread-first to place the inbox list and thread reader. The user can open Gmail inbox beside this chat.",
    parameters: GmailWorkspaceLayout,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Idempotent, true)
    .annotate(McpSchema.EnabledWhen, () => {
      const fiber = Fiber.getCurrent();
      const thread = fiber && Context.getOrUndefined(fiber.context, McpInvocationContext)?.thread;
      return thread !== undefined && !thread.subagent;
    })
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
);

const handlers = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const workspace = yield* GmailWorkspace;
    return {
      gmail_workspace_save: McpToolAccess.actsAsCaller((layout) =>
        Effect.flatMap(McpInvocationContext, (caller) => workspace.save(caller, layout)).pipe(
          Effect.match({
            onFailure: (error) =>
              new McpSchema.CallToolResult({
                isError: true,
                content: [{ type: "text", text: error.message }],
                structuredContent: { code: error.code },
              }),
            onSuccess: (saved) =>
              new McpSchema.CallToolResult({
                content: [{ type: "text", text: JSON.stringify(saved) }],
              }),
          }),
        ),
      ),
    };
  }),
);

export const layer = resultToolkitRegistration(toolkit, handlers);
