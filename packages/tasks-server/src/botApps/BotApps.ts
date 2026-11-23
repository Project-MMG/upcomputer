import type { AuthSessionId, ProjectId } from "@t3tools/contracts";
import {
  BotAppError,
  PaidMediaSnapshot,
  ProjectToolError,
  SingleSourceBotAppSnapshot,
  type BotAppProposalInput,
  type BotAppReviewInput,
  type BotAppSnapshot,
  type BotAppState,
  type BotAppTarget,
  type LifecycleProposalInput,
  type OutboundOpportunity,
  type OutboundProposalInput,
  type OutboundSnapshot,
  type PaidMediaProposalInput,
  type ShopifyStoreProposalInput,
  type SocialCalendarProposalInput,
  type TaskAgentId,
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
import * as Bots from "../bots/BotService.ts";
import * as ProjectTools from "../projectTools/ProjectTools.ts";
import { postizSourceAction } from "../projectTools/postizActions.ts";
import { makeSocialSchedule } from "./socialSchedule.ts";
import { captureLifecycleReport, klaviyoSource } from "./klaviyo.ts";
import { capturePaidMediaReport, paidMediaSources } from "./paidMedia.ts";
import { readPostizDestinations } from "./postiz.ts";
import {
  readShopifyExceptions,
  shopifyCatalogFollowUps,
  shopifyStoreAction,
} from "./shopifyStore.ts";
import { readMetrics, sourceAction } from "./searchConsole.ts";
import { decodeWorkApp } from "./workAppJson.ts";

type Invocation = McpInvocationContext["Service"];
type AppError = BotAppError | ProjectToolError;
type ShopifyProposal = ShopifyStoreProposalInput & { readonly kind: "shopify-store" };
type SocialProposal = SocialCalendarProposalInput & { readonly kind: "social-calendar" };
type LifecycleProposal = LifecycleProposalInput & { readonly kind: "lifecycle" };
type PaidMediaProposal = PaidMediaProposalInput & { readonly kind: "paid-media" };
type OutboundProposal = OutboundProposalInput & { readonly kind: "outbound" };

const singleSourceApp = Schema.Struct({
  accountId: Schema.NullOr(Schema.NonEmptyString),
  snapshot: SingleSourceBotAppSnapshot,
});
const paidMediaApp = Schema.Struct({
  accountIds: Schema.Struct({ google: Schema.NonEmptyString, meta: Schema.NonEmptyString }),
  snapshot: PaidMediaSnapshot,
});
const storedApp = Schema.fromJsonString(Schema.Union([singleSourceApp, paidMediaApp]));
type StoredApp = typeof storedApp.Type;
type SingleSourceApp = typeof singleSourceApp.Type;

function singleActionSource({
  app,
  input,
}: ReturnType<typeof sourceAction | typeof postizSourceAction | typeof shopifyStoreAction>) {
  return { app, inputs: [input] } as const;
}

function appReadSource(snapshot: SingleSourceApp["snapshot"]) {
  if (!("kind" in snapshot)) return singleActionSource(sourceAction(snapshot.definition.source));
  switch (snapshot.kind) {
    case "shopify-store":
      return singleActionSource(shopifyStoreAction(snapshot.definition.source.store));
    case "lifecycle":
      return klaviyoSource(snapshot.definition.source);
    case "outbound":
      return null;
    case "social-calendar": {
      const { source } = snapshot.definition;
      return source.kind === "local" ? null : singleActionSource(postizSourceAction(source));
    }
  }
}

const decode = Schema.decodeUnknownEffect(storedApp);
const encode = Schema.encodeEffect(storedApp);
const storageError = (cause: unknown) => new BotAppError({ code: "storage-unavailable", cause });

export class BotApps extends Context.Service<
  BotApps,
  {
    readonly state: (target: BotAppTarget) => Effect.Effect<BotAppState, AppError>;
    readonly proposal: (caller: Invocation) => Effect.Effect<BotAppSnapshot | null, AppError>;
    readonly shopifyCatalog: (
      caller: Invocation,
    ) => Effect.Effect<ReturnType<typeof shopifyCatalogFollowUps> | null, AppError>;
    readonly outboundHandoff: (
      caller: Invocation,
      opportunityId: string,
    ) => Effect.Effect<OutboundOpportunity | null, AppError>;
    readonly propose: (
      caller: Invocation,
      input:
        | BotAppProposalInput
        | SocialProposal
        | ShopifyProposal
        | PaidMediaProposal
        | LifecycleProposal
        | OutboundProposal,
    ) => Effect.Effect<{ readonly revision: string; readonly title: string }, AppError>;
    readonly review: (
      input: BotAppReviewInput,
      approvalSessionId: AuthSessionId,
    ) => Effect.Effect<void, AppError>;
  }
>()("@t3tools/tasks-server/botApps/BotApps") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* ProjectTools.ProjectTools;
  const bots = yield* Bots.BotService;
  const uuid = (yield* SecureRandom.SecureRandom).uuidV4();
  const socialSchedule = yield* makeSocialSchedule;

  const load = Effect.fn("BotApps.load")(function* ({ projectId, botId }: BotAppTarget) {
    const [row] = yield* sql<{
      proposal: string | null;
      saved: string | null;
      work: string | null;
    }>`
      SELECT proposal_json AS proposal, saved_json AS saved, work_app_json AS work FROM bot_apps
      WHERE project_id = ${projectId} AND bot_id = ${botId}
    `.pipe(Effect.mapError(storageError));
    return row ?? { proposal: null, saved: null, work: null };
  });

  const outboundOwnerName = Effect.fn("BotApps.outboundOwnerName")(function* (
    projectId: ProjectId,
    ownerId: TaskAgentId,
  ) {
    const owner = yield* bots.forAgent(ownerId).pipe(Effect.mapError(storageError));
    if (!owner?.agent.enabled || owner.projectId !== projectId) {
      return yield* new BotAppError({ code: "outbound-owner-unavailable" });
    }
    return owner.agent.name;
  });

  const captureOutbound = Effect.fn("BotApps.captureOutbound")(function* (
    projectId: ProjectId,
    { kind, title, opportunities: candidates }: Omit<OutboundProposal, "replacesRevision">,
  ) {
    const opportunities = yield* Effect.forEach(candidates, (candidate) =>
      outboundOwnerName(projectId, candidate.ownerId).pipe(
        Effect.map((ownerName) => ({ ...candidate, ownerName, disposition: "pending" as const })),
      ),
    );
    return {
      accountId: null,
      snapshot: { kind, definition: { title, opportunities }, revision: yield* uuid, note: "" },
    } satisfies SingleSourceApp;
  });

  const approveOutbound = Effect.fn("BotApps.approveOutbound")(function* (
    { projectId, botId }: BotAppTarget,
    snapshot: OutboundSnapshot,
    { decisions, note }: Extract<BotAppReviewInput["decision"], { kind: "approve-outbound" }>,
  ) {
    const { definition } = snapshot;
    const dispositions = new Map(decisions.map(({ id, disposition }) => [id, disposition]));
    if (dispositions.size !== definition.opportunities.length) {
      return yield* new BotAppError({ code: "outbound-decisions-changed" });
    }
    const opportunities = yield* Effect.forEach(
      definition.opportunities,
      Effect.fnUntraced(function* (opportunity) {
        const disposition = dispositions.get(opportunity.id);
        if (!disposition) return yield* new BotAppError({ code: "outbound-decisions-changed" });
        if (disposition === "pending") {
          return yield* new BotAppError({ code: "outbound-decisions-pending" });
        }
        if (disposition === "handoff" && opportunity.ownerId === botId) {
          return yield* new BotAppError({ code: "outbound-handoff-unavailable" });
        }
        const ownerName =
          disposition === "handoff"
            ? yield* outboundOwnerName(projectId, opportunity.ownerId)
            : opportunity.ownerName;
        return { ...opportunity, ownerName, disposition };
      }),
    );
    return yield* encode({
      accountId: null,
      snapshot: {
        ...snapshot,
        definition: { ...definition, opportunities },
        revision: yield* uuid,
        note: note.trim(),
      },
    }).pipe(Effect.mapError(storageError));
  });

  const withSourceAccess = Effect.fn("BotApps.withSourceAccess")(function* <A>(
    caller: BotAppTarget | Invocation,
    stored: StoredApp,
    use: Effect.Effect<A, AppError>,
  ) {
    if ("accountIds" in stored) {
      return yield* tools.withConnectedBotReadSources(
        caller,
        paidMediaSources(stored.snapshot.definition),
        ({ google, meta }) =>
          google === stored.accountIds.google && meta === stored.accountIds.meta
            ? use
            : Effect.fail(new BotAppError({ code: "source-unavailable" })),
      );
    }
    const { accountId, snapshot } = stored;
    const source = appReadSource(snapshot);
    if (source === null) return yield* use;
    return yield* tools.withConnectedBotReadAccess(
      caller,
      source.app,
      source.inputs,
      (currentAccountId) =>
        currentAccountId === accountId
          ? use
          : Effect.fail(new BotAppError({ code: "source-unavailable" })),
    );
  });

  const captureSearchReport = Effect.fn("BotApps.captureSearchReport")(function* (
    caller: Invocation,
    definition: Omit<BotAppProposalInput, "replacesRevision">,
    previous: SingleSourceApp | null,
  ) {
    const { app, input } = sourceAction(definition.source);
    const read = yield* tools.readConnectedBotAction(caller, app, input);
    const metrics = yield* readMetrics(read.data, definition.source.page);
    const prior = previous?.snapshot;
    return {
      accountId: read.accountId,
      snapshot: {
        definition,
        revision: yield* uuid,
        note:
          prior &&
          !("kind" in prior) &&
          previous?.accountId === read.accountId &&
          Equal.equals(prior.definition.source, definition.source)
            ? prior.note
            : "",
        report: {
          readAt: DateTime.formatIso(yield* DateTime.now),
          accountLabel: read.accountLabel,
          metrics,
        },
      },
    } satisfies SingleSourceApp;
  });

  const captureShopifyStore = Effect.fn("BotApps.captureShopifyStore")(function* (
    caller: Invocation,
    { kind, title, source }: Omit<ShopifyProposal, "replacesRevision">,
    previous: SingleSourceApp | null,
  ) {
    const { app, input } = shopifyStoreAction(source.store);
    const read = yield* tools.readConnectedBotAction(caller, app, input);
    const exceptions = yield* readShopifyExceptions(read.data, source.store);
    const prior = previous?.snapshot;
    return {
      accountId: read.accountId,
      snapshot: {
        kind,
        definition: { title, source },
        revision: yield* uuid,
        note:
          prior &&
          "kind" in prior &&
          prior.kind === "shopify-store" &&
          previous?.accountId === read.accountId &&
          Equal.equals(prior.definition.source, source)
            ? prior.note
            : "",
        report: {
          readAt: DateTime.formatIso(yield* DateTime.now),
          accountLabel: read.accountLabel,
          ...exceptions,
        },
      },
    } satisfies SingleSourceApp;
  });

  const captureSocialCalendar = Effect.fn("BotApps.captureSocialCalendar")(function* (
    caller: Invocation,
    { kind, ...definition }: Omit<SocialProposal, "replacesRevision">,
    previous: SingleSourceApp | null,
  ) {
    const { source, contentPackage } = definition;
    const prior = previous?.snapshot;
    const previousCalendar =
      prior && "kind" in prior && prior.kind === "social-calendar" ? prior : null;
    if (
      previousCalendar &&
      !Equal.equals(previousCalendar.definition.contentPackage.asset, contentPackage.asset)
    ) {
      return yield* new BotAppError({ code: "asset-approval-changed" });
    }

    let accountId: string | null = null;
    let report = null;
    if (source.kind === "postiz") {
      const { app, input } = postizSourceAction(source);
      const read = yield* tools.readConnectedBotAction(caller, app, input);
      const destinations = yield* readPostizDestinations(read.data, contentPackage.posts);
      accountId = read.accountId;
      report = {
        readAt: DateTime.formatIso(yield* DateTime.now),
        accountLabel: read.accountLabel,
        destinations,
      };
    }

    const captionNotes =
      previousCalendar && previous?.accountId === accountId
        ? previousCalendar.captionNotes.filter(({ channel }) => {
            const post = contentPackage.posts.find((post) => post.channel === channel);
            const previousPost = previousCalendar.definition.contentPackage.posts.find(
              (post) => post.channel === channel,
            );
            return post && Equal.equals(post.destination, previousPost?.destination);
          })
        : [];
    return {
      accountId,
      snapshot: { kind, definition, revision: yield* uuid, note: "", captionNotes, report },
    } satisfies SingleSourceApp;
  });

  const slot = Effect.fn("BotApps.slot")(function* (
    target: BotAppTarget,
    json: string | null,
    allowSchedule?: boolean,
  ) {
    if (json === null) return null;
    const stored = yield* decode(json).pipe(Effect.mapError(storageError));
    return yield* withSourceAccess(
      target,
      stored,
      Effect.gen(function* () {
        const { snapshot } = stored;
        const schedule =
          allowSchedule !== undefined &&
          "accountId" in stored &&
          stored.accountId &&
          "kind" in snapshot &&
          snapshot.kind === "social-calendar"
            ? yield* socialSchedule.read(target, stored.accountId, snapshot, allowSchedule)
            : [];
        return {
          status: "available",
          snapshot,
          ...(schedule.length ? { socialSchedule: schedule } : {}),
        } as const;
      }),
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
      const saved = yield* slot(target, row.saved, row.proposal === null);
      const proposal = yield* slot(target, row.proposal);
      const work =
        row.work === null
          ? null
          : yield* decodeWorkApp(row.work).pipe(Effect.mapError(storageError));
      return { saved, proposal, work };
    }),
    proposal: Effect.fn("BotApps.proposal")(function* (caller) {
      const owner = yield* tools.confirmCaller(caller);
      const { proposal } = yield* load(owner);
      if (proposal === null) return null;
      const stored = yield* decode(proposal).pipe(Effect.mapError(storageError));
      return yield* withSourceAccess(caller, stored, Effect.succeed(stored.snapshot));
    }),
    shopifyCatalog: Effect.fn("BotApps.shopifyCatalog")(function* (caller) {
      const owner = yield* tools.confirmCaller(caller);
      const { saved } = yield* load(owner);
      if (saved === null) return null;
      const stored = yield* decode(saved).pipe(Effect.mapError(storageError));
      const { snapshot } = stored;
      if (!("kind" in snapshot) || snapshot.kind !== "shopify-store") return null;
      return yield* withSourceAccess(
        caller,
        stored,
        Effect.sync(() => shopifyCatalogFollowUps(snapshot)),
      );
    }),
    outboundHandoff: Effect.fn("BotApps.outboundHandoff")(function* (caller, opportunityId) {
      const owner = yield* tools.confirmCaller(caller);
      const { saved } = yield* load(owner);
      if (saved === null) return null;
      const { snapshot } = yield* decode(saved).pipe(Effect.mapError(storageError));
      if (!("kind" in snapshot) || snapshot.kind !== "outbound") return null;
      const opportunity = snapshot.definition.opportunities.find(
        ({ id, disposition }) => id === opportunityId && disposition === "handoff",
      );
      if (!opportunity) return null;
      const ownerName = yield* outboundOwnerName(owner.projectId, opportunity.ownerId);
      return { ...opportunity, ownerName };
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

      const previousSingleSource = previous && "accountId" in previous ? previous : null;
      let stored: StoredApp;
      if (!("kind" in definition)) {
        stored = yield* captureSearchReport(caller, definition, previousSingleSource);
      } else {
        switch (definition.kind) {
          case "social-calendar":
            stored = yield* captureSocialCalendar(caller, definition, previousSingleSource);
            break;
          case "shopify-store":
            stored = yield* captureShopifyStore(caller, definition, previousSingleSource);
            break;
          case "lifecycle": {
            const { kind, ...app } = definition;
            const { accountId, report } = yield* captureLifecycleReport(tools, caller, app.source);
            stored = {
              accountId,
              snapshot: { kind, definition: app, revision: yield* uuid, note: "", report },
            };
            break;
          }
          case "outbound":
            stored = yield* captureOutbound(projectId, definition);
            break;
          case "paid-media": {
            const { kind, ...app } = definition;
            const { accountIds, report } = yield* capturePaidMediaReport(tools, caller, app);
            stored = {
              accountIds,
              snapshot: { kind, definition: app, revision: yield* uuid, note: "", report },
            };
            break;
          }
        }
      }
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
      return { revision: stored.snapshot.revision, title: definition.title };
    }),
    review: Effect.fn("BotApps.review")(function* (input, approvalSessionId) {
      yield* tools.confirmBotChat(input);
      const { projectId, botId, decision, revision } = input;
      const row = yield* load(input);
      if (decision.kind === "schedule-social-fixture") {
        if (row.saved === null || row.proposal !== null) {
          return yield* new BotAppError({ code: "saved-app-changed" });
        }
        const saved = yield* decode(row.saved).pipe(Effect.mapError(storageError));
        if (saved.snapshot.revision !== revision) {
          return yield* new BotAppError({ code: "saved-app-changed" });
        }
        if (
          !("accountId" in saved) ||
          !saved.accountId ||
          !("kind" in saved.snapshot) ||
          saved.snapshot.kind !== "social-calendar"
        ) {
          return yield* new BotAppError({ code: "social-schedule-unavailable" });
        }
        return yield* socialSchedule.approve(
          input,
          approvalSessionId,
          row.saved,
          { accountId: saved.accountId, snapshot: saved.snapshot },
          decision.channel,
        );
      }
      if (decision.kind === "remove") {
        if (row.saved === null) return yield* new BotAppError({ code: "saved-app-changed" });
        const saved = yield* decode(row.saved).pipe(Effect.mapError(storageError));
        if (saved.snapshot.revision !== revision) {
          return yield* new BotAppError({ code: "saved-app-changed" });
        }
        const removed = yield* sql`UPDATE bot_apps SET saved_json = NULL
          WHERE project_id = ${projectId} AND bot_id = ${botId} AND saved_json = ${row.saved}
          RETURNING bot_id`.pipe(Effect.mapError(storageError));
        if (!removed.length) return yield* new BotAppError({ code: "saved-app-changed" });
        return;
      }

      const { proposal } = row;
      if (proposal === null) return yield* new BotAppError({ code: "proposal-changed" });
      const stored = yield* decode(proposal).pipe(Effect.mapError(storageError));
      if (stored.snapshot.revision !== revision) {
        return yield* new BotAppError({ code: "proposal-changed" });
      }
      const update = Effect.gen(function* () {
        const { snapshot } = stored;
        let nextProposal: string | null = null;
        let nextSaved: string | null = null;
        if (decision.kind === "annotate") {
          const annotation = { note: decision.note.trim(), revision: yield* uuid };
          nextProposal = yield* encode(
            "accountIds" in stored
              ? { ...stored, snapshot: { ...stored.snapshot, ...annotation } }
              : { ...stored, snapshot: { ...stored.snapshot, ...annotation } },
          ).pipe(Effect.mapError(storageError));
        }
        if (decision.kind === "annotate-caption") {
          const { channel, note } = decision;
          if (
            "accountIds" in stored ||
            !("kind" in snapshot) ||
            snapshot.kind !== "social-calendar" ||
            !snapshot.definition.contentPackage.posts.some((post) => post.channel === channel)
          ) {
            return yield* new BotAppError({ code: "caption-unavailable" });
          }
          const captionNotes = snapshot.captionNotes.filter((item) => item.channel !== channel);
          if (note.trim()) captionNotes.push({ channel, note: note.trim() });
          nextProposal = yield* encode({
            ...stored,
            snapshot: { ...snapshot, captionNotes, revision: yield* uuid },
          }).pipe(Effect.mapError(storageError));
        }
        const outbound = "kind" in snapshot && snapshot.kind === "outbound" ? snapshot : null;
        if (decision.kind === "approve") {
          if (outbound) return yield* new BotAppError({ code: "outbound-decisions-changed" });
          nextSaved = proposal;
        }
        if (decision.kind === "approve-outbound") {
          if (!outbound) return yield* new BotAppError({ code: "outbound-decisions-changed" });
          nextSaved = yield* approveOutbound(input, outbound, decision);
        }
        const written = yield* sql`UPDATE bot_apps SET
          proposal_json = ${nextProposal},
          saved_json = COALESCE(${nextSaved}, saved_json)
          WHERE project_id = ${projectId} AND bot_id = ${botId} AND proposal_json = ${proposal}
          RETURNING bot_id`.pipe(Effect.mapError(storageError));
        if (!written.length) return yield* new BotAppError({ code: "proposal-changed" });
      });
      yield* decision.kind === "dismiss" ? update : withSourceAccess(input, stored, update);
    }),
  });
});

export const layer = Layer.effect(BotApps, make);
