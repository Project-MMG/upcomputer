import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { BotRetroProposeInput, BotSetupProposalInput } from "@t3tools/tasks-contracts/v1";
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
import * as BotWork from "./BotWork.ts";

function isThreadTurn() {
  const fiber = Fiber.getCurrent();
  const thread = fiber && Context.getOrUndefined(fiber.context, McpInvocationContext)?.thread;
  return thread !== undefined && !thread.subagent;
}

const toolkit = Toolkit.make(
  Tool.make("bot_setup_propose", {
    description:
      "From the coordinating bot’s permanent chat, propose a specialist for this project. Start with the project’s playbook and an existing workstream folder. Include role instructions, skill references, requested action slugs and account labels, and a title for the specialist’s assigned-work app. Use a stable roleKey for the same workstream. Repeated calls report the existing proposal or bot. To replace a rejected proposal, pass its revision as replacesRejectedRevision. The operator reviews setup in the team dashboard and manages tool access separately.",
    parameters: BotSetupProposalInput,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Idempotent, true)
    .annotate(McpSchema.EnabledWhen, isThreadTurn)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_retro_propose", {
    description:
      "Save one retrospective proposal for a completed bot task in this project. Use the team dashboard bot’s chat or its assigned retro task. Use the completed task ID as evidence and name the outcome and one change to instructions, a skill, or a tool grant. Keep customer details in the source app. The operator decides in the team dashboard. Retry with the same evidence to keep the original proposal.",
    parameters: BotRetroProposeInput,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Idempotent, true)
    .annotate(McpSchema.EnabledWhen, isThreadTurn)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
);

function result<A, E extends { code: string; message: string }>(effect: Effect.Effect<A, E>) {
  return effect.pipe(
    Effect.match({
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
    }),
  );
}

const handlers = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const work = yield* BotWork.BotWork;
    return {
      bot_setup_propose: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) => result(work.propose(caller, input))),
      ),
      bot_retro_propose: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) => result(work.retroPropose(caller, input))),
      ),
    };
  }),
);

export const layer = resultToolkitRegistration(toolkit, handlers);
