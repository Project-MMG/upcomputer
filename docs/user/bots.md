# Bots

A bot is a personal assistant: one permanent chat with its own memory. You talk to it like any
chat, it remembers what matters, and it can do bigger jobs in the background while you keep
talking.

Bots work best with a clear role. Name them after the job, such as "Inbox manager", "Release
helper" or "Research assistant", and say in the instructions what the job covers.

## Create a bot

- From scratch: click **+** next to **Bots** in the sidebar. Set it up on the **New bot** page and
  click **Create bot**. Its chat opens.
- From an existing chat: right-click the chat in the sidebar, or click its title in the chat
  header, and choose **Turn into bot**. The chat keeps its history, model and permissions. A chat
  that is still running, archived, or a worker's run can't become a bot.

## One permanent chat

Each bot has exactly one conversation. Click the bot's row under **Bots** to open it. The chat is
listed there instead of under **Threads**, and search still finds it. Restarting the app or
changing the bot's model keeps the same conversation and its history. There is no "new chat" for a
bot: keep talking in the same one.

The agent's working memory of the conversation stays bounded, but the full history is kept. The
bot can search its older messages when it needs them.

A bot's chat uses a compact one-line composer. To get the full composer with its model controls,
turn on **Settings → Chat → Full composer in bot chats**.

## Change a bot

Hover the bot's row and click its settings button to open its page. There you change:

- **Name** and **Appearance**: shape, color and accessories.
- **Instructions**: what the bot does and how.
- **Model**: the agent and model it uses.
- **Permissions**: for the bot's chat and its background tasks.
- **Project**: where the bot works. Its chat moves with it, and its memory stays the same.

Changes save automatically and apply from the bot's next turn. Its access to files follows the
permissions you choose here. A change of project or provider
waits until the bot is idle. A bot works in one project; to tell it about others, write it in its
instructions.

## Memory

Memory is a list of facts that belongs to the bot. It stays the same when you change the bot's
model or project.

- **The bot saves facts by itself** during its turns, when it learns something useful that will
  last. Each saved fact shows as a **Saved** card in the chat.
- **You can tell it what to remember**: start a message with **Remember:** followed by the fact.
  The colon is required. Only your own messages save this way, not messages agents post into the
  chat.

To see and edit memory, open the bot's page and scroll to **Memory**. Click a fact to edit it
(Enter saves, Escape cancels), or delete it. The bot can forget facts it saved itself, but it can't
change or forget a fact you saved or edited.

A bot keeps up to 200 facts. Each new conversation with the model gets as many as fit in about
12,000 characters, your facts first, then the newest. The page dims the facts that don't fit; the
bot can still look them up.

## Background work

Ask the bot for something bigger and it works on it in the background, so its chat stays free:

- It can give the job to itself as a background task, which runs as a separate run.
- It can hand the job to one of your [workers](./workers.md). If none fits, it creates one without
  asking, with **Full access** unless you ask for another mode.

The work shows in **Tasks** like any other task. Progress and results come back to the bot's chat,
and the bot replies when the work finishes. See
[Wake chat when tasks complete](./getting-started.md#a-worker-picks-it-up) to change that.

Background tasks can read untrusted pages and files, so they can't save memory. What a task found
comes back in its result, and the bot decides in its own chat what to remember.

## Project tools

Open a bot's settings and choose **Tools** to see its assignments and manage its project tools.
New individual assignments started here select that bot. Use the audience controls to share a
tool with other bots in the project.

Open **Settings → Projects**, select the project, then open **Tools**. If the project
groups several checkouts, select the one whose bots you want to configure. Find an app
in the Composio catalog and open **Manage access**. If it needs an account, connect it
in Composio, then return to Tools and select **Check connection**.

Choose **All bots in this project** or **Selected bots** to give those bots every
action in the app. For narrower access, open **Individual actions** and configure only
the actions that bot should use. You can set fixed input values, such as the repository
the bot should use. Fixed inputs still apply when a bot also has full app access.

Access applies in the bot's chat, its background runs, and schedules bound to its chat.
Plan mode allows read actions only. Select **No full access** to remove the app-wide
grant. Use **Assigned actions** to turn off individual assignments. Disconnecting an
app stops its account-dependent actions, and its assignments stay visible. Some apps
require an auth config in the Composio dashboard first.

The environment owner sets up Composio by saving a project API key as plain text in
`secrets/composio-api-key.bin` under the server's state directory. On a standard
installation, that directory is `~/.upcomputer/userdata`. Restrict the file to the
server user, then refresh Tools.

## Coordinate work and set up a specialist

In the coordinating bot’s settings, open **Bot Apps** and choose **Add team dashboard**.
Open it from those settings or from **Bot Apps** in the chat’s right pane. The dashboard
links to project priorities, blockers, approvals, completed handoffs, and the bots that own
the work. Ask the coordinating bot to assign a task and give it the expected outcome.
Open the completed task to see its result.

Ask the coordinating bot to propose a specialist using the project’s playbook. Review the
role, workstream folder, instructions, skill references, requested account and actions, and
the assigned-work app in the dashboard. You can edit, reject, or approve the proposal.
Approval saves the bot and its app in the project. Setup reuses a bot with the same name in
that project and keeps its existing profile. New specialists get their workstream folder
and skill references in their instructions and share the project checkout.

Open the specialist’s **Tools** settings to confirm the connected account and grant the
requested actions. The proposal records the requests. Project tool assignments take
effect when you save them in **Tools**.

## Open a Gmail inbox beside a bot chat

Connect Gmail in the bot's project and assign **Fetch emails** and **Fetch Message by Thread ID** to
that bot under **Individual actions**. If the bot uses a Home Repo, point its instructions to the
shared `AGENTS.md` and its own playbook. Ask the bot in its chat to set up a Gmail workspace.

After the bot saves the layout, open the right pane and choose **Bot Apps**. Use **Open in right
pane** next to the saved inbox. You can also find **Bot Apps** in the bot's settings. Open an email
to read its thread.
Use the annotation button next to **Inbox** or **Thread reader** to ask the bot to move that
control.

To check for mail in the background, ask the bot to set up a scheduled prompt in its own chat.
Have the prompt read the bot's playbook, check the Gmail workspace, and draft replies for messages
that need one. Enable it in **Settings → Scheduled prompts**.

The inbox marks threads with a reply ready for review. Open a thread to read the draft, edit and
save it, or dismiss it. Later checks keep the version you saved and remember which drafts you
dismissed. You can restore a dismissed draft from the same message.

Highlight a passage in the saved reply and choose **Annotate selection** to send the bot a note.
Review the revised reply in the same pane before approving it.

Assign **Reply to email thread** to let the workspace send replies you approve. Review the sending
account, recipient, and saved reply in the thread, then choose **Approve & send**. If delivery is
uncertain, check Sent in Gmail before sending another reply. A bot with a Gmail workspace uses
this approval flow for Gmail writes.

## Review and save a Search Console bot app

Connect Google Search Console in the bot's project. Under **Individual actions**, assign
**Search Analytics Query** to the bot and set `site_url` to the exact Search Console property.
Ask the bot to propose an app for one page and date range, with a fix and a link to review it.

Open **Bot Apps** in the right pane or Bot Settings and choose **Review proposal**. Inspect the
account, property, report window, and fix preview. Save a review note if the bot should revise the
proposal, then ask it to check the note. **Approve app** saves the reviewed report and preview
link. To see a newer report, ask the bot for another proposal.

If the account or action becomes unavailable, the app keeps its saved report and hides its data.
Restore the original connection and assignment, then choose **Check access**. A report from a
different account needs its own review.

To discard the approved report, open the app and choose **Remove saved app**.

## Review a Social calendar

Ask a bot to propose a Social calendar from your content plan and one approved asset.
The bot can prepare separate captions and publishing times for Facebook, Instagram,
TikTok, and YouTube. To verify Postiz destinations, connect Postiz in the bot’s project
and assign the **List Integrations** read in **Tools**. If you use a Postiz customer
group, fix the action’s `group` input to that group. The bot can also propose a
calendar using local destination labels.

Open **Bot Apps** in the chat’s right pane or in **Bot Settings**. Filter by date and
channel, open the original asset approval, and add a note to the caption you want the
bot to revise. Choose **Save calendar** after reviewing the package. The entries
remain publishing proposals. To discard the calendar, choose **Remove saved app**.

In a fixture workspace with the **Schedule Post (Fixture)** action assigned to the bot,
open a saved calendar and choose **Review fixture schedule** on a verified post. Check
the account, destination, UTC time, caption, and media before approving. The saved
calendar shows the fixture receipt. If delivery is uncertain, check the fixture
provider for the same destination and time before scheduling again.

## Bot status

A bot's row shows the same statuses as a thread row, and also counts its background work:
**Waiting** while its task runs, **Awaiting Input** when the task is blocked, and **Failed** when it
fails, until you open the bot's chat. It shows **Pending Approval** or **Awaiting Input** while any
task started from its chat waits for you. Hover the bot's name to see why.

## Review Shopify store exceptions

Connect one Shopify store in the bot's project using a read-only Shopify connection.
Under **Individual actions**, assign **Execute safe read-only Shopify GraphQL query** to the
store bot. Paste the JSON below into **Fixed inputs**. Replace the example domain with the
store's permanent `myshopify.com` domain and keep the rest of the query as shown.

```json
{
  "query": "# Store: your-store.myshopify.com\nquery StoreOperations {\n  shop { myshopifyDomain }\n  products(first: 5, query: \"status:active\", sortKey: UPDATED_AT, reverse: true) {\n    nodes { id title featuredMedia { id }\n      variants(first: 3) {\n        nodes { id title inventoryQuantity inventoryItem { tracked } }\n      }\n    }\n  }\n  orders(first: 5, query: \"status:open fulfillment_status:on_hold\", reverse: true) {\n    nodes { id name displayFulfillmentStatus }\n  }\n}"
}
```

Ask the bot to propose a Store operations app for that store. Open **Bot Apps** in the right
pane or Bot Settings, then choose **Review proposal**. Check the store, account, and capture
time before you approve the app. Ask the bot for another proposal to refresh the sample.

After saving the app, ask the store bot to assign one catalog follow-up to your Website bot.
The catalog brief includes the product, the work to do, and the link to Shopify Admin.

## Review Google Ads and Meta Ads

Connect Google Ads and Meta Ads in the bot's project. Under **Individual actions** in **Tools**,
assign **Search GAQL** to the bot with its ten-digit `customer_id` fixed. Assign **Get Insights**
with `object_id` fixed and **List Ad Creatives** with `ad_account_id` fixed to the same Meta account
ID, including its `act_` prefix.

Ask the bot to propose a Paid Media app for a date range, a Meta conversion action, and one
Google Ads campaign with its own daily budget. Open **Bot Apps** in the right pane or in
**Bot Settings** and choose **Review proposal**. Switch between the account reports to check
spend, conversion reporting, and creative. The campaign proposal shows the current daily budget,
proposed daily budget, and measurement plan. **Save report** keeps the reviewed snapshot for
reopening. Apply any budget decision separately in Google Ads.

## Review a Klaviyo lifecycle plan

Connect Klaviyo in the bot's project. In **Tools**, assign **Get Account** to the bot and fix its
`id` to the assigned Klaviyo account ID. Assign **Get Segment** and the applicable pair of reads:
**Get Campaign** and **Query Campaign Values**, or **Get Flow** and **Query Flow Values**.

Ask the bot to propose a Lifecycle app for one campaign or flow. Give it a date range in the
Klaviyo account's time zone, an existing target segment, and the conversion metric ID Klaviyo
requires for the report. Open **Bot Apps** in
the chat's right pane or in **Bot Settings**, then choose **Review proposal**. Check the source
report and open the segment definition to review eligibility. Check the proposed timing, email
draft, and success measure. **Save plan** keeps the reviewed proposal in Bot Apps. Manage any
subsequent scheduling and audience changes in Klaviyo.

## Triage outreach opportunities

Give your bot the community links or local exports you want it to review. Ask it to propose an
opportunity queue with a source, reason to engage, draft reply, and owner for each candidate.
In **Bot Apps**, choose **Review proposal**, set a decision for each candidate, and save the queue.

For a support request, choose **Refer to owner** on a candidate owned by your Inbox bot. Save the
queue, then ask your bot to assign that referral in Tasks. The reply stays in draft.

## Remove a bot

Click **Remove bot** at the bottom of the bot's page. This deletes its memory. Its chat goes back
to **Threads** as an ordinary chat.
