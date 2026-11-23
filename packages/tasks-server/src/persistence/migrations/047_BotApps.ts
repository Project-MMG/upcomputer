import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const BotAppsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bot_apps (
    project_id TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(agent_id) ON DELETE CASCADE,
    proposal_json TEXT,
    saved_json TEXT,
    PRIMARY KEY (project_id, bot_id)
  )`;
});
