import type { LifecycleSnapshot } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";

const evidenceLink = "text-primary underline underline-offset-2";
const delayUnits = { days: "day", hours: "hour", minutes: "minute" } as const;

export function LifecyclePlanner({ snapshot }: { readonly snapshot: LifecycleSnapshot }) {
  const gt = useGT();
  const { source, followUp } = snapshot.definition;
  const { accountName, accountTimeZone, readAt, record, performance, segment } = snapshot.report;
  const campaign = record.kind === "campaign";
  const recordUrl = campaign
    ? `https://www.klaviyo.com/campaign/${source.record.id}/reports/overview`
    : `https://www.klaviyo.com/flow/${source.record.id}/edit`;
  const segmentUrl = `https://www.klaviyo.com/list/${source.segmentId}/definition`;
  const sendTime = campaign ? (record.sendTime ?? record.scheduledAt) : null;
  const audience = (ids: readonly string[]) =>
    ids.map((id) => (id === source.segmentId ? segment.name : id)).join(", ") || gt("None");
  const metrics = [
    { label: gt("Delivered"), value: performance.delivered },
    { label: gt("Clicks"), value: performance.clicks },
    { label: gt("Unsubscribes"), value: performance.unsubscribes },
  ];

  return (
    <div className="grid min-w-0 gap-3">
      <section
        className="grid min-w-0 gap-3 rounded-lg border bg-card p-4"
        aria-label={gt("Klaviyo evidence")}
      >
        <div className="grid min-w-0 gap-1">
          <h4 className="break-words text-sm font-semibold">{record.name}</h4>
          <p className="break-words text-xs text-muted-foreground">
            {gt("Klaviyo · {account} · {status}", { account: accountName, status: record.status })}
          </p>
          <a
            className={`${evidenceLink} text-xs`}
            href={recordUrl}
            target="_blank"
            rel="noreferrer"
          >
            {campaign ? gt("Open campaign report in Klaviyo") : gt("Open flow in Klaviyo")}
          </a>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-2 text-xs">
          {campaign ? (
            <>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{gt("Included audiences")}</dt>
                <dd className="break-words">{audience(record.included)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{gt("Excluded audiences")}</dt>
                <dd className="break-words">{audience(record.excluded)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {record.sendTime ? gt("Send time") : gt("Scheduled time")}
                </dt>
                <dd>
                  {sendTime ? (
                    <time dateTime={sendTime}>
                      {new Date(sendTime).toLocaleString(undefined, {
                        timeZone: accountTimeZone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  ) : (
                    gt("Unreported")
                  )}
                </dd>
              </div>
              {record.smartSending !== null && (
                <div>
                  <dt className="text-muted-foreground">{gt("Smart Sending")}</dt>
                  <dd>{record.smartSending ? gt("On") : gt("Off")}</dd>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{gt("Audience entry trigger")}</dt>
                <dd className="break-words">{record.trigger ?? gt("See flow in Klaviyo")}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{gt("Configured waits")}</dt>
                <dd className="break-words">
                  {record.delays.length
                    ? record.delays
                        .map(({ value, unit }) =>
                          value.toLocaleString(undefined, {
                            style: "unit",
                            unit: delayUnits[unit],
                            unitDisplay: "long",
                          }),
                        )
                        .join(", ")
                    : gt("See flow steps in Klaviyo")}
                </dd>
              </div>
            </>
          )}
        </dl>
        <p className="text-xs text-muted-foreground">
          {gt("Klaviyo checks consent and suppressions when sending marketing email.")}{" "}
          <a
            className={evidenceLink}
            href="https://help.klaviyo.com/hc/en-us/articles/115005246108"
            target="_blank"
            rel="noreferrer"
          >
            {gt("Consent and suppression rules")}
          </a>
        </p>
        <div className="grid gap-1.5">
          <div>
            <h5 className="text-xs font-medium">{gt("Email performance")}</h5>
            <p className="text-xs text-muted-foreground">
              {gt("By send date · {start} to {end} ({zone})", {
                ...source.window,
                zone: accountTimeZone,
              })}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-1.5">
            {metrics.map(({ label, value }) => (
              <div key={label} className="min-w-0 rounded-md bg-muted/55 px-2 py-1.5">
                <dt className="break-words text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words text-base font-semibold tabular-nums">
                  {value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            {gt("Captured")} <time dateTime={readAt}>{new Date(readAt).toLocaleString()}</time>
          </p>
        </div>
      </section>
      <section
        className="grid min-w-0 gap-3 rounded-lg border bg-card p-4"
        aria-label={gt("Proposed email follow-up")}
      >
        <div className="grid gap-1">
          <h4 className="text-sm font-semibold">{gt("Proposed email follow-up")}</h4>
          <p className="whitespace-pre-wrap break-words text-sm">{followUp.reason}</p>
        </div>
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{gt("Target segment")}</dt>
            <dd className="break-words">
              <a className={evidenceLink} href={segmentUrl} target="_blank" rel="noreferrer">
                {segment.name}
              </a>
              {segment.profileCount !== null &&
                gt(" · {count} profiles", { count: segment.profileCount.toLocaleString() })}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {segment.requiresEmailOptIn
                ? gt("The segment requires an active email subscription.")
                : gt("Verify email opt-in in the segment definition.")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{gt("Consent checks")}</dt>
            <dd className="whitespace-pre-wrap break-words">{followUp.consent}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{gt("Proposed timing")}</dt>
            <dd className="whitespace-pre-wrap break-words">{followUp.timing}</dd>
          </div>
          <div className="grid gap-1 rounded-md bg-muted/55 p-2.5">
            <dt className="text-xs font-medium text-muted-foreground">{gt("Email draft")}</dt>
            <dd className="break-words font-medium">{followUp.subject}</dd>
            <dd className="whitespace-pre-wrap break-words">{followUp.body}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{gt("Success measure")}</dt>
            <dd className="whitespace-pre-wrap break-words">{followUp.successMeasure}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
