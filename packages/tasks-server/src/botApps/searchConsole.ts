import { BotAppError, type BotAppSource } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export function sourceAction(source: BotAppSource) {
  return {
    app: "google_search_console",
    input: {
      slug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
      requiredFixedInputs: { site_url: source.property },
      arguments: {
        site_url: source.property,
        start_date: source.window.start,
        end_date: source.window.end,
        dimensions: ["page"],
        dimension_filter_groups: [
          {
            groupType: "and",
            filters: [{ dimension: "page", operator: "equals", expression: source.page }],
          },
        ],
        row_limit: 1,
        search_type: "web",
        data_state: "final",
      },
    },
  };
}

const count = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const rows = Schema.Array(
  Schema.Struct({ keys: Schema.Tuple([Schema.String]), clicks: count, impressions: count }),
).check(Schema.isMaxLength(1));
const report = Schema.Union([
  Schema.Struct({ rows }),
  Schema.Struct({ responseAggregationType: Schema.String, rows: Schema.optionalKey(rows) }),
]);
const response = Schema.Union([
  report,
  Schema.Struct({ successful: Schema.Literal(true), data: report }),
]);
const decode = Schema.decodeUnknownEffect(response);

export const readMetrics = Effect.fn("BotApps.readSearchConsoleMetrics")(function* (
  data: Schema.Json,
  page: string,
) {
  const result = yield* decode(data).pipe(
    Effect.mapError((cause) => new BotAppError({ code: "report-invalid", cause })),
  );
  const [row] = ("successful" in result ? result.data.rows : result.rows) ?? [];
  if (!row) return yield* new BotAppError({ code: "report-empty" });
  if (row.keys[0] !== page) return yield* new BotAppError({ code: "report-invalid" });
  return [
    { label: "Clicks", value: row.clicks },
    { label: "Impressions", value: row.impressions },
  ] as const;
});
