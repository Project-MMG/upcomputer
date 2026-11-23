import { BotAppError } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const decodeEnvelope = Schema.decodeUnknownEffect(
  Schema.Struct({ successful: Schema.Literal(true), data: Schema.Json }),
);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

export const readPaidMediaResponse = Effect.fn("BotApps.readPaidMediaResponse")(
  function* <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S, data: Schema.Json) {
    const body =
      typeof data === "object" && data !== null && "successful" in data
        ? (yield* decodeEnvelope(data)).data
        : data;
    const payload = typeof body === "string" ? yield* decodeJson(body) : body;
    return yield* Schema.decodeEffect(schema)(payload);
  },
  Effect.mapError(() => new BotAppError({ code: "paid-media-report-invalid" })),
);

export const adResourceId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,19}$/));
export const adCurrency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));
export const adAmount = Schema.Union([Schema.Finite, Schema.NumberFromString]).check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);
