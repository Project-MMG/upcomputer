import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const createAttempts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE social_schedule_attempts (
    project_id TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(agent_id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    publish_at TEXT NOT NULL,
    revision TEXT NOT NULL,
    approval_session_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'failed', 'uncertain')),
    provider_receipt_id TEXT,
    CHECK ((status = 'scheduled') = (provider_receipt_id IS NOT NULL)),
    PRIMARY KEY (project_id, bot_id, revision, integration_id)
  )`;
  yield* sql`CREATE UNIQUE INDEX social_schedule_reserved_slot ON social_schedule_attempts
    (project_id, bot_id, account_id, integration_id, publish_at) WHERE status <> 'failed'`;
});

export const SOCIAL_SCHEDULE_MIGRATION_CONTRIBUTION = {
  ownerId: "upcomputer.tasks",
  namespace: "upcomputer.tasks.social-schedule",
  migrations: [{ version: 1, name: "SocialScheduleAttempts", run: createAttempts }],
} as const;
