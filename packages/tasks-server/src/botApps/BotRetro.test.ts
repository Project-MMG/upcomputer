import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TaskAgentId, TaskAgentRunId, TaskId } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import {
  runExperimentalFeatureMigrations,
  Scheduler,
} from "../../../../apps/server/src/extensionApi.ts";
import { TaskAgentService } from "../agents/TaskAgentService.ts";
import { TASK_MIGRATION_CONTRIBUTION } from "../persistence/migrations/index.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";
import { TaskRepositoryLive } from "../persistence/TaskRepositoryLive.ts";
import * as ProjectTools from "../projectTools/ProjectTools.ts";
import * as BotRetro from "./BotRetro.ts";

const projectId = ProjectId.make("retro-project");
const botId = TaskAgentId.make("coordinator");
const threadId = ThreadId.make("coordinator-chat");
const ownerId = TaskAgentId.make("specialist");
const target = { projectId, botId, threadId };
const modelSelection = { instanceId: ProviderInstanceId.make("fixture"), model: "fixture" };
const timezone = "America/Denver";
const setTime = (iso: string) => TestClock.setTime(Date.parse(iso));

it.effect(
  "queues completed work once per owner and local day and persists schedule transitions",
  () =>
    Effect.gen(function* () {
      const callbacks = yield* Queue.unbounded<Effect.Effect<void>>();
      const scheduler = Layer.succeed(Scheduler, {
        register: <E, R>(_name: string, due: Effect.Effect<void, E, R>) =>
          Effect.context<R>().pipe(
            Effect.flatMap((context) =>
              Queue.offer(callbacks, due.pipe(Effect.provideContext(context), Effect.orDie)),
            ),
            Effect.asVoid,
          ),
      });
      yield* Effect.gen(function* () {
        yield* runExperimentalFeatureMigrations([TASK_MIGRATION_CONTRIBUTION]);
        const sql = yield* SqlClient.SqlClient;
        const repository = yield* TaskRepository;
        const retro = yield* BotRetro.BotRetro;
        const tick = yield* Queue.take(callbacks);

        const createdAt = "2026-10-01T00:00:00.000Z";
        for (const [id, name] of [
          [botId, "Coordinator"],
          [ownerId, "Specialist"],
        ] as const) {
          yield* repository.upsertAgent({
            id,
            name,
            projectId,
            enabled: true,
            startStatuses: [],
            startTags: [],
            startRunStatuses: [],
            config: { role: name, modelSelection, instructions: "Handle project work." },
            createdAt,
            updatedAt: createdAt,
          });
          yield* sql`INSERT INTO bots (agent_id, thread_id, project_id, allowed_projects_json)
          VALUES (${id}, ${id === botId ? threadId : "specialist-chat"}, ${projectId}, '[]')`;
        }
        yield* sql`INSERT INTO bot_apps (project_id, bot_id, work_app_json)
        VALUES (${projectId}, ${botId}, '{"view":"team"}')`;

        const complete = Effect.fn("BotRetroTest.complete")(function* (
          key: string,
          completedAt: string,
        ) {
          const taskId = TaskId.make(key);
          yield* repository.upsert({
            id: taskId,
            projectId,
            title: key,
            description: "",
            output: "Verified result.",
            status: "Done",
            priority: null,
            createdBy: "user",
            assigneeAgentRunId: null,
            sourceThreadId: null,
            sourceRunId: null,
            metadata: null,
            tags: [],
            createdAt,
            updatedAt: completedAt,
          });
          yield* repository.createAgentRun({
            id: TaskAgentRunId.make(`run:${key}`),
            taskId,
            agentId: ownerId,
            threadId,
            modelSelection,
            status: "completed",
            startedAt: completedAt,
            completedAt,
            triggerRunId: null,
            continuesRunId: null,
          });
        });
        const enable = retro.configure({
          ...target,
          schedule: { action: "enable", time: "19:00", timezone },
        });
        const pause = retro.configure({ ...target, schedule: { action: "pause" } });
        const state = retro.state(projectId);
        const queuedTasks = repository
          .search({ projectId, limit: 50 })
          .pipe(Effect.map((tasks) => tasks.filter((task) => task.createdBy === "bot-retro")));

        yield* setTime("2026-10-02T00:58:00.000Z");
        assert.isNull((yield* state).schedule);
        yield* enable;
        assert.equal((yield* state).schedule?.nextRunAt, "2026-10-02T01:00:00.000Z");
        yield* setTime("2026-10-02T01:00:00.000Z");
        yield* tick;
        assert.deepEqual((yield* state).entries, []);
        assert.deepEqual(yield* queuedTasks, []);
        assert.deepInclude((yield* state).schedule, {
          lastRunAt: "2026-10-02T01:00:00.000Z",
          nextRunAt: "2026-10-03T01:00:00.000Z",
        });

        yield* complete("older result", "2026-10-02T23:59:00.000Z");
        yield* complete("current result", "2026-10-03T00:50:00.000Z");
        yield* pause;
        yield* setTime("2026-10-03T00:59:00.000Z");
        yield* tick;
        assert.isNull((yield* state).schedule?.nextRunAt);
        assert.deepEqual(yield* queuedTasks, []);
        yield* enable;
        yield* setTime("2026-10-03T01:00:00.000Z");
        yield* tick;
        yield* tick;
        const [entry] = (yield* state).entries;
        assert.deepInclude(entry, {
          ownerId,
          date: "2026-10-02",
          evidenceTaskId: TaskId.make("current result"),
          proposal: null,
        });
        assert.deepEqual(
          (yield* queuedTasks).map(({ id }) => id),
          [entry?.queueTaskId],
        );

        yield* complete("next day's result", "2026-10-04T00:45:00.000Z");
        yield* sql`CREATE TRIGGER refuse_retro_task BEFORE INSERT ON tasks
        WHEN NEW.created_by = 'bot-retro' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`;
        yield* setTime("2026-10-04T01:00:00.000Z");
        yield* tick;
        const failed = yield* state;
        assert.isString(failed.schedule?.lastError);
        assert.equal(failed.schedule?.lastRunAt, "2026-10-03T01:00:00.000Z");
        assert.equal(failed.schedule?.nextRunAt, "2026-10-05T01:00:00.000Z");
        assert.lengthOf(failed.entries, 1);
        assert.lengthOf(yield* queuedTasks, 1);

        yield* sql`DROP TRIGGER refuse_retro_task`;
        yield* setTime("2026-10-05T01:00:00.000Z");
        yield* tick;
        assert.isNull((yield* state).schedule?.lastError);
        assert.lengthOf(yield* queuedTasks, 1);
      }).pipe(
        Effect.provide(BotRetro.layer),
        Effect.provide(
          Layer.mergeAll(
            scheduler,
            Layer.mock(TaskAgentService)({ scheduleTaskChanged: () => Effect.void }),
            Layer.mock(ProjectTools.ProjectTools)({
              confirmBotChat: () => Effect.succeed({ ...target, plan: false, runId: null }),
            }),
            TaskRepositoryLive,
          ),
        ),
        Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })),
        Effect.provide(NodeCrypto.layer),
      );
    }),
);
