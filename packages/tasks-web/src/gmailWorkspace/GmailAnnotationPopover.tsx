import {
  GMAIL_WORKSPACE_ANNOTATION_NOTE_LIMIT,
  type GmailWorkspaceAnnotationTarget,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { MessageSquarePlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "../../../../apps/web/src/components/ui/popover.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";
import { projectToolErrorMessage } from "../projectTools/remoteData.ts";

export type AnnotateGmailWorkspace = (
  target: GmailWorkspaceAnnotationTarget,
  note: string,
) => Promise<void>;

export function GmailAnnotationPopover({
  label,
  iconOnly,
  readTarget,
  onAnnotate,
}: {
  readonly label: string;
  readonly iconOnly?: boolean;
  readonly readTarget: () => GmailWorkspaceAnnotationTarget | null;
  readonly onAnnotate: AnnotateGmailWorkspace;
}) {
  const gt = useGT();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [opened, setOpened] = useState<{
    readonly target: GmailWorkspaceAnnotationTarget | null;
  }>();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const target = opened?.target;

  async function submit() {
    if (!target || !note.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onAnnotate(target, note.trim());
      setOpened(undefined);
    } catch (cause) {
      setError(projectToolErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover
      open={opened !== undefined}
      onOpenChange={(open) => {
        if (pending) return;
        setOpened(open ? { target: readTarget() } : undefined);
        setNote("");
        setError(undefined);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            aria-label={label}
            variant="ghost"
            size={iconOnly ? "icon-sm" : "sm"}
            onMouseDown={iconOnly ? undefined : (event) => event.preventDefault()}
          />
        }
      >
        <MessageSquarePlusIcon aria-hidden />
        {iconOnly ? null : label}
      </PopoverTrigger>
      <PopoverPopup align="end" width="sm" initialFocus={target ? noteRef : undefined}>
        <div className="space-y-2 px-3">
          <PopoverTitle>{label}</PopoverTitle>
          {target ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              {target.kind === "draft" ? (
                <blockquote className="max-h-28 overflow-y-auto border-s-2 border-border ps-2 text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                  {target.text}
                </blockquote>
              ) : null}
              <Textarea
                ref={noteRef}
                aria-label={gt("Annotation note")}
                placeholder={gt("What should the bot change?")}
                rows={3}
                maxLength={GMAIL_WORKSPACE_ANNOTATION_NOTE_LIMIT}
                value={note}
                disabled={pending}
                onChange={(event) => setNote(event.target.value)}
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="sm" disabled={pending || !note.trim()}>
                {pending ? gt("Sending…") : gt("Send note to bot")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {gt("Highlight text in the reply draft to add a note.")}
            </p>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
