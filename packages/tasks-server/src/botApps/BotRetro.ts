import type { ProjectId } from "@t3tools/contracts";
import {
  BotRetroProposal,
  BotWorkError,
  ProjectToolError,
  TaskId,
  type BotAppTarget,
  type BotRetroEntry,
  type BotRetroProposeInput,
  type BotRetroReviewInput,
  type BotRetroScheduleInput,
  type BotRetroState,
  type TaskAgentRunId,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";

import { Scheduler, type McpInvocationContext } from "../../../../apps/server/src/extensionApi.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { computeNextRunAt } from "../automations/automationSchedule.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import * as ProjectTools from "../projectTools/ProjectTools.ts";
import { isTimeZone, scheduledInstant } from "../schedule/reminders.ts";

type Invocation = McpInvocationContext["Service"];
type RetroError = BotWorkError | ProjectToolError;
type Schedule = NonNullable<BotRetroState["schedule"]>;
type DueSchedule = BotAppTarget & Pick<Schedule, "time" | "timezone"> & { nextRunAt: string };
type Evidence = Pick<BotRetroEntry, "ownerId" | "evidenceTaskId" | "evidenceTitle"> & {
  readonly evidenceRunId: TaskAgentRunId;
  readonly completedAt: string;
};
type StoredEntry = Omit<BotRetroEntry, "proposal"> & { readonly proposalJson: string | null };

const proposalJson = Schema.fromJsonString(BotRetroProposal);
const encodeProposal = Schema.encodeEffect(proposalJson);
const decodeProposal = Schema.decodeUnknownEffect(proposalJson);
const retroTaskCreator = "bot-retro";

const isWorkError = Schema.is(BotWorkError);
const isToolError = Schema.is(ProjectToolError);
const asRetroError = (cause: unknown): RetroError =>
  isWorkError(cause) || isToolError(cause)
    ? cause
    : new BotWorkError({ code: "storage-unavailable", cause });

function dateInZone(at: string, timezone: string) {
  return Option.map(DateTime.makeZoned(at, { timeZone: timezone }), DateTime.formatIsoDate);
}

function nextRun(time: string, timezone: string, at: string) {
  const [hours, minutes] = time.split(":");
  return computeNextRunAt(
    { cron: `${minutes} ${hours} * * *`, timezone },
    DateTime.toDateUtc(DateTime.makeUnsafe(at)),
  );
}

export class BotRetro extends Context.Service<
  BotRetro,
  {
    readonly state: (projectId: ProjectId) => Effect.Effect<BotRetroState, RetroError>;
    readonly configure: (input: BotRetroScheduleInput) => Effect.Effect<void, RetroError>;
    readonly pauseOwnedSchedule: (target: BotAppTarget) => Effect.Effect<void, RetroError>;
    readonly propose: (
      caller: Invocation,
      input: BotRetroProposeInput,
    ) => Effect.Effect<
      { readonly date: string; readonly ownerId: BotRetroEntry["ownerId"] },
      RetroError
    >;
    readonly review: (input: BotRetroReviewInput) => Effect.Effect<void, RetroError>;
  }
>()("@t3tools/tasks-server/botApps/BotRetro") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repository = yield* TaskRepository;
  const agents = yield* TaskAgentService;
  const tools = yield* ProjectTools.ProjectTools;
  const scheduler = yield* Scheduler;
  const uuid = (yield* SecureRandom.SecureRandom).uuidV4();
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const scheduleFor = Effect.fn("BotRetro.scheduleFor")(function* (projectId: ProjectId) {
    const [schedule] = yield* sql<Schedule>`SELECT time, timezone, next_run_at AS "nextRunAt",
      last_run_at AS "lastRunAt", last_error AS "lastError" FROM bot_retro_schedules
      WHERE project_id = ${projectId}`;
    return schedule ?? null;
  });

  const defaultTimezone = repository
    .scheduleSettings()
    .pipe(Effect.map(({ scheduleTimeZone, serverTimeZone }) => scheduleTimeZone ?? serverTimeZone));

  const confirmTeam = Effect.fn("BotRetro.confirmTeam")(function* (target: BotAppTarget) {
    yield* tools.confirmBotChat(target);
    const [team] = yield* sql`SELECT 1 FROM bot_apps
      WHERE project_id = ${target.projectId} AND bot_id = ${target.botId}
        AND json_extract(work_app_json, '$.view') = 'team'`;
    if (!team) return yield* new BotWorkError({ code: "retro-team-required" });
  });

  const evidenceFields = sql`r.id AS "evidenceRunId", r.agent_id AS "ownerId",
    t.id AS "evidenceTaskId", substr(t.title, 1, 240) AS "evidenceTitle",
    r.completed_at AS "completedAt"`;
  const completedWork = (projectId: ProjectId) => sql`
    FROM bots b JOIN task_agent_runs r ON r.agent_id = b.agent_id
    JOIN tasks t ON t.id = r.task_id
    WHERE b.project_id = ${projectId} AND t.project_id = ${projectId}
      AND t.audience = 'agent' AND t.kind = 'task' AND trim(t.status) = 'Done' COLLATE NOCASE
      AND trim(t.output) <> '' AND t.created_by <> ${retroTaskCreator}
      AND r.status = 'completed' AND r.completed_at IS NOT NULL
      AND r.id = (SELECT latest.id FROM task_agent_runs latest WHERE latest.task_id = t.id
        ORDER BY latest.started_at DESC, latest.id ASC LIMIT 1)`;

  const createQueueTask = Effect.fn("BotRetro.createQueueTask")(function* (
    target: BotAppTarget,
    source: Evidence,
    date: string,
    at: string,
  ) {
    const id = TaskId.make(`bot-retro:${yield* uuid}`);
    const claimed = yield* sql`INSERT INTO bot_retro_entries
      (project_id, owner_id, date, evidence_task_id, evidence_run_id, evidence_title, queue_task_id)
      VALUES (${target.projectId}, ${source.ownerId}, ${date}, ${source.evidenceTaskId},
        ${source.evidenceRunId}, ${source.evidenceTitle}, ${id})
      ON CONFLICT DO NOTHING RETURNING owner_id`;
    if (claimed.length === 0) return null;

    return yield* repository.upsert({
      id,
      projectId: target.projectId,
      title: `Review completed work: ${source.evidenceTitle}`,
      description: [
        `Review the result of completed project task ${source.evidenceTaskId}.`,
        "Use the project's retro guidance. Summarize the outcome and propose one change to instructions, a skill, or a tool grant with bot_retro_propose.",
        "Keep customer details in the source app. Leave the proposed change for the operator to decide in the team dashboard.",
      ].join("\n"),
      output: null,
      status: "To Do",
      priority: null,
      createdBy: retroTaskCreator,
      assigneeAgentRunId: null,
      sourceThreadId: target.threadId,
      sourceRunId: null,
      metadata: { botId: target.botId, targetAgentId: target.botId },
      tags: [`bot:${target.botId}`],
      createdAt: at,
      updatedAt: at,
    });
  });

  const runDue = Effect.fn("BotRetro.runDue")(function* (due: DueSchedule, at: string) {
    const next = nextRun(due.time, due.timezone, at);
    const nextRunAt = Result.isSuccess(next) ? next.success : null;
    const sameSlot = sql`project_id = ${due.projectId} AND coordinator_id = ${due.botId}
      AND next_run_at = ${due.nextRunAt} AND time = ${due.time} AND timezone = ${due.timezone}`;
    const run = repository.withChangeTransaction(
      Effect.gen(function* () {
        const [current] = yield* sql`SELECT 1 FROM bot_retro_schedules WHERE ${sameSlot}`;
        if (!current) return [];
        if (nextRunAt === null) return yield* new BotWorkError({ code: "retro-schedule-invalid" });

        yield* confirmTeam(due);
        const date = Option.getOrThrow(dateInZone(due.nextRunAt, due.timezone));
        const today = Option.getOrThrow(dateInZone(at, due.timezone));
        if (date !== today) {
          yield* sql`UPDATE bot_retro_schedules SET next_run_at = ${nextRunAt} WHERE ${sameSlot}`;
          return [];
        }

        const midnight = scheduledInstant(date, "00:00", due.timezone);
        if (midnight === null) return yield* new BotWorkError({ code: "retro-schedule-invalid" });
        const start = DateTime.formatIso(DateTime.makeUnsafe(midnight));
        const sources = yield* sql<Evidence>`SELECT * FROM (
          SELECT ${evidenceFields}, ROW_NUMBER() OVER (
            PARTITION BY r.agent_id ORDER BY r.completed_at DESC, r.id ASC
          ) AS position ${completedWork(due.projectId)}
            AND r.completed_at >= ${start} AND r.completed_at <= ${at}
        ) WHERE position = 1 ORDER BY "ownerId"`;
        const tasks = yield* Effect.forEach(sources, (source) =>
          createQueueTask(due, source, date, at),
        );
        yield* sql`UPDATE bot_retro_schedules SET next_run_at = ${nextRunAt},
          last_run_at = ${at}, last_error = NULL WHERE ${sameSlot}`;
        return tasks;
      }),
    );
    const result = yield* Effect.result(run);
    if (Result.isFailure(result)) {
      const error = asRetroError(result.failure);
      yield* sql`UPDATE bot_retro_schedules SET next_run_at = ${nextRunAt},
        last_error = ${error.message} WHERE ${sameSlot}`;
      return;
    }

    for (const task of result.success) {
      if (task) yield* agents.scheduleTaskChanged({ task, reason: "created" });
    }
  });

  yield* scheduler.register(
    "bot-retros",
    Effect.gen(function* () {
      const at = yield* now;
      const due = yield* sql<DueSchedule>`SELECT s.project_id AS "projectId",
        s.coordinator_id AS "botId", b.thread_id AS "threadId", s.time, s.timezone,
        s.next_run_at AS "nextRunAt" FROM bot_retro_schedules s JOIN bots b ON b.agent_id = s.coordinator_id
        WHERE s.next_run_at <= ${at} ORDER BY s.next_run_at LIMIT 32`;
      yield* Effect.forEach(
        due,
        (slot) =>
          runDue(slot, at).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not record a bot retrospective check", {
                projectId: slot.projectId,
                cause,
              }),
            ),
          ),
        { discard: true },
      );
    }),
  );

  return BotRetro.of({
    state: Effect.fn("BotRetro.state")(function* (projectId) {
      const rows = yield* sql<StoredEntry>`SELECT e.date, e.owner_id AS "ownerId",
        substr(COALESCE(a.name, ''), 1, 100) AS "ownerName",
        e.evidence_task_id AS "evidenceTaskId", e.evidence_title AS "evidenceTitle",
        e.queue_task_id AS "queueTaskId", e.proposal_json AS "proposalJson", e.revision, e.decision
        FROM bot_retro_entries e LEFT JOIN task_agents a ON a.id = e.owner_id
        WHERE e.project_id = ${projectId}
        ORDER BY (e.proposal_json IS NOT NULL AND e.decision IS NULL) DESC,
          e.date DESC, e.owner_id LIMIT 12`;
      const entries = yield* Effect.forEach(rows, ({ proposalJson, ...entry }) =>
        Effect.gen(function* () {
          const proposal = proposalJson === null ? null : yield* decodeProposal(proposalJson);
          return { ...entry, proposal };
        }),
      );
      return {
        entries,
        schedule: yield* scheduleFor(projectId),
        defaultTimezone: yield* defaultTimezone,
      };
    }, Effect.mapError(asRetroError)),

    configure: Effect.fn("BotRetro.configure")(
      function* (input) {
        yield* confirmTeam(input);
        const { projectId, botId, schedule } = input;
        if (schedule.action === "pause") {
          yield* sql`UPDATE bot_retro_schedules SET next_run_at = NULL WHERE project_id = ${projectId}`;
          return;
        }
        const { time, timezone } = schedule;
        const next = nextRun(time, timezone, yield* now);
        if (!isTimeZone(timezone) || Result.isFailure(next)) {
          return yield* new BotWorkError({ code: "retro-schedule-invalid" });
        }
        yield* sql`INSERT INTO bot_retro_schedules (project_id, coordinator_id, time, timezone, next_run_at)
        VALUES (${projectId}, ${botId}, ${time}, ${timezone}, ${next.success})
        ON CONFLICT (project_id) DO UPDATE SET coordinator_id = excluded.coordinator_id,
          time = excluded.time, timezone = excluded.timezone, next_run_at = excluded.next_run_at`;
      },
      (effect) => sql.withTransaction(effect),
      Effect.mapError(asRetroError),
    ),

    pauseOwnedSchedule: Effect.fn("BotRetro.pauseOwnedSchedule")(function* ({ projectId, botId }) {
      yield* sql`UPDATE bot_retro_schedules SET next_run_at = NULL
        WHERE project_id = ${projectId} AND coordinator_id = ${botId}`;
    }, Effect.mapError(asRetroError)),

    propose: Effect.fn("BotRetro.propose")(
      function* (caller, input) {
        const target = yield* tools.confirmCaller(caller);
        if (target.plan) return yield* new ProjectToolError({ code: "plan-mode" });
        yield* confirmTeam(target);
        const { projectId } = target;
        const { evidenceTaskId, ...proposal } = input;
        const [source] = yield* sql<Evidence>`SELECT ${evidenceFields} ${completedWork(projectId)}
        AND t.id = ${evidenceTaskId} LIMIT 1`;
        if (!source) return yield* new BotWorkError({ code: "retro-evidence-unavailable" });
        const [existing] = yield* sql<{
          date: string;
          queueTaskId: TaskId | null;
        }>`SELECT date, queue_task_id AS "queueTaskId" FROM bot_retro_entries
          WHERE project_id = ${projectId} AND evidence_run_id = ${source.evidenceRunId}`;
        if (caller.thread?.threadId !== target.threadId) {
          const run = caller.thread
            ? Option.getOrNull(
                yield* repository.findLatestAgentRunByThreadId({
                  threadId: caller.thread.threadId,
                }),
              )
            : null;
          if (
            run === null ||
            run.completedAt !== null ||
            run.agentId !== target.botId ||
            run.taskId !== existing?.queueTaskId
          )
            return yield* new BotWorkError({ code: "retro-evidence-unavailable" });
        }

        const timezone = (yield* scheduleFor(projectId))?.timezone ?? (yield* defaultTimezone);
        const date = existing?.date ?? Option.getOrThrow(dateInZone(source.completedAt, timezone));
        const { ownerId } = source;
        const json = yield* encodeProposal(proposal);
        const [saved] = yield* sql`INSERT INTO bot_retro_entries
        (project_id, owner_id, date, evidence_task_id, evidence_run_id, evidence_title, proposal_json)
        VALUES (${projectId}, ${ownerId}, ${date}, ${evidenceTaskId}, ${source.evidenceRunId},
          ${source.evidenceTitle}, ${json})
        ON CONFLICT (project_id, owner_id, date) DO UPDATE
          SET proposal_json = COALESCE(bot_retro_entries.proposal_json, excluded.proposal_json)
          WHERE bot_retro_entries.evidence_run_id = excluded.evidence_run_id
        RETURNING owner_id`;
        if (!saved) return yield* new BotWorkError({ code: "retro-evidence-unavailable" });
        return { date, ownerId };
      },
      (effect) => sql.withTransaction(effect),
      Effect.mapError(asRetroError),
    ),

    review: Effect.fn("BotRetro.review")(
      function* (input) {
        yield* confirmTeam(input);
        const { projectId, ownerId, date, revision, decision } = input;
        const reopen = decision === "reopen";
        const canUpdate = reopen
          ? sql`decision IS NOT NULL`
          : sql`decision IS NULL OR decision = ${decision}`;
        const [updated] = yield* sql`UPDATE bot_retro_entries
        SET decision = ${reopen ? null : decision}, revision = ${reopen ? revision + 1 : revision}
        WHERE project_id = ${projectId} AND owner_id = ${ownerId} AND date = ${date}
          AND proposal_json IS NOT NULL AND revision = ${revision} AND (${canUpdate})
        RETURNING owner_id`;
        if (!updated) return yield* new BotWorkError({ code: "retro-proposal-unavailable" });
      },
      (effect) => sql.withTransaction(effect),
      Effect.mapError(asRetroError),
    ),
  });
});

export const layer = Layer.effect(BotRetro, make);
