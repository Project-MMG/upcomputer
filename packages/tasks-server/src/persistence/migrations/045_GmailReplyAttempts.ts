import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const GmailReplyAttemptsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE gmail_workspace_reply_attempts (
    draft_id TEXT NOT NULL REFERENCES gmail_workspace_replies(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    approval_session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'uncertain')),
    gmail_message_id TEXT,
    CHECK ((status = 'sent') = (gmail_message_id IS NOT NULL)),
    PRIMARY KEY (draft_id, revision)
  )`;
});
