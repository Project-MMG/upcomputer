import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  ProjectToolQuery,
  ProjectToolCursor,
  ProjectToolSlug,
  type ProjectToolError,
} from "@t3tools/tasks-contracts/v1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import {
  McpInvocationContext,
  McpToolAccess,
  resultToolkitRegistration,
  ThreadManagementService,
} from "../../../../apps/server/src/extensionApi.ts";
import { ProjectTools } from "./ProjectTools.ts";

const forThread = () => {
  const fiber = Fiber.getCurrent();
  const thread = fiber && Context.getOrUndefined(fiber.context, McpInvocationContext)?.thread;
  return thread !== undefined && !thread.subagent;
};
const parameters = Schema.Struct({ slug: ProjectToolSlug, arguments: Schema.JsonObject });
const toolkit = Toolkit.make(
  Tool.make("project_tools_search", {
    description:
      "Find actions assigned to this bot in its current project. Results include input schemas, read or write access, and names of fixed inputs. Search an app by its slug from the apps list to find its actions. Use nextOffset for individual assignments or nextCursor for a full app's next page.",
    parameters: Schema.Struct({
      query: Schema.optional(ProjectToolQuery),
      offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      app: Schema.optional(ProjectToolSlug),
      cursor: Schema.optional(ProjectToolCursor),
    }),
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, forThread)
    .addDependency(McpInvocationContext),
  Tool.make("project_tool_read", {
    description:
      "Run an assigned read action from project_tools_search. Omit inputs fixed by the project.",
    parameters,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.OpenWorld, true)
    .annotate(McpSchema.EnabledWhen, forThread)
    .addDependency(McpInvocationContext),
  Tool.make("project_tool_write", {
    description:
      "Run an assigned write action from project_tools_search. It can change the connected app. Omit inputs fixed by the project. If the outcome is unknown, check the app before retrying.",
    parameters,
    success: McpSchema.CallToolResult,
    failure: OrchestratorMcpFailure,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.OpenWorld, true)
    .annotate(McpSchema.EnabledWhen, forThread)
    .addDependency(McpInvocationContext)
    .addDependency(ThreadManagementService),
);

const result = <A, R>(effect: Effect.Effect<A, ProjectToolError, R>) =>
  effect.pipe(
    Effect.match({
      onFailure: (error) =>
        new McpSchema.CallToolResult({
          isError: true,
          content: [{ type: "text", text: error.message }],
          structuredContent: { code: error.code },
        }),
      onSuccess: (value) =>
        new McpSchema.CallToolResult({
          content: [{ type: "text", text: JSON.stringify(value) }],
        }),
    }),
  );

const handlers = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const tools = yield* ProjectTools;
    return {
      project_tools_search: McpToolAccess.readsAsCaller((input) =>
        result(Effect.flatMap(McpInvocationContext, (scope) => tools.search(scope, input))),
      ),
      project_tool_read: McpToolAccess.readsAsCaller((input) =>
        result(
          Effect.flatMap(McpInvocationContext, (scope) => tools.execute(scope, "read", input)),
        ),
      ),
      project_tool_write: McpToolAccess.actsAsCaller((input) =>
        result(
          Effect.flatMap(McpInvocationContext, (scope) => tools.execute(scope, "write", input)),
        ),
      ),
    };
  }),
);

export const layer = resultToolkitRegistration(toolkit, handlers);
