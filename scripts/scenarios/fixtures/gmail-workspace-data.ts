export const gmailFixtureKey = "composio-key-for-tests";
export const gmailFixtureDeliveryFile = "gmail-question-delivered";
export const gmailFixtureSendLog = "gmail-fixture-sends.ndjson";
export const gmailListAction = "GMAIL_FETCH_EMAILS";
export const gmailThreadAction = "GMAIL_FETCH_MESSAGE_BY_THREAD_ID";
export const gmailReplyAction = "GMAIL_REPLY_TO_THREAD";
export const gmailFixtureSender = "support@vt.example.test";
export const gmailFixtureEditedReply =
  "Hi Jordan, I’ll verify the delivery date and follow up this afternoon.";
export const gmailFixtureSelectedText = "the delivery date";
export const gmailFixtureReplacement = "the updated delivery date";
export const gmailFixtureDraftNote = "Say that we’ll verify the updated delivery date.";
export const gmailFixtureLayoutNote = "Move the inbox above the thread reader.";

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
  preview: "A question about order VT-204.",
  messageText: "Hi VT, could you confirm whether order VT-204 will arrive this Friday?",
};

export const receipt = {
  messageId: "19bf77729bcb3a56",
  threadId: "19bf77729bcb3a56",
  subject: "Receipt for order VT-199",
  sender: "Receipts <receipts@example.test>",
  messageTimestamp: "2026-11-20T15:30:00Z",
  labelIds: ["INBOX"],
  preview: "Payment received for order VT-199.",
  messageText: "Your payment for order VT-199 has been received. Thank you.",
};

const earlierQuestion = {
  ...customerQuestion,
  messageId: customerQuestion.threadId,
  messageTimestamp: "2026-11-20T16:00:00Z",
  preview: "The original question about this order.",
  messageText: "Hello VT, I have a question about order VT-204.",
};

export function gmailActionData(slug: string, threadId: unknown, questionDelivered = true) {
  const messages = questionDelivered
    ? [earlierQuestion, receipt, customerQuestion]
    : [earlierQuestion, receipt];
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
