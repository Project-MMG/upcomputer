import {
  type ProjectToolAction,
  type ProjectToolActionDetails,
  type ProjectToolAssignment,
  type ProjectToolConnectionInput,
  type ProjectToolGrantInput,
  type ProjectToolSettings,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";
import { useCallback, useId, useState, type ReactNode } from "react";

import { ensureLocalApi } from "../../../../apps/web/src/localApi.ts";
import { Alert, AlertDescription } from "../../../../apps/web/src/components/ui/alert.tsx";
import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Checkbox } from "../../../../apps/web/src/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../../../apps/web/src/components/ui/dialog.tsx";
import { Radio, RadioGroup } from "../../../../apps/web/src/components/ui/radio-group.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import type { ProjectToolsApi } from "../rpc/projectTools.ts";
import { projectToolErrorMessage, useRemoteData } from "./remoteData.ts";

const isObject = Schema.is(Schema.JsonObject);
const dashboard = "https://dashboard.composio.dev/";

type Account = ProjectToolSettings["accounts"][number];

export function actionAccessLabel(effect: ProjectToolAction["effect"]) {
  return effect === "read" ? "Read" : "Can write";
}

export function accountLabel(entry: Account | undefined) {
  const account = entry?.account;
  if (!account) return entry?.pending ? "Sign-in pending" : "No connected account";
  if (account.status === "connected") return account.label;
  return `${account.label} · ${account.status === "unverified" ? "Couldn't verify" : "Unavailable"}`;
}

export function InlineError({ children }: { readonly children: ReactNode }) {
  return (
    <Alert variant="error" role="alert">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function ProjectToolAccountDialog({
  app,
  api,
  settings,
  canWrite,
  onChange,
  onClose,
  onBack,
}: {
  readonly app: string;
  readonly api: ProjectToolsApi;
  readonly settings: ProjectToolSettings;
  readonly canWrite: boolean;
  readonly onChange: () => void;
  readonly onClose: () => void;
  readonly onBack?: (() => void) | undefined;
}) {
  const details = useRemoteData(
    useCallback(
      () => (settings.configured ? api.app(app) : Promise.resolve(null)),
      [api, app, settings.configured],
    ),
  );
  const account = settings.accounts.find((item) => item.app === app);
  const assignments = settings.assignments.filter(
    ({ action }) => action.app === app && action.requiresAccount,
  );
  const [link, setLink] = useState<string>();
  const [pending, setPending] = useState<ProjectToolConnectionInput["operation"]>();
  const [error, setError] = useState<string>();
  const setup = details.data?.setup;
  const name = details.data?.name ?? assignments[0]?.action.appName ?? app;

  const change = async (operation: ProjectToolConnectionInput["operation"]) => {
    if (!canWrite || pending) return;
    setPending(operation);
    setError(undefined);
    try {
      if (
        operation === "disconnect" &&
        !(await ensureLocalApi().dialogs.confirm(
          `Disconnect ${name} from this project? Its account-dependent actions will stop running.`,
          { variant: "destructive" },
        ))
      )
        return;
      const { url } = await api.connection({ app, operation });
      setLink(url ?? undefined);
    } catch (cause) {
      setError(projectToolErrorMessage(cause));
    } finally {
      setPending(undefined);
      onChange();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{name} account</DialogTitle>
          <DialogDescription>{accountLabel(account)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {error || details.error ? <InlineError>{error ?? details.error}</InlineError> : null}
            {details.loading ? <p role="status">Checking app setup…</p> : null}
            {setup === "no-account" ? <p>This app has actions that use no account.</p> : null}
            {setup === "auth-config-required" ? (
              <p className="text-sm text-muted-foreground">
                Create and enable an auth config for this app in Composio first. Then check its
                setup again.
              </p>
            ) : null}
            {account?.pending || link ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Complete sign-in in Composio, then check the connection here.
                </p>
                <div className="flex flex-wrap gap-2">
                  {link ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        void ensureLocalApi()
                          .shell.openExternal(link)
                          .catch((cause: unknown) => setError(projectToolErrorMessage(cause)));
                      }}
                    >
                      Open Composio sign-in
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canWrite || !!pending || !settings.configured}
                    onClick={() => void change("finish")}
                  >
                    {pending === "finish" ? "Checking…" : "Check connection"}
                  </Button>
                </div>
              </div>
            ) : null}
            {assignments.length > 0 ? (
              <div className="space-y-1.5">
                <h3 className="text-sm font-medium">Actions using this connection</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {assignments.map(({ action }) => (
                    <li key={action.slug}>{action.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          {onBack ? (
            <Button variant="ghost" onClick={onBack}>
              Back to action
            </Button>
          ) : null}
          {setup === "auth-config-required" ? (
            <>
              <Button
                variant="outline"
                onClick={() => void ensureLocalApi().shell.openExternal(dashboard)}
              >
                Open Composio
              </Button>
              <Button variant="outline" disabled={details.loading} onClick={details.refresh}>
                Check setup
              </Button>
            </>
          ) : null}
          {account?.account || account?.pending ? (
            <Button
              variant="destructive-outline"
              disabled={!canWrite || !!pending}
              onClick={() => void change("disconnect")}
            >
              {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null}
          {setup === "connect" ? (
            <Button disabled={!canWrite || !!pending} onClick={() => void change("start")}>
              {pending === "start"
                ? "Preparing sign-in…"
                : account?.pending
                  ? "Restart sign-in"
                  : account?.account
                    ? "Reconnect"
                    : "Connect"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ProjectToolActionDialog({
  slug,
  api,
  settings,
  canWrite,
  onClose,
  onSaved,
  onOpenAccount,
}: {
  readonly slug: string;
  readonly api: ProjectToolsApi;
  readonly settings: ProjectToolSettings;
  readonly canWrite: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly onOpenAccount: (app: string) => void;
}) {
  const details = useRemoteData(useCallback(() => api.action(slug), [api, slug]));
  const assignment = settings.assignments.find(({ action }) => action.slug === slug);
  const action = details.data ?? assignment?.action;
  const account = settings.accounts.find((entry) => entry.app === action?.app);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{action?.name ?? slug}</DialogTitle>
          <DialogDescription>
            {action?.description ??
              (details.loading ? "Loading action…" : "Action details unavailable.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {details.error ? <InlineError>{details.error}</InlineError> : null}
            {action ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{action.appName}</span>
                <Badge variant="outline">{actionAccessLabel(action.effect)}</Badge>
                <span className="text-muted-foreground">
                  {action.requiresAccount ? accountLabel(account) : "No account required"}
                </span>
                {action.requiresAccount ? (
                  <Button size="xs" variant="outline" onClick={() => onOpenAccount(action.app)}>
                    Manage account
                  </Button>
                ) : null}
              </div>
            ) : null}
            {details.data ? (
              <GrantForm
                action={details.data}
                assignment={assignment}
                bots={settings.bots}
                canWrite={
                  canWrite &&
                  (!details.data.requiresAccount || account?.account?.status === "connected")
                }
                onSave={async (input) => {
                  await api.grant(input);
                  onSaved();
                }}
              />
            ) : null}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function GrantForm({
  action,
  assignment,
  bots,
  canWrite,
  onSave,
}: {
  readonly action: ProjectToolActionDetails;
  readonly assignment: ProjectToolAssignment | undefined;
  readonly bots: ProjectToolSettings["bots"];
  readonly canWrite: boolean;
  readonly onSave: (input: Omit<ProjectToolGrantInput, "projectId">) => Promise<void>;
}) {
  const formId = useId();
  const [audience, setAudience] = useState(assignment?.audience.kind ?? "all");
  const [selected, setSelected] = useState<ReadonlyArray<TaskAgentId>>(
    assignment?.audience.kind === "selected" ? assignment.audience.botIds : [],
  );
  const [fixed, setFixed] = useState(() =>
    assignment && Object.keys(assignment.fixedInputs).length > 0
      ? JSON.stringify(assignment.fixedInputs, null, 2)
      : "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const fields = isObject(action.inputSchema.properties)
    ? Object.keys(action.inputSchema.properties)
    : [];
  const botIds = bots.filter(({ id }) => selected.includes(id)).map(({ id }) => id);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canWrite || pending) return;
        const revoke = audience === "selected" && botIds.length === 0;
        if (revoke && !assignment) return;
        let fixedInputs: Schema.JsonObject = {};
        if (!revoke && fixed.trim()) {
          try {
            const parsed: unknown = JSON.parse(fixed);
            if (!isObject(parsed)) throw new Error();
            fixedInputs = parsed;
          } catch {
            setError("Enter fixed inputs as a JSON object.");
            return;
          }
        }
        setError(undefined);
        setPending(true);
        void onSave({
          slug: action.slug,
          audience: audience === "all" ? { kind: "all" } : { kind: "selected", botIds },
          fixedInputs,
        })
          .catch((cause: unknown) => setError(projectToolErrorMessage(cause)))
          .finally(() => setPending(false));
      }}
    >
      <fieldset disabled={!canWrite || pending} className="space-y-2">
        <legend className="text-sm font-medium">Who can use this action?</legend>
        <RadioGroup
          aria-label="Action audience"
          disabled={!canWrite || pending}
          value={audience}
          onValueChange={(value) => {
            if (value === "all" || value === "selected") setAudience(value);
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <Radio value="all" aria-label="All bots in this project" /> All bots in this project
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Radio value="selected" aria-label="Selected bots" /> Selected bots
          </label>
        </RadioGroup>
        {audience === "selected" ? (
          <div className="space-y-2 pl-6">
            {bots.length === 0 ? (
              <p className="text-sm text-muted-foreground">This project has no bots yet.</p>
            ) : null}
            {bots.map((bot) => (
              <label key={bot.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(bot.id)}
                  aria-label={bot.name}
                  disabled={!canWrite || pending}
                  onCheckedChange={(checked) => {
                    setSelected((ids) =>
                      checked ? [...ids, bot.id] : ids.filter((id) => id !== bot.id),
                    );
                  }}
                />
                <span>{bot.name}</span>
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      {fields.length > 0 || fixed ? (
        <details
          open={assignment && Object.keys(assignment.fixedInputs).length > 0 ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-medium">Fixed inputs (optional)</summary>
          <div className="mt-2 space-y-2 text-sm">
            <p className="text-muted-foreground">
              The project supplies these values every time a bot runs the action.
            </p>
            <label className="sr-only" htmlFor={formId}>
              Fixed inputs as JSON
            </label>
            <Textarea
              id={formId}
              rows={3}
              placeholder="{}"
              spellCheck={false}
              value={fixed}
              disabled={!canWrite || pending}
              onChange={(event) => setFixed(event.currentTarget.value)}
            />
            {fields.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Input fields include {fields.join(", ")}.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            !canWrite || pending || (audience === "selected" && botIds.length === 0 && !assignment)
          }
        >
          {pending
            ? "Saving…"
            : audience === "selected" && botIds.length === 0 && assignment
              ? "Turn off action"
              : "Save assignment"}
        </Button>
      </div>
    </form>
  );
}
