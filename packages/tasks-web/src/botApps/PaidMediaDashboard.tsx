import { PAID_MEDIA_CREATIVE_LIMIT, type PaidMediaSnapshot } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import { useState } from "react";
import { Toggle, ToggleGroup } from "../../../../apps/web/src/components/ui/toggle-group.tsx";

function formatCurrency(value: number, currency: string, signed = false) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 6,
    signDisplay: signed ? "exceptZero" : "auto",
  });
}

export function PaidMediaDashboard({ snapshot }: { readonly snapshot: PaidMediaSnapshot }) {
  const gt = useGT();
  const [platform, setPlatform] = useState<"google" | "meta">("google");
  const { source, proposedChange } = snapshot.definition;
  const { google, campaignName, currentDailyBudgetMicros, readAt } = snapshot.report;
  const account = snapshot.report[platform];
  const isGoogle = platform === "google";
  const accountId = isGoogle ? source.googleCustomerId : source.metaAdAccountId;
  const deltaMicros = proposedChange.dailyBudgetMicros - currentDailyBudgetMicros;

  return (
    <div className="grid min-w-0 gap-3">
      <ToggleGroup
        aria-label={gt("Ad account reports")}
        value={[platform]}
        onValueChange={([next]) => {
          if (next === "google" || next === "meta") setPlatform(next);
        }}
      >
        <Toggle value="google">{gt("Google Ads")}</Toggle>
        <Toggle value="meta">{gt("Meta Ads")}</Toggle>
      </ToggleGroup>
      <section
        className="grid min-w-0 gap-3 rounded-lg border bg-card p-3.5"
        aria-label={gt("Account report")}
      >
        <div className="grid min-w-0 gap-0.5">
          <h4 className="break-words text-sm font-semibold">{account.accountName}</h4>
          <p className="break-all text-xs text-muted-foreground">{accountId}</p>
          <p className="text-xs text-muted-foreground">
            {gt("{start} to {end} in account time", source.window)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-md bg-muted/55 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{gt("Spend")}</dt>
            <dd className="break-words text-lg font-semibold tabular-nums">
              {formatCurrency(account.spend, account.currency)}
            </dd>
          </div>
          <div className="min-w-0 rounded-md bg-muted/55 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{gt("Conversions")}</dt>
            <dd className="break-words text-lg font-semibold tabular-nums">
              {account.conversions?.toLocaleString() ?? gt("Unreported")}
            </dd>
          </div>
        </dl>
        <p className="break-words text-xs text-muted-foreground">
          {isGoogle
            ? gt(
                "Google Ads counts actions included in its Conversions metric by ad interaction date.",
              )
            : gt(
                "Meta Insights reports attributed actions for {action} using Meta’s attribution settings.",
                {
                  action: source.metaConversionAction,
                },
              )}
        </p>
        <p className="text-xs text-muted-foreground">
          {gt("Captured")} <time dateTime={readAt}>{new Date(readAt).toLocaleString()}</time>
        </p>
      </section>
      <section
        className="grid min-w-0 gap-2 rounded-lg border bg-card p-3.5"
        aria-label={gt("Creative sample")}
      >
        <div>
          <h4 className="text-sm font-semibold">{gt("Creative sample")}</h4>
          <p className="text-xs text-muted-foreground">
            {isGoogle
              ? gt("Up to {limit} ads by spend in the report window.", {
                  limit: PAID_MEDIA_CREATIVE_LIMIT,
                })
              : gt("Up to {limit} current account creatives.", {
                  limit: PAID_MEDIA_CREATIVE_LIMIT,
                })}
          </p>
        </div>
        {account.creative.length ? (
          <ul className="grid gap-2 divide-y text-sm">
            {account.creative.map(({ id, label, text }) => (
              <li key={id} className="grid min-w-0 gap-0.5 pt-2 first:pt-0">
                <span className="break-words font-medium">{label}</span>
                {text && <span className="break-words text-muted-foreground">{text}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{gt("No creative returned.")}</p>
        )}
      </section>
      <section
        className="grid min-w-0 gap-2 rounded-lg border bg-card p-3.5"
        aria-label={gt("Campaign budget proposal")}
      >
        <div className="grid gap-0.5">
          <h4 className="text-sm font-semibold">{gt("Campaign budget proposal")}</h4>
          <p className="break-words text-sm">{campaignName}</p>
          <p className="break-words text-xs text-muted-foreground">
            {gt("Google Ads · {account}", { account: google.accountName })}
          </p>
          <p className="break-words text-xs text-muted-foreground">
            {gt("Customer {customer} · Campaign {campaign}", {
              customer: source.googleCustomerId,
              campaign: proposedChange.campaignId,
            })}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{gt("Current daily budget")}</dt>
            <dd className="break-words tabular-nums">
              {formatCurrency(currentDailyBudgetMicros / 1_000_000, google.currency)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{gt("Proposed daily budget")}</dt>
            <dd className="break-words tabular-nums">
              {formatCurrency(proposedChange.dailyBudgetMicros / 1_000_000, google.currency)}
            </dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted-foreground">{gt("Daily budget impact")}</dt>
            <dd className="break-words font-semibold tabular-nums">
              {formatCurrency(deltaMicros / 1_000_000, google.currency, true)}
            </dd>
          </div>
        </dl>
        <p className="whitespace-pre-wrap break-words text-sm">{proposedChange.reason}</p>
        <div>
          <h5 className="text-xs font-medium text-muted-foreground">{gt("Measurement plan")}</h5>
          <p className="whitespace-pre-wrap break-words text-sm">{proposedChange.measurement}</p>
        </div>
      </section>
    </div>
  );
}
