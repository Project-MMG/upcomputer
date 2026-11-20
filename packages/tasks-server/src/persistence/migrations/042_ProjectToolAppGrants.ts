import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ProjectToolAppGrantsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_tool_app_grants (
    project_id TEXT NOT NULL,
    app TEXT NOT NULL,
    grant_json TEXT NOT NULL,
    PRIMARY KEY (project_id, app)
  )`;
});
