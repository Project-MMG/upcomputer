import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  PROJECT_TOOLS_RPC_METHODS as M,
  type ProjectToolAction,
  type ProjectToolApp,
  type ProjectToolAssignment,
  type ProjectToolAudience,
  type ProjectToolSettings,
} from "@t3tools/tasks-contracts/v1";
import { PlugIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  SettingsRow,
  SettingsSection,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { Toggle, ToggleGroup } from "../../../../apps/web/src/components/ui/toggle-group.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import type { SidebarProjectGroupMember } from "../../../../apps/web/src/sidebarProjectGrouping.ts";
import { projectToolsApi, type ProjectToolsApi } from "../rpc/projectTools.ts";
import {
  accountLabel,
  actionAccessLabel,
  InlineError,
  ProjectToolAppDialog,
  ProjectToolActionDialog,
} from "./ProjectToolDetails.tsx";
import { projectToolErrorMessage, useRemoteData } from "./remoteData.ts";

const assignmentStatus: Record<ProjectToolAssignment["status"], string> = {
  available: "Available",
  "account-required": "Account required",
  "account-unavailable": "Account unavailable",
  "action-unavailable": "Action unavailable",
  "action-changed": "Review changes",
  "no-selected-bots": "No selected bots here",
  unverified: "Couldn't verify",
};

type Detail =
  | { readonly kind: "action"; readonly slug: string; readonly fromApp?: string }
  | {
      readonly kind: "app";
      readonly slug: string;
      readonly backTo?: string;
      readonly showActions?: boolean;
    };
type CatalogView = {
  readonly kind: "apps" | "actions";
  readonly app?: ProjectToolApp;
};

const includesBot = (audience: ProjectToolAudience, bot?: ProjectToolSettings["bots"][number]) =>
  !bot || audience.kind === "all" || audience.botIds.includes(bot.id);

export default function ProjectToolsPanel({
  members,
}: {
  readonly members: readonly SidebarProjectGroupMember[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const member =
    members.length === 1
      ? members[0]
      : members.find(({ physicalProjectKey }) => physicalProjectKey === selected);
  return (
    <div className="flex flex-col gap-6">
      {members.length > 1 ? (
        <SettingsSection title="Checkout">
          <SettingsRow
            title="Manage tools for"
            description="Accounts and assignments belong to one checkout in one environment."
            control={
              <Select value={member?.physicalProjectKey ?? null} onValueChange={setSelected}>
                <SelectTrigger aria-label="Choose checkout">
                  <SelectValue placeholder="Choose a checkout" />
                </SelectTrigger>
                <SelectPopup>
                  {members.map((item) => (
                    <SelectItem key={item.physicalProjectKey} value={item.physicalProjectKey}>
                      {item.environmentLabel ?? "Environment"} · {item.workspaceRoot}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </SettingsSection>
      ) : null}
      {member ? (
        <ProjectTools
          key={member.physicalProjectKey}
          environmentId={member.environmentId}
          projectId={member.id}
        />
      ) : null}
    </div>
  );
}

export function ProjectTools({
  environmentId,
  projectId,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly bot?: ProjectToolSettings["bots"][number];
}) {
  const api = useMemo(() => projectToolsApi(environmentId, projectId), [environmentId, projectId]);
  const canGrant = useExperimentalFeatureRpcPermission(environmentId, M.grant);
  const canGrantApp = useExperimentalFeatureRpcPermission(environmentId, M.appGrant);
  const canConnect = useExperimentalFeatureRpcPermission(environmentId, M.connection);
  const { data: settings, error, loading, refresh } = useRemoteData(api.settings);
  const [detail, setDetail] = useState<Detail>();
  const [catalog, setCatalog] = useState<CatalogView | null>(bot ? null : { kind: "apps" });
  const [removing, setRemoving] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const showAction = (slug: string) => setDetail({ kind: "action", slug });
  const showApp = (slug: string) => setDetail({ kind: "app", slug });
  const close = () => setDetail(undefined);
  const appliesToBot = ({ audience }: { readonly audience: ProjectToolAudience }) =>
    includesBot(audience, bot);
  const grants = (settings?.appGrants ?? []).filter(appliesToBot);
  const assignments = (settings?.assignments ?? []).filter(appliesToBot);
  const configuredApps = new Set([
    ...(bot ? [] : (settings?.accounts ?? []).map(({ app }) => app)),
    ...grants.map(({ app }) => app.slug),
    ...assignments.map(({ action }) => action.app),
  ]);

  const revoke = async (slug: string) => {
    if (removing || !canGrant) return;
    setRemoving(slug);
    setMutationError(undefined);
    try {
      await api.grant({ slug, audience: null, fixedInputs: {} });
    } catch (cause) {
      setMutationError(projectToolErrorMessage(cause));
    } finally {
      setRemoving(undefined);
      refresh();
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {bot
            ? `Manage the project tools ${bot.name} can use.`
            : "Connect apps and choose which bots in this project can use them."}
        </p>
        <div className="flex flex-wrap gap-2">
          {bot && settings?.configured ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCatalog(catalog ? null : { kind: "apps" })}
            >
              {catalog ? "Hide catalog" : "Add tool"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={loading} onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>
      {error || mutationError ? <InlineError>{mutationError ?? error}</InlineError> : null}
      {!settings && loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading project tools…
        </p>
      ) : null}
      {settings && !settings.configured ? (
        <InlineError>
          Ask the environment owner to add a Composio project API key to the server secret file{" "}
          <code>secrets/composio-api-key.bin</code> in its state directory, then refresh.
        </InlineError>
      ) : null}
      {settings ? (
        <>
          {bot && settings.configured && grants.length === 0 && assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools assigned to {bot.name}.</p>
          ) : null}
          {configuredApps.size > 0 ? (
            <SettingsSection
              title={bot ? "Assigned apps" : "Project apps"}
              icon={<PlugIcon className="size-4" />}
            >
              {Array.from(configuredApps, (app) => {
                const entry = settings.accounts.find((account) => account.app === app);
                const grant = grants.find(({ app: granted }) => granted.slug === app);
                const actions = assignments.filter(({ action }) => action.app === app);
                const needsAccount =
                  entry ||
                  grant?.app.setup === "connect" ||
                  actions.some(({ action }) => action.requiresAccount);
                const audience = grant?.audience;
                const fullCount =
                  audience?.kind === "selected"
                    ? settings.bots.filter(({ id }) => audience.botIds.includes(id)).length
                    : 0;
                return (
                  <SettingsRow
                    key={app}
                    title={grant?.app.name ?? actions[0]?.action.appName ?? app}
                    description={
                      <>
                        {needsAccount ? <span className="block">{accountLabel(entry)}</span> : null}
                        {settings.appGrants ? (
                          <span className="block">
                            {audience?.kind === "all"
                              ? "Full access for all bots"
                              : fullCount > 0
                                ? bot
                                  ? "Full access for this bot"
                                  : `Full access for ${fullCount} ${fullCount === 1 ? "bot" : "bots"}`
                                : "Full access off"}
                            {actions.length > 0
                              ? ` · ${actions.length} individual ${actions.length === 1 ? "action" : "actions"}`
                              : ""}
                          </span>
                        ) : null}
                      </>
                    }
                    control={
                      <Button size="sm" variant="outline" onClick={() => showApp(app)}>
                        {settings.appGrants ? "Manage access" : "Manage account"}
                      </Button>
                    }
                  />
                );
              })}
            </SettingsSection>
          ) : null}
          {assignments.length > 0 ? (
            <SettingsSection title="Assigned actions">
              {assignments.map(({ action, audience, status }) => {
                const matching =
                  audience.kind === "selected"
                    ? settings.bots.filter(({ id }) => audience.botIds.includes(id))
                    : [];
                return (
                  <SettingsRow
                    key={action.slug}
                    title={action.name}
                    description={
                      <>
                        {action.appName} · {actionAccessLabel(action.effect)} ·{" "}
                        {assignmentStatus[status]}
                        <span className="block">
                          {audience.kind === "all"
                            ? "All bots in this project"
                            : matching.map(({ name }) => name).join(", ") || "Selected bots"}
                        </span>
                      </>
                    }
                    control={
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => showAction(action.slug)}>
                          Edit assignment
                        </Button>
                        {bot ? null : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canGrant || removing !== undefined}
                            onClick={() => void revoke(action.slug)}
                          >
                            {removing === action.slug ? "Turning off…" : "Turn off"}
                          </Button>
                        )}
                      </div>
                    }
                  />
                );
              })}
            </SettingsSection>
          ) : null}
          {settings.configured && catalog ? (
            <Catalog
              key={JSON.stringify([catalog.kind, catalog.app?.slug])}
              api={api}
              view={catalog}
              onViewChange={setCatalog}
              settings={settings}
              bot={bot}
              showAction={showAction}
              showApp={showApp}
            />
          ) : null}
          {detail?.kind === "app" ? (
            <ProjectToolAppDialog
              key={JSON.stringify([detail.slug, detail.showActions, detail.backTo])}
              app={detail.slug}
              api={api}
              settings={settings}
              defaultBotId={bot?.id}
              canWrite={canConnect}
              canGrantApp={canGrantApp}
              onChange={refresh}
              onClose={close}
              onBack={detail.backTo ? () => showAction(detail.backTo!) : undefined}
              showActions={detail.showActions}
              renderActions={(app) => (
                <Catalog
                  api={api}
                  view={{ kind: "actions", app }}
                  settings={settings}
                  bot={bot}
                  showAction={(slug) => setDetail({ kind: "action", slug, fromApp: app.slug })}
                  showApp={showApp}
                />
              )}
            />
          ) : null}
          {detail?.kind === "action" ? (
            <ProjectToolActionDialog
              key={detail.slug}
              slug={detail.slug}
              api={api}
              settings={settings}
              defaultBotId={bot?.id}
              canWrite={canGrant}
              onClose={close}
              onBack={
                detail.fromApp
                  ? () => setDetail({ kind: "app", slug: detail.fromApp!, showActions: true })
                  : undefined
              }
              onSaved={() => {
                if (detail.fromApp) {
                  setDetail({ kind: "app", slug: detail.fromApp, showActions: true });
                } else close();
                refresh();
              }}
              onOpenAccount={(slug) => setDetail({ kind: "app", slug, backTo: detail.slug })}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Catalog({
  api,
  view,
  onViewChange,
  settings,
  bot,
  showAction,
  showApp,
}: {
  readonly api: ProjectToolsApi;
  readonly view: CatalogView;
  readonly onViewChange?: (view: CatalogView) => void;
  readonly settings: ProjectToolSettings;
  readonly bot?: ProjectToolSettings["bots"][number] | undefined;
  readonly showAction: (slug: string) => void;
  readonly showApp: (slug: string) => void;
}) {
  const { kind, app } = view;
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const fetchPage = useCallback(
    (cursor?: string) => {
      const input = { query, cursor };
      return kind === "apps" ? api.apps(input) : api.actions({ ...input, app: app?.slug });
    },
    [api, kind, query, app],
  );
  const results = (
    <div className="space-y-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            aria-label={kind === "apps" ? "Search apps" : "Search actions"}
            placeholder={kind === "apps" ? "Search apps" : "Search actions by name or description"}
            maxLength={200}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              if (event.currentTarget.value === "") setQuery("");
            }}
          />
        </div>
        <Button type="submit" variant="outline">
          <SearchIcon /> Search
        </Button>
      </form>
      {kind === "actions" && app && onViewChange ? (
        <div className="flex items-center gap-2">
          <Badge variant="outline">{app.name}</Badge>
          <Button size="xs" variant="ghost" onClick={() => onViewChange({ kind: "actions" })}>
            Clear app filter
          </Button>
        </div>
      ) : null}
      <CatalogResults
        key={JSON.stringify([kind, app?.slug, query])}
        fetchPage={fetchPage}
        render={(item) => {
          const account = settings.accounts.find(
            (entry) => entry.app === ("effect" in item ? item.app : item.slug),
          );
          if ("effect" in item) {
            const assignment = settings.assignments.find(
              ({ action, audience }) => item.slug === action.slug && includesBot(audience, bot),
            );
            return (
              <SettingsRow
                key={item.slug}
                title={item.name}
                description={
                  <>
                    <span className="block">
                      {item.appName} · {actionAccessLabel(item.effect)} ·{" "}
                      {item.requiresAccount
                        ? account?.account
                          ? accountLabel(account)
                          : "Account required"
                        : "No account required"}
                    </span>
                    {item.description}
                  </>
                }
                control={
                  <Button size="sm" variant="outline" onClick={() => showAction(item.slug)}>
                    {assignment ? "Edit assignment" : "Configure"}
                  </Button>
                }
              />
            );
          }
          return (
            <SettingsRow
              key={item.slug}
              title={item.name}
              description={item.description}
              control={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => showApp(item.slug)}>
                    {settings.appGrants ? "Manage access" : "Account setup"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewChange?.({ kind: "actions", app: item })}
                  >
                    Browse actions
                  </Button>
                </div>
              }
            />
          );
        }}
      />
    </div>
  );
  return onViewChange ? (
    <SettingsSection
      title="Composio catalog"
      variant="plain"
      headerAction={
        <ToggleGroup
          variant="segmented"
          aria-label="Browse catalog"
          value={[kind]}
          onValueChange={([value]) => {
            if (value === "apps" || value === "actions") onViewChange({ kind: value });
          }}
        >
          <Toggle value="apps">Apps</Toggle>
          <Toggle value="actions">Actions</Toggle>
        </ToggleGroup>
      }
    >
      {results}
    </SettingsSection>
  ) : (
    results
  );
}

type CatalogItem = ProjectToolAction | ProjectToolApp;
type CatalogPage = { readonly items: readonly CatalogItem[]; readonly nextCursor: string | null };

function CatalogResults({
  fetchPage,
  render,
}: {
  readonly fetchPage: (cursor?: string) => Promise<CatalogPage>;
  readonly render: (item: CatalogItem) => React.ReactNode;
}) {
  const first = useRemoteData(fetchPage);
  const [pages, setPages] = useState<readonly CatalogPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  if (!first.data) {
    return first.error && !first.loading ? (
      <div className="space-y-2">
        <InlineError>{first.error}</InlineError>
        <Button size="sm" variant="outline" onClick={first.refresh}>
          Retry catalog
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        Loading catalog…
      </p>
    );
  }
  const all = [first.data, ...pages];
  const items = new Map(
    all.flatMap((page) => page.items.map((item) => [item.slug, item] as const)),
  );
  const cursor = all.at(-1)?.nextCursor;
  return (
    <>
      {items.size > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border/60 divide-y divide-border/60">
          {Array.from(items.values(), render)}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No catalog results.</p>
      )}
      {error ? <InlineError>{error}</InlineError> : null}
      {cursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              if (loading) return;
              setLoading(true);
              setError(undefined);
              void fetchPage(cursor)
                .then(
                  (page) => setPages((previous) => [...previous, page]),
                  (cause: unknown) => setError(projectToolErrorMessage(cause)),
                )
                .finally(() => setLoading(false));
            }}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
