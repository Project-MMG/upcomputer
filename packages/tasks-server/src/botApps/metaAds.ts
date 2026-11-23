import {
  BotAppError,
  PAID_MEDIA_CREATIVE_LIMIT,
  type PaidMediaSource,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { adAmount, adCurrency, adResourceId, readPaidMediaResponse } from "./paidMediaResponse.ts";

export function metaAdsSource({ metaAdAccountId, window }: PaidMediaSource) {
  const insightsScope = { object_id: metaAdAccountId };
  const creativeScope = { ad_account_id: metaAdAccountId };
  return {
    app: "metaads",
    inputs: [
      {
        slug: "METAADS_GET_INSIGHTS",
        requiredFixedInputs: insightsScope,
        arguments: {
          ...insightsScope,
          level: "account",
          fields: "account_id,account_name,account_currency,date_start,date_stop,spend,actions",
          time_range: { since: window.start, until: window.end },
          time_increment: "all_days",
          limit: 1,
        },
      },
      {
        slug: "METAADS_LIST_AD_CREATIVES",
        requiredFixedInputs: creativeScope,
        arguments: {
          ...creativeScope,
          fields: "id,account_id,name,title,body",
          limit: PAID_MEDIA_CREATIVE_LIMIT,
        },
      },
    ],
  } as const;
}

const insightsPayload = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      account_id: adResourceId,
      account_name: Schema.optionalKey(Schema.String),
      account_currency: adCurrency,
      date_start: Schema.String,
      date_stop: Schema.String,
      spend: adAmount,
      actions: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            action_type: Schema.String,
            value: Schema.optionalKey(adAmount),
          }),
        ),
      ),
    }),
  ).check(Schema.isMaxLength(1)),
  paging: Schema.optionalKey(Schema.Struct({ next: Schema.optionalKey(Schema.Never) })),
  error: Schema.optionalKey(Schema.Never),
});

const creativePayload = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: adResourceId,
      account_id: adResourceId,
      name: Schema.optionalKey(Schema.String),
      title: Schema.optionalKey(Schema.String),
      body: Schema.optionalKey(Schema.String),
    }),
  ).check(Schema.isMaxLength(PAID_MEDIA_CREATIVE_LIMIT)),
  error: Schema.optionalKey(Schema.Never),
});

export const readMetaAds = Effect.fn("BotApps.readMetaAds")(function* (
  { metaAdAccountId, metaConversionAction, window }: PaidMediaSource,
  accountLabel: string,
  [insights, creatives]: readonly [Schema.Json, Schema.Json],
) {
  const {
    data: [summary],
  } = yield* readPaidMediaResponse(insightsPayload, insights);
  if (!summary || summary.date_start !== window.start || summary.date_stop !== window.end) {
    return yield* new BotAppError({ code: "paid-media-report-invalid" });
  }
  const { data: creative } = yield* readPaidMediaResponse(creativePayload, creatives);
  const id = metaAdAccountId.slice(4);
  if (summary.account_id !== id || creative.some((row) => row.account_id !== id)) {
    return yield* new BotAppError({ code: "paid-media-source-mismatch" });
  }
  const actions =
    summary.actions?.filter((action) => action.action_type === metaConversionAction) ?? [];
  if (actions.length > 1) return yield* new BotAppError({ code: "paid-media-report-invalid" });

  return {
    accountName: (summary.account_name?.trim() || accountLabel).slice(0, 200),
    currency: summary.account_currency,
    spend: summary.spend,
    conversions: actions[0]?.value ?? null,
    creative: creative.map((ad) => ({
      id: ad.id,
      label: ad.name?.trim().slice(0, 200) || ad.id,
      text: [ad.title?.trim(), ad.body?.trim()].filter(Boolean).join(" · ").slice(0, 240),
    })),
  };
});
