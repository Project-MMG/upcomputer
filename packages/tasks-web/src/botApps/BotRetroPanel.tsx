import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_WORK_RPC_METHODS,
  type BotRetroReviewInput,
  type BotRetroState,
} from "@t3tools/tasks-contracts/v1";
import { Link } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useState } from "react";

import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import { projectToolErrorMessage } from "../projectTools/remoteData.ts";
import type { botWorkApi } from "../rpc/botWork.ts";
import { taskKey } from "../ui/shared.ts";

type Review = Pick<BotRetroReviewInput, "date" | "ownerId" | "revision" | "decision">;

export function BotRetroPanel({
  environmentId,
  state,
  api,
  refresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly state: BotRetroState;
  readonly api: ReturnType<typeof botWorkApi>;
  readonly refresh: () => void;
}) {
  const gt = useGT();
  const maySchedule = useExperimentalFeatureRpcPermission(
    environmentId,
    BOT_WORK_RPC_METHODS.retroSchedule,
  );
  const mayReview = useExperimentalFeatureRpcPermission(
    environmentId,
    BOT_WORK_RPC_METHODS.retroReview,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const { schedule, entries } = state;
  const run = (write: () => Promise<unknown>) => {
    setPending(true);
    setError(undefined);
    void write()
      .catch((cause: unknown) => setError(projectToolErrorMessage(cause)))
      .finally(() => {
        refresh();
        setPending(false);
      });
  };
  const dateTime = (value: string | null | undefined) =>
    value && schedule
      ? new Date(value).toLocaleString(undefined, {
          timeZone: schedule.timezone,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : gt("None");

  return (
    <section className="grid gap-2" aria-label={gt("Completed work retrospectives")}>
      <h4 className="text-sm font-semibold">{gt("Completed work retrospectives")}</h4>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="grid gap-2 rounded-lg border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-sm font-medium">{gt("Daily review queue")}</h5>
          {schedule ? (
            <Badge variant="secondary">{schedule.nextRunAt ? gt("Active") : gt("Paused")}</Badge>
          ) : null}
        </div>
        {schedule ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{gt("Schedule")}</dt>
            <dd className="break-words">
              {schedule.time} · {schedule.timezone}
            </dd>
            <dt className="text-muted-foreground">{gt("Last successful check")}</dt>
            <dd>{dateTime(schedule.lastRunAt)}</dd>
            <dt className="text-muted-foreground">{gt("Next check")}</dt>
            <dd>{dateTime(schedule.nextRunAt)}</dd>
          </dl>
        ) : null}
        {schedule?.lastError ? (
          <p role="alert" className="text-sm text-destructive">
            {schedule.lastError}
          </p>
        ) : null}
        {schedule?.nextRunAt ? (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={!maySchedule || pending}
              onClick={() => run(() => api.retroSchedule({ action: "pause" }))}
            >
              {gt("Pause daily queue")}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!maySchedule || pending) return;
              const data = new FormData(event.currentTarget);
              run(() =>
                api.retroSchedule({
                  action: "enable",
                  time: String(data.get("time")),
                  timezone: String(data.get("timezone")),
                }),
              );
            }}
          >
            <label className="grid gap-1 text-xs">
              {gt("Daily time")}
              <Input
                type="time"
                name="time"
                required
                defaultValue={schedule?.time ?? "17:00"}
                disabled={!maySchedule || pending}
              />
            </label>
            <label className="grid min-w-32 grow gap-1 text-xs">
              {gt("Project time zone")}
              <Input
                name="timezone"
                required
                defaultValue={schedule?.timezone ?? state.defaultTimezone}
                disabled={!maySchedule || pending}
              />
            </label>
            <Button size="sm" type="submit" disabled={!maySchedule || pending}>
              {schedule ? gt("Resume daily queue") : gt("Enable daily queue")}
            </Button>
          </form>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{gt("No completed work in review yet.")}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {entries.map((entry) => (
            <li key={`${entry.ownerId}:${entry.date}`} className="px-3 py-2.5">
              <RetroEntry
                entry={entry}
                environmentId={environmentId}
                disabled={!mayReview || pending}
                review={(decision) => run(() => api.retroReview(decision))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RetroEntry({
  entry,
  environmentId,
  disabled,
  review,
}: {
  readonly entry: BotRetroState["entries"][number];
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly review: (input: Review) => void;
}) {
  const gt = useGT();
  const { date, ownerId, ownerName, proposal, revision, decision, queueTaskId } = entry;
  const status =
    decision === "approved"
      ? gt("Approved")
      : decision === "dismissed"
        ? gt("Dismissed")
        : proposal
          ? gt("Needs review")
          : gt("Queued");
  const change = {
    instructions: gt("Instruction change"),
    skill: gt("Skill change"),
    grant: gt("Tool grant change"),
  };

  return (
    <details>
      <summary className="cursor-pointer break-words text-sm font-medium">
        {ownerName || gt("Former bot")} <time dateTime={date}>{date}</time>{" "}
        <Badge variant="secondary">{status}</Badge>
      </summary>
      <div className="mt-2 grid gap-2 text-sm">
        <Link
          to={"/tasks" as never}
          search={{ task: taskKey({ environmentId, id: entry.evidenceTaskId }) } as never}
          className="w-fit break-words text-primary underline underline-offset-2"
        >
          {entry.evidenceTitle}
        </Link>
        {queueTaskId ? (
          <Link
            to={"/tasks" as never}
            search={{ task: taskKey({ environmentId, id: queueTaskId }) } as never}
            className="w-fit text-xs text-primary underline underline-offset-2"
          >
            {gt("Open review task")}
          </Link>
        ) : null}
        {proposal ? (
          <>
            <dl className="grid gap-1">
              <dt className="font-medium">{gt("Outcome")}</dt>
              <dd className="whitespace-pre-wrap break-words">{proposal.outcome}</dd>
              <dt className="font-medium">{change[proposal.kind]}</dt>
              <dd className="whitespace-pre-wrap break-words">{proposal.change}</dd>
            </dl>
            {decision === "approved" ? (
              <p className="text-xs text-muted-foreground">
                {gt("Apply this change in the bot settings or project files.")}
              </p>
            ) : null}
            {decision === null ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => review({ date, ownerId, revision, decision: "approved" })}
                >
                  {gt("Approve proposal")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => review({ date, ownerId, revision, decision: "dismissed" })}
                >
                  {gt("Dismiss proposal")}
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => review({ date, ownerId, revision, decision: "reopen" })}
                >
                  {gt("Reopen proposal")}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </details>
  );
}
