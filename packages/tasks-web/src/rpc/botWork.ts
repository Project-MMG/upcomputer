import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_WORK_RPC_METHODS as M,
  BotWorkRpcGroup,
  type BotAppTarget,
  type BotSetupReviewInput,
  type BotWorkConfigureInput,
} from "@t3tools/tasks-contracts/v1";

import { requestExperimentalFeatureRpc } from "../../../../apps/web/src/extensionApi.ts";

export function botWorkApi(environmentId: EnvironmentId, target: BotAppTarget) {
  return {
    state: () =>
      requestExperimentalFeatureRpc(environmentId, BotWorkRpcGroup, (client) =>
        client[M.state](target),
      ),
    configure: (action: BotWorkConfigureInput["action"]) => {
      const input = { ...target, action };
      return requestExperimentalFeatureRpc(
        environmentId,
        BotWorkRpcGroup,
        (client) => client[M.configure](input),
        { method: M.configure, input },
      );
    },
    review: (review: Pick<BotSetupReviewInput, "roleKey" | "revision" | "decision">) => {
      const input = { ...target, ...review };
      return requestExperimentalFeatureRpc(
        environmentId,
        BotWorkRpcGroup,
        (client) => client[M.review](input),
        { method: M.review, input },
      );
    },
  };
}
