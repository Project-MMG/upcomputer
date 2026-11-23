import type { EnvironmentId } from "@t3tools/contracts";
import type {
  BotSetupDraft,
  BotSetupProposal,
  BotSetupReviewInput,
} from "@t3tools/tasks-contracts/v1";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useState } from "react";

import { Badge } from "../../../../apps/web/src/components/ui/badge.tsx";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import { botPage } from "../bots/botData.tsx";
import { splitListInput } from "../ui/shared.ts";

type Decision = BotSetupReviewInput["decision"];

function DraftProfile({ draft }: { readonly draft: BotSetupDraft }) {
  const gt = useGT();
  return (
    <div className="grid gap-3">
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="font-medium">{gt("Role")}</dt>
          <dd className="break-words text-muted-foreground">{draft.role}</dd>
        </div>
        <div>
          <dt className="font-medium">{gt("Workstream folder")}</dt>
          <dd className="break-words text-muted-foreground">
            <code>{draft.folder}</code>
          </dd>
        </div>
        <div>
          <dt className="font-medium">{gt("Instructions")}</dt>
          <dd className="whitespace-pre-wrap break-words text-muted-foreground">
            {draft.instructions}
          </dd>
        </div>
        {draft.skills.length > 0 ? (
          <div>
            <dt className="font-medium">{gt("Skill references")}</dt>
            <dd className="break-words text-muted-foreground">{draft.skills.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      <section
        className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm"
        aria-label={gt("App preview")}
      >
        <span className="text-xs font-medium text-muted-foreground">{gt("App preview")}</span>
        <p className="break-words font-medium">{draft.appTitle}</p>
        <p className="text-muted-foreground">
          {gt("Shows this specialist’s priorities, blockers, approvals, and completed handoffs.")}
        </p>
      </section>
      <ToolRequests draft={draft} />
    </div>
  );
}

function ToolRequests({ draft }: { readonly draft: BotSetupDraft }) {
  const gt = useGT();
  if (draft.toolRequests.length === 0) return null;
  return (
    <section className="grid gap-1.5 text-sm">
      <h5 className="font-medium">{gt("Requested tool access")}</h5>
      <ul className="grid gap-2">
        {draft.toolRequests.map((tool) => (
          <li key={tool.action} className="grid gap-0.5 rounded-md border p-2.5">
            <p className="break-all font-medium">{tool.action}</p>
            <p className="break-words text-muted-foreground">
              {tool.toolkit} · {tool.account}
            </p>
            {tool.scope ? <p className="break-words text-muted-foreground">{tool.scope}</p> : null}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {gt("Review the account and grant actions in the specialist’s Tools settings.")}
      </p>
    </section>
  );
}

function EditDraft({
  original,
  disabled,
  onSave,
  onCancel,
}: {
  readonly original: BotSetupDraft;
  readonly disabled: boolean;
  readonly onSave: (draft: BotSetupDraft) => void;
  readonly onCancel: () => void;
}) {
  const gt = useGT();
  const { toolRequests, ...profile } = original;
  const [draft, setDraft] = useState(profile);
  const [skills, setSkills] = useState(original.skills.join(", "));
  const [requests, setRequests] = useState(() => toolRequests.map((tool, id) => ({ id, tool })));
  const fields = [
    ["name", gt("Bot name"), 100],
    ["role", gt("Role"), 100],
    ["folder", gt("Workstream folder"), 240],
    ["appTitle", gt("App title"), 100],
  ] as const;
  const toolFields = [
    ["toolkit", gt("Toolkit")],
    ["action", gt("Action slug")],
    ["account", gt("Account label")],
    ["scope", gt("Requested scope")],
  ] as const;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...draft,
          skills: splitListInput(skills),
          toolRequests: requests.map(({ tool }) => tool),
        });
      }}
    >
      <fieldset className="grid min-w-0 gap-3" disabled={disabled}>
        {fields.map(([field, label, limit]) => (
          <label key={field} className="grid gap-1 text-sm font-medium">
            {label}
            <Input
              required
              maxLength={limit}
              value={draft[field]}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
          </label>
        ))}
        <label className="grid gap-1 text-sm font-medium">
          {gt("Instructions")}
          <Textarea
            required
            rows={4}
            maxLength={4000}
            value={draft.instructions}
            onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {gt("Skill references (comma separated)")}
          <Input
            maxLength={1200}
            value={skills}
            onChange={(event) => setSkills(event.target.value)}
          />
        </label>
        {requests.map(({ id, tool }) => (
          <fieldset key={id} className="grid min-w-0 gap-2 rounded-md border p-2.5">
            <legend className="px-1 text-sm font-medium">{gt("Tool request")}</legend>
            {toolFields.map(([field, label]) => (
              <label key={field} className="grid gap-1 text-sm">
                {label}
                <Input
                  required={field !== "scope"}
                  maxLength={field === "scope" ? 240 : 100}
                  value={tool[field]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRequests(
                      requests.map((entry) =>
                        entry.id === id ? { id, tool: { ...tool, [field]: value } } : entry,
                      ),
                    );
                  }}
                />
              </label>
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRequests(requests.filter((entry) => entry.id !== id))}
              >
                {gt("Remove tool request")}
              </Button>
            </div>
          </fieldset>
        ))}
        {requests.length < 6 ? (
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setRequests([
                  ...requests,
                  {
                    id: (requests.at(-1)?.id ?? -1) + 1,
                    tool: { toolkit: "", action: "", account: "", scope: "" },
                  },
                ])
              }
            >
              {gt("Add tool request")}
            </Button>
          </div>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled}>
          {gt("Save changes")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
          {gt("Cancel")}
        </Button>
      </div>
    </form>
  );
}

export function BotSetupReview({
  environmentId,
  proposal,
  disabled,
  review,
}: {
  readonly environmentId: EnvironmentId;
  readonly proposal: BotSetupProposal;
  readonly disabled: boolean;
  readonly review: (decision: Decision) => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const [editingRevision, setEditingRevision] = useState<string>();
  const { draft, state } = proposal;
  const status = {
    pending: gt("Awaiting review"),
    rejected: gt("Rejected"),
    applying: gt("Setup approved"),
    applied: gt("Setup complete"),
  }[state.status];
  if (state.status === "rejected") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="break-words font-medium">{draft.name}</span>
        <Badge variant="secondary">{status}</Badge>
      </div>
    );
  }
  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        <span className="ml-1 break-words">{draft.name}</span>
        <span className="ml-2">
          <Badge variant={state.status === "pending" ? "warning" : "secondary"}>{status}</Badge>
        </span>
      </summary>
      <div className="grid gap-3 border-t p-3">
        {state.status === "applied" ? (
          <>
            {state.reused ? (
              <p className="text-sm text-muted-foreground">
                {gt("Reused an existing bot in this project.")}
              </p>
            ) : null}
            <ToolRequests draft={draft} />
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigate(botPage(environmentId, { bot: state.botId }))}
              >
                {gt("Open bot settings")}
              </Button>
            </div>
          </>
        ) : editingRevision === proposal.revision && state.status === "pending" ? (
          <EditDraft
            original={draft}
            disabled={disabled}
            onSave={(edited) => review({ kind: "edit", draft: edited })}
            onCancel={() => setEditingRevision(undefined)}
          />
        ) : (
          <>
            <DraftProfile draft={draft} />
            <p className="text-xs text-muted-foreground">
              {gt(
                "New bots start in Supervised mode with the coordinating bot’s provider and model.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={disabled} onClick={() => review({ kind: "approve" })}>
                {state.status === "applying" ? gt("Continue setup") : gt("Approve setup")}
              </Button>
              {state.status === "pending" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setEditingRevision(proposal.revision)}
                  >
                    {gt("Edit proposal")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => review({ kind: "reject" })}
                  >
                    {gt("Reject proposal")}
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
