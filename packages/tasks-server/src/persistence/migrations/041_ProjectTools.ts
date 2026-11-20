import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ProjectToolsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_tool_accounts (
    project_id TEXT NOT NULL,
    app TEXT NOT NULL,
    account_id TEXT,
    account_label TEXT,
    pending_id TEXT,
    PRIMARY KEY (project_id, app)
  )`;
  yield* sql`CREATE TABLE project_tool_grants (
    project_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    grant_json TEXT NOT NULL,
    PRIMARY KEY (project_id, slug)
  )`;
});
