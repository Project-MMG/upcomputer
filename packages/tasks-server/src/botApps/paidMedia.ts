import type { PaidMediaSnapshot } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { McpInvocationContext } from "../../../../apps/server/src/extensionApi.ts";
import type { ProjectTools } from "../projectTools/ProjectTools.ts";
import { googleAdsSource, readGoogleAds } from "./googleAds.ts";
import { metaAdsSource, readMetaAds } from "./metaAds.ts";

export function paidMediaSources({ source, proposedChange }: PaidMediaSnapshot["definition"]) {
  return {
    google: googleAdsSource(source, proposedChange.campaignId),
    meta: metaAdsSource(source),
  };
}

export const capturePaidMediaReport = Effect.fn("BotApps.capturePaidMediaReport")(function* (
  tools: ProjectTools["Service"],
  caller: McpInvocationContext["Service"],
  definition: PaidMediaSnapshot["definition"],
) {
  const { source, proposedChange } = definition;
  const sources = paidMediaSources(definition);
  const accountIds = yield* tools.withConnectedBotReadSources(caller, sources, Effect.succeed);
  const google = sources.google;
  const meta = sources.meta;
  const [totals, googleCreative, budget] = google.inputs;
  const [insights, metaCreative] = meta.inputs;
  const [googleTotals, googleAds, googleBudget, metaInsights, metaAds] = yield* Effect.all(
    [
      tools.readConnectedBotAction(caller, google.app, totals, accountIds.google),
      tools.readConnectedBotAction(caller, google.app, googleCreative, accountIds.google),
      tools.readConnectedBotAction(caller, google.app, budget, accountIds.google),
      tools.readConnectedBotAction(caller, meta.app, insights, accountIds.meta),
      tools.readConnectedBotAction(caller, meta.app, metaCreative, accountIds.meta),
    ],
    { concurrency: 2 },
  );
  const googleReport = yield* readGoogleAds(
    source.googleCustomerId,
    proposedChange.campaignId,
    proposedChange.dailyBudgetMicros,
    googleTotals.accountLabel,
    [googleTotals.data, googleAds.data, googleBudget.data],
  );
  const metaReport = yield* readMetaAds(source, metaInsights.accountLabel, [
    metaInsights.data,
    metaAds.data,
  ]);

  return {
    accountIds,
    report: {
      ...googleReport,
      meta: metaReport,
      readAt: DateTime.formatIso(yield* DateTime.now),
    },
  };
});
