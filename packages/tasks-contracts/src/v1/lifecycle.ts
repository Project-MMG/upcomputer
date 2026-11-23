import { IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { TaskScheduleDate } from "./schedule.ts";

const resourceId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/));
const label = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const window = Schema.Struct({ start: TaskScheduleDate, end: TaskScheduleDate }).check(
  Schema.makeFilter(
    ({ start, end }) =>
      (start <= end && Date.parse(end) - Date.parse(start) < 365 * 86_400_000) ||
      "Expected an inclusive report window of up to 365 days",
  ),
);

export const LifecycleSource = Schema.Struct({
  accountId: resourceId,
  record: Schema.Struct({ kind: Schema.Literals(["campaign", "flow"]), id: resourceId }),
  segmentId: resourceId,
  conversionMetricId: resourceId,
  window,
});
export type LifecycleSource = typeof LifecycleSource.Type;

export const LifecycleFollowUp = Schema.Struct({
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
  consent: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
  timing: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  subject: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(3000)),
  successMeasure: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
});

const audienceIds = Schema.Array(resourceId).check(Schema.isMaxLength(100));
const campaign = Schema.Struct({
  kind: Schema.Literal("campaign"),
  name: label,
  status: label,
  included: audienceIds,
  excluded: audienceIds,
  sendTime: Schema.NullOr(IsoDateTime),
  scheduledAt: Schema.NullOr(IsoDateTime),
  smartSending: Schema.NullOr(Schema.Boolean),
});
const flow = Schema.Struct({
  kind: Schema.Literal("flow"),
  name: label,
  status: label,
  trigger: Schema.NullOr(label),
  delays: Schema.Array(
    Schema.Struct({ value: count, unit: Schema.Literals(["days", "hours", "minutes"]) }),
  ).check(Schema.isMaxLength(8)),
});

export const LifecycleReport = Schema.Struct({
  accountName: label,
  accountTimeZone: label,
  readAt: IsoDateTime,
  record: Schema.Union([campaign, flow]),
  segment: Schema.Struct({
    name: label,
    profileCount: Schema.NullOr(count),
    requiresEmailOptIn: Schema.Boolean,
  }),
  performance: Schema.Struct({ delivered: count, clicks: count, unsubscribes: count }),
});
