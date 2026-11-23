export const gmailFixtureKey = "composio-key-for-tests";
export const gmailFixtureDeliveryFile = "gmail-question-delivered";
export const gmailFixtureRejectionFile = "gmail-second-question-delivered";
export const gmailFixtureSendLog = "gmail-fixture-sends.ndjson";
export const gmailListAction = "GMAIL_FETCH_EMAILS";
export const gmailThreadAction = "GMAIL_FETCH_MESSAGE_BY_THREAD_ID";
export const gmailReplyAction = "GMAIL_REPLY_TO_THREAD";
export const gmailFixtureSender = "support@example.test";
export const gmailFixtureEditedReply =
  "Hi Jordan, I’ll verify the delivery date and follow up this afternoon.";
export const gmailFixtureSelectedText = "the delivery date";
export const gmailFixtureReplacement = "the updated delivery date";
export const gmailFixtureDraftNote = "Say that we’ll verify the updated delivery date.";
export const gmailFixtureLayoutNote = "Move the inbox above the thread reader.";

export const inboxProjectTitle = "Inbox Operations";
export const inboxBotId = "email";
export const websiteBotId = "website";
export const inboxInstructions = "Read inbox/AGENTS.md and inbox/voice.md before handling mail.";
export const createInboxPrompt = "Create the Gmail workspace using the Inbox playbook.";
export const checkInboxPrompt = "Check the Gmail inbox for new mail.";
export const inboxTitle = "Support Inbox";
export const revisedInboxTitle = "Support Customer Mail";
export const firstDraftOpening = "Hi Jordan, we’ll check the date for order 204";
export const inboxVoiceSignoff = "The support team";

const handoffSource = "knowledge/customer-questions.md";
export const handoff = {
  id: "delivery-faq-handoff",
  title: "Check the delivery FAQ",
  outcome: "Check whether the delivery FAQ explains where to find an updated delivery estimate.",
  source: `${handoffSource}#delivery-estimates`,
  sourcePath: handoffSource,
  owner: "Website",
  preparePrompt: "Prepare a Website handoff for the delivery question.",
  sitePath: "website/delivery.md",
  result: "The delivery FAQ gives an initial estimate. Add a link to order tracking.",
};
export const handoffDescription = `Outcome: ${handoff.outcome}\nSource: ${handoff.source}\nOwner: ${handoff.owner}`;
export const assignHandoffPrompt = `Assign this project follow-up. ${handoffDescription.replaceAll("\n", " ")}`;

export const retro = {
  prompt: `Run the manual inbox retrospective for ${handoff.id}.`,
  skill: ".agents/skills/inbox-retro/SKILL.md",
  path: `inbox/results/${handoff.id}.md`,
  proposal: "Use the delivery FAQ before drafting replies about delivery estimates.",
};

export const inboxProjectFiles = {
  "AGENTS.md": `# ${inboxProjectTitle}\n\nWorkspace title prefix: Support\n`,
  "inbox/AGENTS.md":
    "# Inbox playbook\n\nRead the shared instructions and approved voice guidance. Use gmail_workspace_save for workspace changes. Call gmail_workspace_check and draft for customer questions. Record routine notices as needing no reply. Share only a source, outcome, and owner for an internal handoff. Run the inbox-retro skill when the operator asks.\n\nCreate: Inbox (inbox-first)\nRevise: Customer Mail (thread-first)\n",
  "inbox/voice.md": `# Approved support voice\n\nUse a short, plain-text reply.\nSign-off: ${inboxVoiceSignoff}\n`,
  [handoff.sourcePath]:
    "# Customer questions\n\n## Delivery estimates\n\nCustomers need a way to find updated delivery estimates after checkout.\n",
  [handoff.sitePath]: "# Delivery FAQ\n\nThe delivery FAQ gives an initial estimate.\n",
  [retro.skill]: `---\nname: inbox-retro\ndescription: Review one completed Inbox handoff on request.\n---\n\nRead the completed project task and its source. Save the evidence, outcome, proposed improvement, and owner in inbox/results/ under the task ID.\n\nPropose: ${retro.proposal}\n`,
};

export const gmailApp = {
  slug: "gmail",
  name: "Gmail",
  no_auth: false,
  composio_managed_auth: [{ managed_app_id: "managed-gmail-fixture" }],
};

const string = { type: "string" };
const boolean = { type: "boolean" };
const catalogAction = (
  slug: string,
  name: string,
  properties: object,
  required: string[] = [],
  tags = ["readOnlyHint"],
) => ({
  slug,
  name,
  toolkit: { slug: gmailApp.slug, name: gmailApp.name },
  tags,
  no_auth: false,
  input_parameters: { type: "object", properties, required, additionalProperties: false },
});

export const gmailActions = [
  catalogAction(gmailListAction, "Fetch emails", {
    user_id: string,
    query: string,
    max_results: { type: "integer", minimum: 1, maximum: 500 },
    include_payload: boolean,
    verbose: boolean,
    page_token: string,
  }),
  catalogAction(
    gmailThreadAction,
    "Fetch message by thread ID",
    {
      user_id: string,
      thread_id: string,
      page_token: string,
    },
    ["thread_id"],
  ),
  catalogAction(
    gmailReplyAction,
    "Reply to email thread",
    {
      user_id: string,
      thread_id: { ...string, pattern: "^[0-9a-f]+$" },
      message_body: string,
      recipient_email: { ...string, format: "email" },
      is_html: boolean,
      include_signature: boolean,
      cc: { type: "array", items: string },
    },
    ["thread_id"],
    ["createHint"],
  ),
];

export const customerQuestion = {
  messageId: "19bf77729bcb3a45",
  threadId: "19bf77729bcb3a44",
  subject: "Can you confirm my delivery date?",
  sender: "Jordan Lee <jordan@example.test>",
  messageTimestamp: "2026-11-20T16:45:00Z",
  labelIds: ["INBOX", "UNREAD"],
  preview: "A question about order 204.",
  messageText: "Hi, could you confirm whether order 204 will arrive this Friday?",
};

export const rejectedQuestion = {
  messageId: "19bf77729bcb3a67",
  threadId: "19bf77729bcb3a67",
  subject: "Can you change my delivery instructions?",
  sender: "Morgan Lee <morgan@example.test>",
  messageTimestamp: "2026-11-20T17:45:00Z",
  labelIds: ["INBOX", "UNREAD"],
  preview: "A question about delivery instructions.",
  messageText: "Can you ask the courier to leave my package at the back door?",
};

export const receiptBody = "Your payment for order 199 has been received. Thank you.";

export const receipt = {
  messageId: "19bf77729bcb3a56",
  threadId: "19bf77729bcb3a56",
  subject: "Receipt for order 199",
  sender: "Receipts <receipts@example.test>",
  messageTimestamp: "2026-11-20T15:30:00Z",
  labelIds: ["INBOX"],
  preview: "Payment received for order 199.",
  messageText: `<div style="background-color: white">
    <p>${receiptBody}</p>
    <a href="https://shop.example.test/orders/199">View order</a>
    <img src="https://mail.example.test/receipt.png" alt="Order receipt">
  </div>`,
};

const earlierQuestion = {
  ...customerQuestion,
  messageId: customerQuestion.threadId,
  messageTimestamp: "2026-11-20T16:00:00Z",
  preview: "The original question about this order.",
  messageText: "Hello, I have a question about order 204.",
};

export function gmailActionData(
  slug: string,
  threadId: unknown,
  questionDelivered = true,
  rejectionDelivered = false,
) {
  const messages = [earlierQuestion, receipt];
  if (questionDelivered) messages.push(customerQuestion);
  if (rejectionDelivered) messages.push(rejectedQuestion);
  if (slug === gmailListAction) {
    return {
      messages: messages.map(({ messageText: _body, ...summary }) =>
        summary.messageId === receipt.messageId
          ? { ...summary, preview: false, snippet: summary.preview }
          : summary,
      ),
      nextPageToken: "",
    };
  }
  if (slug === gmailThreadAction) {
    return { messages: messages.filter((mail) => mail.threadId === threadId) };
  }
  if (slug === gmailReplyAction && typeof threadId === "string") {
    return { response_data: { id: "19bf77729bcb3a99", threadId, labelIds: ["SENT"] } };
  }
  return undefined;
}
