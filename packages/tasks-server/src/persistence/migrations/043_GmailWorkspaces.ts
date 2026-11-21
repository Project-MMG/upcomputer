import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const GmailWorkspacesMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE gmail_workspaces (
    project_id TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(agent_id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    PRIMARY KEY (project_id, bot_id)
  )`;
});
