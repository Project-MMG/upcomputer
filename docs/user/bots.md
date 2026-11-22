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

## Open a Gmail inbox beside a bot chat

Connect Gmail in the bot's project and assign **Fetch emails** and **Fetch Message by Thread ID** to
that bot under **Individual actions**. If the bot uses a Home Repo, point its instructions to the
shared `AGENTS.md` and its own playbook. Ask the bot in its chat to set up a Gmail workspace.

After the bot saves the layout, choose **Gmail inbox** in the chat, or open the saved workspace
from **Bot Apps** in the bot's settings or right-pane menu. Open an email to read its thread.
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

## Bot status

A bot's row shows the same statuses as a thread row, and also counts its background work:
**Waiting** while its task runs, **Awaiting Input** when the task is blocked, and **Failed** when it
fails, until you open the bot's chat. It shows **Pending Approval** or **Awaiting Input** while any
task started from its chat waits for you. Hover the bot's name to see why.

## Remove a bot

Click **Remove bot** at the bottom of the bot's page. This deletes its memory. Its chat goes back
to **Threads** as an ordinary chat.
