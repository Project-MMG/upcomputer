import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { TaskAgentId } from "./agents.ts";
import { PaidMediaProposedChange, PaidMediaReport, PaidMediaSource } from "./paidMedia.ts";
import { ProjectToolError } from "./projectTools.ts";
import { TaskScheduleDate } from "./schedule.ts";
import { ShopifyStoreReport, ShopifyStoreSource } from "./shopifyStore.ts";

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

const searchConsoleSnapshot = Schema.Struct({
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

const shopifyStoreDefinition = Schema.Struct({ title, source: ShopifyStoreSource });
export const ShopifyStoreProposalInput = Schema.Struct({
  ...shopifyStoreDefinition.fields,
  replacesRevision: Schema.optionalKey(revision),
});
export type ShopifyStoreProposalInput = typeof ShopifyStoreProposalInput.Type;

const shopifyStoreSnapshot = Schema.Struct({
  kind: Schema.Literal("shopify-store"),
  definition: shopifyStoreDefinition,
  revision,
  note,
  report: ShopifyStoreReport,
});
export type ShopifyStoreSnapshot = typeof shopifyStoreSnapshot.Type;

export const SOCIAL_CALENDAR_CHANNELS = ["facebook", "instagram", "tiktok", "youtube"] as const;
const socialChannel = Schema.Literals(SOCIAL_CALENDAR_CHANNELS);
export type SocialCalendarChannel = typeof socialChannel.Type;

const isScheduleDate = Schema.is(TaskScheduleDate);
const utcDateTime = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/),
  Schema.makeFilter(
    (value) => isScheduleDate(value.slice(0, 10)) || "Expected a UTC calendar date",
  ),
);
const destinationId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const socialSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("local") }),
  Schema.Struct({ kind: Schema.Literal("postiz"), group: Schema.optionalKey(destinationId) }),
]);
export type SocialCalendarSource = typeof socialSource.Type;

const socialPost = Schema.Struct({
  channel: socialChannel,
  destination: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("local"), label: destinationId }),
    Schema.Struct({ kind: Schema.Literal("postiz"), integrationId: destinationId }),
  ]),
  publishAt: utcDateTime,
  caption: TrimmedNonEmptyString.check(Schema.isMaxLength(5000)),
});
export type SocialCalendarPost = typeof socialPost.Type;

const socialCalendarDefinition = Schema.Struct({
  title,
  source: socialSource,
  contentPackage: Schema.Struct({
    asset: Schema.Struct({
      title,
      mediaUrl: httpUrl,
      approval: Schema.Struct({ sourceUrl: httpUrl, approvedAt: utcDateTime }),
    }),
    posts: Schema.NonEmptyArray(socialPost).check(
      Schema.isMaxLength(SOCIAL_CALENDAR_CHANNELS.length),
      Schema.makeFilter(
        (posts) =>
          new Set(posts.map(({ channel }) => channel)).size === posts.length ||
          "Expected one caption per channel",
      ),
    ),
  }),
});
const matchesSocialSource = Schema.makeFilter(
  ({ source, contentPackage }: typeof socialCalendarDefinition.Type) =>
    (source.kind === "postiz") ===
      contentPackage.posts.some(({ destination }) => destination.kind === "postiz") ||
    "Expected a Postiz source for Postiz destinations",
);

export const SocialCalendarProposalInput = Schema.Struct({
  ...socialCalendarDefinition.fields,
  replacesRevision: Schema.optionalKey(revision),
}).check(matchesSocialSource);
export type SocialCalendarProposalInput = typeof SocialCalendarProposalInput.Type;

const socialCalendarSnapshot = Schema.Struct({
  kind: Schema.Literal("social-calendar"),
  definition: socialCalendarDefinition.check(matchesSocialSource),
  revision,
  note,
  captionNotes: Schema.Array(Schema.Struct({ channel: socialChannel, note })).check(
    Schema.isMaxLength(SOCIAL_CALENDAR_CHANNELS.length),
  ),
  report: Schema.NullOr(
    Schema.Struct({
      readAt: IsoDateTime,
      accountLabel: Schema.String.check(Schema.isMaxLength(200)),
      destinations: Schema.NonEmptyArray(
        Schema.Struct({ integrationId: destinationId, label: destinationId }),
      ).check(Schema.isMaxLength(SOCIAL_CALENDAR_CHANNELS.length)),
    }),
  ),
});
export type SocialCalendarSnapshot = typeof socialCalendarSnapshot.Type;

const paidMediaDefinition = Schema.Struct({
  title,
  source: PaidMediaSource,
  proposedChange: PaidMediaProposedChange,
});
export const PaidMediaProposalInput = Schema.Struct({
  ...paidMediaDefinition.fields,
  replacesRevision: Schema.optionalKey(revision),
});
export type PaidMediaProposalInput = typeof PaidMediaProposalInput.Type;

export const PaidMediaSnapshot = Schema.Struct({
  kind: Schema.Literal("paid-media"),
  definition: paidMediaDefinition,
  revision,
  note,
  report: PaidMediaReport,
});
export type PaidMediaSnapshot = typeof PaidMediaSnapshot.Type;

export const SingleSourceBotAppSnapshot = Schema.Union([
  searchConsoleSnapshot,
  socialCalendarSnapshot,
  shopifyStoreSnapshot,
]);
export const BotAppSnapshot = Schema.Union([
  ...SingleSourceBotAppSnapshot.members,
  PaidMediaSnapshot,
]);
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
    Schema.Struct({ kind: Schema.Literal("annotate-caption"), channel: socialChannel, note }),
    Schema.Struct({ kind: Schema.Literal("approve") }),
    Schema.Struct({ kind: Schema.Literal("dismiss") }),
    Schema.Struct({ kind: Schema.Literal("remove") }),
  ]),
});
export type BotAppReviewInput = typeof BotAppReviewInput.Type;

const messages = {
  "storage-unavailable": "Up.computer could not load or save this bot app.",
  "proposal-changed": "The proposal changed. Open the latest version to continue.",
  "saved-app-changed": "The saved app changed. Open the latest version to continue.",
  "source-unavailable":
    "This bot app’s source access has changed. Check its account and tool assignment.",
  "shopify-report-invalid": "Shopify did not return a complete store report.",
  "shopify-store-mismatch": "The connected Shopify account returned a different store.",
  "report-invalid": "Search Console returned a report that did not match the requested page.",
  "report-empty": "Search Console returned no data for this page and report window.",
  "asset-approval-changed": "The original asset and its approval must stay with this proposal.",
  "caption-unavailable": "This proposal does not have a caption for that channel.",
  "paid-media-report-invalid": "The ads platform did not return a complete account report.",
  "paid-media-source-mismatch": "The ads platform returned a different account or campaign.",
  "paid-media-budget-unavailable": "Choose a Google Ads campaign with its own daily budget.",
  "paid-media-budget-unchanged": "The proposed daily budget matches the current budget.",
  "postiz-response-invalid": "Postiz returned an unrecognized channel list.",
  "postiz-destination-unavailable": "Postiz could not verify a selected channel destination.",
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
