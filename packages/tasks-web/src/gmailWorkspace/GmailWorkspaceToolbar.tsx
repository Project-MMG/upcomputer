import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import type { GmailWorkspaceTarget } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { InboxIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import type { ExperimentalWebThreadAccessoryProps } from "../../../../apps/web/src/product/WebFeature.ts";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../../../apps/web/src/rightPanelStore.ts";
import { useBots } from "../bots/botData.tsx";
import { gmailWorkspaceSurfaceId } from "./surface.ts";
import { useGmailWorkspaceLayout } from "./useGmailWorkspaceLayout.ts";

function GmailWorkspaceButton({
  environmentId,
  target,
}: {
  readonly environmentId: EnvironmentId;
  readonly target: GmailWorkspaceTarget;
}) {
  const gt = useGT();
  const { ref, layout } = useGmailWorkspaceLayout(environmentId, target);
  const unavailable = layout.data === null && !layout.loading;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Close restored Gmail tabs when the environment reports that the bot has no available inbox.
  useEffect(() => {
    if (!unavailable) return;
    const ref = scopeThreadRef(environmentId, target.threadId);
    const surfaceId = `feature:${gmailWorkspaceSurfaceId}`;
    const panels = useRightPanelStore.getState();
    const { surfaces } = selectThreadRightPanelState(panels.byThreadKey, ref);
    if (surfaces.some(({ id }) => id === surfaceId)) panels.closeSurface(ref, surfaceId);
  }, [environmentId, target.threadId, unavailable]);
  if (!layout.data || layout.error) return null;
  return (
    <div
      data-chat-toolbar-accessory
      data-workspace-titlebar-controls
      className="relative z-10 shrink-0 [-webkit-app-region:no-drag]"
    >
      <Button
        variant="outline"
        size="sm"
        aria-label={gt("Open Gmail inbox")}
        onClick={() => useRightPanelStore.getState().openFeature(ref, gmailWorkspaceSurfaceId)}
      >
        <InboxIcon aria-hidden />
        {gt("Gmail inbox")}
      </Button>
    </div>
  );
}

export default function GmailWorkspaceToolbar({
  environmentId,
  threadId,
}: ExperimentalWebThreadAccessoryProps) {
  const { bots, enabled } = useBots(environmentId);
  const bot = enabled ? bots.find((item) => item.threadId === threadId) : undefined;
  if (!bot) return null;
  return (
    <GmailWorkspaceButton
      key={`${scopedThreadKey(scopeThreadRef(environmentId, threadId))}:${bot.agent.id}:${bot.projectId}`}
      environmentId={environmentId}
      target={{ threadId, projectId: bot.projectId, botId: bot.agent.id }}
    />
  );
}
