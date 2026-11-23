import {
  BotAppError,
  SHOPIFY_STORE_SAMPLE,
  ShopifyStoreSource,
  shopifyAdminLink,
  type ShopifyStoreSnapshot,
} from "@t3tools/tasks-contracts/v1";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const { products, variantsPerProduct, orders } = SHOPIFY_STORE_SAMPLE;
const query = [
  "query StoreOperations {",
  "  shop { myshopifyDomain }",
  "  products(first: " +
    products +
    ', query: "status:active", sortKey: UPDATED_AT, reverse: true) {',
  "    nodes { id title featuredMedia { id }",
  "      variants(first: " + variantsPerProduct + ") {",
  "        nodes { id title inventoryQuantity inventoryItem { tracked } }",
  "      }",
  "    }",
  "  }",
  "  orders(first: " +
    orders +
    ', query: "status:open fulfillment_status:on_hold", reverse: true) {',
  "    nodes { id name displayFulfillmentStatus }",
  "  }",
  "}",
].join("\n");

export function shopifyStoreAction(store: ShopifyStoreSource["store"]) {
  // The fixed input binds the grant to a shop and to this projection of its data.
  const args = { query: "# Store: " + store + "\n" + query };
  return {
    app: "shopify",
    input: {
      slug: "SHOPIFY_GRAPH_QL_READ_QUERY",
      requiredFixedInputs: args,
      arguments: args,
    },
  };
}

const productId = Schema.String.check(
  Schema.isPattern(/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/),
);
const variantId = Schema.String.check(
  Schema.isPattern(/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/),
);
const orderId = Schema.String.check(Schema.isPattern(/^gid:\/\/shopify\/Order\/[1-9][0-9]{0,19}$/));
const label = Schema.String.check(
  Schema.isMaxLength(255),
  Schema.makeFilter((value) => value.trim().length > 0 || "Expected a non-empty label"),
);
const product = Schema.Struct({
  id: productId,
  title: label,
  featuredMedia: Schema.NullOr(Schema.Struct({ id: Schema.NonEmptyString })),
  variants: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        id: variantId,
        title: label,
        inventoryQuantity: Schema.NullOr(Schema.Int),
        inventoryItem: Schema.Struct({ tracked: Schema.Boolean }),
      }),
    ).check(Schema.isMaxLength(variantsPerProduct)),
  }),
});
const order = Schema.Struct({
  id: orderId,
  name: label,
  displayFulfillmentStatus: Schema.Literal("ON_HOLD"),
});
const payload = Schema.Struct({
  shop: Schema.Struct({ myshopifyDomain: ShopifyStoreSource.fields.store }),
  products: Schema.Struct({ nodes: Schema.Array(product).check(Schema.isMaxLength(products)) }),
  orders: Schema.Struct({ nodes: Schema.Array(order).check(Schema.isMaxLength(orders)) }),
});
const graphql = Schema.Struct({
  successful: Schema.optionalKey(Schema.Never),
  data: payload,
  errors: Schema.optionalKey(Schema.Tuple([])),
});
const decode = Schema.decodeUnknownEffect(
  Schema.Union([
    graphql,
    Schema.Struct({
      successful: Schema.Literal(true),
      data: Schema.Union([graphql, Schema.fromJsonString(graphql)]),
    }),
  ]),
);

const localId = (id: string) => id.slice(id.lastIndexOf("/") + 1);

export const readShopifyExceptions = Effect.fn("BotApps.readShopifyExceptions")(function* (
  result: Schema.Json,
  store: ShopifyStoreSource["store"],
) {
  const response = yield* decode(result).pipe(
    Effect.mapError(() => new BotAppError({ code: "shopify-report-invalid" })),
  );
  const data = response.successful === true ? response.data.data : response.data;
  if (data.shop.myshopifyDomain !== store) {
    return yield* new BotAppError({ code: "shopify-store-mismatch" });
  }

  const catalog: ShopifyStoreSnapshot["report"]["catalog"][number][] = [];
  const inventory: ShopifyStoreSnapshot["report"]["inventory"][number][] = [];
  for (const item of data.products.nodes) {
    const productId = localId(item.id);
    const product = item.title.trim();
    if (item.featuredMedia === null) catalog.push({ productId, product });
    for (const variant of item.variants.nodes) {
      const available = variant.inventoryQuantity;
      if (variant.inventoryItem.tracked && available !== null && available <= 0) {
        inventory.push({
          productId,
          variantId: localId(variant.id),
          product,
          variant: variant.title.trim(),
          available,
        });
      }
    }
  }
  return {
    catalog,
    inventory,
    orders: data.orders.nodes.map((item) => ({
      orderId: localId(item.id),
      order: item.name.trim(),
    })),
  };
});

export function shopifyCatalogFollowUps(snapshot: ShopifyStoreSnapshot) {
  const { store } = snapshot.definition.source;
  return snapshot.report.catalog.map(({ productId, product }) => ({
    product,
    outcome: "Verify and prepare missing product media for the product page.",
    source: shopifyAdminLink(store, "products", productId),
  }));
}
