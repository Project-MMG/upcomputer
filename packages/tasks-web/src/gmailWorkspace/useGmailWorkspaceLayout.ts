import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import type { GmailWorkspaceTarget } from "@t3tools/tasks-contracts/v1";
import { useMemo } from "react";
import { useQuietThreadShell } from "../../../../apps/web/src/state/entities.ts";
import { useRemoteData } from "../projectTools/remoteData.ts";
import { gmailWorkspaceApi } from "../rpc/gmailWorkspace.ts";

export function useGmailWorkspaceLayout(
  environmentId: EnvironmentId,
  target: GmailWorkspaceTarget,
) {
  const { threadId, projectId, botId } = target;
  const ref = scopeThreadRef(environmentId, threadId);
  const shell = useQuietThreadShell(ref);
  const api = useMemo(
    () => gmailWorkspaceApi(environmentId, { threadId, projectId, botId }),
    [environmentId, threadId, projectId, botId],
  );
  const refreshKey = shell?.latestRun?.completedAt;
  return { ref, api, refreshKey, layout: useRemoteData(api.layout, refreshKey) };
}
