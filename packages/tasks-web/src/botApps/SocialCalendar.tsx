import {
  BOT_APP_NOTE_LIMIT,
  SOCIAL_CALENDAR_CHANNELS,
  type BotAppReviewInput,
  type SocialCalendarChannel,
  type SocialCalendarSnapshot,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { CalendarDaysIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../../../../apps/web/src/components/ui/dialog.tsx";
import { Input } from "../../../../apps/web/src/components/ui/input.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../apps/web/src/components/ui/select.tsx";
import { Textarea } from "../../../../apps/web/src/components/ui/textarea.tsx";

const channelNames = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
} satisfies Record<SocialCalendarChannel, string>;

type Review = {
  readonly disabled: boolean;
  readonly send: (decision: BotAppReviewInput["decision"]) => void;
};

export interface SocialCalendarFilters {
  readonly channel: string;
  readonly from: string;
  readonly to: string;
}

function CaptionNote({
  channel,
  initialNote,
  review,
}: {
  readonly channel: SocialCalendarChannel;
  readonly initialNote: string;
  readonly review: Review;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const name = channelNames[channel];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setNote(initialNote);
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" disabled={review.disabled} />}>
        {gt("Annotate {channel} caption", { channel: name })}
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{gt("Annotate {channel} caption", { channel: name })}</DialogTitle>
          <DialogDescription>
            {gt("The bot can read this note when it revises the package.")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (review.disabled || note.trim() === initialNote) return;
            review.send({ kind: "annotate-caption", channel, note });
            setOpen(false);
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            {gt("Caption note")}
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={BOT_APP_NOTE_LIMIT}
            />
          </label>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {gt("Cancel")}
            </DialogClose>
            <Button type="submit" disabled={review.disabled || note.trim() === initialNote}>
              {gt("Save caption note")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function SocialCalendar({
  snapshot,
  filters: { channel, from, to },
  setFilters,
  review,
}: {
  readonly snapshot: SocialCalendarSnapshot;
  readonly filters: SocialCalendarFilters;
  readonly setFilters: (filters: SocialCalendarFilters) => void;
  readonly review?: Review;
}) {
  const gt = useGT();
  const { asset, posts } = snapshot.definition.contentPackage;
  const { report } = snapshot;
  const channelOptions = [
    { value: "all", label: gt("All channels") },
    ...SOCIAL_CALENDAR_CHANNELS.map((value) => ({ value, label: channelNames[value] })),
  ];
  const invalidRange = from !== "" && to !== "" && from > to;
  const visiblePosts = posts
    .filter((post) => {
      const date = post.publishAt.slice(0, 10);
      return (channel === "all" || channel === post.channel) && date >= from && (!to || date <= to);
    })
    .sort((left, right) => Date.parse(left.publishAt) - Date.parse(right.publishAt));

  return (
    <>
      <section
        className="grid gap-2 rounded-lg border bg-card p-3"
        aria-label={gt("Approved asset")}
      >
        <p className="text-xs font-medium text-muted-foreground">{gt("Approved asset")}</p>
        <p className="break-words text-sm font-semibold">{asset.title}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <a
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            href={asset.mediaUrl}
            target="_blank"
            rel="noreferrer"
          >
            {gt("Open media")} <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
          <a
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            href={asset.approval.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {gt("Approval record")} <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          {gt("Approved {date} (UTC)", { date: asset.approval.approvedAt.slice(0, 10) })}
        </p>
      </section>
      <section className="grid gap-3" aria-label={gt("Channel calendar")}>
        <div className="grid gap-1">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDaysIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {gt("Channel calendar")}
          </h4>
          {report ? (
            <p className="break-words text-xs text-muted-foreground">
              {gt("Postiz · {account} · Channels checked {date} (UTC)", {
                account: report.accountLabel,
                date: report.readAt.slice(0, 10),
              })}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{gt("Local plan")}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Select
              items={channelOptions}
              value={channel}
              onValueChange={(value) => setFilters({ channel: value ?? "all", from, to })}
            >
              <SelectTrigger aria-label={gt("Filter by channel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {channelOptions.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
            {gt("From (UTC)")}
            <Input
              type="date"
              value={from}
              onChange={(event) => setFilters({ channel, from: event.target.value, to })}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
            {gt("Through (UTC)")}
            <Input
              type="date"
              value={to}
              onChange={(event) => setFilters({ channel, from, to: event.target.value })}
            />
          </label>
        </div>
        {invalidRange ? (
          <p role="status" className="text-sm text-muted-foreground">
            {gt("Choose an end date on or after the start date.")}
          </p>
        ) : visiblePosts.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {gt("No posts match these filters.")}
          </p>
        ) : (
          <ol className="grid gap-2">
            {visiblePosts.map(({ channel, destination, publishAt, caption }) => {
              const captionNote = snapshot.captionNotes.find((item) => item.channel === channel);
              const target =
                destination.kind === "local"
                  ? destination.label
                  : (report?.destinations.find(
                      (item) => item.integrationId === destination.integrationId,
                    )?.label ?? destination.integrationId);
              return (
                <li key={channel} className="grid min-w-0 gap-2 rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                    <h5 className="text-sm font-semibold">{channelNames[channel]}</h5>
                    <time
                      dateTime={publishAt}
                      className="text-xs tabular-nums text-muted-foreground"
                    >
                      {gt("{date} · {time} UTC", {
                        date: publishAt.slice(0, 10),
                        time: publishAt.slice(11, -1),
                      })}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{caption}</p>
                  <dl className="grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{gt("Destination")}</dt>
                      <dd className="break-words">{target}</dd>
                      <dd className="text-muted-foreground">
                        {destination.kind === "local" ? gt("Local plan") : gt("Verified in Postiz")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{gt("Publishing status")}</dt>
                      <dd>{gt("Proposal only")}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">{gt("Media")}</dt>
                      <dd className="break-words">{asset.title}</dd>
                    </div>
                  </dl>
                  {captionNote ? (
                    <div className="grid gap-1 rounded-md bg-muted/50 p-2 text-xs">
                      <p className="font-medium">{gt("Caption note")}</p>
                      <p className="whitespace-pre-wrap break-words text-muted-foreground">
                        {captionNote.note}
                      </p>
                    </div>
                  ) : null}
                  {review ? (
                    <div>
                      <CaptionNote
                        key={snapshot.revision}
                        channel={channel}
                        initialNote={captionNote?.note ?? ""}
                        review={review}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {review ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={review.disabled}
            onClick={() => review.send({ kind: "approve" })}
          >
            {gt("Save calendar")}
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
      ) : null}
    </>
  );
}
