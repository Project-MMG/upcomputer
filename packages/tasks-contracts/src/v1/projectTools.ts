import { ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { TaskAgentId } from "./agents.ts";

export const ProjectToolSlug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9_.-]{0,199}$/i),
);
export const ProjectToolQuery = Schema.String.check(Schema.isMaxLength(200));
export const ProjectToolCursor = Schema.String.check(Schema.isMaxLength(1000));

export const ProjectToolAction = Schema.Struct({
  slug: ProjectToolSlug,
  name: Schema.String,
  description: Schema.String,
  app: ProjectToolSlug,
  appName: Schema.String,
  requiresAccount: Schema.Boolean,
  effect: Schema.Literals(["read", "write"]),
});
export type ProjectToolAction = typeof ProjectToolAction.Type;

export const ProjectToolActionDetails = ProjectToolAction.mapFields((fields) => ({
  ...fields,
  inputSchema: Schema.JsonObject,
}));
export type ProjectToolActionDetails = typeof ProjectToolActionDetails.Type;

export const ProjectToolApp = Schema.Struct({
  slug: ProjectToolSlug,
  name: Schema.String,
  description: Schema.String,
});
export type ProjectToolApp = typeof ProjectToolApp.Type;
export const ProjectToolAppDetails = ProjectToolApp.mapFields((fields) => ({
  ...fields,
  setup: Schema.Literals(["no-account", "connect", "auth-config-required"]),
}));
export type ProjectToolAppDetails = typeof ProjectToolAppDetails.Type;

const AllBots = Schema.Struct({ kind: Schema.Literal("all") });
export const ProjectToolAudience = Schema.Union([
  AllBots,
  Schema.Struct({ kind: Schema.Literal("selected"), botIds: Schema.NonEmptyArray(TaskAgentId) }),
]);
export type ProjectToolAudience = typeof ProjectToolAudience.Type;

export const ProjectToolAppGrant = Schema.Struct({
  app: ProjectToolAppDetails,
  audience: ProjectToolAudience,
});
export type ProjectToolAppGrant = typeof ProjectToolAppGrant.Type;

export const ProjectToolGrant = Schema.Struct({
  action: ProjectToolAction,
  audience: ProjectToolAudience,
  fixedInputs: Schema.JsonObject,
});
export type ProjectToolGrant = typeof ProjectToolGrant.Type;

const ProjectToolAccount = Schema.Struct({
  app: ProjectToolSlug,
  account: Schema.NullOr(
    Schema.Struct({
      label: Schema.String,
      status: Schema.Literals(["connected", "unavailable", "unverified"]),
    }),
  ),
  pending: Schema.Boolean,
});

const ProjectToolAssignment = ProjectToolGrant.mapFields((fields) => ({
  ...fields,
  status: Schema.Literals([
    "available",
    "account-required",
    "account-unavailable",
    "action-unavailable",
    "action-changed",
    "no-selected-bots",
    "unverified",
  ]),
}));
export type ProjectToolAssignment = typeof ProjectToolAssignment.Type;

export const ProjectToolSettings = Schema.Struct({
  configured: Schema.Boolean,
  accounts: Schema.Array(ProjectToolAccount),
  assignments: Schema.Array(ProjectToolAssignment),
  appGrants: Schema.optionalKey(Schema.Array(ProjectToolAppGrant)),
  bots: Schema.Array(Schema.Struct({ id: TaskAgentId, name: Schema.String })),
});
export type ProjectToolSettings = typeof ProjectToolSettings.Type;

const project = { projectId: ProjectId };
const page = {
  ...project,
  query: Schema.optional(ProjectToolQuery),
  cursor: Schema.optional(ProjectToolCursor),
};
export const ProjectToolAppsInput = Schema.Struct(page);
export const ProjectToolActionsInput = Schema.Struct({
  ...page,
  app: Schema.optional(ProjectToolSlug),
});
export const ProjectToolConnectionInput = Schema.Struct({
  ...project,
  app: ProjectToolSlug,
  operation: Schema.Literals(["start", "finish", "disconnect"]),
});
export type ProjectToolConnectionInput = typeof ProjectToolConnectionInput.Type;

const requestedAudience = Schema.NullOr(
  Schema.Union([
    AllBots,
    Schema.Struct({ kind: Schema.Literal("selected"), botIds: Schema.Array(TaskAgentId) }),
  ]),
);

export const ProjectToolGrantInput = Schema.Struct({
  ...project,
  slug: ProjectToolSlug,
  audience: requestedAudience,
  fixedInputs: Schema.JsonObject,
});
export type ProjectToolGrantInput = typeof ProjectToolGrantInput.Type;

export const ProjectToolAppGrantInput = Schema.Struct({
  ...project,
  app: ProjectToolSlug,
  audience: requestedAudience,
});
export type ProjectToolAppGrantInput = typeof ProjectToolAppGrantInput.Type;

const messages = {
  "missing-key": "Set up a Composio API key on this environment to use project tools.",
  "missing-project": "This project is unavailable in this environment.",
  "not-a-bot": "This action requires a bot running in its working project.",
  "not-assigned": "This action is unavailable to this bot in its current project.",
  "plan-mode": "Plan mode can only run read actions.",
  "wrong-action-type": "Use the project tool for this action's read or write access.",
  "action-changed": "This action changed in Composio. Review and save its assignment again.",
  "action-unavailable": "This action is no longer available in Composio.",
  "app-unavailable": "This app is no longer available in Composio.",
  "auth-config-required": "Create an auth config for this app in your Composio project first.",
  "account-not-needed": "This app does not need a connected account.",
  "no-pending-account": "Start a new sign-in for this app.",
  "pending-account": "Finish signing in with Composio, then check the connection again.",
  "failed-account": "This sign-in is no longer available. Start a new sign-in.",
  "account-unavailable": "Connect an active account for this app in Project Settings.",
  "account-removal-failed":
    "Project access ended. Remove the connection in the Composio dashboard.",
  "invalid-bots": "Choose bots that currently work in this project.",
  "invalid-input-schema": "Composio's input schema for this action could not be validated.",
  "invalid-fixed-inputs":
    "Fixed inputs must use fields and values from this action's input schema.",
  "invalid-arguments": "The action arguments do not match its input schema.",
  "policy-changed": "The bot's project tool access changed while preparing the action.",
  "workspace-unavailable": "This bot chat does not have a Gmail workspace.",
  "workspace-input-conflict":
    "A fixed project tool input conflicts with the Gmail workspace request.",
  "workspace-storage-unavailable": "Up.computer could not load or save the Gmail workspace.",
  "workspace-account-changed": "The Gmail connection changed. Check the inbox again.",
  "workspace-message-changed": "This Gmail message is no longer available for a reply.",
  "workspace-recipient-unavailable": "No reply address was found for this Gmail message.",
  "workspace-draft-changed": "This draft changed or is no longer available. Reopen it to continue.",
  "storage-unavailable": "Up.computer could not load or save this project's tools.",
  "credentials-unavailable": "Up.computer could not read this environment's Composio key.",
  "composio-unavailable": "Up.computer could not reach Composio or read its response.",
  "composio-rejected": "Composio rejected the project's request. Check the API key and app setup.",
  "composio-approval-required": "Composio requires approval for this action.",
  "action-failed": "Composio reported that the action failed.",
  "action-outcome-unknown": "Composio did not confirm the result. Check the app before retrying.",
} as const;

export class ProjectToolError extends Schema.TaggedError<ProjectToolError>()("ProjectToolError", {
  code: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
  status: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return messages[this.code];
  }
}

export const PROJECT_TOOLS_RPC_NAMESPACE = "upcomputer.project-tools.v1";
export const PROJECT_TOOLS_RPC_METHODS = {
  settings: `${PROJECT_TOOLS_RPC_NAMESPACE}.settings`,
  apps: `${PROJECT_TOOLS_RPC_NAMESPACE}.apps`,
  app: `${PROJECT_TOOLS_RPC_NAMESPACE}.app`,
  actions: `${PROJECT_TOOLS_RPC_NAMESPACE}.actions`,
  action: `${PROJECT_TOOLS_RPC_NAMESPACE}.action`,
  connection: `${PROJECT_TOOLS_RPC_NAMESPACE}.connection`,
  appGrant: `${PROJECT_TOOLS_RPC_NAMESPACE}.appGrant`,
  grant: `${PROJECT_TOOLS_RPC_NAMESPACE}.grant`,
} as const;

const M = PROJECT_TOOLS_RPC_METHODS;
export const ProjectToolsRpcGroup = RpcGroup.make(
  Rpc.make(M.settings, {
    payload: Schema.Struct(project),
    success: ProjectToolSettings,
    error: ProjectToolError,
  }),
  Rpc.make(M.apps, {
    payload: ProjectToolAppsInput,
    success: Schema.Struct({
      items: Schema.Array(ProjectToolApp),
      nextCursor: Schema.NullOr(ProjectToolCursor),
    }),
    error: ProjectToolError,
  }),
  Rpc.make(M.app, {
    payload: Schema.Struct({ ...project, app: ProjectToolSlug }),
    success: ProjectToolAppDetails,
    error: ProjectToolError,
  }),
  Rpc.make(M.actions, {
    payload: ProjectToolActionsInput,
    success: Schema.Struct({
      items: Schema.Array(ProjectToolAction),
      nextCursor: Schema.NullOr(ProjectToolCursor),
    }),
    error: ProjectToolError,
  }),
  Rpc.make(M.action, {
    payload: Schema.Struct({ ...project, slug: ProjectToolSlug }),
    success: ProjectToolActionDetails,
    error: ProjectToolError,
  }),
  Rpc.make(M.connection, {
    payload: ProjectToolConnectionInput,
    success: Schema.Struct({ url: Schema.NullOr(Schema.String) }),
    error: ProjectToolError,
  }),
  Rpc.make(M.grant, {
    payload: ProjectToolGrantInput,
    error: ProjectToolError,
  }),
  Rpc.make(M.appGrant, {
    payload: ProjectToolAppGrantInput,
    error: ProjectToolError,
  }),
);
