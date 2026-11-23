import { ModelSelection, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { TaskAgentId, TaskAgentWorkingFolder } from "./agents.ts";
import { BotAppTarget, BotWorkApp } from "./botApps.ts";
import { ProjectToolError } from "./projectTools.ts";
import { TaskId } from "./tasks.ts";

const shortText = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const revision = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
const roleKey = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/));
const toolRequest = Schema.Struct({
  toolkit: shortText,
  action: shortText,
  account: shortText,
  scope: Schema.String.check(Schema.isMaxLength(240)),
});

export const BotSetupDraft = Schema.Struct({
  name: shortText,
  role: shortText,
  folder: TaskAgentWorkingFolder,
  instructions: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  skills: Schema.Array(shortText).check(Schema.isMaxLength(12)),
  toolRequests: Schema.Array(toolRequest).check(
    Schema.isMaxLength(6),
    Schema.makeFilter(
      (requests) =>
        new Set(requests.map(({ action }) => action)).size === requests.length ||
        "List each requested action once",
    ),
  ),
  appTitle: shortText,
});
export type BotSetupDraft = typeof BotSetupDraft.Type;

export const BotSetupProposalInput = Schema.Struct({
  roleKey,
  draft: BotSetupDraft,
  replacesRejectedRevision: Schema.optionalKey(revision),
});
export type BotSetupProposalInput = typeof BotSetupProposalInput.Type;

export const BotSetupProposal = Schema.Struct({
  roleKey,
  revision,
  draft: BotSetupDraft,
  modelSelection: ModelSelection,
  state: Schema.Union([
    Schema.Struct({ status: Schema.Literals(["pending", "rejected"]) }),
    Schema.Struct({
      status: Schema.Literal("applying"),
      botId: TaskAgentId,
      reused: Schema.Boolean,
    }),
    Schema.Struct({
      status: Schema.Literal("applied"),
      botId: TaskAgentId,
      threadId: ThreadId,
      reused: Schema.Boolean,
    }),
  ]),
});
export type BotSetupProposal = typeof BotSetupProposal.Type;

export const BotSetupReviewInput = Schema.Struct({
  ...BotAppTarget.fields,
  roleKey,
  revision,
  decision: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("edit"), draft: BotSetupDraft }),
    Schema.Struct({ kind: Schema.Literals(["approve", "reject"]) }),
  ]),
});
export type BotSetupReviewInput = typeof BotSetupReviewInput.Type;

export const BotWorkConfigureInput = Schema.Struct({
  ...BotAppTarget.fields,
  action: Schema.Literals(["enable-team", "remove"]),
});
export type BotWorkConfigureInput = typeof BotWorkConfigureInput.Type;

const WorkstreamOwner = Schema.Struct({
  id: TaskAgentId,
  threadId: ThreadId,
  name: Schema.String,
  role: Schema.String,
});
export type WorkstreamOwner = typeof WorkstreamOwner.Type;

const BotWorkItem = Schema.Struct({
  id: TaskId,
  title: Schema.String,
  status: Schema.String,
  priority: Schema.NullOr(Schema.String),
  ownerId: Schema.NullOr(TaskAgentId),
  hasResult: Schema.Boolean,
  approvalThreadId: Schema.NullOr(ThreadId),
});
export type BotWorkItem = typeof BotWorkItem.Type;

const BotWorkState = Schema.Struct({
  app: BotWorkApp,
  roster: Schema.Array(WorkstreamOwner),
  priorities: Schema.Array(BotWorkItem),
  blockers: Schema.Array(BotWorkItem),
  approvals: Schema.Array(BotWorkItem),
  handoffs: Schema.Array(BotWorkItem),
  proposals: Schema.Array(BotSetupProposal),
});
export type BotWorkState = typeof BotWorkState.Type;

const messages = {
  "storage-unavailable": "Up.computer could not load or save this bot’s work.",
  "app-unavailable": "This work app is unavailable. Open it from this bot’s Bot Apps.",
  "app-already-configured": "Remove the existing work app before enabling the team dashboard.",
  "team-required": "Enable the team dashboard in this bot’s settings to propose a setup.",
  "proposal-changed": "The setup proposal changed. Open the latest revision to continue.",
  "role-already-proposed": "A different bot already proposed setup for this role in this project.",
  "folder-unavailable": "Choose an existing folder inside this project’s checkout.",
  "coordinator-name": "Choose a name different from the coordinating bot’s name.",
  "ambiguous-name": "Several bots in this project use that name. Choose a distinct name.",
  "setup-unavailable": "Up.computer could not finish this bot setup. Try again.",
} as const;

export class BotWorkError extends Schema.TaggedError<BotWorkError>()("BotWorkError", {
  code: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return messages[this.code];
  }
}

export const BOT_WORK_RPC_NAMESPACE = "upcomputer.bot-work.v1";
export const BOT_WORK_RPC_METHODS = {
  state: `${BOT_WORK_RPC_NAMESPACE}.state`,
  configure: `${BOT_WORK_RPC_NAMESPACE}.configure`,
  review: `${BOT_WORK_RPC_NAMESPACE}.review`,
} as const;

const error = Schema.Union([BotWorkError, ProjectToolError]);
export const BotWorkRpcGroup = RpcGroup.make(
  Rpc.make(BOT_WORK_RPC_METHODS.state, { payload: BotAppTarget, success: BotWorkState, error }),
  Rpc.make(BOT_WORK_RPC_METHODS.configure, { payload: BotWorkConfigureInput, error }),
  Rpc.make(BOT_WORK_RPC_METHODS.review, { payload: BotSetupReviewInput, error }),
);
