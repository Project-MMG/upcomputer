import type * as Schema from "effect/Schema";

export const googleAdsApp = {
  slug: "googleads",
  name: "Google Ads",
  no_auth: false,
  composio_managed_auth: [{ managed_app_id: "fixture-google-ads" }],
};
export const metaAdsApp = {
  slug: "metaads",
  name: "Meta Ads",
  no_auth: false,
  composio_managed_auth: [{ managed_app_id: "fixture-meta-ads" }],
};

const action = (
  app: typeof googleAdsApp | typeof metaAdsApp,
  slug: string,
  name: string,
  properties: Schema.JsonObject,
  required: string[],
) => ({
  slug,
  name,
  toolkit: { slug: app.slug, name: app.name },
  tags: ["readOnlyHint"],
  no_auth: false,
  input_parameters: { type: "object", properties, required, additionalProperties: false },
});
const string = { type: "string" };
const integer = { type: "integer" };
export const googleAdsSearch = action(
  googleAdsApp,
  "GOOGLEADS_SEARCH_GAQL",
  "Search GAQL",
  { customer_id: string, query: string },
  ["query"],
);
export const metaAdsInsights = action(
  metaAdsApp,
  "METAADS_GET_INSIGHTS",
  "Get Insights",
  {
    object_id: string,
    fields: string,
    level: { enum: ["account", "campaign", "adset", "ad"] },
    time_range: { type: "object", properties: { since: string, until: string } },
    time_increment: string,
    limit: integer,
  },
  ["object_id"],
);
export const metaAdsCreatives = action(
  metaAdsApp,
  "METAADS_LIST_AD_CREATIVES",
  "List Ad Creatives",
  { ad_account_id: string, fields: string, limit: integer },
  ["ad_account_id"],
);

export const paidMediaProposal = {
  title: "Paid Media",
  source: {
    googleCustomerId: "1".repeat(10),
    metaAdAccountId: "act_" + "2".repeat(12),
    metaConversionAction: "offsite_conversion.fb_pixel_purchase",
    window: { start: "2026-10-01", end: "2026-10-14" },
  },
  proposedChange: {
    campaignId: "3".repeat(8),
    dailyBudgetMicros: 60_000_000,
    reason: "Test a smaller budget on the core search campaign for one week.",
    measurement: "Compare completed orders and cost per order with the preceding week.",
  },
};

export function paidMediaActionData(
  slug: string,
  args: Schema.JsonObject,
  { proposal = paidMediaProposal, sharedBudget = false, includeMetaConversion = true } = {},
): Schema.Json | undefined {
  const { source, proposedChange } = proposal;
  const googleCustomer = { id: source.googleCustomerId };
  const metaAccountId = source.metaAdAccountId.slice(4);
  if (slug === googleAdsSearch.slug && typeof args.query === "string") {
    if (args.query.includes(" FROM customer ")) {
      return {
        successful: true,
        data: JSON.stringify({
          results: [
            {
              customer: {
                ...googleCustomer,
                descriptiveName: "Workshop Search",
                currencyCode: "USD",
              },
              metrics: { costMicros: "1234500000", conversions: 42.5 },
            },
          ],
        }),
      };
    }
    if (args.query.includes(" FROM ad_group_ad ")) {
      return {
        results: [
          {
            customer: googleCustomer,
            adGroupAd: {
              ad: {
                id: "101",
                name: "Search • Everyday collection",
                responsiveSearchAd: { headlines: [{ text: "Tools for everyday projects" }] },
              },
            },
          },
        ],
      };
    }
    if (args.query.includes(" FROM campaign ")) {
      return {
        successful: true,
        data: {
          results: [
            {
              customer: googleCustomer,
              campaign: { id: proposedChange.campaignId, name: "Core search campaign" },
              campaignBudget: {
                amountMicros: "75000000",
                period: "DAILY",
                explicitlyShared: sharedBudget,
              },
            },
          ],
        },
      };
    }
  }
  if (slug === metaAdsInsights.slug) {
    return {
      successful: true,
      data: {
        data: [
          {
            account_id: metaAccountId,
            account_name: "Workshop Social",
            account_currency: "EUR",
            date_start: source.window.start,
            date_stop: source.window.end,
            spend: "842.10",
            actions: [
              { action_type: "link_click", value: "200" },
              { action_type: "purchase", value: "19" },
              ...(includeMetaConversion
                ? [{ action_type: source.metaConversionAction, value: "17" }]
                : []),
            ],
          },
        ],
      },
    };
  }
  if (slug === metaAdsCreatives.slug) {
    return {
      successful: true,
      data: JSON.stringify({
        data: [
          {
            id: "202",
            account_id: metaAccountId,
            name: "Instagram • Weekend project",
            title: "Make something this weekend",
            body: "Explore the workshop collection.",
          },
        ],
        paging: { next: "https://example.test/next" },
      }),
    };
  }
}
