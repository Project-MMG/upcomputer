import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_WORK_RPC_METHODS,
  type Bot,
  type BotWorkConfigureInput,
} from "@t3tools/tasks-contracts/v1";
import { useNavigate } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";
import {
  SettingsRow,
  SettingsSection,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { useExperimentalFeatureRpcPermission } from "../../../../apps/web/src/extensionApi.ts";
import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/product/WebFeature.ts";
import { useRightPanelStore } from "../../../../apps/web/src/rightPanelStore.ts";
import { savedBotAppSurfaceId, workBotAppSurfaceId } from "../botApps/surface.ts";
import { useBotAppState } from "../botApps/useBotAppState.ts";
import { gmailWorkspaceSurfaceId } from "../gmailWorkspace/surface.ts";
import { useGmailWorkspaceLayout } from "../gmailWorkspace/useGmailWorkspaceLayout.ts";
import { projectToolErrorMessage } from "../projectTools/remoteData.ts";
import { botWorkApi } from "../rpc/botWork.ts";
import { useBots } from "./botData.tsx";

export function BotApps({
  environmentId,
  bot,
  fromSettings = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
  readonly fromSettings?: boolean;
}) {
  const gt = useGT();
  const [pending, setPending] = useState(false);
  const [configureError, setConfigureError] = useState<string>();
  const navigate = useNavigate();
  const { state } = useBotAppState(environmentId, bot);
  const { ref, layout } = useGmailWorkspaceLayout(environmentId, {
    threadId: bot.threadId,
    projectId: bot.projectId,
    botId: bot.agent.id,
  });
  const open = (surface: string) => {
    useRightPanelStore.getState().openFeature(ref, surface);
    if (fromSettings) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: bot.threadId },
      });
    }
  };
  const canConfigure = useExperimentalFeatureRpcPermission(
    environmentId,
    BOT_WORK_RPC_METHODS.configure,
  );
  const configure = (action: BotWorkConfigureInput["action"]) => {
    setPending(true);
    setConfigureError(undefined);
    void botWorkApi(environmentId, {
      botId: bot.agent.id,
      projectId: bot.projectId,
      threadId: bot.threadId,
    })
      .configure(action)
      .catch((cause: unknown) => setConfigureError(projectToolErrorMessage(cause)))
      .finally(() => {
        state.refresh();
        setPending(false);
      });
  };
  const { saved, proposal, work } = state.data ?? {};
  const app = state.loading || state.error ? null : (proposal ?? saved);
  const gmail = layout.error ? null : layout.data;
  const error = layout.error ?? state.error;
  const showConfigure = fromSettings && work !== undefined && !state.error;
  if (!gmail && !app && !work && !error && !showConfigure) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {layout.loading || state.loading
          ? gt("Loading bot apps…")
          : gt("This bot has no saved apps yet.")}
      </p>
    );
  }
  return (
    <SettingsSection title={gt("Bot Apps")} hideTitle>
      {showConfigure && !work && !app && !gmail && !error && !layout.loading && !state.loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {gt("This bot has no saved apps yet.")}
        </p>
      ) : null}
      {work && !state.error ? (
        <SettingsRow
          title={work.view === "team" ? gt("Team dashboard") : work.title}
          description={
            work.view === "team"
              ? gt("Project work and setup proposals")
              : gt("Work assigned to this bot")
          }
          control={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => open(workBotAppSurfaceId)}>
                {gt("Open in right pane")}
              </Button>
              {showConfigure ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canConfigure || pending || state.loading}
                  onClick={() => configure("remove")}
                >
                  {gt("Remove work app")}
                </Button>
              ) : null}
            </div>
          }
        />
      ) : showConfigure ? (
        <SettingsRow
          title={gt("Team dashboard")}
          description={gt("See project work and review proposals for new bots.")}
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!canConfigure || pending || state.loading}
              onClick={() => configure("enable-team")}
            >
              {gt("Add team dashboard")}
            </Button>
          }
        />
      ) : null}
      {configureError ? (
        <p role="alert" className="text-sm text-destructive">
          {configureError}
        </p>
      ) : null}
      {gmail ? (
        <SettingsRow
          title={gmail.title}
          description={gt("Gmail inbox")}
          control={
            <Button size="sm" variant="outline" onClick={() => open(gmailWorkspaceSurfaceId)}>
              {gt("Open in right pane")}
            </Button>
          }
        />
      ) : null}
      {app ? (
        <SettingsRow
          title={app.status === "available" ? app.snapshot.definition.title : gt("Bot app")}
          description={
            app.status === "unavailable"
              ? gt("Source unavailable")
              : proposal
                ? gt("Awaiting review")
                : gt("Saved app")
          }
          control={
            <Button size="sm" variant="outline" onClick={() => open(savedBotAppSurfaceId)}>
              {proposal ? gt("Review proposal") : gt("Open in right pane")}
            </Button>
          }
        />
      ) : null}
      {error ? (
        <SettingsRow
          title={gt("Couldn’t load bot apps")}
          description={<span role="alert">{error}</span>}
          control={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                layout.refresh();
                state.refresh();
              }}
            >
              {gt("Retry")}
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  );
}

export default function BotAppsPanel({
  environmentId,
  threadId,
}: ExperimentalWebRightPanelSurfaceProps) {
  const gt = useGT();
  const m = useMessages();
  const { bots, loaded, error } = useBots(environmentId);
  const bot = bots.find((item) => item.threadId === threadId);
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
      {bot ? (
        <BotApps
          key={JSON.stringify([environmentId, bot.projectId, bot.agent.id])}
          environmentId={environmentId}
          bot={bot}
        />
      ) : (
        <p role={error ? "alert" : "status"} className="text-sm text-muted-foreground">
          {m(error) || (loaded ? gt("Open a bot chat to see its apps.") : gt("Loading bot apps…"))}
        </p>
      )}
    </div>
  );
}
