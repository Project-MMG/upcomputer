import { ProviderRequestKind, type ProjectId } from "@t3tools/contracts";
import {
  TaskAgentRunId,
  type BotWorkApp,
  type BotWorkItem,
  type TaskAgentId,
  type TaskPageResult,
  type TaskPageInput,
  type WorkstreamOwner,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ThreadManagementService } from "../../../../apps/server/src/extensionApi.ts";
import { BotService } from "../bots/BotService.ts";
import { TaskRepository } from "../persistence/TaskRepository.ts";

const reviewStatuses = ["In Review", "Needs Review"] as const;
const isApproval = Schema.is(ProviderRequestKind);
const workstreamLimit = 24;
const sectionLimit = 8;
type WorkTask = TaskPageResult["tasks"][number];

export const makeWorkOverview = Effect.gen(function* () {
  const bots = yield* BotService;
  const tasks = yield* TaskRepository;
  const threads = yield* ThreadManagementService;

  return Effect.fn("BotWork.overview")(function* (
    projectId: ProjectId,
    botId: TaskAgentId,
    app: BotWorkApp,
  ) {
    const roster: WorkstreamOwner[] = (yield* bots.projectRoster(projectId)).map(
      ({ agent, threadId }) => ({
        id: agent.id,
        threadId,
        name: agent.name.slice(0, 100),
        role: agent.config.role.slice(0, 100),
      }),
    );
    const byTag = new Map(roster.map(({ id }) => [`bot:${id}`, id]));
    const filters: TaskPageInput = {
      projectId,
      audience: "agent",
      ...(app.view === "assigned" ? { tags: [`bot:${botId}`] } : {}),
      limit: sectionLimit,
    };
    const [priorities, blockers, reviews, needsReview, handoffs] = yield* Effect.all([
      tasks.page({
        ...filters,
        excludeStatuses: ["Done", "Cancelled", "Blocked", ...reviewStatuses],
      }),
      tasks.page({ ...filters, status: "Blocked" }),
      tasks.page({ ...filters, status: reviewStatuses[0] }),
      tasks.page({ ...filters, status: reviewStatuses[1] }),
      tasks.page({ ...filters, status: "Done" }),
    ]);

    const summarize = Effect.fn("BotWork.summarizeTask")(function* (task: WorkTask) {
      const assignment = task.assigneeAgentRunId
        ? Option.getOrNull(
            yield* tasks.getAgentRunById({ id: TaskAgentRunId.make(task.assigneeAgentRunId) }),
          )
        : null;
      const claimed = assignment?.taskId === task.id ? assignment : null;
      const [latest] = claimed
        ? [claimed]
        : yield* tasks.searchAgentRuns({ taskId: task.id, limit: 1 });
      const tagged = task.tags.flatMap((tag) => {
        const id = byTag.get(tag);
        return id ? [id] : [];
      });
      const ownerId =
        claimed?.agentId ?? (tagged.length === 1 ? tagged[0] : latest?.agentId) ?? null;
      const approvalThreadId =
        latest && latest.completedAt === null
          ? yield* threads
              .getThreadRecords(latest.threadId, ["runtimeRequests"], {
                runtimeRequestStatuses: ["pending"],
              })
              .pipe(
                Effect.map(({ thread, runtimeRequests }) =>
                  thread.projectId === projectId &&
                  thread.deletedAt === null &&
                  thread.archivedAt === null &&
                  runtimeRequests.some(({ kind }) => isApproval(kind))
                    ? latest.threadId
                    : null,
                ),
                Effect.orElseSucceed(() => null),
              )
          : null;
      return {
        id: task.id,
        title: task.title.slice(0, 240),
        status: task.status.slice(0, 80),
        priority: task.priority?.slice(0, 80) ?? null,
        ownerId,
        hasResult: Boolean(task.output?.trim()),
        approvalThreadId,
      } satisfies BotWorkItem;
    });
    const candidates = new Map(
      [
        ...priorities.tasks,
        ...blockers.tasks,
        ...reviews.tasks,
        ...needsReview.tasks,
        ...handoffs.tasks,
      ].map((task) => [task.id, task]),
    );
    const all = yield* Effect.forEach(candidates.values(), summarize, { concurrency: 4 });
    const canSee = (item: BotWorkItem) => app.view === "team" || item.ownerId === botId;
    const summaries = new Map(all.map((item) => [item.id, item]));
    const liveApprovals: BotWorkItem[] = [];
    let cursor: TaskPageInput["cursor"];
    do {
      const page = yield* tasks.page({
        ...filters,
        lastRun: "running",
        ...(cursor === undefined ? {} : { cursor }),
      });
      const running = yield* Effect.forEach(
        page.tasks,
        (task) => {
          const summary = summaries.get(task.id);
          return summary ? Effect.succeed(summary) : summarize(task);
        },
        { concurrency: 4 },
      );
      liveApprovals.push(
        ...running.filter((item) => item.approvalThreadId !== null && canSee(item)),
      );
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && liveApprovals.length < sectionLimit);
    const items = (rows: readonly WorkTask[]) =>
      rows.flatMap(({ id }) => {
        const item = summaries.get(id);
        return item && canSee(item) ? [item] : [];
      });
    const work = items(priorities.tasks);
    const blocked = items(blockers.tasks);
    const approvalItems = [
      ...liveApprovals,
      ...work.filter((task) => task.approvalThreadId !== null),
      ...blocked.filter((task) => task.approvalThreadId !== null),
      ...items(needsReview.tasks),
      ...items(reviews.tasks),
    ];

    return {
      roster: roster
        .filter(({ id }) => app.view === "team" || id === botId)
        .slice(0, workstreamLimit),
      priorities: work.filter((task) => task.approvalThreadId === null),
      blockers: blocked,
      approvals: [...new Map(approvalItems.map((task) => [task.id, task])).values()].slice(
        0,
        sectionLimit,
      ),
      handoffs: items(handoffs.tasks).filter((task) => task.ownerId !== null || task.hasResult),
    };
  });
});
