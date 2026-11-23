import { BotAppError, type LifecycleSource } from "@t3tools/tasks-contracts/v1";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { McpInvocationContext } from "../../../../apps/server/src/extensionApi.ts";
import type { ProjectTools } from "../projectTools/ProjectTools.ts";

const statistics = ["delivered", "clicks", "unsubscribes"] as const;

export function klaviyoSource({
  accountId,
  record,
  segmentId,
  conversionMetricId,
  window,
}: LifecycleSource) {
  const account = { id: accountId };
  const campaign = record.kind === "campaign";
  const recordFilter = `equals(${record.kind}_id,"${record.id}")`;

  return {
    app: "klaviyo",
    inputs: [
      {
        slug: "KLAVIYO_GET_ACCOUNT",
        requiredFixedInputs: account,
        arguments: { ...account, fields__account: ["timezone"] },
      },
      campaign
        ? {
            slug: "KLAVIYO_GET_CAMPAIGN",
            requiredFixedInputs: {},
            arguments: { campaign_id: record.id },
          }
        : {
            slug: "KLAVIYO_GET_FLOW",
            requiredFixedInputs: {},
            arguments: { id: record.id, include: ["flow-actions"] },
          },
      {
        slug: "KLAVIYO_GET_SEGMENT",
        requiredFixedInputs: {},
        arguments: {
          id: segmentId,
          fields__segment: ["name", "definition", "profile_count"],
          additional__fields__segment: ["profile_count"],
        },
      },
      {
        slug: campaign ? "KLAVIYO_QUERY_CAMPAIGN_VALUES" : "KLAVIYO_QUERY_FLOW_VALUES",
        requiredFixedInputs: {},
        arguments: {
          data__type: campaign ? "campaign-values-report" : "flow-values-report",
          data__attributes__filter: campaign
            ? recordFilter
            : `and(${recordFilter},equals(send_channel,"email"))`,
          // Klaviyo interprets the report boundaries in the connected account's time zone.
          data__attributes__timeframe: {
            start: `${window.start}T00:00:00Z`,
            end: `${window.end}T23:59:59.999Z`,
          },
          data__attributes__statistics: statistics,
          ...(campaign
            ? { data__attributes__conversion__metric__id: conversionMetricId }
            : { data__attributes__conversion_metric_id: conversionMetricId }),
        },
      },
    ],
  } as const;
}

const resourceId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/));
const label = Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const isResourceId = Schema.is(resourceId);
const timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/),
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)) || "Expected a send timestamp"),
);
const audienceIds = Schema.Array(resourceId).check(Schema.isMaxLength(100));
const accountPayload = Schema.Struct({
  data: Schema.Struct({
    type: Schema.Literal("account"),
    id: resourceId,
    attributes: Schema.Struct({
      timezone: label.check(
        Schema.makeFilter(
          (value) =>
            Option.isSome(DateTime.zoneMakeNamed(value)) ||
            "Expected the Klaviyo account time zone",
        ),
      ),
    }),
  }),
});
const campaignPayload = Schema.Struct({
  data: Schema.Struct({
    type: Schema.Literal("campaign"),
    id: resourceId,
    attributes: Schema.Struct({
      name: label,
      status: label,
      audiences: Schema.Struct({
        included: audienceIds,
        excluded: Schema.optionalKey(Schema.NullOr(audienceIds)),
      }),
      send_time: Schema.optionalKey(Schema.NullOr(timestamp)),
      scheduled_at: Schema.optionalKey(Schema.NullOr(timestamp)),
      send_options: Schema.optionalKey(
        Schema.Struct({ use_smart_sending: Schema.optionalKey(Schema.NullOr(Schema.Boolean)) }),
      ),
    }),
  }),
});
const flowPayload = Schema.Struct({
  data: Schema.Struct({
    type: Schema.Literal("flow"),
    id: resourceId,
    attributes: Schema.Struct({
      name: label,
      status: label,
      trigger_type: Schema.optionalKey(Schema.NullOr(label)),
    }),
  }),
  included: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        attributes: Schema.Struct({ definition: Schema.optionalKey(Schema.Unknown) }),
      }),
    ),
  ),
});
const isTimeDelay = Schema.is(
  Schema.Struct({
    type: Schema.Literal("time-delay"),
    data: Schema.Struct({
      value: count,
      unit: Schema.optionalKey(Schema.Literals(["days", "hours", "minutes"])),
    }),
  }),
);
const segmentPayload = Schema.Struct({
  data: Schema.Struct({
    type: Schema.Literal("segment"),
    id: resourceId,
    attributes: Schema.Struct({
      name: label,
      profile_count: Schema.optionalKey(Schema.NullOr(count)),
      definition: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            condition_groups: Schema.Array(
              Schema.Struct({ conditions: Schema.Array(Schema.Unknown) }),
            ),
          }),
        ),
      ),
    }),
  }),
});
const isEligibleSubscriber = Schema.is(
  Schema.Struct({
    type: Schema.Literal("profile-marketing-consent"),
    consent: Schema.Struct({
      channel: Schema.Literal("email"),
      can_receive_marketing: Schema.Literal(true),
      consent_status: Schema.Struct({ subscription: Schema.Literal("subscribed") }),
    }),
  }),
);
const valuesPayload = Schema.Struct({
  data: Schema.Struct({
    type: Schema.Literals(["campaign-values-report", "flow-values-report"]),
    attributes: Schema.Struct({
      results: Schema.Array(
        Schema.Struct({
          groupings: Schema.Struct({
            campaign_id: Schema.optionalKey(resourceId),
            campaign_message_id: Schema.optionalKey(resourceId),
            flow_id: Schema.optionalKey(resourceId),
            flow_message_id: Schema.optionalKey(resourceId),
            send_channel: Schema.Literals(["email", "sms", "push-notification", "whatsapp"]),
          }),
          statistics: Schema.Unknown,
        }),
      ).check(Schema.isMaxLength(250)),
    }),
  }),
  links: Schema.optionalKey(Schema.Struct({ next: Schema.optionalKey(Schema.Null) })),
});
const totals = Schema.Struct({ delivered: count, clicks: count, unsubscribes: count });
const decodeTotals = Schema.decodeUnknownEffect(totals);
const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.Struct({ successful: Schema.Literal(true), data: Schema.Json }),
);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));
const invalidReport = () => new BotAppError({ code: "lifecycle-report-invalid" });
const sourceMismatch = () => new BotAppError({ code: "lifecycle-source-mismatch" });

const readPayload = Effect.fn("BotApps.readKlaviyoPayload")(function* <
  S extends Schema.ConstraintDecoder<unknown, never>,
>(schema: S, data: Schema.Json) {
  const body =
    typeof data === "object" && data !== null && "successful" in data
      ? (yield* decodeEnvelope(data)).data
      : data;
  return yield* Schema.decodeEffect(schema)(
    typeof body === "string" ? yield* decodeJson(body) : body,
  );
}, Effect.mapError(invalidReport));

const readRecord = Effect.fn("BotApps.readKlaviyoRecord")(function* (
  record: LifecycleSource["record"],
  data: Schema.Json,
) {
  if (record.kind === "campaign") {
    const { data: campaign } = yield* readPayload(campaignPayload, data);
    if (campaign.id !== record.id) return yield* sourceMismatch();
    const { name, status, audiences, send_time, scheduled_at, send_options } = campaign.attributes;
    return {
      kind: record.kind,
      name,
      status,
      included: audiences.included,
      excluded: audiences.excluded ?? [],
      sendTime: send_time ?? null,
      scheduledAt: scheduled_at ?? null,
      smartSending: send_options?.use_smart_sending ?? null,
    };
  }

  const { data: flow, included = [] } = yield* readPayload(flowPayload, data);
  if (flow.id !== record.id) return yield* sourceMismatch();
  const { name, status, trigger_type } = flow.attributes;
  const delays = included
    .flatMap(({ type, attributes: { definition } }) =>
      type === "flow-action" && isTimeDelay(definition)
        ? [{ value: definition.data.value, unit: definition.data.unit ?? "days" } as const]
        : [],
    )
    .slice(0, 8);
  return { kind: record.kind, name, status, trigger: trigger_type ?? null, delays };
});

const readPerformance = Effect.fn("BotApps.readKlaviyoPerformance")(function* (
  record: LifecycleSource["record"],
  data: Schema.Json,
) {
  const { data: report } = yield* readPayload(valuesPayload, data);
  const rows = report.attributes.results;
  if (
    report.type !== `${record.kind}-values-report` ||
    rows.some(({ groupings }) => groupings[`${record.kind}_id`] !== record.id)
  ) {
    return yield* sourceMismatch();
  }
  const email = rows.filter(({ groupings }) => groupings.send_channel === "email");
  if (!email.length) return yield* new BotAppError({ code: "lifecycle-report-empty" });
  const groups = new Set<string>();
  const aggregate = { delivered: 0, clicks: 0, unsubscribes: 0 };
  for (const row of email) {
    const messageId = row.groupings[`${record.kind}_message_id`];
    if (!isResourceId(messageId) || groups.has(messageId)) return yield* invalidReport();
    groups.add(messageId);
    const counts = yield* decodeTotals(row.statistics).pipe(Effect.mapError(invalidReport));
    aggregate.delivered += counts.delivered;
    aggregate.clicks += counts.clicks;
    aggregate.unsubscribes += counts.unsubscribes;
  }
  return yield* decodeTotals(aggregate).pipe(Effect.mapError(invalidReport));
});

export const captureLifecycleReport = Effect.fn("BotApps.captureLifecycleReport")(function* (
  tools: ProjectTools["Service"],
  caller: McpInvocationContext["Service"],
  source: LifecycleSource,
) {
  const { app, inputs } = klaviyoSource(source);
  const connectionId = yield* tools.withConnectedBotReadAccess(caller, app, inputs, Effect.succeed);
  const [accountInput, recordInput, segmentInput, reportInput] = inputs;
  const readAccount = yield* tools.readConnectedBotAction(caller, app, accountInput, connectionId);
  const { data: account } = yield* readPayload(accountPayload, readAccount.data);
  if (account.id !== source.accountId) return yield* sourceMismatch();

  const readRecordResult = yield* tools.readConnectedBotAction(
    caller,
    app,
    recordInput,
    connectionId,
  );
  const record = yield* readRecord(source.record, readRecordResult.data);
  const readSegment = yield* tools.readConnectedBotAction(caller, app, segmentInput, connectionId);
  const { data: segment } = yield* readPayload(segmentPayload, readSegment.data);
  if (segment.id !== source.segmentId) return yield* sourceMismatch();
  const { name, profile_count, definition } = segment.attributes;
  const requiresEmailOptIn =
    definition?.condition_groups.some(
      ({ conditions }) => conditions.length > 0 && conditions.every(isEligibleSubscriber),
    ) ?? false;

  const readReport = yield* tools.readConnectedBotAction(caller, app, reportInput, connectionId);
  const performance = yield* readPerformance(source.record, readReport.data);
  return {
    accountId: connectionId,
    report: {
      accountName: readAccount.accountLabel.trim().slice(0, 200) || source.accountId,
      accountTimeZone: account.attributes.timezone,
      readAt: DateTime.formatIso(yield* DateTime.now),
      record,
      segment: { name, profileCount: profile_count ?? null, requiresEmailOptIn },
      performance,
    },
  };
});
