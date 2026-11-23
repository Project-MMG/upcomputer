import {
  BOT_APP_NOTE_LIMIT,
  type BotAppReviewInput,
  type OutboundDisposition,
  type OutboundSnapshot,
  type TaskAgentId,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { useState } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";

export function OutboundQueue({
  snapshot,
  review,
}: {
  readonly snapshot: OutboundSnapshot;
  readonly review?: {
    readonly botId: TaskAgentId;
    readonly disabled: boolean;
    readonly send: (decision: BotAppReviewInput["decision"]) => void;
  };
}) {
  const gt = useGT();
  const { opportunities } = snapshot.definition;
  const [choices, setChoices] = useState<ReadonlyMap<string, OutboundDisposition>>(new Map());
  const [note, setNote] = useState(snapshot.note);
  const decisions = opportunities.map(({ id, disposition }) => ({
    id,
    disposition: choices.get(id) ?? disposition,
  }));
  const hasPendingDecisions = decisions.some(({ disposition }) => disposition === "pending");
  const labels = {
    pending: gt("Needs review"),
    "keep-draft": gt("Keep draft"),
    skip: gt("Skip"),
    handoff: gt("Refer to owner"),
  } satisfies Record<OutboundDisposition, string>;
  const options = [
    { value: "pending", label: labels.pending },
    { value: "keep-draft", label: labels["keep-draft"] },
    { value: "skip", label: labels.skip },
    { value: "handoff", label: labels.handoff },
  ] as const;

  return (
    <>
      {!review && opportunities.some(({ disposition }) => disposition === "handoff") ? (
        <p className="text-sm text-muted-foreground">
          {gt("Ask this bot to assign a saved referral in Tasks.")}
        </p>
      ) : null}
      <ul className="grid gap-3" aria-label={gt("Opportunities")}>
        {opportunities.map(
          ({ id, title, source, reason, draftReply, ownerId, ownerName, disposition }) => (
            <li key={id} className="grid min-w-0 gap-2 rounded-lg border bg-card p-3.5">
              <h4 className="break-words text-sm font-semibold">{title}</h4>
              <dl className="grid min-w-0 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{gt("Source")}</dt>
                  <dd className="break-words">
                    {source.kind === "link" ? (
                      <a
                        className="text-primary underline underline-offset-2"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.label}
                      </a>
                    ) : (
                      <>
                        {source.label}
                        <p className="text-xs text-muted-foreground">{source.reference}</p>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{gt("Reason to engage")}</dt>
                  <dd className="whitespace-pre-wrap break-words">{reason}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{gt("Draft reply")}</dt>
                  <dd className="whitespace-pre-wrap break-words">{draftReply}</dd>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,1fr)] items-start gap-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{gt("Owner")}</dt>
                    <dd className="break-words">{ownerName}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{gt("Decision")}</dt>
                    <dd>
                      {review ? (
                        <Select<OutboundDisposition>
                          items={options}
                          disabled={review.disabled}
                          value={choices.get(id) ?? disposition}
                          onValueChange={(value) => {
                            if (value !== null) {
                              setChoices((current) => new Map(current).set(id, value));
                            }
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={gt("Decision for {title}", { title })}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            {options.map(({ value, label }) => (
                              <SelectItem
                                key={value}
                                value={value}
                                disabled={value === "handoff" && ownerId === review.botId}
                              >
                                {label}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      ) : (
                        labels[disposition]
                      )}
                    </dd>
                  </div>
                </div>
              </dl>
            </li>
          ),
        )}
      </ul>
      {review ? (
        <div className="grid gap-2">
          <label className="grid gap-1.5 text-sm font-medium">
            {gt("Review note")}
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={BOT_APP_NOTE_LIMIT}
              disabled={review.disabled}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={review.disabled || hasPendingDecisions}
              onClick={() => review.send({ kind: "approve-outbound", decisions, note })}
            >
              {gt("Save queue")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={review.disabled}
              onClick={() => review.send({ kind: "dismiss" })}
            >
              {gt("Dismiss proposal")}
            </Button>
          </div>
          {hasPendingDecisions ? (
            <p className="text-sm text-muted-foreground">
              {gt("Choose a decision for every opportunity to save the queue.")}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
