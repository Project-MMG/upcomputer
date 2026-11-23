import {
  SHOPIFY_STORE_SAMPLE,
  shopifyAdminLink,
  type ShopifyStoreSnapshot,
} from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react";
import type { ReactNode } from "react";

function SourceLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a
      className="break-words text-primary underline underline-offset-2"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

function Exceptions({
  title,
  children,
  empty,
}: {
  readonly title: string;
  readonly children: readonly ReactNode[];
  readonly empty: string;
}) {
  return (
    <section className="grid gap-2 rounded-lg border bg-card p-3.5" aria-label={title}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {children.length > 0 ? (
        <ul className="grid gap-2 divide-y text-sm">{children}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

export function ShopifyStoreOperations({ snapshot }: { readonly snapshot: ShopifyStoreSnapshot }) {
  const gt = useGT();
  const { store } = snapshot.definition.source;
  const { readAt, accountLabel, catalog, inventory, orders } = snapshot.report;
  return (
    <div className="grid gap-3">
      <section
        className="grid gap-2 rounded-lg border bg-card p-3.5"
        aria-label={gt("Store source")}
      >
        <div className="grid gap-1 text-sm">
          <h4 className="font-semibold">{gt("Shopify Admin")}</h4>
          <p className="break-words">
            <SourceLink href={"https://" + store + "/admin"}>{store}</SourceLink>
            {" · "}
            {accountLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            {gt("Captured")} <time dateTime={readAt}>{new Date(readAt).toLocaleString()}</time>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {gt(
            "Sample of up to {products} recently updated active products, {variantsPerProduct} variants per product, and {orders} open orders on hold.",
            SHOPIFY_STORE_SAMPLE,
          )}
        </p>
      </section>
      <Exceptions title={gt("Catalog")} empty={gt("No missing product media in this sample.")}>
        {catalog.map(({ productId, product }) => (
          <li key={productId} className="grid min-w-0 gap-0.5 pt-2 first:pt-0">
            <SourceLink href={shopifyAdminLink(store, "products", productId)}>{product}</SourceLink>
            <span className="text-xs text-muted-foreground">{gt("Missing product media")}</span>
          </li>
        ))}
      </Exceptions>
      <Exceptions
        title={gt("Inventory")}
        empty={gt("No tracked variants at or below zero in this sample.")}
      >
        {inventory.map(({ productId, variantId, product, variant, available }) => (
          <li key={variantId} className="grid min-w-0 gap-0.5 pt-2 first:pt-0">
            <SourceLink href={shopifyAdminLink(store, "products", productId)}>{product}</SourceLink>
            <span className="break-words text-xs text-muted-foreground">
              {gt("{variant} · {available} available", { variant, available })}
            </span>
          </li>
        ))}
      </Exceptions>
      <Exceptions title={gt("Orders")} empty={gt("No open orders on hold in this sample.")}>
        {orders.map(({ orderId, order }) => (
          <li key={orderId} className="grid min-w-0 gap-0.5 pt-2 first:pt-0">
            <SourceLink href={shopifyAdminLink(store, "orders", orderId)}>{order}</SourceLink>
            <span className="text-xs text-muted-foreground">{gt("Fulfillment on hold")}</span>
          </li>
        ))}
      </Exceptions>
    </div>
  );
}
