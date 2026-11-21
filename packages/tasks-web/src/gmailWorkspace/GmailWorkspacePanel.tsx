import { useGT } from "gt-react";
import { ArrowLeftIcon, ArrowRightIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { GmailWorkspaceLayout, GmailWorkspaceTarget } from "@t3tools/tasks-contracts/v1";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/product/WebFeature.ts";
import { useBots } from "../bots/botData.tsx";
import { useRemoteData } from "../projectTools/remoteData.ts";
import type { gmailWorkspaceApi } from "../rpc/gmailWorkspace.ts";
import { useGmailWorkspaceLayout } from "./GmailWorkspaceToolbar.tsx";

type Api = ReturnType<typeof gmailWorkspaceApi>;
type PageStack = ReturnType<typeof usePageStack>;

function usePageStack() {
  const [tokens, setTokens] = useState<ReadonlyArray<string | undefined>>([undefined]);
  return {
    token: tokens.at(-1),
    hasPrevious: tokens.length > 1,
    back: () => setTokens((current) => current.slice(0, -1)),
    next: (token: string) => setTokens((current) => [...current, token]),
  };
}

function Pager(props: { readonly pages: PageStack; readonly next: string | null }) {
  const gt = useGT();
  const next = props.next;
  if (!props.pages.hasPrevious && next === null) return null;
  return (
    <div className="flex justify-between gap-2 pt-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={!props.pages.hasPrevious}
        onClick={props.pages.back}
      >
        <ArrowLeftIcon aria-hidden />
        {gt("Previous page")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={next === null}
        onClick={() => next !== null && props.pages.next(next)}
      >
        {gt("Next page")}
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  );
}

function PaneStatus({ children, error }: { readonly children: string; readonly error?: boolean }) {
  return (
    <p role={error ? "alert" : "status"} className="px-3 py-2 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function InboxPage(props: {
  readonly api: Api;
  readonly pages: PageStack;
  readonly selectedThread: string | null;
  readonly onOpenThread: (id: string) => void;
}) {
  const gt = useGT();
  const token = props.pages.token;
  const { api } = props;
  const inbox = useRemoteData(useCallback(() => api.inbox(token), [api, token]));
  return (
    <>
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 className="text-sm font-medium">{gt("Inbox")}</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={gt("Refresh inbox")}
          disabled={inbox.loading}
          onClick={inbox.refresh}
        >
          <RefreshCwIcon aria-hidden />
        </Button>
      </div>
      {inbox.error ? (
        <PaneStatus error>{inbox.error}</PaneStatus>
      ) : inbox.data === undefined ? (
        <PaneStatus>{gt("Loading mail…")}</PaneStatus>
      ) : inbox.data.threads.length === 0 ? (
        <PaneStatus>{gt("No inbox mail on this page.")}</PaneStatus>
      ) : (
        <ul className="max-h-80 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
          {inbox.data.threads.map((thread) => (
            <li key={thread.threadId}>
              <button
                type="button"
                aria-pressed={props.selectedThread === thread.threadId}
                onClick={() => props.onOpenThread(thread.threadId)}
                className="grid w-full cursor-pointer grid-cols-[0.5rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent"
              >
                <span
                  className={cn("size-1.5 self-center rounded-full", thread.unread && "bg-primary")}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className={cn("block truncate text-sm", thread.unread && "font-semibold")}>
                    {thread.subject || gt("(No subject)")}
                  </span>
                  {thread.sender ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {thread.sender}
                    </span>
                  ) : null}
                  {thread.preview ? (
                    <span className="block truncate pt-0.5 text-xs text-muted-foreground">
                      {thread.preview}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pager pages={props.pages} next={inbox.error ? null : (inbox.data?.nextPageToken ?? null)} />
    </>
  );
}

function ThreadPage({
  api,
  threadId,
  pages,
}: {
  readonly api: Api;
  readonly threadId: string;
  readonly pages: PageStack;
}) {
  const gt = useGT();
  const token = pages.token;
  const thread = useRemoteData(
    useCallback(() => api.thread(threadId, token), [api, threadId, token]),
  );
  if (thread.error) {
    return (
      <>
        <PaneStatus error>{thread.error}</PaneStatus>
        <Button variant="outline" size="sm" onClick={thread.refresh} disabled={thread.loading}>
          {gt("Retry thread")}
        </Button>
        <Pager pages={pages} next={null} />
      </>
    );
  }
  if (thread.data === undefined) return <PaneStatus>{gt("Loading thread…")}</PaneStatus>;
  return (
    <>
      {thread.data.messages.length === 0 ? (
        <PaneStatus>{gt("No messages on this page.")}</PaneStatus>
      ) : (
        <div className="divide-y divide-border/60 rounded-md border border-border">
          {thread.data.messages.map((message) => (
            <article key={message.messageId} className="min-w-0 space-y-2 p-3">
              <h4 className="text-sm font-medium wrap-anywhere">
                {message.subject || gt("(No subject)")}
              </h4>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted-foreground">
                <span className="wrap-anywhere">{message.sender}</span>
                {message.receivedAt && Number.isFinite(Date.parse(message.receivedAt)) ? (
                  <time dateTime={message.receivedAt}>
                    {new Date(message.receivedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                ) : null}
              </div>
              <p className="text-sm wrap-anywhere whitespace-pre-wrap select-text">
                {message.body || gt("No message text available.")}
              </p>
            </article>
          ))}
        </div>
      )}
      <Pager pages={pages} next={thread.data.nextPageToken} />
    </>
  );
}

function ThreadReader({ api, threadId }: { readonly api: Api; readonly threadId: string }) {
  const pages = usePageStack();
  return <ThreadPage key={pages.token ?? ""} api={api} threadId={threadId} pages={pages} />;
}

function Workspace({ api, layout }: { readonly api: Api; readonly layout: GmailWorkspaceLayout }) {
  const gt = useGT();
  const pages = usePageStack();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const order =
    layout.order === "inbox-first"
      ? (["inbox", "thread"] as const)
      : (["thread", "inbox"] as const);
  return (
    <section
      aria-label={gt("Gmail workspace")}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3"
    >
      <h2 className="mb-3 text-base font-semibold wrap-anywhere">{layout.title}</h2>
      <div className="flex flex-col gap-4">
        {order.map((control) =>
          control === "inbox" ? (
            <section key={control} aria-label={gt("Inbox")} data-workspace-control={control}>
              <InboxPage
                key={pages.token ?? ""}
                api={api}
                pages={pages}
                selectedThread={selectedThread}
                onOpenThread={setSelectedThread}
              />
            </section>
          ) : (
            <section
              key={control}
              aria-label={gt("Thread reader")}
              data-workspace-control={control}
            >
              <h3 className="pb-2 text-sm font-medium">{gt("Thread reader")}</h3>
              {selectedThread === null ? (
                <PaneStatus>{gt("Select an email to read its thread.")}</PaneStatus>
              ) : (
                <ThreadReader key={selectedThread} api={api} threadId={selectedThread} />
              )}
            </section>
          ),
        )}
      </div>
    </section>
  );
}

function SavedWorkspace({
  environmentId,
  target,
}: {
  readonly environmentId: EnvironmentId;
  readonly target: GmailWorkspaceTarget;
}) {
  const gt = useGT();
  const { api, layout } = useGmailWorkspaceLayout(environmentId, target);
  if (layout.error) return <PaneStatus error>{layout.error}</PaneStatus>;
  if (layout.data === undefined) return <PaneStatus>{gt("Loading Gmail workspace…")}</PaneStatus>;
  if (layout.data === null)
    return <PaneStatus>{gt("Ask this bot to create a Gmail workspace.")}</PaneStatus>;
  return <Workspace api={api} layout={layout.data} />;
}

export default function GmailWorkspacePanel({
  environmentId,
  projectId,
  threadId,
}: ExperimentalWebRightPanelSurfaceProps) {
  const gt = useGT();
  const { bots, loaded } = useBots(environmentId);
  const bot = bots.find((item) => item.threadId === threadId && item.projectId === projectId);
  if (!loaded) return <PaneStatus>{gt("Loading Gmail workspace…")}</PaneStatus>;
  if (!bot) return <PaneStatus>{gt("Open Gmail from its bot chat.")}</PaneStatus>;
  return (
    <SavedWorkspace
      key={`${environmentId}:${threadId}:${bot.agent.id}:${bot.projectId}`}
      environmentId={environmentId}
      target={{ projectId: bot.projectId, threadId, botId: bot.agent.id }}
    />
  );
}
