import {
  GMAIL_REPLY_BODY_LIMIT,
  type GmailDraftUpdateInput,
  type GmailReplyDeliveryStatus,
  type GmailReplyDraft as ReplyDraft,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { useId, useRef, useState } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import { projectToolErrorMessage } from "../projectTools/remoteData.ts";
import { GmailAnnotationPopover, type AnnotateGmailWorkspace } from "./GmailAnnotationPopover.tsx";

function selectedDraftText(element: HTMLParagraphElement, body: string) {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const prefix = element.ownerDocument.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const text = range.toString();
  return text.trim() && body.slice(start, start + text.length) === text ? { start, text } : null;
}

export function GmailReplyDraft({
  draft,
  gmailThreadId,
  canWrite,
  canApprove,
  sendingAccount,
  onUpdate,
  onApprove,
  onAnnotate,
}: {
  readonly draft: ReplyDraft;
  readonly gmailThreadId: string;
  readonly canWrite: boolean;
  readonly canApprove: boolean;
  readonly sendingAccount: string | undefined;
  readonly onUpdate: (
    revision: number,
    change: GmailDraftUpdateInput["change"],
  ) => Promise<ReplyDraft>;
  readonly onApprove: (revision: number) => Promise<GmailReplyDeliveryStatus>;
  readonly onAnnotate: AnnotateGmailWorkspace | undefined;
}) {
  const gt = useGT();
  const fieldId = useId();
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [saved, setSaved] = useState<ReplyDraft>();
  const current =
    saved &&
    (saved.revision > draft.revision ||
      (saved.revision === draft.revision &&
        saved.deliveryStatus &&
        draft.deliveryStatus !== "sent" &&
        draft.deliveryStatus !== "failed"))
      ? saved
      : draft;
  const delivery = current.deliveryStatus;
  const canEdit = canWrite && (delivery == null || delivery === "failed");
  const canSend = canApprove && !!sendingAccount && delivery == null;
  const [edit, setEdit] = useState<{ readonly body: string; readonly revision: number }>();
  const [operation, setOperation] = useState<"update" | "send">();
  const busy = operation !== undefined;
  const [error, setError] = useState<string>();

  async function update(revision: number, change: GmailDraftUpdateInput["change"]) {
    setOperation("update");
    setError(undefined);
    try {
      setSaved(await onUpdate(revision, change));
      setEdit(undefined);
    } catch (cause) {
      setError(projectToolErrorMessage(cause));
    } finally {
      setOperation(undefined);
    }
  }

  async function approve() {
    setOperation("send");
    setError(undefined);
    try {
      const deliveryStatus = await onApprove(current.revision);
      setSaved({ ...current, deliveryStatus });
    } catch (cause) {
      setError(projectToolErrorMessage(cause));
    } finally {
      setOperation(undefined);
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
      <h5 aria-live="polite" className="text-sm font-medium">
        {delivery === "sent" ? gt("Reply sent") : gt("Reply draft")}
      </h5>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs wrap-anywhere">
        {sendingAccount ? (
          <>
            <dt className="text-muted-foreground">{gt("Sending account")}</dt>
            <dd>{sendingAccount}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{gt("To")}</dt>
        <dd>{current.recipient}</dd>
      </dl>
      {delivery === "uncertain" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {gt("Delivery uncertain. Check Sent in Gmail before sending another reply.")}
        </p>
      ) : delivery === "failed" ? (
        <p role="status" className="text-sm text-destructive">
          {gt("Send failed. Edit and approve a new revision to try again.")}
        </p>
      ) : null}
      {edit && canEdit ? (
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
          <p ref={bodyRef} className="text-sm wrap-anywhere whitespace-pre-wrap select-text">
            {current.body}
          </p>
          {canSend ? (
            <p className="text-xs text-muted-foreground">
              {gt("The reply includes the latest message as quoted text.")}
            </p>
          ) : null}
          {canSend || canEdit ? (
            <div className="flex flex-wrap gap-2">
              {canSend ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => void approve()}>
                  {operation === "send" ? gt("Sending…") : gt("Approve & send")}
                </Button>
              ) : null}
              {canEdit ? (
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
              ) : null}
              {canEdit && onAnnotate ? (
                <GmailAnnotationPopover
                  label={gt("Annotate selection")}
                  onAnnotate={onAnnotate}
                  readTarget={() => {
                    const selection =
                      bodyRef.current && selectedDraftText(bodyRef.current, current.body);
                    return selection
                      ? {
                          kind: "draft",
                          gmailThreadId,
                          draftId: current.id,
                          revision: current.revision,
                          ...selection,
                        }
                      : null;
                  }}
                />
              ) : null}
              {canWrite && delivery == null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void update(current.revision, { kind: "dismiss" })}
                >
                  {gt("Dismiss draft")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {failure}
    </section>
  );
}
