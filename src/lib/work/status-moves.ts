import type { WorkStatus } from "@/lib/work/database";

export type StatusMove = {
  to: WorkStatus;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  needsComment?: boolean;
  hint?: string;
};

export type StatusRights = {
  /** Reviewer or workspace admin. */
  approve: boolean;
  /** An owner: may finish the task directly and open it again. */
  complete?: boolean;
  cancel: boolean;
};

/**
 * The status buttons that make sense for this user right now; the database
 * (work_set_status) checks the same rules. An owner chooses between
 * finishing the task directly and sending it to review (feedback Julius).
 */
export function statusMoves(status: WorkStatus, can: StatusRights): StatusMove[] {
  const moves: StatusMove[] = [];
  const canFinish = can.approve || Boolean(can.complete);
  const finish: StatusMove = { to: "done", label: "Mark as done" };
  switch (status) {
    case "todo":
      if (canFinish) {
        moves.push(finish, { to: "review", label: "Send to review", variant: "secondary" }, { to: "in_progress", label: "Start", variant: "secondary" });
      } else {
        moves.push({ to: "in_progress", label: "Start" }, { to: "review", label: "Send to review", variant: "secondary" });
      }
      break;
    case "in_progress":
      if (canFinish) {
        moves.push(finish, { to: "review", label: "Send to review", variant: "secondary" });
      } else {
        moves.push({ to: "review", label: "Send to review" });
      }
      moves.push({ to: "todo", label: "Back to To do", variant: "secondary" });
      break;
    case "review":
      if (can.approve) {
        moves.push(
          { to: "done", label: "Approve" },
          { to: "in_progress", label: "Send back", variant: "secondary", needsComment: true, hint: "Say what still needs to happen. The owners get a mail." },
        );
      } else {
        moves.push({ to: "in_progress", label: "Pull back from review", variant: "secondary", needsComment: true, hint: "Say why you take it back." });
      }
      break;
    case "done":
      if (canFinish) {
        moves.push({ to: "in_progress", label: "Reopen", variant: "secondary", needsComment: true, hint: "Say what still needs to happen." });
      }
      break;
    case "cancelled":
      moves.push({ to: "todo", label: "Reopen", variant: "secondary" });
      break;
  }
  if (can.cancel && status !== "done" && status !== "cancelled") {
    moves.push({ to: "cancelled", label: "Cancel task", variant: "secondary" });
  }
  return moves;
}

/** The line under the status buttons on the task page. */
export function reviewRuleText(can: StatusRights, reviewerName: string | null): string {
  const reviewer = `Reviewer: ${reviewerName ?? "nobody yet"}.`;
  if (can.complete && !can.approve) return `${reviewer} As an owner you can mark it as done yourself, or send it to review.`;
  if (can.approve) return `${reviewer} You can mark it as done.`;
  return `${reviewer} An owner, the reviewer or an admin can mark it as done.`;
}
