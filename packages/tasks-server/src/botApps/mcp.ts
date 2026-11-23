import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  BotAppProposalInput,
  type BotAppError,
  type ProjectToolError,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import {
  McpInvocationContext,
  McpToolAccess,
  resultToolkitRegistration,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import * as BotApps from "./BotApps.ts";

const inThread = () => {
  const fiber = Fiber.getCurrent();
  const thread = fiber && Context.getOrUndefined(fiber.context, McpInvocationContext)?.thread;
  return thread !== undefined && !thread.subagent;
};

const toolkit = Toolkit.make(
  Tool.make("bot_app_get_proposal", {
    description:
      "Read this bot’s pending app proposal and operator note. Use its revision when proposing an update.",
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, inThread)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_app_propose", {
    description:
      "Propose a right-pane app for this bot. For a Search Console page report, use the property fixed on the assigned Search Analytics Query action. Supply one page, a report window, and a related fix with a preview link. Up.computer reads the report from the project’s account and saves it for operator review. To update a pending proposal, supply its current revision as replacesRevision.",
    parameters: BotAppProposalInput,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(McpSchema.EnabledWhen, inThread)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
);

const result = (effect: Effect.Effect<Schema.Json, BotAppError | ProjectToolError>) =>
  Effect.match(effect, {
    onFailure: (error) =>
      new McpSchema.CallToolResult({
        isError: true,
        content: [{ type: "text", text: error.message }],
        structuredContent: { code: error.code },
      }),
    onSuccess: (value) =>
      new McpSchema.CallToolResult({
        content: [{ type: "text", text: JSON.stringify(value) }],
      }),
  });

const handlers = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const apps = yield* BotApps.BotApps;
    return {
      bot_app_get_proposal: McpToolAccess.actsAsCaller(() =>
        Effect.flatMap(McpInvocationContext, (caller) => result(apps.proposal(caller))),
      ),
      bot_app_propose: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) => result(apps.propose(caller, input))),
      ),
    };
  }),
);

export const layer = resultToolkitRegistration(toolkit, handlers);
