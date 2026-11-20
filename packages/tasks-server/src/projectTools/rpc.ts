import { AuthOrchestrationReadScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import {
  PROJECT_TOOLS_RPC_METHODS as M,
  PROJECT_TOOLS_RPC_NAMESPACE,
  ProjectToolError,
  ProjectToolsRpcGroup,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import { defineNamespacedRpcContribution } from "../../../../apps/server/src/extensionApi.ts";
import { ProjectTools } from "./ProjectTools.ts";

const response = <A>(effect: Effect.Effect<A, ProjectToolError>) =>
  Effect.mapError(
    effect,
    ({ code, status }) =>
      new ProjectToolError({
        code,
        ...(status === undefined ? {} : { status }),
      }),
  );

export const PROJECT_TOOLS_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "project-tools-rpc-v1",
  ownerId: "upcomputer.tasks",
  version: 1,
  namespace: PROJECT_TOOLS_RPC_NAMESPACE,
  group: ProjectToolsRpcGroup,
  requiredScopes: {
    [M.settings]: AuthOrchestrationReadScope,
    [M.apps]: AuthOrchestrationReadScope,
    [M.app]: AuthOrchestrationReadScope,
    [M.actions]: AuthOrchestrationReadScope,
    [M.action]: AuthOrchestrationReadScope,
    [M.connection]: AuthSettingsWriteScope,
    [M.grant]: AuthSettingsWriteScope,
  },
  handlers: () =>
    ProjectToolsRpcGroup.toLayer(
      Effect.gen(function* () {
        const tools = yield* ProjectTools;
        return ProjectToolsRpcGroup.of({
          [M.settings]: ({ projectId }) => response(tools.settings(projectId)),
          [M.apps]: (input) => response(tools.apps(input)),
          [M.app]: ({ projectId, app }) => response(tools.app(projectId, app)),
          [M.actions]: (input) => response(tools.actions(input)),
          [M.action]: ({ projectId, slug }) => response(tools.action(projectId, slug)),
          [M.connection]: (input) => response(tools.connection(input)),
          [M.grant]: (input) => response(tools.grant(input)),
        });
      }),
    ),
});
