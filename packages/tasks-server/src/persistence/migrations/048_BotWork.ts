import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const BotWorkMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE bot_apps ADD COLUMN work_app_json TEXT`;
  yield* sql`CREATE TABLE bot_setup_proposals (
    project_id TEXT NOT NULL,
    coordinator_id TEXT NOT NULL REFERENCES bots(agent_id) ON DELETE CASCADE,
    role_key TEXT NOT NULL,
    proposal_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, role_key)
  )`;
});
