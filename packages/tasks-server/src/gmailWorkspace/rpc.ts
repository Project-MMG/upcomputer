import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  GMAIL_WORKSPACE_RPC_METHODS as M,
  GMAIL_WORKSPACE_RPC_NAMESPACE,
  GmailWorkspaceRpcGroup,
  ProjectToolError,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import { defineNamespacedRpcContribution } from "../../../../apps/server/src/extensionApi.ts";
import { GmailWorkspace } from "./GmailWorkspace.ts";

const response = <A>(effect: Effect.Effect<A, ProjectToolError>) =>
  Effect.mapError(effect, ({ code }) => new ProjectToolError({ code }));

export const GMAIL_WORKSPACE_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "gmail-workspace-rpc-v1",
  ownerId: "upcomputer.tasks",
  version: 1,
  namespace: GMAIL_WORKSPACE_RPC_NAMESPACE,
  group: GmailWorkspaceRpcGroup,
  requiredScopes: {
    [M.layout]: AuthOrchestrationReadScope,
    [M.inbox]: AuthOrchestrationReadScope,
    [M.thread]: AuthOrchestrationReadScope,
    [M.updateDraft]: AuthOrchestrationOperateScope,
  },
  handlers: () =>
    GmailWorkspaceRpcGroup.toLayer(
      GmailWorkspaceRpcGroup.of({
        [M.layout]: (input) =>
          Effect.flatMap(GmailWorkspace, (workspace) => response(workspace.layout(input))),
        [M.inbox]: (input) =>
          Effect.flatMap(GmailWorkspace, (workspace) => response(workspace.inbox(input))),
        [M.thread]: (input) =>
          Effect.flatMap(GmailWorkspace, (workspace) => response(workspace.thread(input))),
        [M.updateDraft]: (input) =>
          Effect.flatMap(GmailWorkspace, (workspace) => response(workspace.updateDraft(input))),
      }),
    ),
});
