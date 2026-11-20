import {
  PROJECT_TOOLS_RPC_METHODS as M,
  type ProjectToolAction,
  type ProjectToolApp,
  type ProjectToolAssignment,
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
  ProjectToolAccountDialog,
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
  | { readonly kind: "action"; readonly slug: string }
  | { readonly kind: "app"; readonly slug: string; readonly backTo?: string };

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
      {member ? <ProjectTools key={member.physicalProjectKey} member={member} /> : null}
    </div>
  );
}

function ProjectTools({ member }: { readonly member: SidebarProjectGroupMember }) {
  const api = useMemo(
    () => projectToolsApi(member.environmentId, member.id),
    [member.environmentId, member.id],
  );
  const canGrant = useExperimentalFeatureRpcPermission(member.environmentId, M.grant);
  const canConnect = useExperimentalFeatureRpcPermission(member.environmentId, M.connection);
  const { data: settings, error, loading, refresh } = useRemoteData(api.settings);
  const [detail, setDetail] = useState<Detail>();
  const [removing, setRemoving] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const showAction = (slug: string) => setDetail({ kind: "action", slug });
  const showApp = (slug: string) => setDetail({ kind: "app", slug });
  const close = () => setDetail(undefined);

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
          Connect apps and choose which bots in this project can use each action.
        </p>
        <Button size="sm" variant="outline" disabled={loading} onClick={refresh}>
          Refresh
        </Button>
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
          {settings.accounts.length > 0 ? (
            <SettingsSection title="App connections" icon={<PlugIcon className="size-4" />}>
              {settings.accounts.map((entry) => {
                const actions = settings.assignments.filter(
                  ({ action }) => action.app === entry.app && action.requiresAccount,
                );
                return (
                  <SettingsRow
                    key={entry.app}
                    title={actions[0]?.action.appName ?? entry.app}
                    description={accountLabel(entry)}
                    control={
                      <Button size="sm" variant="outline" onClick={() => showApp(entry.app)}>
                        Manage account
                      </Button>
                    }
                  />
                );
              })}
            </SettingsSection>
          ) : null}
          <SettingsSection title="Assigned actions">
            {settings.assignments.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                Choose an action from the catalog to grant access.
              </p>
            ) : (
              settings.assignments.map(({ action, audience, status }) => {
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
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canGrant || removing !== undefined}
                          onClick={() => void revoke(action.slug)}
                        >
                          {removing === action.slug ? "Turning off…" : "Turn off"}
                        </Button>
                      </div>
                    }
                  />
                );
              })
            )}
          </SettingsSection>
          {settings.configured ? (
            <Catalog api={api} settings={settings} showAction={showAction} showApp={showApp} />
          ) : null}
          {detail?.kind === "app" ? (
            <ProjectToolAccountDialog
              key={detail.slug}
              app={detail.slug}
              api={api}
              settings={settings}
              canWrite={canConnect}
              onChange={refresh}
              onClose={close}
              onBack={detail.backTo ? () => showAction(detail.backTo!) : undefined}
            />
          ) : null}
          {detail?.kind === "action" ? (
            <ProjectToolActionDialog
              key={detail.slug}
              slug={detail.slug}
              api={api}
              settings={settings}
              canWrite={canGrant}
              onClose={close}
              onSaved={() => {
                close();
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
  settings,
  showAction,
  showApp,
}: {
  readonly api: ProjectToolsApi;
  readonly settings: ProjectToolSettings;
  readonly showAction: (slug: string) => void;
  readonly showApp: (slug: string) => void;
}) {
  const [kind, setKind] = useState<"apps" | "actions">("actions");
  const [app, setApp] = useState<ProjectToolApp>();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const fetchPage = useCallback(
    (cursor?: string) => {
      const input = { query, cursor };
      return kind === "apps" ? api.apps(input) : api.actions({ ...input, app: app?.slug });
    },
    [api, kind, query, app],
  );
  return (
    <SettingsSection
      title="Composio catalog"
      variant="plain"
      headerAction={
        <ToggleGroup
          variant="segmented"
          aria-label="Browse catalog"
          value={[kind]}
          onValueChange={([value]) => {
            if (value === "apps" || value === "actions") setKind(value);
          }}
        >
          <Toggle value="actions">Actions</Toggle>
          <Toggle value="apps">Apps</Toggle>
        </ToggleGroup>
      }
    >
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
              placeholder={
                kind === "apps" ? "Search apps" : "Search actions by name or description"
              }
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
        {kind === "actions" && app ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline">{app.name}</Badge>
            <Button size="xs" variant="ghost" onClick={() => setApp(undefined)}>
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
                ({ action }) => item.slug === action.slug,
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
                      Account setup
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setApp(item);
                        setKind("actions");
                        setDraft("");
                        setQuery("");
                      }}
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
    </SettingsSection>
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
