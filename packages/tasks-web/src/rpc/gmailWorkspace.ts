import type { EnvironmentId } from "@t3tools/contracts";
import {
  GMAIL_WORKSPACE_RPC_METHODS as M,
  GmailWorkspaceRpcGroup,
  type GmailDraftApprovalInput,
  type GmailDraftUpdateInput,
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
    updateDraft: (input: Omit<GmailDraftUpdateInput, keyof GmailWorkspaceTarget>) => {
      const payload = { ...target, ...input };
      return requestExperimentalFeatureRpc(
        environmentId,
        GmailWorkspaceRpcGroup,
        (client) => client[M.updateDraft](payload),
        { method: M.updateDraft, input: payload },
      );
    },
    approveDraft: (input: Omit<GmailDraftApprovalInput, keyof GmailWorkspaceTarget>) => {
      const payload = { ...target, ...input };
      return requestExperimentalFeatureRpc(
        environmentId,
        GmailWorkspaceRpcGroup,
        (client) => client[M.approveDraft](payload),
        { method: M.approveDraft, input: payload },
      );
    },
  };
}
