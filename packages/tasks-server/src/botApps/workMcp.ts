import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { BotSetupProposalInput } from "@t3tools/tasks-contracts/v1";
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
    const work = yield* BotWork.BotWork;
    return {
      bot_setup_propose: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) =>
          work.propose(caller, input).pipe(
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
          ),
        ),
      ),
    };
  }),
);

export const layer = resultToolkitRegistration(toolkit, handlers);
