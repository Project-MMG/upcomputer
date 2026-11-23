import {
  BotAppError,
  PAID_MEDIA_CREATIVE_LIMIT,
  type PaidMediaSource,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { adAmount, adCurrency, adResourceId, readPaidMediaResponse } from "./paidMediaResponse.ts";

export function googleAdsSource({ googleCustomerId, window }: PaidMediaSource, campaignId: string) {
  const account = { customer_id: googleCustomerId };
  const search = (query: string) => ({
    slug: "GOOGLEADS_SEARCH_GAQL",
    requiredFixedInputs: account,
    arguments: { ...account, query },
  });
  const dates = "segments.date BETWEEN '" + window.start + "' AND '" + window.end + "'";
  return {
    app: "googleads",
    inputs: [
      search(
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, " +
          "metrics.cost_micros, metrics.conversions FROM customer WHERE " +
          dates +
          " LIMIT 1",
      ),
      search(
        "SELECT customer.id, ad_group_ad.ad.id, ad_group_ad.ad.name, " +
          "ad_group_ad.ad.responsive_search_ad.headlines, metrics.cost_micros " +
          "FROM ad_group_ad WHERE " +
          dates +
          " ORDER BY metrics.cost_micros DESC LIMIT " +
          PAID_MEDIA_CREATIVE_LIMIT,
      ),
      search(
        "SELECT customer.id, campaign.id, campaign.name, campaign_budget.amount_micros, " +
          "campaign_budget.period, campaign_budget.explicitly_shared FROM campaign " +
          "WHERE campaign.id = " +
          campaignId +
          " AND campaign_budget.period = 'DAILY' AND campaign_budget.explicitly_shared = FALSE LIMIT 1",
      ),
    ],
  } as const;
}

const customer = { id: Schema.String.check(Schema.isPattern(/^[0-9]{10}$/)) };
const googleResults = <S extends Schema.Constraint>(row: S, limit: number) =>
  Schema.Struct({
    results: Schema.optionalKey(Schema.Array(row).check(Schema.isMaxLength(limit))),
    nextPageToken: Schema.optionalKey(Schema.Literal("")),
    error: Schema.optionalKey(Schema.Never),
  });
const totalsPayload = googleResults(
  Schema.Struct({
    customer: Schema.Struct({
      ...customer,
      descriptiveName: Schema.optionalKey(Schema.String),
      currencyCode: adCurrency,
    }),
    metrics: Schema.optionalKey(
      Schema.Struct({
        costMicros: Schema.optionalKey(adAmount),
        conversions: Schema.optionalKey(adAmount),
      }),
    ),
  }),
  1,
);
const creativePayload = googleResults(
  Schema.Struct({
    customer: Schema.Struct(customer),
    adGroupAd: Schema.Struct({
      ad: Schema.Struct({
        id: adResourceId,
        name: Schema.optionalKey(Schema.String),
        responsiveSearchAd: Schema.optionalKey(
          Schema.Struct({
            headlines: Schema.optionalKey(Schema.Array(Schema.Struct({ text: Schema.String }))),
          }),
        ),
      }),
    }),
  }),
  PAID_MEDIA_CREATIVE_LIMIT,
);
const campaignPayload = googleResults(
  Schema.Struct({
    customer: Schema.Struct(customer),
    campaign: Schema.Struct({ id: adResourceId, name: Schema.NonEmptyString }),
    campaignBudget: Schema.Struct({
      amountMicros: adAmount.check(
        Schema.isInt(),
        Schema.isGreaterThan(0),
        Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
      ),
      period: Schema.Literal("DAILY"),
      explicitlyShared: Schema.optionalKey(Schema.Boolean),
    }),
  }),
  1,
);

export const readGoogleAds = Effect.fn("BotApps.readGoogleAds")(function* (
  customerId: string,
  campaignId: string,
  proposedMicros: number,
  accountLabel: string,
  [totals, creatives, budget]: readonly [Schema.Json, Schema.Json, Schema.Json],
) {
  const summary = (yield* readPaidMediaResponse(totalsPayload, totals)).results?.[0];
  if (!summary) return yield* new BotAppError({ code: "paid-media-report-invalid" });

  const creative = (yield* readPaidMediaResponse(creativePayload, creatives)).results ?? [];
  const campaign = (yield* readPaidMediaResponse(campaignPayload, budget)).results?.[0];
  if (
    summary.customer.id !== customerId ||
    creative.some((row) => row.customer.id !== customerId) ||
    (campaign && (campaign.customer.id !== customerId || campaign.campaign.id !== campaignId))
  ) {
    return yield* new BotAppError({ code: "paid-media-source-mismatch" });
  }
  if (!campaign || campaign.campaignBudget.explicitlyShared) {
    return yield* new BotAppError({ code: "paid-media-budget-unavailable" });
  }
  if (campaign.campaignBudget.amountMicros === proposedMicros) {
    return yield* new BotAppError({ code: "paid-media-budget-unchanged" });
  }

  return {
    google: {
      accountName: (summary.customer.descriptiveName?.trim() || accountLabel).slice(0, 200),
      currency: summary.customer.currencyCode,
      spend: (summary.metrics?.costMicros ?? 0) / 1_000_000,
      conversions: summary.metrics?.conversions ?? 0,
      creative: [...new Map(creative.map(({ adGroupAd: { ad } }) => [ad.id, ad])).values()].map(
        (ad) => ({
          id: ad.id,
          label: ad.name?.trim().slice(0, 200) || ad.id,
          text: (ad.responsiveSearchAd?.headlines ?? [])
            .slice(0, 3)
            .map(({ text }) => text.trim())
            .filter(Boolean)
            .join(" · ")
            .slice(0, 240),
        }),
      ),
    },
    campaignName: campaign.campaign.name.trim().slice(0, 200) || campaign.campaign.id,
    currentDailyBudgetMicros: campaign.campaignBudget.amountMicros,
  };
});
