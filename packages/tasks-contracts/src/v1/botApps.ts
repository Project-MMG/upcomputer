import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { TaskAgentId } from "./agents.ts";
import { ProjectToolError } from "./projectTools.ts";
import { TaskScheduleDate } from "./schedule.ts";

export const BotAppTarget = Schema.Struct({
  projectId: ProjectId,
  botId: TaskAgentId,
  threadId: ThreadId,
});
export type BotAppTarget = typeof BotAppTarget.Type;

const title = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const revision = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export const BOT_APP_NOTE_LIMIT = 2000;
const note = Schema.String.check(Schema.isMaxLength(BOT_APP_NOTE_LIMIT));

const httpUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(2000),
  Schema.makeFilter((value) => {
    const url = URL.parse(value);
    return (
      (url !== null &&
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password) ||
      "Expected an HTTP or HTTPS URL without credentials"
    );
  }),
);

const reportWindow = Schema.Struct({
  start: TaskScheduleDate,
  end: TaskScheduleDate,
}).check(Schema.makeFilter(({ start, end }) => start <= end || "Expected start on or before end"));

const BotAppSource = Schema.Struct({
  kind: Schema.Literal("search-console-page"),
  property: Schema.Union([
    httpUrl,
    Schema.String.check(Schema.isPattern(/^sc-domain:[a-z0-9.-]{1,253}$/i)),
  ]),
  page: httpUrl,
  window: reportWindow,
});
export type BotAppSource = typeof BotAppSource.Type;

const BotAppDefinition = Schema.Struct({
  title,
  source: BotAppSource,
  proposedFix: Schema.Struct({
    title,
    description: TrimmedNonEmptyString.check(Schema.isMaxLength(1600)),
    previewUrl: httpUrl,
  }),
});

export const BotAppProposalInput = Schema.Struct({
  ...BotAppDefinition.fields,
  replacesRevision: Schema.optionalKey(revision),
});
export type BotAppProposalInput = typeof BotAppProposalInput.Type;

export const BotAppSnapshot = Schema.Struct({
  definition: BotAppDefinition,
  revision,
  note,
  report: Schema.Struct({
    readAt: IsoDateTime,
    accountLabel: Schema.String.check(Schema.isMaxLength(200)),
    metrics: Schema.NonEmptyArray(Schema.Struct({ label: title, value: Schema.Finite })).check(
      Schema.isMaxLength(4),
    ),
  }),
});
export type BotAppSnapshot = typeof BotAppSnapshot.Type;

const appSlot = Schema.NullOr(
  Schema.Union([
    Schema.Struct({ status: Schema.Literal("available"), snapshot: BotAppSnapshot }),
    Schema.Struct({ status: Schema.Literal("unavailable"), revision }),
  ]),
);
const BotAppState = Schema.Struct({ saved: appSlot, proposal: appSlot });
export type BotAppState = typeof BotAppState.Type;

export const BotAppReviewInput = Schema.Struct({
  ...BotAppTarget.fields,
  revision,
  decision: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("annotate"), note }),
    Schema.Struct({ kind: Schema.Literal("approve") }),
    Schema.Struct({ kind: Schema.Literal("dismiss") }),
  ]),
});
export type BotAppReviewInput = typeof BotAppReviewInput.Type;

const messages = {
  "storage-unavailable": "Up.computer could not load or save this bot app.",
  "proposal-changed": "The proposal changed. Open the latest version to continue.",
  "source-unavailable":
    "This bot app’s source access has changed. Check its account and tool assignment.",
  "report-invalid": "Search Console returned a report that did not match the requested page.",
  "report-empty": "Search Console returned no data for this page and report window.",
} as const;

export class BotAppError extends Schema.TaggedError<BotAppError>()("BotAppError", {
  code: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return messages[this.code];
  }
}

export const BOT_APPS_RPC_NAMESPACE = "upcomputer.bot-apps.v1";
export const BOT_APPS_RPC_METHODS = {
  state: `${BOT_APPS_RPC_NAMESPACE}.state`,
  review: `${BOT_APPS_RPC_NAMESPACE}.review`,
} as const;

const error = Schema.Union([BotAppError, ProjectToolError]);
export const BotAppsRpcGroup = RpcGroup.make(
  Rpc.make(BOT_APPS_RPC_METHODS.state, { payload: BotAppTarget, success: BotAppState, error }),
  Rpc.make(BOT_APPS_RPC_METHODS.review, { payload: BotAppReviewInput, error }),
);
