import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { TaskAgentId } from "./agents.ts";
import { BotAppTarget } from "./botApps.ts";
import { TaskId } from "./tasks.ts";

const date = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
const time = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/));
const timezone = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const decision = Schema.Literals(["approved", "dismissed"]);

export const BotRetroProposal = Schema.Struct({
  outcome: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
  kind: Schema.Literals(["instructions", "skill", "grant"]),
  change: TrimmedNonEmptyString.check(Schema.isMaxLength(800)),
});
export type BotRetroProposal = typeof BotRetroProposal.Type;

export const BotRetroProposeInput = Schema.Struct({
  evidenceTaskId: TaskId,
  ...BotRetroProposal.fields,
});
export type BotRetroProposeInput = typeof BotRetroProposeInput.Type;

const BotRetroEntry = Schema.Struct({
  date,
  ownerId: TaskAgentId,
  ownerName: Schema.String,
  evidenceTaskId: TaskId,
  evidenceTitle: Schema.String,
  queueTaskId: Schema.NullOr(TaskId),
  proposal: Schema.NullOr(BotRetroProposal),
  revision: PositiveInt,
  decision: Schema.NullOr(decision),
});
export type BotRetroEntry = typeof BotRetroEntry.Type;

const BotRetroSchedule = Schema.Struct({
  time,
  timezone,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRunAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(Schema.String),
});

export const BotRetroState = Schema.Struct({
  schedule: Schema.NullOr(BotRetroSchedule),
  entries: Schema.Array(BotRetroEntry),
  defaultTimezone: timezone,
});
export type BotRetroState = typeof BotRetroState.Type;

export const BotRetroScheduleInput = Schema.Struct({
  ...BotAppTarget.fields,
  schedule: Schema.Union([
    Schema.Struct({ action: Schema.Literal("pause") }),
    Schema.Struct({ action: Schema.Literal("enable"), time, timezone }),
  ]),
});
export type BotRetroScheduleInput = typeof BotRetroScheduleInput.Type;

export const BotRetroReviewInput = Schema.Struct({
  ...BotAppTarget.fields,
  date,
  ownerId: TaskAgentId,
  revision: PositiveInt,
  decision: Schema.Union([decision, Schema.Literal("reopen")]),
});
export type BotRetroReviewInput = typeof BotRetroReviewInput.Type;
