import type { ProjectToolError } from "@t3tools/tasks-contracts/v1";

export function reviewedWriteFailureStatus({ code, status }: ProjectToolError) {
  return code === "action-outcome-unknown" || code === "action-failed" || status === 408
    ? "uncertain"
    : "failed";
}
