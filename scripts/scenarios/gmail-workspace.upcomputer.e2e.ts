import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { T3_HOME } from "../e2e.config.ts";
import {
  assignHandoffPrompt,
  checkInboxPrompt,
  createInboxPrompt,
  customerQuestion,
  firstDraftOpening,
  gmailFixtureDraftNote,
  gmailFixtureEditedReply,
  gmailFixtureLayoutNote,
  gmailFixtureReplacement,
  gmailFixtureSelectedText,
  gmailFixtureSender,
  gmailReplyAction,
  handoff,
  inboxBotId,
  inboxProjectFiles,
  inboxProjectTitle,
  inboxTitle,
  inboxVoiceSignoff,
  receipt,
  receiptBody,
  rejectedQuestion,
  retro,
  revisedInboxTitle,
} from "./fixtures/gmail-workspace-data.ts";
import {
  approve as approveFixture,
  changeAccess,
  deliverRejection,
  fixtureSends,
  readApproval,
  runCheck,
  runFixture,
  scheduleCheck,
  seedEmailBot,
} from "./fixtures/gmail-workspace-session.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

test(
  "Inbox review sends one approved revision and returns a scoped Website handoff",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const project = await t3.project(inboxProjectTitle, inboxProjectFiles);
    const { cli } = makeState(T3_HOME);
    const issued = await runPromise(cli(["auth", "session", "issue", "--token-only"]));
    const fixture = {
      home: T3_HOME,
      origin: app.baseUrl ?? "",
      token: issued.stdout.trim().split("\n").at(-1) ?? "",
    };
    const thread = await runFixture(seedEmailBot(fixture));
    const ordinary = await t3.thread({ project, title: "Ordinary chat", messages: ["Hello"] });
    await t3.open(thread);

    const headerLaunchers = browser
      .locator("[data-chat-header]")
      .getByRole("button", /Gmail inbox|Bot Apps/);
    const toggleRightPanel = screen.getByRole("button", "Toggle right panel");
    const appsLauncher = screen.getByRole("button", /^Bot Apps\b/);
    const appsMenuItem = screen.getByRole("menuitem", /^Bot Apps\b/);
    const addSurface = screen.getByRole("button", "Add panel surface");
    const openBotApp = screen.getByRole("button", "Open in right pane");
    const closeBotApps = screen.getByRole("button", "Close Bot Apps");
    const closeGmail = screen.getByRole("button", "Close Gmail inbox");
    const noApps = screen.getByText("This bot has no saved apps yet.");
    const openAppsFromLauncher = async () => {
      await toggleRightPanel.tap();
      await appsLauncher.tap();
    };
    const openAppsFromMenu = async () => {
      await addSurface.tap();
      await appsMenuItem.tap();
    };
    const composer = screen.getByRole("textbox");
    const submit = screen.getByRole("button", "Submit message");
    const sendMessage = async (prompt: string) => {
      await composer.fill(prompt);
      await submit.tap();
    };
    const controls = () =>
      browser.evaluate<string[]>(
        'Array.from(document.querySelectorAll("[data-workspace-control]"), (node) => node.getAttribute("data-workspace-control"))',
      );
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await sendMessage(createInboxPrompt);
    await expect(
      screen.getByText(`Saved ${inboxTitle} from the Inbox playbook.`, { exact: false }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      screen.getByText("Loaded the approved voice guidance.", { exact: false }),
    ).toBeVisible();
    await openAppsFromLauncher();
    await expect(openBotApp).toBeVisible();
    await app.screenshot("bot-apps-header");
    await expect(headerLaunchers).toBeHidden();
    await openBotApp.tap();
    await expect(screen.getByRole("heading", inboxTitle)).toBeVisible();
    await closeBotApps.tap();
    const questionRow = screen.getByRole("button", customerQuestion.subject, { exact: false });
    const receiptRow = screen.getByRole("button", receipt.subject, { exact: false });
    const draft = screen.getByRole("heading", "Reply draft");
    const draftReady = screen.getByText("Draft ready");
    const dismissed = screen.getByText("Draft dismissed");
    const noNewMail = screen.getByText("No new inbox messages to review.");
    const queuedDraft = screen.getByText("Gmail check queued 1 reply draft.");
    const draftText = screen.getByText(firstDraftOpening, {
      exact: false,
    });
    await expect(receiptRow).toBeVisible();
    await questionRow.tap();
    await expect(screen.getByText(customerQuestion.messageText)).toBeHidden();
    expect(await controls()).toEqual(["inbox", "thread"]);
    await app.screenshot("created-inbox");

    await sendMessage("Revise the Gmail workspace using the Inbox playbook.");
    await expect(screen.getByRole("heading", revisedInboxTitle)).toBeVisible({ timeout: 45_000 });
    expect(await controls()).toEqual(["thread", "inbox"]);
    await expect(draft).toBeHidden();
    await app.screenshot("revised-inbox");

    const scheduleId = await runFixture(scheduleCheck(fixture, thread.threadId));
    await expect(queuedDraft).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByText(customerQuestion.messageText)).toBeVisible();
    await expect(draftReady).toHaveCount(1);
    await expect(draft).toHaveCount(1);
    await expect(screen.getByText(gmailFixtureSender)).toBeVisible();
    await expect(screen.getByText("jordan@example.test")).toBeVisible();
    await expect(draftText).toBeVisible();
    await expect(screen.getByText(inboxVoiceSignoff, { exact: false })).toBeVisible();
    await app.screenshot("queued-reply");
    await receiptRow.tap();
    await expect(screen.getByRole("heading", receipt.subject)).toBeVisible();
    await app.screenshot("html-receipt");
    await expect(screen.getByText(receiptBody, { exact: true })).toBeVisible();
    await expect(screen.getByRole("link", "View order")).toBeVisible();
    await expect(screen.getByRole("img", "Order receipt")).toBeHidden();
    await expect(draft).toBeHidden();

    const toolsTab = screen.getByRole("tab", "Tools");
    const appsTab = screen.getByRole("tab", "Bot Apps");
    const inboxRead = screen.getByRole("heading", "Fetch emails");
    const threadRead = screen.getByRole("heading", "Fetch message by thread ID");
    await t3.open({ threadId: thread.chiefThreadId });
    await sendMessage(createInboxPrompt);
    await expect(
      screen.getByText(`Saved ${inboxTitle} from the Inbox playbook.`, { exact: false }),
    ).toBeVisible();
    await openAppsFromLauncher();
    await expect(noApps).toBeVisible();
    await expect(openBotApp).toBeHidden();
    await sendMessage(checkInboxPrompt);
    await expect(screen.getByText("Gmail check blocked by not-assigned.")).toBeVisible();
    await app.screenshot("chief-gmail-visibility");

    await t3.open(ordinary);
    await toggleRightPanel.tap();
    await expect(screen.getByRole("heading", "Open a surface")).toBeVisible();
    await expect(appsLauncher).toBeHidden();
    await screen.getByRole("button", /^Files\b/).tap();
    await addSurface.tap();
    await expect(screen.getByRole("menuitem", /^Tasks\b/)).toBeVisible();
    await expect(appsMenuItem).toBeHidden();
    await app.screenshot("ordinary-chat-launcher");

    await t3.open("/bots?bot=chief");
    await toolsTab.tap();
    await expect(screen.getByText("No tools assigned to Chief.")).toBeVisible();
    await expect(threadRead).toBeHidden();
    await expect(inboxRead).toBeHidden();
    await expect(screen.getByRole("button", "Manage access")).toHaveCount(0);
    await appsTab.tap();
    await expect(noApps).toBeVisible();

    await t3.open(`/bots?bot=${inboxBotId}`);
    await toolsTab.tap();
    await expect(inboxRead).toBeVisible();
    await expect(threadRead).toBeVisible();
    await app.screenshot("bot-tools");
    await screen.getByRole("button", "Manage access").tap();
    await screen.getByText("Individual actions", { exact: true }).tap();
    await app.screenshot("bot-individual-actions");
    await screen.getByRole("button", "Configure").tap();
    await expect(screen.getByRole("dialog", "Reply to email thread")).toBeVisible();
    await expect(screen.getByRole("radio", "Selected bots")).toBeChecked();
    await expect(screen.getByRole("checkbox", "Email")).toBeChecked();
    await expect(screen.getByRole("checkbox", "Chief")).not.toBeChecked();
    await screen.getByRole("button", "Save assignment").tap();
    await expect(screen.getByRole("dialog", "Reply to email thread")).toBeHidden();
    await screen.getByRole("dialog", "Gmail").getByRole("button", "Close").tap();

    await appsTab.tap();
    await expect(screen.getByRole("heading", revisedInboxTitle)).toBeVisible();
    await app.screenshot("bot-apps");
    await openBotApp.tap();
    await expect(screen.getByRole("region", "Gmail workspace")).toBeVisible();
    await openAppsFromMenu();
    await openBotApp.tap();
    await expect(screen.getByRole("region", "Gmail workspace")).toBeVisible();
    await closeBotApps.tap();

    await questionRow.tap();
    await screen.getByRole("button", "Edit draft").tap();
    const edited = gmailFixtureEditedReply;
    await screen.getByRole("textbox", "Reply text").fill(edited);
    await screen.getByRole("button", "Save draft").tap();
    await expect(screen.getByText(edited)).toBeVisible();
    await runFixture(runCheck(fixture, scheduleId));
    await expect(noNewMail).toHaveCount(1);

    const reopen = async () => {
      await closeGmail.tap();
      await expect(screen.getByRole("heading", revisedInboxTitle)).toBeHidden();
      await browser.reload();
      await openAppsFromLauncher();
      await openBotApp.tap();
      await closeBotApps.tap();
      await questionRow.tap();
    };
    await reopen();
    await expect(screen.getByRole("heading", revisedInboxTitle)).toBeVisible();
    expect(await controls()).toEqual(["thread", "inbox"]);
    await expect(screen.getByText(edited)).toBeVisible();
    await app.screenshot("reopened-edited-draft");
    await screen.getByRole("button", "Dismiss draft").tap();
    await expect(dismissed).toBeVisible();
    await expect(draftReady).toBeHidden();
    await runFixture(runCheck(fixture, scheduleId));
    await expect(noNewMail).toHaveCount(2);
    await reopen();
    await expect(dismissed).toBeVisible();
    await expect(draft).toBeHidden();
    await app.screenshot("reopened-dismissed-draft");
    await screen.getByRole("button", "Restore draft").tap();
    await expect(screen.getByText(edited)).toBeVisible();
    await expect(draftReady).toHaveCount(1);
    await app.screenshot("restored-edited-draft");

    const priorApproval = await runFixture(readApproval(fixture, thread.threadId));
    const selected = await browser.evaluate<string>(`(() => {
      const body = Array.from(document.querySelectorAll("p")).find(
        (node) => node.textContent === ${JSON.stringify(edited)},
      )?.firstChild;
      if (!body) throw new Error("Draft body is missing.");
      const text = ${JSON.stringify(gmailFixtureSelectedText)};
      const start = body.textContent.indexOf(text);
      const range = document.createRange();
      range.setStart(body, start);
      range.setEnd(body, start + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    })()`);
    expect(selected).toBe(gmailFixtureSelectedText);
    const note = screen.getByRole("textbox", "Annotation note");
    const sendNote = screen.getByRole("button", "Send note to bot");
    await screen.getByRole("button", "Annotate selection").tap();
    await expect(screen.getByText(gmailFixtureSelectedText, { exact: true })).toBeVisible();
    await note.fill(gmailFixtureDraftNote);
    await app.screenshot("draft-annotation");
    await sendNote.tap();
    await expect(screen.getByText(gmailFixtureDraftNote)).toBeVisible();
    await expect(screen.getByText("Revised the selected reply text.")).toBeVisible();
    const revised = edited.replace(gmailFixtureSelectedText, gmailFixtureReplacement);
    await expect(screen.getByText(revised)).toBeVisible();
    expect(await runFixture(Effect.flip(approveFixture(fixture, priorApproval)))).toMatchObject({
      code: "workspace-draft-changed",
    });
    expect(await runFixture(fixtureSends(fixture))).toEqual([]);
    await app.screenshot("annotated-reply");

    await screen.getByRole("button", "Annotate inbox").tap();
    await note.fill(gmailFixtureLayoutNote);
    await app.screenshot("layout-annotation");
    await sendNote.tap();
    await expect(screen.getByText(gmailFixtureLayoutNote)).toBeVisible();
    await expect(screen.getByText("Moved the inbox above the thread reader.")).toBeVisible();
    await reopen();
    await expect(screen.getByRole("heading", revisedInboxTitle)).toBeVisible();
    expect(await controls()).toEqual(["inbox", "thread"]);
    await expect(screen.getByText(revised)).toBeVisible();
    await app.screenshot("annotated-layout-after-reopen");

    const approve = screen.getByRole("button", "Approve & send");
    const sent = screen.getByRole("heading", "Reply sent");
    await expect(approve).toBeEnabled();
    await expect(screen.getByText(gmailFixtureSender)).toBeVisible();
    await expect(screen.getByText("jordan@example.test")).toBeVisible();
    expect(await runFixture(fixtureSends(fixture))).toEqual([]);
    await app.screenshot("reviewed-reply");
    await approve.tap();
    await expect(sent).toBeVisible();
    await expect(draftReady).toBeHidden();
    await expect(approve).toBeHidden();
    await reopen();
    await expect(sent).toBeVisible();
    await expect(screen.getByText(revised)).toBeVisible();
    await expect(approve).toBeHidden();
    await app.screenshot("sent-reply-after-reopen");
    const sends = [
      {
        account: expect.stringMatching(/^account-/u),
        tool_slug: gmailReplyAction,
        arguments: {
          user_id: "me",
          thread_id: customerQuestion.threadId,
          recipient_email: "jordan@example.test",
          message_body: revised,
          is_html: false,
          include_signature: false,
        },
      },
    ];
    const approvedRevision = await runFixture(readApproval(fixture, thread.threadId));
    expect(await runFixture(approveFixture(fixture, approvedRevision))).toBe("sent");
    expect(await runFixture(fixtureSends(fixture))).toEqual(sends);

    await sendMessage(handoff.preparePrompt);
    await expect(screen.getByText(handoff.source, { exact: false })).toBeVisible();
    await app.screenshot("inbox-handoff-brief");
    await t3.open({ threadId: thread.chiefThreadId });
    await sendMessage(assignHandoffPrompt);
    await expect(screen.getByText("Assigned the delivery FAQ check to Website.")).toBeVisible();
    await expect(screen.getByText(`Website reported: ${handoff.result}`)).toBeVisible({
      timeout: 45_000,
    });
    await app.screenshot("chief-handoff-result");

    await t3.open(thread);
    await sendMessage(retro.prompt);
    await expect(
      screen.getByText("Saved the Inbox retrospective for operator review."),
    ).toBeVisible();
    const noteText = await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        return yield* fs.readFileString(path.join(project, retro.path));
      }),
    );
    expect(noteText).toContain(`Evidence: ${handoff.id} and ${handoff.source}`);
    expect(noteText).toContain(`Outcome: ${handoff.result}`);
    expect(noteText).toContain(`Proposed improvement: ${retro.proposal}`);
    expect(noteText).toContain("Owner: Inbox");
    expect(noteText).not.toContain(customerQuestion.messageText);
    await app.screenshot("manual-inbox-retrospective");

    await openAppsFromMenu();
    await expect(openBotApp).toBeVisible();
    await expect(closeGmail).toBeVisible();
    await runFixture(changeAccess(fixture, "revoke"));
    await browser.reload();
    await expect(noApps).toBeVisible();
    await expect(closeGmail).toBeHidden();
    await app.screenshot("revoked-restored-tab");
    await runFixture(runCheck(fixture, scheduleId));
    await expect(screen.getByText("Gmail check blocked by not-assigned.")).toBeVisible();
    await app.screenshot("blocked-check");

    await runFixture(changeAccess(fixture, "restore"));
    await browser.reload();
    await openBotApp.tap();
    await closeBotApps.tap();
    await questionRow.tap();
    await expect(sent).toBeVisible();
    await expect(screen.getByText(revised)).toBeVisible();
    expect(await controls()).toEqual(["inbox", "thread"]);
    await app.screenshot("restored-gmail-access");

    await runFixture(changeAccess(fixture, "replace-account"));
    await runFixture(runCheck(fixture, scheduleId));
    await reopen();
    await expect(draftReady).toHaveCount(1);
    await expect(draftText).toBeVisible();
    await expect(dismissed).toBeHidden();
    await expect(screen.getByText(revised)).toBeHidden();
    await app.screenshot("replacement-account");

    await runFixture(deliverRejection(fixture));
    await runFixture(runCheck(fixture, scheduleId));
    const rejectedRow = screen.getByRole("button", rejectedQuestion.subject, { exact: false });
    await expect(rejectedRow.getByText("Draft ready")).toBeVisible({ timeout: 45_000 });
    await rejectedRow.tap();
    await expect(screen.getByText(rejectedQuestion.messageText)).toBeVisible();
    await screen.getByRole("button", "Dismiss draft").tap();
    await expect(dismissed).toBeVisible();
    await reopen();
    await rejectedRow.tap();
    await expect(dismissed).toBeVisible();
    await expect(approve).toBeHidden();
    await app.screenshot("rejected-reply-after-reopen");
    expect(await runFixture(fixtureSends(fixture))).toEqual(sends);
  },
);
