export const shopifyApp = {
  slug: "shopify",
  name: "Shopify",
  no_auth: false,
};

export const shopifyRead = {
  slug: "SHOPIFY_GRAPH_QL_READ_QUERY",
  name: "Execute safe read-only Shopify GraphQL query",
  toolkit: { slug: shopifyApp.slug, name: shopifyApp.name },
  tags: ["readOnlyHint"],
  no_auth: false,
  input_parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      variables: { type: "object" },
      operation_name: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const shopifyProposal = {
  title: "Store operations",
  source: { kind: "shopify-store", store: "fixture-workshop-operations.myshopify.com" },
} as const;

export const otherShop = "fixture-supply-operations.myshopify.com";

export const shopifyResponse = {
  shop: { myshopifyDomain: shopifyProposal.source.store },
  products: {
    nodes: [
      {
        id: "gid://shopify/Product/101",
        title: "Workshop apron",
        featuredMedia: null,
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/201",
              title: "Canvas",
              inventoryQuantity: 0,
              inventoryItem: { tracked: true },
            },
            {
              id: "gid://shopify/ProductVariant/202",
              title: "Denim",
              inventoryQuantity: 12,
              inventoryItem: { tracked: true },
            },
            {
              id: "gid://shopify/ProductVariant/203",
              title: "Made to order",
              inventoryQuantity: 0,
              inventoryItem: { tracked: false },
            },
          ],
        },
      },
      {
        id: "gid://shopify/Product/102",
        title: "Workbench mat",
        featuredMedia: { id: "gid://shopify/MediaImage/300" },
        variants: { nodes: [] },
      },
    ],
  },
  orders: {
    nodes: [
      {
        id: "gid://shopify/Order/401",
        name: "#1401",
        displayFulfillmentStatus: "ON_HOLD",
      },
    ],
  },
};
