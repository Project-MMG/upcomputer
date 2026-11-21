import type { EnvironmentId } from "@t3tools/contracts";
import {
  GMAIL_WORKSPACE_RPC_METHODS as M,
  GmailWorkspaceRpcGroup,
  type GmailWorkspaceTarget,
} from "@t3tools/tasks-contracts/v1";
import { requestExperimentalFeatureRpc } from "../../../../apps/web/src/extensionApi.ts";

export function gmailWorkspaceApi(environmentId: EnvironmentId, target: GmailWorkspaceTarget) {
  return {
    layout: () =>
      requestExperimentalFeatureRpc(environmentId, GmailWorkspaceRpcGroup, (client) =>
        client[M.layout](target),
      ),
    inbox: (pageToken?: string) =>
      requestExperimentalFeatureRpc(environmentId, GmailWorkspaceRpcGroup, (client) =>
        client[M.inbox]({ ...target, pageToken }),
      ),
    thread: (gmailThreadId: string, pageToken?: string) =>
      requestExperimentalFeatureRpc(environmentId, GmailWorkspaceRpcGroup, (client) =>
        client[M.thread]({ ...target, gmailThreadId, pageToken }),
      ),
  };
}
