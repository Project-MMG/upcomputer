import {
  BotSetupProposal,
  BotWorkError,
  ProjectToolError,
  TaskAgentId,
  type BotAppTarget,
  type BotSetupDraft,
  type BotSetupProposalInput,
  type BotSetupReviewInput,
  type BotWorkApp,
  type BotWorkConfigureInput,
  type BotWorkState,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";

import {
  ProjectStoreV2,
  type McpInvocationContext,
} from "../../../../apps/server/src/extensionApi.ts";
import { BotService } from "../bots/BotService.ts";
import * as ProjectTools from "../projectTools/ProjectTools.ts";
import * as BotRetro from "./BotRetro.ts";
import { decodeWorkApp, encodeWorkApp } from "./workAppJson.ts";
import { makeWorkOverview } from "./workOverview.ts";

type Invocation = McpInvocationContext["Service"];
type WorkError = BotWorkError | ProjectToolError;
const storedProposal = Schema.fromJsonString(
  Schema.Struct({ ...BotSetupProposal.fields, candidateId: TaskAgentId }),
);
type StoredProposal = typeof storedProposal.Type;
const decodeProposal = Schema.decodeUnknownEffect(storedProposal);
const encodeProposal = Schema.encodeEffect(storedProposal);
const storageError = (cause: unknown) => new BotWorkError({ code: "storage-unavailable", cause });

export class BotWork extends Context.Service<
  BotWork,
  {
    readonly state: (target: BotAppTarget) => Effect.Effect<BotWorkState, WorkError>;
    readonly configure: (input: BotWorkConfigureInput) => Effect.Effect<void, WorkError>;
    readonly propose: (
      caller: Invocation,
      input: BotSetupProposalInput,
    ) => Effect.Effect<
      {
        readonly roleKey: string;
        readonly revision: string;
        readonly state: BotSetupProposal["state"];
      },
      WorkError
    >;
    readonly review: (input: BotSetupReviewInput) => Effect.Effect<void, WorkError>;
    readonly retroSchedule: BotRetro.BotRetro["Service"]["configure"];
    readonly retroPropose: BotRetro.BotRetro["Service"]["propose"];
    readonly retroReview: BotRetro.BotRetro["Service"]["review"];
  }
>()("@t3tools/tasks-server/botApps/BotWork") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* ProjectTools.ProjectTools;
  const bots = yield* BotService;
  const projects = yield* ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const uuid = (yield* SecureRandom.SecureRandom).uuidV4();
  const lock = yield* Semaphore.make(1);
  const overview = yield* makeWorkOverview;
  const retro = yield* BotRetro.BotRetro;

  const registration = Effect.fn("BotWork.registration")(function* ({
    projectId,
    botId,
  }: BotAppTarget) {
    const [row] = yield* sql<{ json: string | null }>`
      SELECT work_app_json AS json FROM bot_apps WHERE project_id = ${projectId} AND bot_id = ${botId}
    `;
    return row?.json == null ? null : yield* decodeWorkApp(row.json);
  }, Effect.mapError(storageError));

  const register = Effect.fn("BotWork.register")(function* (
    { projectId, botId }: BotAppTarget,
    app: BotWorkApp,
  ) {
    const json = yield* encodeWorkApp(app);
    const written = yield* sql`INSERT INTO bot_apps (project_id, bot_id, work_app_json)
      SELECT project_id, agent_id, ${json} FROM bots WHERE project_id = ${projectId} AND agent_id = ${botId}
      ON CONFLICT (project_id, bot_id) DO UPDATE
      SET work_app_json = COALESCE(bot_apps.work_app_json, excluded.work_app_json)
      RETURNING bot_id`;
    return written.length !== 0;
  }, Effect.mapError(storageError));

  const loadProposal = Effect.fn("BotWork.loadProposal")(function* (
    { projectId }: BotAppTarget,
    roleKey: string,
  ) {
    const [row] = yield* sql<{ coordinatorId: string; json: string }>`
      SELECT coordinator_id AS "coordinatorId", proposal_json AS json
      FROM bot_setup_proposals WHERE project_id = ${projectId} AND role_key = ${roleKey}
    `;
    return row
      ? { coordinatorId: row.coordinatorId, proposal: yield* decodeProposal(row.json) }
      : null;
  }, Effect.mapError(storageError));

  const saveProposal = Effect.fn("BotWork.saveProposal")(function* (
    { projectId, botId }: BotAppTarget,
    proposal: StoredProposal,
  ) {
    const json = yield* encodeProposal(proposal);
    const at = DateTime.formatIso(yield* DateTime.now);
    return yield* sql`INSERT INTO bot_setup_proposals
      (project_id, coordinator_id, role_key, proposal_json, updated_at)
      VALUES (${projectId}, ${botId}, ${proposal.roleKey}, ${json}, ${at})
      ON CONFLICT (project_id, role_key) DO UPDATE SET proposal_json = excluded.proposal_json,
        updated_at = excluded.updated_at
      WHERE bot_setup_proposals.coordinator_id = excluded.coordinator_id`;
  }, Effect.mapError(storageError));

  const validateDraft = Effect.fn("BotWork.validateDraft")(function* (
    target: BotAppTarget,
    draft: BotSetupDraft,
  ) {
    const bot = yield* bots.forThread(target.threadId).pipe(Effect.mapError(storageError));
    if (bot?.agent.name.toLowerCase() === draft.name.toLowerCase())
      return yield* new BotWorkError({ code: "coordinator-name" });
    const project = yield* projects.getShell(target.projectId).pipe(Effect.mapError(storageError));
    if (Option.isNone(project)) return yield* new BotWorkError({ code: "folder-unavailable" });
    const folder = yield* Effect.gen(function* () {
      const root = yield* fs.realPath(project.value.workspaceRoot);
      const fullPath = yield* fs.realPath(path.join(root, draft.folder));
      const relative = path.relative(root, fullPath);
      return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative) &&
        (yield* fs.stat(fullPath)).type === "Directory"
      );
    }).pipe(Effect.orElseSucceed(() => false));
    if (!folder) return yield* new BotWorkError({ code: "folder-unavailable" });
    return bot;
  });

  return BotWork.of({
    state: Effect.fn("BotWork.state")(function* (target) {
      yield* tools.confirmBotChat(target);
      const app = yield* registration(target);
      if (app === null) return yield* new BotWorkError({ code: "app-unavailable" });
      const work = yield* overview(target.projectId, target.botId, app).pipe(
        Effect.mapError(storageError),
      );
      const proposals =
        app.view === "team"
          ? yield* sql<{ json: string }>`SELECT proposal_json AS json FROM bot_setup_proposals
            WHERE project_id = ${target.projectId} AND coordinator_id = ${target.botId}
            ORDER BY json_extract(proposal_json, '$.state.status') IN ('applying', 'pending') DESC,
              updated_at DESC, role_key LIMIT 8`.pipe(
              Effect.flatMap((rows) => Effect.forEach(rows, ({ json }) => decodeProposal(json))),
              Effect.mapError(storageError),
            )
          : [];
      const retros = app.view === "team" ? yield* retro.state(target.projectId) : undefined;
      return { app, ...work, proposals, ...(retros ? { retros } : {}) };
    }),

    configure: Effect.fn("BotWork.configure")(function* ({ action, ...target }) {
      yield* tools.confirmBotChat(target);
      if (action === "remove") {
        yield* sql
          .withTransaction(
            sql`UPDATE bot_apps SET work_app_json = NULL
            WHERE project_id = ${target.projectId} AND bot_id = ${target.botId}`.pipe(
              Effect.andThen(retro.pauseOwnedSchedule(target)),
            ),
          )
          .pipe(Effect.mapError(storageError));
        return;
      }
      if ((yield* registration(target))?.view === "assigned")
        return yield* new BotWorkError({ code: "app-already-configured" });
      if (!(yield* register(target, { view: "team" })))
        return yield* new BotWorkError({ code: "app-unavailable" });
    }, lock.withPermits(1)),

    propose: Effect.fn("BotWork.propose")(function* (caller, input) {
      const target = yield* tools.confirmCaller(caller);
      if (target.threadId !== caller.thread?.threadId)
        return yield* new ProjectToolError({ code: "not-a-bot" });
      if (target.plan) return yield* new ProjectToolError({ code: "plan-mode" });
      if ((yield* registration(target))?.view !== "team")
        return yield* new BotWorkError({ code: "team-required" });
      const current = yield* loadProposal(target, input.roleKey);
      if (current && current.coordinatorId !== target.botId)
        return yield* new BotWorkError({ code: "role-already-proposed" });
      if (
        current &&
        (current.proposal.state.status !== "rejected" ||
          current.proposal.revision !== input.replacesRejectedRevision)
      ) {
        const { roleKey, revision, state } = current.proposal;
        return { roleKey, revision, state };
      }
      if (!current && input.replacesRejectedRevision !== undefined)
        return yield* new BotWorkError({ code: "proposal-changed" });

      const bot = yield* validateDraft(target, input.draft);
      if (!bot) return yield* new ProjectToolError({ code: "not-a-bot" });
      const owner = yield* tools.confirmCaller(caller);
      if (
        owner.runId !== target.runId ||
        owner.botId !== target.botId ||
        owner.projectId !== target.projectId ||
        owner.plan
      )
        return yield* new ProjectToolError({ code: "policy-changed" });
      const proposal = {
        roleKey: input.roleKey,
        revision: yield* uuid,
        draft: input.draft,
        modelSelection: bot.agent.config.modelSelection,
        candidateId: current?.proposal.candidateId ?? TaskAgentId.make(`setup-bot:${yield* uuid}`),
        state: { status: "pending" },
      } satisfies StoredProposal;
      yield* saveProposal(target, proposal);
      return { roleKey: proposal.roleKey, revision: proposal.revision, state: proposal.state };
    }, lock.withPermits(1)),

    retroSchedule: retro.configure,
    retroPropose: retro.propose,
    retroReview: retro.review,

    review: Effect.fn("BotWork.review")(function* (input) {
      yield* tools.confirmBotChat(input);
      if ((yield* registration(input))?.view !== "team")
        return yield* new BotWorkError({ code: "team-required" });
      const current = yield* loadProposal(input, input.roleKey);
      if (
        !current ||
        current.coordinatorId !== input.botId ||
        current.proposal.revision !== input.revision
      )
        return yield* new BotWorkError({ code: "proposal-changed" });
      const { proposal } = current;
      if (input.decision.kind === "approve" && proposal.state.status === "applied") return;
      if (
        proposal.state.status !== "pending" &&
        !(proposal.state.status === "applying" && input.decision.kind === "approve")
      )
        return yield* new BotWorkError({ code: "proposal-changed" });

      if (input.decision.kind === "reject") {
        yield* saveProposal(input, { ...proposal, state: { status: "rejected" } });
        return;
      }
      if (input.decision.kind === "edit") {
        yield* validateDraft(input, input.decision.draft);
        yield* saveProposal(input, {
          ...proposal,
          draft: input.decision.draft,
          revision: yield* uuid,
        });
        return;
      }

      const { draft, modelSelection, candidateId } = proposal;
      let application = proposal.state;
      if (application.status === "pending") {
        yield* validateDraft(input, draft);
        const matching = (yield* bots
          .projectRoster(input.projectId)
          .pipe(Effect.mapError(storageError))).filter(
          ({ agent }) => agent.name.toLowerCase() === draft.name.toLowerCase(),
        );
        if (matching.length > 1) return yield* new BotWorkError({ code: "ambiguous-name" });
        yield* tools.confirmBotChat(input);
        application = {
          status: "applying",
          botId: matching[0]?.agent.id ?? candidateId,
          reused: matching.length === 1,
        };
        yield* saveProposal(input, { ...proposal, state: application });
      }
      if (application.status !== "applying")
        return yield* new BotWorkError({ code: "proposal-changed" });
      const bot = yield* bots
        .ensureSetupBot(
          {
            id: application.botId,
            projectId: input.projectId,
            allowedProjectIds: [input.projectId],
            name: draft.name,
            config: {
              role: draft.role,
              instructions: draft.instructions,
              skills: draft.skills,
              workingFolder: draft.folder,
              runtimeMode: "approval-required",
              modelSelection,
            },
          },
          application.reused,
        )
        .pipe(Effect.mapError((cause) => new BotWorkError({ code: "setup-unavailable", cause })));
      const reused = application.reused;

      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const app = yield* register(
              { projectId: bot.projectId, botId: bot.agent.id, threadId: bot.threadId },
              { view: "assigned", title: draft.appTitle },
            );
            if (!app) return yield* new BotWorkError({ code: "setup-unavailable" });
            yield* saveProposal(input, {
              ...proposal,
              state: {
                status: "applied",
                botId: bot.agent.id,
                threadId: bot.threadId,
                reused,
              },
            });
          }),
        )
        .pipe(Effect.catchTags({ SqlError: (cause) => Effect.fail(storageError(cause)) }));
    }, lock.withPermits(1)),
  });
});

export const layer = Layer.effect(BotWork, make).pipe(Layer.provide(BotRetro.layer));
