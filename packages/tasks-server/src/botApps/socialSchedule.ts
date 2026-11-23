import type { AuthSessionId } from "@t3tools/contracts";
import {
  BotAppError,
  type BotAppTarget,
  type SocialCalendarChannel,
  type SocialCalendarPost,
  type SocialCalendarSnapshot,
  type SocialSchedule,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectTools from "../projectTools/ProjectTools.ts";
import { SocialFixtureArguments } from "../projectTools/postizActions.ts";
import { reviewedWriteFailureStatus } from "../projectTools/reviewedWrites.ts";

const storageError = (cause: unknown) => new BotAppError({ code: "storage-unavailable", cause });
const encodePayload = Schema.encodeEffect(Schema.fromJsonString(SocialFixtureArguments));
const receiptId = Schema.NonEmptyString.check(Schema.isTrimmed(), Schema.isMaxLength(200));
const receipt = Schema.Struct({
  id: receiptId,
  integration_id: Schema.String,
  publish_at: Schema.String,
});
const isReceipt = Schema.is(receipt);

function fixtureArgs(
  snapshot: SocialCalendarSnapshot,
  post: SocialCalendarPost,
): SocialFixtureArguments | null {
  const { source, contentPackage } = snapshot.definition;
  const { destination, publishAt, caption } = post;
  if (source.kind !== "postiz" || destination.kind !== "postiz") return null;
  const integrationId = destination.integrationId;
  if (!snapshot.report?.destinations.some((entry) => entry.integrationId === integrationId)) {
    return null;
  }
  return {
    integration_id: integrationId,
    publish_at: publishAt,
    caption,
    media_url: contentPackage.asset.mediaUrl,
    ...(source.group === undefined ? {} : { group: source.group }),
  };
}

const slotTime = (time: string) => (time.includes(".") ? time : time.replace(/Z$/, ".000Z"));

type Attempt =
  | { readonly status: "scheduled"; readonly receiptId: string }
  | { readonly status: "failed" | "uncertain"; readonly receiptId: null };

export const makeSocialSchedule = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* ProjectTools.ProjectTools;

  const findAttempt = Effect.fn("BotApps.findSocialScheduleAttempt")(function* (
    { projectId, botId }: BotAppTarget,
    accountId: string,
    revision: string,
    args: SocialFixtureArguments,
  ) {
    const [attempt] = yield* sql<Attempt & { readonly payload: string }>`
      SELECT status, provider_receipt_id AS "receiptId", payload_json AS payload
      FROM social_schedule_attempts
      WHERE project_id = ${projectId} AND bot_id = ${botId} AND account_id = ${accountId}
        AND integration_id = ${args.integration_id} AND publish_at = ${slotTime(args.publish_at)}
        AND (status <> 'failed' OR revision = ${revision})
      ORDER BY status = 'failed' LIMIT 1
    `.pipe(Effect.mapError(storageError));
    return attempt;
  });

  const read = Effect.fn("BotApps.readSocialSchedule")(function* (
    target: BotAppTarget,
    accountId: string,
    snapshot: SocialCalendarSnapshot,
    allowSchedule: boolean,
  ) {
    const schedule: SocialSchedule[] = [];
    for (const post of snapshot.definition.contentPackage.posts) {
      const args = fixtureArgs(snapshot, post);
      if (!args) continue;
      const attempt = yield* findAttempt(target, accountId, snapshot.revision, args);
      if (attempt) {
        const payload = yield* encodePayload(args).pipe(Effect.mapError(storageError));
        const matchesPost = attempt.payload === payload;
        const delivery =
          attempt.status === "scheduled"
            ? { status: attempt.status, receiptId: attempt.receiptId, matchesPost }
            : { status: attempt.status, matchesPost };
        schedule.push({ channel: post.channel, delivery });
      } else if (allowSchedule && (yield* tools.hasSocialFixtureGrant(target, args))) {
        schedule.push({ channel: post.channel, delivery: { status: "ready" } });
      }
    }
    return schedule;
  });

  const approve = Effect.fn("BotApps.approveSocialSchedule")(function* (
    target: BotAppTarget,
    approvalSessionId: AuthSessionId,
    savedJson: string,
    {
      accountId,
      snapshot,
    }: { readonly accountId: string; readonly snapshot: SocialCalendarSnapshot },
    channel: SocialCalendarChannel,
  ) {
    const { projectId, botId } = target;
    const { revision } = snapshot;
    const post = snapshot.definition.contentPackage.posts.find(
      (candidate) => candidate.channel === channel,
    );
    const args = post && fixtureArgs(snapshot, post);
    if (!args) return yield* new BotAppError({ code: "social-schedule-unavailable" });
    const payload = yield* encodePayload(args).pipe(Effect.mapError(storageError));
    const checkPrevious = Effect.gen(function* () {
      const attempt = yield* findAttempt(target, accountId, revision, args);
      if (attempt && attempt.payload !== payload) {
        return yield* new BotAppError({ code: "social-schedule-already-attempted" });
      }
      return attempt !== undefined;
    });
    if (yield* checkPrevious) return;
    yield* tools.scheduleApprovedSocialFixture(
      target,
      accountId,
      args,
      Effect.fn("BotApps.attemptSocialSchedule")(function* (execute) {
        // Commit the claim before delivery so a lost response or restart cannot resend it.
        const [claim] = yield* sql`INSERT INTO social_schedule_attempts (
          project_id, bot_id, account_id, integration_id, publish_at, revision,
          approval_session_id, payload_json, status
        )
        SELECT project_id, bot_id, ${accountId}, ${args.integration_id}, ${slotTime(args.publish_at)},
          ${revision}, ${approvalSessionId}, ${payload}, 'uncertain'
        FROM bot_apps
        WHERE project_id = ${projectId} AND bot_id = ${botId}
          AND saved_json = ${savedJson} AND proposal_json IS NULL
        ON CONFLICT DO NOTHING
        RETURNING revision`.pipe(Effect.mapError(storageError));
        if (!claim) {
          if (yield* checkPrevious) return;
          return yield* new BotAppError({ code: "saved-app-changed" });
        }
        const outcome = yield* Effect.match(execute, {
          onSuccess: (data): Attempt =>
            isReceipt(data) &&
            data.integration_id === args.integration_id &&
            data.publish_at === args.publish_at
              ? { status: "scheduled", receiptId: data.id }
              : { status: "uncertain", receiptId: null },
          onFailure: (error): Attempt => ({
            status: reviewedWriteFailureStatus(error),
            receiptId: null,
          }),
        });
        if (outcome.status === "uncertain") return;
        yield* sql`UPDATE social_schedule_attempts
          SET status = ${outcome.status}, provider_receipt_id = ${outcome.receiptId}
          WHERE project_id = ${projectId} AND bot_id = ${botId}
            AND revision = ${revision} AND integration_id = ${args.integration_id}
        `.pipe(Effect.mapError(storageError));
      }),
    );
  });

  return { read, approve };
});
