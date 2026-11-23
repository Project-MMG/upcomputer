import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  PaidMediaProposalInput,
  ShopifyStoreProposalInput,
  BotAppProposalInput,
  SocialCalendarProposalInput,
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
  Tool.make("bot_app_get_shopify_catalog_follow_ups", {
    description:
      "Read the catalog follow-ups from this bot's approved Shopify store app. When asked to assign a catalog follow-up, find the receiving bot through task_context and create one internal task using only the returned product, outcome and source link.",
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, inThread)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_app_propose_shopify_store", {
    description:
      "Propose a Shopify Store operations app for this bot. Supply the permanent myshopify.com domain of the assigned store. Up.computer reads a bounded catalog, inventory and fulfillment sample through the assigned read-only action. To replace a pending proposal, read it and supply its current revision as replacesRevision.",
    parameters: ShopifyStoreProposalInput,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(McpSchema.EnabledWhen, inThread)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
  Tool.make("bot_app_propose_paid_media", {
    description:
      "Propose a Paid Media app with reports for the bot's assigned Google Ads and Meta Ads accounts. Use the Google customer ID and act_-prefixed Meta ad account ID fixed on the read grants, an inclusive date window, and the exact Meta action type to count. Supply a Google Ads campaign ID, proposed daily budget in millionths of its account currency, reason, and a plan to measure the outcome. Up.computer checks the campaign's own daily budget. This saves a proposal for review. To replace a pending proposal, supply its current revision as replacesRevision.",
    parameters: PaidMediaProposalInput,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(McpSchema.EnabledWhen, inThread)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
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
  Tool.make("bot_app_propose_social_calendar", {
    description:
      "Propose a Social calendar for this bot. Use the project’s content plan, brand voice, and one approved asset with its approval source and timestamp. Supply one caption, destination, and proposed UTC publish time for each selected channel. Use Postiz integration IDs from the bot’s assigned read, or label local destinations when unavailable. This saves a package for review. To revise captions, read the pending proposal and supply its current revision as replacesRevision.",
    parameters: SocialCalendarProposalInput,
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
      bot_app_get_shopify_catalog_follow_ups: McpToolAccess.actsAsCaller(() =>
        Effect.flatMap(McpInvocationContext, (caller) => result(apps.shopifyCatalog(caller))),
      ),
      bot_app_propose_shopify_store: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) =>
          result(apps.propose(caller, { ...input, kind: "shopify-store" })),
        ),
      ),
      bot_app_propose_paid_media: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) =>
          result(apps.propose(caller, { ...input, kind: "paid-media" })),
        ),
      ),
      bot_app_get_proposal: McpToolAccess.actsAsCaller(() =>
        Effect.flatMap(McpInvocationContext, (caller) => result(apps.proposal(caller))),
      ),
      bot_app_propose: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) => result(apps.propose(caller, input))),
      ),
      bot_app_propose_social_calendar: McpToolAccess.actsAsCaller((input) =>
        Effect.flatMap(McpInvocationContext, (caller) =>
          result(apps.propose(caller, { ...input, kind: "social-calendar" })),
        ),
      ),
    };
  }),
);

export const layer = resultToolkitRegistration(toolkit, handlers);
