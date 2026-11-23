import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  BOT_WORK_RPC_METHODS as M,
  BOT_WORK_RPC_NAMESPACE,
  BotWorkError,
  BotWorkRpcGroup,
  ProjectToolError,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";

import { defineNamespacedRpcContribution } from "../../../../apps/server/src/extensionApi.ts";
import * as BotWork from "./BotWork.ts";

const response = <A>(effect: Effect.Effect<A, BotWorkError | ProjectToolError>) =>
  Effect.mapError(effect, (error) =>
    error._tag === "BotWorkError"
      ? new BotWorkError({ code: error.code })
      : new ProjectToolError({ code: error.code }),
  );

export const BOT_WORK_RPC_CONTRIBUTION = defineNamespacedRpcContribution({
  id: "bot-work-rpc-v1",
  ownerId: "upcomputer.tasks",
  version: 1,
  namespace: BOT_WORK_RPC_NAMESPACE,
  group: BotWorkRpcGroup,
  requiredScopes: {
    [M.state]: AuthOrchestrationReadScope,
    [M.configure]: AuthOrchestrationOperateScope,
    [M.review]: AuthOrchestrationOperateScope,
  },
  handlers: () =>
    BotWorkRpcGroup.toLayer(
      Effect.gen(function* () {
        const work = yield* BotWork.BotWork;
        return BotWorkRpcGroup.of({
          [M.state]: (input) => response(work.state(input)),
          [M.configure]: (input) => response(work.configure(input)),
          [M.review]: (input) => response(work.review(input)),
        });
      }),
    ),
});
