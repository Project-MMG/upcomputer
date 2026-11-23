import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_WORK_RPC_METHODS,
  type Bot,
  type BotSetupReviewInput,
  type BotWorkItem,
  type WorkstreamOwner,
} from "@t3tools/tasks-contracts/v1";
import { Link } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/product/WebFeature.ts";
import { subscribeAtomChanges } from "../../../../apps/web/src/rpc/atomRegistry.ts";
import { useQuietThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { environmentThreadShells } from "../../../../apps/web/src/state/threads.ts";
import { botsChanged, useBots } from "../bots/botData.tsx";
import { readTasksWebClient } from "../environmentApi.ts";
import { projectToolErrorMessage, useRemoteData } from "../projectTools/remoteData.ts";
import { botWorkApi } from "../rpc/botWork.ts";
import { taskKey } from "../ui/shared.ts";
import { BotRetroPanel } from "./BotRetroPanel.tsx";
import { BotSetupReview } from "./BotSetupReview.tsx";

function WorkList({
  environmentId,
  title,
  items,
  roster,
}: {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly items: readonly BotWorkItem[];
  readonly roster: readonly WorkstreamOwner[];
}) {
  const gt = useGT();
  if (!items.length) return null;
  return (
    <section className="grid gap-1.5" aria-label={title}>
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="divide-y rounded-lg border bg-card">
        {items.map(({ id, title, status, priority, ownerId, hasResult, approvalThreadId }) => {
          const owner = roster.find((item) => item.id === ownerId);
          const target = taskKey({ environmentId, id });
          return (
            <li key={id} className="grid gap-1 px-3 py-2.5">
              <Link
                to={"/tasks" as never}
                search={{ task: target } as never}
                className="w-fit break-words text-sm font-medium hover:underline"
              >
                {title}
              </Link>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="break-words">
                  {owner?.name ?? (ownerId ? gt("Assigned worker") : gt("Unassigned"))}
                </span>
                <Badge variant="secondary">{status}</Badge>
                {priority ? <span className="break-words">{priority}</span> : null}
              </div>
              {approvalThreadId ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: approvalThreadId }}
                  className="w-fit text-xs text-primary underline underline-offset-2"
                >
                  {gt("Open approval")}
                </Link>
              ) : hasResult ? (
                <Link
                  to={"/tasks" as never}
                  search={{ task: target } as never}
                  className="w-fit text-xs text-primary underline underline-offset-2"
                >
                  {gt("View result")}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Workstreams({
  environmentId,
  owners,
}: {
  readonly environmentId: EnvironmentId;
  readonly owners: readonly WorkstreamOwner[];
}) {
  const gt = useGT();
  return (
    <section className="grid gap-1.5" aria-label={gt("Workstream owners")}>
      <h4 className="text-sm font-semibold">{gt("Workstream owners")}</h4>
      <ul className="divide-y rounded-lg border bg-card">
        {owners.map(({ id, name, role, threadId }) => (
          <li key={id} className="grid gap-0.5 px-3 py-2.5">
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId }}
              className="w-fit break-words text-sm font-medium hover:underline"
            >
              {name}
            </Link>
            <p className="break-words text-xs text-muted-foreground">{role}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkDashboard({
  environmentId,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
}) {
  const gt = useGT();
  const {
    threadId,
    projectId,
    agent: { id: botId },
  } = bot;
  const api = useMemo(
    () => botWorkApi(environmentId, { projectId, botId, threadId }),
    [environmentId, projectId, botId, threadId],
  );
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const state = useRemoteData(api.state, shell?.latestRun?.completedAt);
  const { refresh } = state;
  const canReview = useExperimentalFeatureRpcPermission(environmentId, BOT_WORK_RPC_METHODS.review);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Follow task and runtime approval changes while the workspace is open.
  useEffect(() => {
    const projectThreads = environmentThreadShells.threadShellsForProjectRefsAtom([
      scopeProjectRef(environmentId, projectId),
    ]);
    const pendingApprovals = Atom.map(projectThreads, (threads) =>
      JSON.stringify(
        threads
          .filter((thread) => thread.hasPendingApprovals)
          .map(({ id }) => id)
          .toSorted(),
      ),
    );
    const stopApprovals = subscribeAtomChanges(pendingApprovals, refresh);
    const stopTasks = readTasksWebClient(environmentId).tasks.subscribe((change) => {
      if (
        change.kind === "changed" &&
        (change.listChanged || change.runsChanged || change.agentsChanged)
      )
        refresh();
    });
    return () => {
      stopTasks();
      stopApprovals();
    };
  }, [environmentId, projectId, refresh]);

  const review = (input: Pick<BotSetupReviewInput, "roleKey" | "revision" | "decision">) => {
    setPending(input.roleKey);
    setError(undefined);
    void api
      .review(input)
      .then(
        () => {
          if (input.decision.kind === "approve") botsChanged();
        },
        (cause: unknown) => setError(projectToolErrorMessage(cause)),
      )
      .finally(() => {
        refresh();
        setPending(undefined);
      });
  };

  const data = state.error ? undefined : state.data;
  return (
    <div className="grid gap-5">
      <header className="flex items-start justify-between gap-2">
        <h3 className="break-words text-lg font-semibold">
          {data?.app.view === "assigned"
            ? data.app.title
            : data?.app.view === "team"
              ? gt("Team dashboard")
              : gt("Work dashboard")}
        </h3>
        <div className="shrink-0">
          <Button size="sm" variant="outline" disabled={state.loading} onClick={refresh}>
            {gt("Refresh")}
          </Button>
        </div>
      </header>
      {error || state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? state.error}
        </p>
      ) : null}
      {!data && state.loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {gt("Loading project work…")}
        </p>
      ) : null}
      {data ? (
        <>
          <WorkList
            environmentId={environmentId}
            title={gt("Current priorities")}
            items={data.priorities}
            roster={data.roster}
          />
          <WorkList
            environmentId={environmentId}
            title={gt("Blockers")}
            items={data.blockers}
            roster={data.roster}
          />
          <WorkList
            environmentId={environmentId}
            title={gt("Approvals")}
            items={data.approvals}
            roster={data.roster}
          />
          {data.proposals.length ? (
            <section className="grid gap-1.5" aria-label={gt("Bot setup proposals")}>
              <h4 className="text-sm font-semibold">{gt("Bot setup proposals")}</h4>
              {data.proposals.map((proposal) => (
                <BotSetupReview
                  key={proposal.roleKey}
                  environmentId={environmentId}
                  proposal={proposal}
                  disabled={!canReview || pending !== undefined}
                  review={(decision) =>
                    review({ roleKey: proposal.roleKey, revision: proposal.revision, decision })
                  }
                />
              ))}
            </section>
          ) : null}
          <WorkList
            environmentId={environmentId}
            title={gt("Completed handoffs")}
            items={data.handoffs}
            roster={data.roster}
          />
          {data.retros ? (
            <BotRetroPanel
              environmentId={environmentId}
              state={data.retros}
              api={api}
              refresh={refresh}
            />
          ) : null}
          {data.app.view === "team" ? (
            <Workstreams environmentId={environmentId} owners={data.roster} />
          ) : null}
          {data.priorities.length +
            data.blockers.length +
            data.approvals.length +
            data.handoffs.length ===
          0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {data.app.view === "team"
                ? gt("No project tasks to show.")
                : gt("No tasks assigned to this bot yet.")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function BotWorkPanel({
  environmentId,
  threadId,
  projectId,
}: ExperimentalWebRightPanelSurfaceProps) {
  const gt = useGT();
  const { bots, loaded } = useBots(environmentId);
  const bot = bots.find((item) => item.threadId === threadId && item.projectId === projectId);
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
      {bot ? (
        <WorkDashboard
          key={JSON.stringify([environmentId, projectId, bot.agent.id])}
          environmentId={environmentId}
          bot={bot}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {loaded
            ? gt("Open a bot chat to see its work dashboard.")
            : gt("Loading work dashboard…")}
        </p>
      )}
    </div>
  );
}
