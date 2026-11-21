import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const GmailRepliesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE gmail_workspace_replies (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    gmail_thread_id TEXT NOT NULL,
    gmail_message_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'dismissed', 'skipped')),
    revision INTEGER NOT NULL DEFAULT 1,
    recipient TEXT,
    body TEXT,
    CHECK (
      (status = 'skipped' AND recipient IS NULL AND body IS NULL) OR
      (status <> 'skipped' AND recipient IS NOT NULL AND body IS NOT NULL)
    ),
    UNIQUE (project_id, bot_id, account_id, gmail_message_id),
    FOREIGN KEY (project_id, bot_id) REFERENCES gmail_workspaces(project_id, bot_id) ON DELETE CASCADE
  )`;
  yield* sql`CREATE INDEX idx_gmail_workspace_pending_replies
    ON gmail_workspace_replies (project_id, bot_id, account_id, gmail_thread_id)
    WHERE status = 'pending'`;
});
