import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOT_APPS_RPC_METHODS as M,
  BotAppsRpcGroup,
  type BotAppReviewInput,
  type BotAppTarget,
} from "@t3tools/tasks-contracts/v1";
import { requestExperimentalFeatureRpc } from "../../../../apps/web/src/extensionApi.ts";

export function botAppsApi(environmentId: EnvironmentId, target: BotAppTarget) {
  return {
    state: () =>
      requestExperimentalFeatureRpc(environmentId, BotAppsRpcGroup, (client) =>
        client[M.state](target),
      ),
    review: (input: Pick<BotAppReviewInput, "revision" | "decision">) => {
      const payload = { ...target, ...input };
      return requestExperimentalFeatureRpc(
        environmentId,
        BotAppsRpcGroup,
        (client) => client[M.review](payload),
        { method: M.review, input: payload },
      );
    },
  };
}
