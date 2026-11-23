import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const BotRetrosMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bot_retro_schedules (
    project_id TEXT PRIMARY KEY,
    coordinator_id TEXT NOT NULL REFERENCES bots(agent_id) ON DELETE CASCADE,
    time TEXT NOT NULL,
    timezone TEXT NOT NULL,
    next_run_at TEXT,
    last_run_at TEXT,
    last_error TEXT
  )`;
  yield* sql`CREATE INDEX bot_retro_due ON bot_retro_schedules (next_run_at)
    WHERE next_run_at IS NOT NULL`;
  yield* sql`CREATE TABLE bot_retro_entries (
    project_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    date TEXT NOT NULL,
    evidence_task_id TEXT NOT NULL,
    evidence_run_id TEXT NOT NULL,
    evidence_title TEXT NOT NULL,
    queue_task_id TEXT,
    proposal_json TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    decision TEXT CHECK (decision IN ('approved', 'dismissed')),
    PRIMARY KEY (project_id, owner_id, date),
    UNIQUE (project_id, evidence_run_id)
  )`;
});
