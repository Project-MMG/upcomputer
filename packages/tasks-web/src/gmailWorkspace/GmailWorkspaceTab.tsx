import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Bot, GmailWorkspaceTarget } from "@t3tools/tasks-contracts/v1";
import { useEffect } from "react";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../../../../apps/web/src/rightPanelStore.ts";
import { gmailWorkspaceSurfaceId } from "./surface.ts";
import { useGmailWorkspaceLayout } from "./useGmailWorkspaceLayout.ts";

const gmailTabId = `feature:${gmailWorkspaceSurfaceId}`;

function CloseUnavailableGmailTab({
  environmentId,
  target,
}: {
  readonly environmentId: EnvironmentId;
  readonly target: GmailWorkspaceTarget;
}) {
  const { layout } = useGmailWorkspaceLayout(environmentId, target);
  const unavailable = layout.data === null && !layout.loading && !layout.error;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Close restored Gmail tabs when the environment reports that the bot has no available inbox.
  useEffect(() => {
    if (!unavailable) return;
    useRightPanelStore
      .getState()
      .closeSurface(scopeThreadRef(environmentId, target.threadId), gmailTabId);
  }, [environmentId, target.threadId, unavailable]);
  return null;
}

export function GmailWorkspaceTabLifecycle({
  environmentId,
  bot,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: Bot;
}) {
  const { threadId, projectId, agent } = bot;
  const ref = scopeThreadRef(environmentId, threadId);
  const hasGmailTab = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, ref).surfaces.some(
      ({ id }) => id === gmailTabId,
    ),
  );
  if (!hasGmailTab) return null;
  return (
    <CloseUnavailableGmailTab
      key={JSON.stringify([environmentId, threadId, projectId, agent.id])}
      environmentId={environmentId}
      target={{ threadId, projectId, botId: agent.id }}
    />
  );
}
