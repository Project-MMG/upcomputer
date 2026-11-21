import {
  GMAIL_REPLY_BODY_LIMIT,
  type GmailDraftUpdateInput,
  type GmailReplyDraft as ReplyDraft,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { useId, useState } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import { projectToolErrorMessage } from "../projectTools/remoteData.ts";

export function GmailReplyDraft({
  draft,
  canWrite,
  onUpdate,
}: {
  readonly draft: ReplyDraft;
  readonly canWrite: boolean;
  readonly onUpdate: (
    revision: number,
    change: GmailDraftUpdateInput["change"],
  ) => Promise<ReplyDraft>;
}) {
  const gt = useGT();
  const fieldId = useId();
  const [saved, setSaved] = useState<ReplyDraft>();
  const current = saved && saved.revision > draft.revision ? saved : draft;
  const [edit, setEdit] = useState<{ readonly body: string; readonly revision: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function update(revision: number, change: GmailDraftUpdateInput["change"]) {
    setBusy(true);
    setError(undefined);
    try {
      setSaved(await onUpdate(revision, change));
      setEdit(undefined);
    } catch (cause) {
      setError(projectToolErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const failure = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;

  if (current.status === "dismissed")
    return (
      <div className="space-y-2 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{gt("Draft dismissed")}</p>
          {canWrite ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void update(current.revision, { kind: "restore" })}
            >
              {gt("Restore draft")}
            </Button>
          ) : null}
        </div>
        {failure}
      </div>
    );

  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/25 p-3">
      <h5 className="text-sm font-medium">{gt("Reply draft")}</h5>
      <p className="text-xs wrap-anywhere text-muted-foreground">
        {gt("To")} {current.recipient}
      </p>
      {edit && canWrite ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void update(edit.revision, { kind: "edit", body: edit.body });
          }}
        >
          <label htmlFor={fieldId} className="sr-only">
            {gt("Reply text")}
          </label>
          <Textarea
            id={fieldId}
            rows={5}
            value={edit.body}
            maxLength={GMAIL_REPLY_BODY_LIMIT}
            disabled={busy}
            onChange={(event) => setEdit({ ...edit, body: event.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || edit.body.trim().length === 0}>
              {gt("Save draft")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEdit(undefined);
                setError(undefined);
              }}
            >
              {gt("Cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm wrap-anywhere whitespace-pre-wrap select-text">{current.body}</p>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(undefined);
                  setEdit({ body: current.body, revision: current.revision });
                }}
              >
                {gt("Edit draft")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void update(current.revision, { kind: "dismiss" })}
              >
                {gt("Dismiss draft")}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {failure}
    </section>
  );
}
