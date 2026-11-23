import { IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { TaskScheduleDate } from "./schedule.ts";

export const PAID_MEDIA_CREATIVE_LIMIT = 5;

const accountName = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const resourceId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,19}$/));
const amount = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const budgetMicros = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const PaidMediaSource = Schema.Struct({
  window: Schema.Struct({ start: TaskScheduleDate, end: TaskScheduleDate }).check(
    Schema.makeFilter(({ start, end }) => start <= end || "Expected start on or before end"),
  ),
  googleCustomerId: Schema.String.check(Schema.isPattern(/^[0-9]{10}$/)),
  metaAdAccountId: Schema.String.check(Schema.isPattern(/^act_[1-9][0-9]{0,19}$/)),
  metaConversionAction: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_.:-]{1,160}$/)),
});
export type PaidMediaSource = typeof PaidMediaSource.Type;

export const PaidMediaProposedChange = Schema.Struct({
  campaignId: resourceId,
  dailyBudgetMicros: budgetMicros,
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(1200)),
  measurement: TrimmedNonEmptyString.check(Schema.isMaxLength(1200)),
});

const accountReport = {
  accountName,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  spend: amount,
  creative: Schema.Array(
    Schema.Struct({
      id: resourceId,
      label: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
      text: Schema.String.check(Schema.isMaxLength(240)),
    }),
  ).check(Schema.isMaxLength(PAID_MEDIA_CREATIVE_LIMIT)),
};

export const PaidMediaReport = Schema.Struct({
  readAt: IsoDateTime,
  google: Schema.Struct({ ...accountReport, conversions: amount }),
  meta: Schema.Struct({ ...accountReport, conversions: Schema.NullOr(amount) }),
  campaignName: accountName,
  currentDailyBudgetMicros: budgetMicros,
});
