export const searchApp = {
  slug: "google_search_console",
  name: "Google Search Console",
  no_auth: false,
  composio_managed_auth: [{ managed_app_id: "fixture-search-console" }],
};

export const searchAction = {
  slug: "GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY",
  name: "Search Analytics Query",
  toolkit: { slug: searchApp.slug, name: searchApp.name },
  tags: ["readOnlyHint"],
  no_auth: false,
  input_parameters: {
    type: "object",
    properties: {
      site_url: { type: "string" },
      start_date: { type: "string" },
      end_date: { type: "string" },
      row_limit: { type: "integer" },
      search_type: { type: "string" },
      data_state: { type: "string" },
      dimensions: { type: "array", items: { type: "string" } },
      dimension_filter_groups: { type: "array", items: { type: "object" } },
    },
    required: ["site_url", "start_date", "end_date"],
    additionalProperties: false,
  },
};

export const websiteProposal = {
  title: "Search and site health",
  source: {
    kind: "search-console-page",
    property: "sc-domain:workshop.example.test",
    page: "https://workshop.example.test/assembly-guide",
    window: { start: "2026-10-01", end: "2026-10-31" },
  },
  proposedFix: {
    title: "Add a fitment FAQ to the assembly guide",
    description:
      "Clarify which sizes the guide covers. Include a fitment table above the first step.",
    previewUrl: "https://preview.example.test/assembly-guide#fitment",
  },
} as const;

export const websiteReport = {
  rows: [{ keys: [websiteProposal.source.page], clicks: 18, impressions: 620 }],
  responseAggregationType: "byPage",
};
