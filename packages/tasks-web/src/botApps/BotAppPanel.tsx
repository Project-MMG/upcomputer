import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_APP_NOTE_LIMIT,
  BOT_APPS_RPC_METHODS,
  type Bot,
  type BotAppReviewInput,
  type BotAppSnapshot,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { useState } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/product/WebFeature.ts";
import { useBots } from "../bots/botData.tsx";
import { projectToolErrorMessage } from "../projectTools/remoteData.ts";
import { useBotAppState } from "./useBotAppState.ts";

type Review = (revision: string, decision: BotAppReviewInput["decision"]) => void;

function Report({ snapshot }: { readonly snapshot: BotAppSnapshot }) {
  const gt = useGT();
  const {
    definition: { source, proposedFix },
    report,
  } = snapshot;
  const sourceUrl = new URL(
    "https://search.google.com/search-console/performance/search-analytics",
  );
  sourceUrl.searchParams.set("resource_id", source.property);
  return (
    <>
      <section
        className="grid gap-3 rounded-lg border bg-card p-4"
        aria-label={gt("Report evidence")}
      >
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-semibold">{gt("Web search performance")}</h4>
          <a
            className="break-all text-sm text-primary underline underline-offset-2"
            href={source.page}
            target="_blank"
            rel="noreferrer"
          >
            {source.page}
          </a>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          {report.metrics.map(({ label, value }) => (
            <div key={label} className="rounded-md bg-muted/55 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <dl className="grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">{gt("Source and account")}</dt>
            <dd className="break-words">
              <a
                className="text-primary underline underline-offset-2"
                href={sourceUrl.href}
                target="_blank"
                rel="noreferrer"
              >
                {gt("Google Search Console")}
              </a>
              {" · "}
              {report.accountLabel}
            </dd>
            <dd className="break-all text-muted-foreground">{source.property}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{gt("Report window (Pacific time)")}</dt>
            <dd>{gt("{start} to {end}", source.window)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{gt("Report captured")}</dt>
            <dd>
              <time dateTime={report.readAt}>{new Date(report.readAt).toLocaleString()}</time>
            </dd>
          </div>
        </dl>
      </section>
      <section className="grid gap-2 rounded-lg border bg-card p-4" aria-label={gt("Proposed fix")}>
        <h4 className="text-xs font-medium text-muted-foreground">{gt("Proposed fix")}</h4>
        <p className="break-words text-sm font-semibold">{proposedFix.title}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{proposedFix.description}</p>
        <div>
          <Button
            size="sm"
            variant="outline"
            render={<a href={proposedFix.previewUrl} target="_blank" rel="noreferrer" />}
          >
            {gt("Open fix preview")}
          </Button>
        </div>
      </section>
    </>
  );
}

function ProposalReview({
  snapshot,
  disabled,
  review,
}: {
  readonly snapshot: BotAppSnapshot;
  readonly disabled: boolean;
  readonly review: Review;
}) {
  const gt = useGT();
  const [note, setNote] = useState(snapshot.note);
  const dirty = note.trim() !== snapshot.note;
  return (
    <div className="grid gap-2">
      <label className="grid gap-1.5 text-sm font-medium">
        {gt("Review note")}
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={BOT_APP_NOTE_LIMIT}
          disabled={disabled}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !dirty}
          onClick={() => review(snapshot.revision, { kind: "annotate", note })}
        >
          {gt("Save note")}
        </Button>
        <Button
          size="sm"
          disabled={disabled || dirty}
          onClick={() => review(snapshot.revision, { kind: "approve" })}
        >
          {gt("Approve app")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => review(snapshot.revision, { kind: "dismiss" })}
        >
          {gt("Dismiss proposal")}
        </Button>
      </div>
    </div>
  );
}

function BotApp({
  environmentId,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
}) {
  const gt = useGT();
  const { api, state } = useBotAppState(environmentId, bot);
  const canReview = useExperimentalFeatureRpcPermission(environmentId, BOT_APPS_RPC_METHODS.review);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const review: Review = (revision, decision) => {
    setReviewing(true);
    setError(undefined);
    void api
      .review({ revision, decision })
      .catch((cause: unknown) => {
        setError(projectToolErrorMessage(cause));
      })
      .finally(() => {
        state.refresh();
        setReviewing(false);
      });
  };
  const disabled = !canReview || reviewing;
  const { saved, proposal } = state.data ?? {};
  return (
    <div className="grid gap-5">
      {error || state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? state.error}
        </p>
      ) : null}
      {state.loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {gt("Checking bot app access…")}
        </p>
      ) : state.error ? (
        <div>
          <Button size="sm" variant="outline" onClick={state.refresh}>
            {gt("Retry")}
          </Button>
        </div>
      ) : (
        <>
          {proposal?.status === "available" ? (
            <section className="grid gap-3" aria-label={gt("App proposal")}>
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">{gt("App proposal")}</p>
                <h3 className="break-words text-lg font-semibold">
                  {proposal.snapshot.definition.title}
                </h3>
              </div>
              <Report snapshot={proposal.snapshot} />
              <ProposalReview
                key={proposal.snapshot.revision}
                snapshot={proposal.snapshot}
                disabled={disabled}
                review={review}
              />
            </section>
          ) : proposal?.status === "unavailable" ? (
            <section className="grid gap-2">
              <p role="status" className="text-sm text-muted-foreground">
                {gt("The app proposal’s source is unavailable.")}
              </p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => review(proposal.revision, { kind: "dismiss" })}
                >
                  {gt("Dismiss proposal")}
                </Button>
              </div>
            </section>
          ) : null}
          {saved?.status === "available" ? (
            <section className="grid gap-3" aria-label={gt("Saved app")}>
              <div className="grid gap-1">
                <p className="text-xs font-medium text-muted-foreground">{gt("Saved app")}</p>
                <h3 className="break-words text-lg font-semibold">
                  {saved.snapshot.definition.title}
                </h3>
              </div>
              <Report snapshot={saved.snapshot} />
              {saved.snapshot.note ? (
                <div className="grid gap-1 text-sm">
                  <h4 className="font-medium">{gt("Review note")}</h4>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {saved.snapshot.note}
                  </p>
                </div>
              ) : null}
            </section>
          ) : saved?.status === "unavailable" ? (
            <p role="status" className="text-sm text-muted-foreground">
              {gt("The saved app’s source is unavailable.")}
            </p>
          ) : null}
          {proposal || saved ? (
            <div>
              <Button size="sm" variant="outline" onClick={state.refresh}>
                {gt("Check access")}
              </Button>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {gt("This bot has no app proposal or saved report yet.")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function BotAppPanel({
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
        <BotApp
          key={JSON.stringify([environmentId, projectId, threadId, bot.agent.id])}
          environmentId={environmentId}
          bot={bot}
        />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {loaded ? gt("Open a bot chat to see its apps.") : gt("Loading bot app…")}
        </p>
      )}
    </div>
  );
}
