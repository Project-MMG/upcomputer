import type { EnvironmentId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useNavigate } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";
import {
  SettingsRow,
  SettingsSection,
} from "../../../../apps/web/src/components/settings/settingsLayout.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import type { ExperimentalWebRightPanelSurfaceProps } from "../../../../apps/web/src/product/WebFeature.ts";
import { useRightPanelStore } from "../../../../apps/web/src/rightPanelStore.ts";
import { gmailWorkspaceSurfaceId } from "../gmailWorkspace/surface.ts";
import { useGmailWorkspaceLayout } from "../gmailWorkspace/useGmailWorkspaceLayout.ts";
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
  const navigate = useNavigate();
  const { ref, layout } = useGmailWorkspaceLayout(environmentId, {
    threadId: bot.threadId,
    projectId: bot.projectId,
    botId: bot.agent.id,
  });
  if (layout.error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-muted-foreground">
          {layout.error}
        </p>
        <Button size="sm" variant="outline" onClick={layout.refresh} disabled={layout.loading}>
          {gt("Retry")}
        </Button>
      </div>
    );
  }
  if (!layout.data) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {layout.loading ? gt("Loading bot apps…") : gt("This bot has no saved apps yet.")}
      </p>
    );
  }
  return (
    <SettingsSection title={gt("Bot Apps")} hideTitle>
      <SettingsRow
        title={layout.data.title}
        description={gt("Gmail inbox")}
        control={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              useRightPanelStore.getState().openFeature(ref, gmailWorkspaceSurfaceId);
              if (fromSettings) {
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId, threadId: bot.threadId },
                });
              }
            }}
          >
            {gt("Open in right pane")}
          </Button>
        }
      />
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
