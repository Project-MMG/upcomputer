import type { SocialCalendarProposalInput } from "@t3tools/tasks-contracts/v1";

export const postizApp = {
  slug: "postiz_mcp",
  name: "Postiz",
  no_auth: false,
  composio_managed_auth: [{ managed_app_id: "fixture-postiz" }],
};

export const postizAction = {
  slug: "POSTIZ_MCP_INTEGRATION_LIST",
  name: "List Integrations",
  toolkit: { slug: postizApp.slug, name: postizApp.name },
  tags: ["readOnlyHint"],
  no_auth: false,
  input_parameters: {
    type: "object",
    properties: { group: { type: "string" } },
    additionalProperties: false,
  },
};

export const postizScheduleFixture = {
  slug: "POSTIZ_MCP_SCHEDULE_POST_FIXTURE",
  name: "Schedule Post (Fixture)",
  toolkit: postizAction.toolkit,
  tags: ["createHint"],
  no_auth: false,
  input_parameters: {
    type: "object",
    properties: {
      group: { type: "string" },
      integration_id: { type: "string" },
      publish_at: { type: "string" },
      caption: { type: "string" },
      media_url: { type: "string" },
    },
    required: ["integration_id", "publish_at", "caption", "media_url"],
    additionalProperties: false,
  },
};

export const socialProposal = {
  title: "Workshop social calendar",
  source: { kind: "postiz", group: "workshop" },
  contentPackage: {
    asset: {
      title: "Workshop build walkthrough",
      mediaUrl: "https://media.example.test/build-walkthrough.mp4",
      approval: {
        sourceUrl: "https://workshop.example.test/asset-ledger/walkthrough",
        approvedAt: "2026-11-20T16:00:00Z",
      },
    },
    posts: [
      {
        channel: "facebook",
        destination: { kind: "postiz", integrationId: "workshop-fb" },
        publishAt: "2026-11-23T16:00:00Z",
        caption: "Here’s how the workshop team assembled the frame and checked each joint.",
      },
      {
        channel: "instagram",
        destination: { kind: "postiz", integrationId: "workshop-ig" },
        publishAt: "2026-11-24T17:00:00Z",
        caption:
          "From the first dry fit to the finished frame. Save the walkthrough for your next build.",
      },
      {
        channel: "tiktok",
        destination: { kind: "local", label: "Workshop TikTok" },
        publishAt: "2026-11-25T19:30:00Z",
        caption: "Watch the quick check that helped us square the frame.",
      },
      {
        channel: "youtube",
        destination: { kind: "postiz", integrationId: "workshop-yt" },
        publishAt: "2026-11-26T18:00:00Z",
        caption:
          "Follow the full workshop walkthrough, including the dry fit and final inspection.",
      },
    ],
  },
} as const satisfies SocialCalendarProposalInput;

export const postizChannels = {
  output: [
    { id: "workshop-fb", platform: "facebook", name: "Workshop Facebook" },
    { id: "workshop-ig", platform: "instagram-standalone", name: "Workshop Instagram" },
    { id: "workshop-yt", platform: "youtube", name: "Workshop YouTube" },
    { id: "other-fb", platform: "facebook", name: "Unselected destination" },
  ],
};
