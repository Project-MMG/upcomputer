import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  BOT_APPS_RPC_METHODS as M,
  BOT_APPS_RPC_NAMESPACE,
  BotAppError,
  BotAppsRpcGroup,
  ProjectToolError,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";

import { defineNamespacedRpcContribution } from "../../../../apps/server/src/extensionApi.ts";
import * as BotApps from "./BotApps.ts";

const response = <A>(effect: Effect.Effect<A, BotAppError | ProjectToolError>) =>
  Effect.mapError(effect, (error) =>
    error._tag === "BotAppError"
      ? new BotAppError({ code: error.code })
      : new ProjectToolError({ code: error.code }),
  );

export const BOT_APPS_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "bot-apps-rpc-v1",
  ownerId: "upcomputer.tasks",
  version: 1,
  namespace: BOT_APPS_RPC_NAMESPACE,
  group: BotAppsRpcGroup,
  requiredScopes: {
    [M.state]: AuthOrchestrationReadScope,
    [M.review]: AuthOrchestrationOperateScope,
  },
  handlers: () =>
    BotAppsRpcGroup.toLayer(
      BotAppsRpcGroup.of({
        [M.state]: (input) =>
          Effect.flatMap(BotApps.BotApps, (apps) => response(apps.state(input))),
        [M.review]: (input) =>
          Effect.flatMap(BotApps.BotApps, (apps) => response(apps.review(input))),
      }),
    ),
});
