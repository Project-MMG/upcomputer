import { BotWorkApp } from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";

const workAppJson = Schema.fromJsonString(BotWorkApp);
export const decodeWorkApp = Schema.decodeUnknownEffect(workAppJson);
export const encodeWorkApp = Schema.encodeEffect(workAppJson);
