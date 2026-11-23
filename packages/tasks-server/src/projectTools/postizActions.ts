import type { SocialCalendarSource } from "@t3tools/tasks-contracts/v1";
import * as Schema from "effect/Schema";

export const postizApp = "postiz_mcp";
export const postizScheduleFixtureSlug = "POSTIZ_MCP_SCHEDULE_POST_FIXTURE";

export const SocialFixtureArguments = Schema.Struct({
  integration_id: Schema.String,
  publish_at: Schema.String,
  caption: Schema.String,
  media_url: Schema.String,
  group: Schema.optionalKey(Schema.String),
});
export type SocialFixtureArguments = typeof SocialFixtureArguments.Type;

export function postizSourceAction(source: Extract<SocialCalendarSource, { kind: "postiz" }>) {
  const args: Schema.JsonObject = source.group === undefined ? {} : { group: source.group };
  return {
    app: postizApp,
    input: {
      slug: "POSTIZ_MCP_INTEGRATION_LIST",
      arguments: args,
      requiredFixedInputs: args,
    },
  };
}
