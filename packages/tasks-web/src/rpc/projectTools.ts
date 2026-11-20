import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  PROJECT_TOOLS_RPC_METHODS as M,
  ProjectToolsRpcGroup,
  type ProjectToolActionsInput,
  type ProjectToolAppGrantInput,
  type ProjectToolConnectionInput,
  type ProjectToolGrantInput,
} from "@t3tools/tasks-contracts/v1";
import type * as Effect from "effect/Effect";
import {
  requestExperimentalFeatureRpc,
  type ExperimentalFeatureRpcClient,
} from "../../../../apps/web/src/extensionApi.ts";

export function projectToolsApi(environmentId: EnvironmentId, projectId: ProjectId) {
  const request = <A, E>(
    execute: (
      client: ExperimentalFeatureRpcClient<typeof ProjectToolsRpcGroup>,
    ) => Effect.Effect<A, E>,
    authorization?: { readonly method: string; readonly input: unknown },
  ) => requestExperimentalFeatureRpc(environmentId, ProjectToolsRpcGroup, execute, authorization);

  return {
    settings: () => request((client) => client[M.settings]({ projectId })),
    apps: (input: Pick<typeof ProjectToolActionsInput.Type, "query" | "cursor">) =>
      request((client) => client[M.apps]({ ...input, projectId })),
    actions: (input: Omit<typeof ProjectToolActionsInput.Type, "projectId">) =>
      request((client) => client[M.actions]({ ...input, projectId })),
    app: (app: string) => request((client) => client[M.app]({ app, projectId })),
    action: (slug: string) => request((client) => client[M.action]({ slug, projectId })),
    connection: (input: Omit<ProjectToolConnectionInput, "projectId">) => {
      const payload = { ...input, projectId };
      return request((client) => client[M.connection](payload), {
        method: M.connection,
        input: payload,
      });
    },
    grant: (input: Omit<ProjectToolGrantInput, "projectId">) => {
      const payload = { ...input, projectId };
      return request((client) => client[M.grant](payload), { method: M.grant, input: payload });
    },
    grantApp: (input: Omit<ProjectToolAppGrantInput, "projectId">) => {
      const payload = { ...input, projectId };
      return request((client) => client[M.appGrant](payload), {
        method: M.appGrant,
        input: payload,
      });
    },
  };
}

export type ProjectToolsApi = ReturnType<typeof projectToolsApi>;
