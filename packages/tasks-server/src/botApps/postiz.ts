import { BotAppError, type SocialCalendarPost } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const noError = Schema.optionalKey(Schema.Literal(false));
const integration = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.String,
  disabled: Schema.optionalKey(Schema.Boolean),
});
const list = Schema.Struct({
  isError: noError,
  output: Schema.Array(integration).check(Schema.isMaxLength(1000)),
});
const toolResult = Schema.Union([
  list,
  Schema.Struct({ isError: noError, structuredContent: list }),
  Schema.Struct({
    isError: noError,
    structuredContent: Schema.optionalKey(Schema.Never),
    content: Schema.Tuple([
      Schema.Struct({ type: Schema.Literal("text"), text: Schema.fromJsonString(list) }),
    ]),
  }),
]);
const decode = Schema.decodeUnknownEffect(
  Schema.Union([toolResult, Schema.Struct({ successful: Schema.Literal(true), data: toolResult })]),
);

export const readPostizDestinations = Effect.fn("BotApps.readPostizDestinations")(function* (
  data: Schema.Json,
  posts: readonly SocialCalendarPost[],
) {
  const response = yield* decode(data).pipe(
    Effect.mapError((cause) => new BotAppError({ code: "postiz-response-invalid", cause })),
  );
  const result = "successful" in response ? response.data : response;
  const { output } =
    "output" in result
      ? result
      : "content" in result
        ? result.content[0].text
        : result.structuredContent;
  const destinations = [];
  for (const { channel, destination } of posts) {
    if (destination.kind !== "postiz") continue;
    const matches = output.filter(({ id }) => id === destination.integrationId);
    const [match] = matches;
    if (matches.length !== 1 || !match || match.disabled) {
      return yield* new BotAppError({ code: "postiz-destination-unavailable" });
    }
    const platform = match.platform === "instagram-standalone" ? "instagram" : match.platform;
    const label = match.name.trim();
    if (channel !== platform || label.length === 0 || label.length > 200) {
      return yield* new BotAppError({ code: "postiz-destination-unavailable" });
    }
    destinations.push({ integrationId: destination.integrationId, label });
  }
  const [first, ...rest] = destinations;
  if (!first) return yield* new BotAppError({ code: "postiz-destination-unavailable" });
  return [first, ...rest] as const;
});
