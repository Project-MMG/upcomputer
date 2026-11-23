import type * as Schema from "effect/Schema";

export const klaviyoApp = {
  slug: "klaviyo",
  name: "Klaviyo",
  no_auth: false,
  composio_managed_auth: [{ managed_app_id: "fixture-klaviyo" }],
};
const string = { type: "string" };
const strings = { type: "array", items: string };
const id = { id: string };
const timeframe = {
  type: "object",
  properties: { start: string, end: string },
  required: ["start", "end"],
};
const values = {
  data__type: string,
  data__attributes__filter: string,
  data__attributes__timeframe: timeframe,
  data__attributes__statistics: strings,
  page_cursor: string,
};
const action = (
  suffix: string,
  name: string,
  properties: Schema.JsonObject,
  required: string[],
) => ({
  slug: `KLAVIYO_${suffix}`,
  name,
  toolkit: { slug: klaviyoApp.slug, name: klaviyoApp.name },
  tags: ["readOnlyHint"],
  no_auth: false,
  input_parameters: { type: "object", properties, required, additionalProperties: false },
});
export const klaviyoGetAccount = action(
  "GET_ACCOUNT",
  "Get Account",
  { ...id, fields__account: strings },
  ["id"],
);
export const klaviyoGetCampaign = action("GET_CAMPAIGN", "Get Campaign", { campaign_id: string }, [
  "campaign_id",
]);
export const klaviyoGetFlow = action("GET_FLOW", "Get Flow", { ...id, include: strings }, ["id"]);
export const klaviyoGetSegment = action(
  "GET_SEGMENT",
  "Get Segment",
  { ...id, fields__segment: strings, additional__fields__segment: strings },
  ["id"],
);
export const klaviyoCampaignValues = action(
  "QUERY_CAMPAIGN_VALUES",
  "Query Campaign Values",
  { ...values, data__attributes__conversion__metric__id: string },
  ["data__attributes__conversion__metric__id"],
);
export const klaviyoFlowValues = action(
  "QUERY_FLOW_VALUES",
  "Query Flow Values",
  { ...values, data__attributes__conversion_metric_id: string },
  ["data__attributes__conversion_metric_id"],
);
export const klaviyoActions = [
  klaviyoGetAccount,
  klaviyoGetCampaign,
  klaviyoGetFlow,
  klaviyoGetSegment,
  klaviyoCampaignValues,
  klaviyoFlowValues,
];

export const lifecycleProposal = {
  title: "Lifecycle planner",
  source: {
    accountId: "fixture-workshop-account",
    record: { kind: "campaign", id: "fixture-autumn-campaign" },
    segmentId: "fixture-repeat-segment",
    conversionMetricId: "fixture-order-metric",
    window: { start: "2026-10-01", end: "2026-10-14" },
  },
  followUp: {
    reason: "Test whether a single project idea earns more clicks than the autumn roundup.",
    consent:
      "Confirm email subscribers only. Exclude suppressed profiles and keep Smart Sending enabled.",
    timing: "Tuesday at 10 a.m. in the recipient’s time zone, one week after the roundup.",
    subject: "One project for the weekend",
    body: "Start with our one-page guide to building a wall shelf. See the tools and materials you’ll need.",
    successMeasure:
      "Compare clicks per 100 deliveries with the roundup after seven days. Track the unsubscribe rate.",
  },
};
export const lifecycleFlowProposal = {
  ...lifecycleProposal,
  source: { ...lifecycleProposal.source, record: { kind: "flow", id: "fixture-welcome-flow" } },
};

export function klaviyoActionData(
  slug: string,
  options: {
    readonly accountId?: string;
    readonly reportId?: string;
    readonly empty?: boolean;
    readonly partial?: boolean;
    readonly optionalConsent?: boolean;
  } = {},
): Schema.Json | undefined {
  const { source } = lifecycleProposal;
  switch (slug) {
    case klaviyoGetAccount.slug:
      return {
        successful: true,
        data: {
          data: {
            type: "account",
            id: options.accountId ?? source.accountId,
            attributes: { timezone: "America/Los_Angeles" },
          },
        },
      };
    case klaviyoGetCampaign.slug:
      return {
        successful: true,
        data: JSON.stringify({
          data: {
            type: "campaign",
            id: source.record.id,
            attributes: {
              name: "Autumn workshop roundup",
              status: "Sent",
              audiences: { included: [source.segmentId], excluded: ["fixture-recent-send"] },
              send_time: "2026-10-06T16:00:00Z",
              send_options: { use_smart_sending: true },
            },
          },
        }),
      };
    case klaviyoGetFlow.slug:
      return {
        data: {
          type: "flow",
          id: lifecycleFlowProposal.source.record.id,
          attributes: { name: "Workshop welcome", status: "Live", trigger_type: "Added to List" },
        },
        included: [
          {
            type: "flow-action",
            attributes: { definition: { type: "time-delay", data: { unit: "days", value: 2 } } },
          },
        ],
      };
    case klaviyoGetSegment.slug: {
      const membership = { type: "profile-property", value: "fixture-only-condition" };
      return {
        data: {
          type: "segment",
          id: source.segmentId,
          attributes: {
            name: "Repeat workshop subscribers",
            profile_count: 1800,
            definition: {
              condition_groups: [
                {
                  conditions: [
                    {
                      type: "profile-marketing-consent",
                      consent: {
                        channel: "email",
                        can_receive_marketing: true,
                        consent_status: { subscription: "subscribed" },
                      },
                    },
                    ...(options.optionalConsent ? [membership] : []),
                  ],
                },
                { conditions: [membership] },
              ],
            },
          },
        },
      };
    }
    case klaviyoCampaignValues.slug:
    case klaviyoFlowValues.slug: {
      const record =
        slug === klaviyoCampaignValues.slug ? source.record : lifecycleFlowProposal.source.record;
      const grouping = { [`${record.kind}_id`]: options.reportId ?? record.id };
      return {
        data: {
          type: `${record.kind}-values-report`,
          attributes: {
            results: options.empty
              ? []
              : [
                  {
                    groupings: {
                      ...grouping,
                      send_channel: "email",
                      [`${record.kind}_message_id`]: "fixture-message-one",
                    },
                    statistics: { delivered: 1200, clicks: 84, unsubscribes: 4 },
                  },
                  {
                    groupings: {
                      ...grouping,
                      send_channel: "email",
                      [`${record.kind}_message_id`]: "fixture-message-two",
                    },
                    statistics: { delivered: 600, clicks: 39, unsubscribes: 2 },
                  },
                  {
                    groupings: { ...grouping, send_channel: "sms" },
                    statistics: { delivered: 999 },
                  },
                ],
          },
        },
        links: { next: options.partial ? "https://example.test/next" : null },
      };
    }
  }
}
