import { Ajv, type AnySchemaObject } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { ProjectToolError } from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const isJsonObject = Schema.is(Schema.JsonObject);
const options = { strict: false, ownProperties: true, addUsedSchema: false } as const;

export const makeArgumentValidator = () => {
  const addFormats = formats.default;
  const draft7 = addFormats(new Ajv(options));
  const draft2019 = addFormats(new Ajv2019(options));
  const draft2020 = addFormats(new Ajv2020(options));

  const compile = (schema: Schema.JsonObject, fixed: boolean) =>
    Effect.try({
      try: () => {
        if (schema.$async === true) throw new Error("Action schemas must be synchronous.");
        const dialect = typeof schema.$schema === "string" ? schema.$schema : "";
        const ajv = dialect.includes("2020-12")
          ? draft2020
          : dialect.includes("2019-09")
            ? draft2019
            : draft7;
        const input: AnySchemaObject = fixed
          ? {
              ...(dialect ? { $schema: dialect } : {}),
              ...(schema.definitions ? { definitions: schema.definitions } : {}),
              ...(schema.$defs ? { $defs: schema.$defs } : {}),
              type: "object",
              properties: isJsonObject(schema.properties) ? schema.properties : {},
              additionalProperties: false,
            }
          : schema;
        try {
          return ajv.compile(input);
        } finally {
          ajv.removeSchema(input);
        }
      },
      catch: () => new ProjectToolError({ code: "invalid-input-schema" }),
    });

  return Effect.fn("ProjectTools.validateArguments")(function* (
    schema: Schema.JsonObject,
    args: Schema.JsonObject,
    fixed = false,
  ) {
    const validate = yield* compile(schema, false);
    if (fixed && Object.keys(args).length === 0) return;
    const matches = fixed ? yield* compile(schema, true) : validate;
    if (!matches(args)) {
      return yield* new ProjectToolError({
        code: fixed ? "invalid-fixed-inputs" : "invalid-arguments",
      });
    }
  });
};
