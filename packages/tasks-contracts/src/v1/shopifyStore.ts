import { IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const SHOPIFY_STORE_SAMPLE = { products: 5, variantsPerProduct: 3, orders: 5 } as const;

export const ShopifyStoreSource = Schema.Struct({
  kind: Schema.Literal("shopify-store"),
  store: Schema.String.check(
    Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/),
  ),
});
export type ShopifyStoreSource = typeof ShopifyStoreSource.Type;

const resourceId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,19}$/));
const label = TrimmedNonEmptyString.check(Schema.isMaxLength(255));

export const ShopifyStoreReport = Schema.Struct({
  readAt: IsoDateTime,
  accountLabel: Schema.String.check(Schema.isMaxLength(200)),
  catalog: Schema.Array(Schema.Struct({ productId: resourceId, product: label })).check(
    Schema.isMaxLength(SHOPIFY_STORE_SAMPLE.products),
  ),
  inventory: Schema.Array(
    Schema.Struct({
      productId: resourceId,
      variantId: resourceId,
      product: label,
      variant: label,
      available: Schema.Int.check(Schema.isLessThanOrEqualTo(0)),
    }),
  ).check(
    Schema.isMaxLength(SHOPIFY_STORE_SAMPLE.products * SHOPIFY_STORE_SAMPLE.variantsPerProduct),
  ),
  orders: Schema.Array(Schema.Struct({ orderId: resourceId, order: label })).check(
    Schema.isMaxLength(SHOPIFY_STORE_SAMPLE.orders),
  ),
});

export function shopifyAdminLink(
  store: ShopifyStoreSource["store"],
  resource: "products" | "orders",
  id: string,
): string {
  return new URL("/admin/" + resource + "/" + id, "https://" + store).href;
}
