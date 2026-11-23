import {
  BotAppError,
  BotAppSnapshot,
  ProjectToolError,
  type BotAppProposalInput,
  type BotAppReviewInput,
  type BotAppState,
  type BotAppTarget,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";

import type { McpInvocationContext } from "../../../../apps/server/src/extensionApi.ts";
import * as ProjectTools from "../projectTools/ProjectTools.ts";
import { readMetrics, sourceAction } from "./searchConsole.ts";

type Invocation = McpInvocationContext["Service"];
type AppError = BotAppError | ProjectToolError;
type StoredApp = typeof storedApp.Type;
const storedApp = Schema.fromJsonString(
  Schema.Struct({ accountId: Schema.NonEmptyString, snapshot: BotAppSnapshot }),
);
const decode = Schema.decodeUnknownEffect(storedApp);
const encode = Schema.encodeEffect(storedApp);
const storageError = (cause: unknown) => new BotAppError({ code: "storage-unavailable", cause });

export class BotApps extends Context.Service<
  BotApps,
  {
    readonly state: (target: BotAppTarget) => Effect.Effect<BotAppState, AppError>;
    readonly proposal: (caller: Invocation) => Effect.Effect<BotAppSnapshot | null, AppError>;
    readonly propose: (
      caller: Invocation,
      input: BotAppProposalInput,
    ) => Effect.Effect<{ readonly revision: string; readonly title: string }, AppError>;
    readonly review: (input: BotAppReviewInput) => Effect.Effect<void, AppError>;
  }
>()("@t3tools/tasks-server/botApps/BotApps") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* ProjectTools.ProjectTools;
  const uuid = (yield* SecureRandom.SecureRandom).uuidV4();

  const load = Effect.fn("BotApps.load")(function* ({ projectId, botId }: BotAppTarget) {
    const [row] = yield* sql<{ proposal: string | null; saved: string | null }>`
      SELECT proposal_json AS proposal, saved_json AS saved FROM bot_apps
      WHERE project_id = ${projectId} AND bot_id = ${botId}
    `.pipe(Effect.mapError(storageError));
    return row ?? { proposal: null, saved: null };
  });

  const withSourceAccess = Effect.fn("BotApps.withSourceAccess")(function* <A>(
    caller: BotAppTarget | Invocation,
    { accountId, snapshot }: StoredApp,
    use: Effect.Effect<A, AppError>,
  ) {
    const { app, input } = sourceAction(snapshot.definition.source);
    return yield* tools.withConnectedBotReadAccess(caller, app, [input], (currentAccountId) =>
      currentAccountId === accountId
        ? use
        : Effect.fail(new BotAppError({ code: "source-unavailable" })),
    );
  });

  const slot = Effect.fn("BotApps.slot")(function* (target: BotAppTarget, json: string | null) {
    if (json === null) return null;
    const stored = yield* decode(json).pipe(Effect.mapError(storageError));
    return yield* withSourceAccess(
      target,
      stored,
      Effect.succeed({ status: "available", snapshot: stored.snapshot } as const),
    ).pipe(
      Effect.orElseSucceed(
        () => ({ status: "unavailable", revision: stored.snapshot.revision }) as const,
      ),
    );
  });

  return BotApps.of({
    state: Effect.fn("BotApps.state")(function* (target) {
      yield* tools.confirmBotChat(target);
      const row = yield* load(target);
      const saved = yield* slot(target, row.saved);
      const proposal = yield* slot(target, row.proposal);
      return { saved, proposal };
    }),
    proposal: Effect.fn("BotApps.proposal")(function* (caller) {
      const owner = yield* tools.confirmCaller(caller);
      const { proposal } = yield* load(owner);
      if (proposal === null) return null;
      const stored = yield* decode(proposal).pipe(Effect.mapError(storageError));
      return yield* withSourceAccess(caller, stored, Effect.succeed(stored.snapshot));
    }),
    propose: Effect.fn("BotApps.propose")(function* (caller, { replacesRevision, ...definition }) {
      const owner = yield* tools.confirmCaller(caller);
      if (owner.plan) return yield* new ProjectToolError({ code: "plan-mode" });
      const { projectId, botId } = owner;
      const { proposal } = yield* load(owner);
      const previous =
        proposal === null ? null : yield* decode(proposal).pipe(Effect.mapError(storageError));
      if (previous?.snapshot.revision !== replacesRevision) {
        return yield* new BotAppError({ code: "proposal-changed" });
      }

      const { app, input } = sourceAction(definition.source);
      const read = yield* tools.readConnectedBotAction(caller, app, input);
      const metrics = yield* readMetrics(read.data, definition.source.page);
      const revision = yield* uuid;
      const readAt = DateTime.formatIso(yield* DateTime.now);
      const stored = {
        accountId: read.accountId,
        snapshot: {
          definition,
          revision,
          note:
            previous?.accountId === read.accountId &&
            Equal.equals(previous.snapshot.definition.source, definition.source)
              ? previous.snapshot.note
              : "",
          report: { readAt, accountLabel: read.accountLabel, metrics },
        },
      } satisfies StoredApp;
      const json = yield* encode(stored).pipe(Effect.mapError(storageError));
      yield* withSourceAccess(
        caller,
        stored,
        Effect.gen(function* () {
          const current = yield* tools.confirmCaller(caller);
          if (
            current.runId !== owner.runId ||
            current.botId !== botId ||
            current.projectId !== projectId ||
            current.plan
          ) {
            return yield* new ProjectToolError({ code: "policy-changed" });
          }
          const written = yield* sql`INSERT INTO bot_apps (project_id, bot_id, proposal_json)
          VALUES (${projectId}, ${botId}, ${json})
          ON CONFLICT (project_id, bot_id) DO UPDATE SET proposal_json = excluded.proposal_json
          WHERE bot_apps.proposal_json IS ${proposal}
          RETURNING bot_id`.pipe(Effect.mapError(storageError));
          if (!written.length) return yield* new BotAppError({ code: "proposal-changed" });
        }),
      );
      return { revision, title: definition.title };
    }),
    review: Effect.fn("BotApps.review")(function* (input) {
      yield* tools.confirmBotChat(input);
      const { proposal } = yield* load(input);
      if (proposal === null) return yield* new BotAppError({ code: "proposal-changed" });
      const stored = yield* decode(proposal).pipe(Effect.mapError(storageError));
      if (stored.snapshot.revision !== input.revision) {
        return yield* new BotAppError({ code: "proposal-changed" });
      }

      const { projectId, botId, decision } = input;
      const update = Effect.gen(function* () {
        const nextProposal =
          decision.kind === "annotate"
            ? yield* encode({
                ...stored,
                snapshot: { ...stored.snapshot, note: decision.note.trim(), revision: yield* uuid },
              }).pipe(Effect.mapError(storageError))
            : null;
        const written = yield* sql`UPDATE bot_apps SET
          proposal_json = ${nextProposal},
          saved_json = CASE WHEN ${decision.kind} = 'approve' THEN ${proposal} ELSE saved_json END
          WHERE project_id = ${projectId} AND bot_id = ${botId} AND proposal_json = ${proposal}
          RETURNING bot_id`.pipe(Effect.mapError(storageError));
        if (!written.length) return yield* new BotAppError({ code: "proposal-changed" });
      });
      yield* decision.kind === "dismiss" ? update : withSourceAccess(input, stored, update);
    }),
  });
});

export const layer = Layer.effect(BotApps, make);
