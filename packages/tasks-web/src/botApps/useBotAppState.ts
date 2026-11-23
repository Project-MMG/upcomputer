import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import type { Bot } from "@t3tools/tasks-contracts/v1";
import { useMemo } from "react";
import { useQuietThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { useRemoteData } from "../projectTools/remoteData.ts";
import { botAppsApi } from "../rpc/botApps.ts";

export function useBotAppState(environmentId: EnvironmentId, bot: Bot) {
  const {
    threadId,
    projectId,
    agent: { id: botId },
  } = bot;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, threadId));
  const api = useMemo(
    () => botAppsApi(environmentId, { threadId, projectId, botId }),
    [environmentId, threadId, projectId, botId],
  );
  const refreshKey = JSON.stringify([
    shell?.latestRun?.completedAt,
    bot.latestTaskRun?.completedAt,
  ]);
  return { api, state: useRemoteData(api.state, refreshKey) };
}
