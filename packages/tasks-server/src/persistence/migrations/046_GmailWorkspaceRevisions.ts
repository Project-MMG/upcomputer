import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const GmailWorkspaceRevisionsMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE gmail_workspaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`;
});
