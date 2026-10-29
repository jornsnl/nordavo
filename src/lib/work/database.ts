// Types of the task tool tables (supabase/migrations/20261029000000_work.sql),
// merged into Database in src/lib/database.types.ts. Writes go through the
// work_* functions, so Insert and Update only matter for the service role
// (ClickUp import) and the few tables users write themselves.

import type { Json } from "@/lib/database.types";

export type WorkRole = "admin" | "member" | "guest";
export type WorkVisibility = "open" | "private";
export type WorkStatus = "todo" | "in_progress" | "review" | "done" | "cancelled";
export type WorkPriority = "low" | "normal" | "high" | "urgent";
export type WorkCommentKind = "comment" | "returned";
export type WorkNotificationKind =
  | "assigned"
  | "comment"
  | "mention"
  | "review"
  | "returned"
  | "due_soon"
  | "overdue"
  | "project_added"
  | "access_expiring";
export type WorkDelivery = "instant" | "digest";
export type WorkAccessAction =
  | "invited"
  | "invite_revoked"
  | "granted"
  | "revoked"
  | "role_changed"
  | "expiry_changed"
  | "expired"
  | "deactivated"
  | "reactivated";

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

/** Row, plus Insert with the required columns and Update with everything optional. */
type Table<Row, Required extends keyof Row, Relationships extends Rel[]> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

type ToProfile<Name extends string, Column extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: "profiles";
  referencedColumns: ["id"];
};

type To<Name extends string, Column extends string, Relation extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Relation;
  referencedColumns: ["id"];
};

export type WorkWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkMemberRow = {
  workspace_id: string;
  user_id: string;
  role: WorkRole;
  access_expires_at: string | null;
  deactivated_at: string | null;
  expiry_warned_at: string | null;
  expiry_logged_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  visibility: WorkVisibility;
  guests_see_assigned_only: boolean;
  created_by: string | null;
  archived_at: string | null;
  external_source: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkProjectMemberRow = {
  project_id: string;
  user_id: string;
  access_expires_at: string | null;
  expiry_warned_at: string | null;
  expiry_logged_at: string | null;
  added_by: string | null;
  created_at: string;
};

export type WorkTaskRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: WorkStatus;
  priority: WorkPriority;
  due_at: string | null;
  created_by: string | null;
  reviewer_id: string | null;
  is_log: boolean;
  position: number;
  review_requested_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  external_source: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkTaskAssigneeRow = {
  task_id: string;
  user_id: string;
  assigned_by: string | null;
  created_at: string;
};

export type WorkCommentRow = {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  kind: WorkCommentKind;
  external_source: string | null;
  external_id: string | null;
  created_at: string;
};

export type WorkCommentMentionRow = { comment_id: string; user_id: string };

export type WorkAttachmentRow = {
  id: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  external_source: string | null;
  external_id: string | null;
  created_at: string;
};

export type WorkTaskActivityRow = {
  id: number;
  task_id: string;
  actor_id: string | null;
  action: string;
  details: Json;
  created_at: string;
};

export type WorkAccessLogRow = {
  id: number;
  workspace_id: string;
  project_id: string | null;
  user_id: string | null;
  email: string | null;
  action: WorkAccessAction;
  role: string | null;
  actor_id: string | null;
  details: Json;
  created_at: string;
};

export type WorkInviteRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  email: string;
  role: WorkRole;
  access_expires_at: string | null;
  token_hash: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
};

export type WorkNotificationRow = {
  id: number;
  user_id: string;
  kind: WorkNotificationKind;
  workspace_id: string | null;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  data: Json;
  delivery: WorkDelivery;
  dedupe_key: string | null;
  attempts: number;
  claimed_at: string | null;
  sent_at: string | null;
  skipped: boolean;
  created_at: string;
};

export type WorkNotificationPrefsRow = {
  user_id: string;
  prefs: Json;
  updated_at: string;
};

export type WorkApiTokenRow = {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  access: "read" | "write";
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type WorkTables = {
  work_workspaces: Table<WorkWorkspaceRow, "name" | "slug", [ToProfile<"work_workspaces_created_by_fkey", "created_by">]>;
  work_members: Table<
    WorkMemberRow,
    "workspace_id" | "user_id" | "role",
    [
      To<"work_members_workspace_id_fkey", "workspace_id", "work_workspaces">,
      ToProfile<"work_members_user_id_fkey", "user_id">,
      ToProfile<"work_members_invited_by_fkey", "invited_by">,
    ]
  >;
  work_projects: Table<
    WorkProjectRow,
    "workspace_id" | "name",
    [
      To<"work_projects_workspace_id_fkey", "workspace_id", "work_workspaces">,
      ToProfile<"work_projects_created_by_fkey", "created_by">,
    ]
  >;
  work_project_members: Table<
    WorkProjectMemberRow,
    "project_id" | "user_id",
    [
      To<"work_project_members_project_id_fkey", "project_id", "work_projects">,
      ToProfile<"work_project_members_user_id_fkey", "user_id">,
      ToProfile<"work_project_members_added_by_fkey", "added_by">,
    ]
  >;
  work_tasks: Table<
    WorkTaskRow,
    "workspace_id" | "project_id" | "title",
    [
      To<"work_tasks_workspace_id_fkey", "workspace_id", "work_workspaces">,
      {
        foreignKeyName: "work_tasks_project_id_workspace_id_fkey";
        columns: ["project_id", "workspace_id"];
        isOneToOne: false;
        referencedRelation: "work_projects";
        referencedColumns: ["id", "workspace_id"];
      },
      To<"work_tasks_parent_id_fkey", "parent_id", "work_tasks">,
      ToProfile<"work_tasks_created_by_fkey", "created_by">,
      ToProfile<"work_tasks_reviewer_id_fkey", "reviewer_id">,
      ToProfile<"work_tasks_archived_by_fkey", "archived_by">,
    ]
  >;
  work_task_assignees: Table<
    WorkTaskAssigneeRow,
    "task_id" | "user_id",
    [
      To<"work_task_assignees_task_id_fkey", "task_id", "work_tasks">,
      ToProfile<"work_task_assignees_user_id_fkey", "user_id">,
      ToProfile<"work_task_assignees_assigned_by_fkey", "assigned_by">,
    ]
  >;
  work_comments: Table<
    WorkCommentRow,
    "task_id" | "body",
    [To<"work_comments_task_id_fkey", "task_id", "work_tasks">, ToProfile<"work_comments_author_id_fkey", "author_id">]
  >;
  work_comment_mentions: Table<
    WorkCommentMentionRow,
    "comment_id" | "user_id",
    [
      To<"work_comment_mentions_comment_id_fkey", "comment_id", "work_comments">,
      ToProfile<"work_comment_mentions_user_id_fkey", "user_id">,
    ]
  >;
  work_attachments: Table<
    WorkAttachmentRow,
    "task_id" | "storage_path" | "file_name",
    [
      To<"work_attachments_task_id_fkey", "task_id", "work_tasks">,
      ToProfile<"work_attachments_uploaded_by_fkey", "uploaded_by">,
    ]
  >;
  work_task_activity: Table<
    WorkTaskActivityRow,
    "task_id" | "action",
    [To<"work_task_activity_task_id_fkey", "task_id", "work_tasks">, ToProfile<"work_task_activity_actor_id_fkey", "actor_id">]
  >;
  work_access_log: Table<
    WorkAccessLogRow,
    "workspace_id" | "action",
    [
      To<"work_access_log_workspace_id_fkey", "workspace_id", "work_workspaces">,
      To<"work_access_log_project_id_fkey", "project_id", "work_projects">,
      ToProfile<"work_access_log_user_id_fkey", "user_id">,
      ToProfile<"work_access_log_actor_id_fkey", "actor_id">,
    ]
  >;
  work_invites: Table<
    WorkInviteRow,
    "workspace_id" | "email" | "role" | "token_hash",
    [
      To<"work_invites_workspace_id_fkey", "workspace_id", "work_workspaces">,
      To<"work_invites_project_id_fkey", "project_id", "work_projects">,
      ToProfile<"work_invites_invited_by_fkey", "invited_by">,
    ]
  >;
  work_notifications: Table<
    WorkNotificationRow,
    "user_id" | "kind" | "delivery",
    [
      ToProfile<"work_notifications_user_id_fkey", "user_id">,
      ToProfile<"work_notifications_actor_id_fkey", "actor_id">,
      To<"work_notifications_task_id_fkey", "task_id", "work_tasks">,
      To<"work_notifications_project_id_fkey", "project_id", "work_projects">,
      To<"work_notifications_workspace_id_fkey", "workspace_id", "work_workspaces">,
    ]
  >;
  work_notification_prefs: Table<WorkNotificationPrefsRow, "user_id", []>;
  work_api_tokens: Table<WorkApiTokenRow, "user_id" | "name" | "token_hash" | "token_prefix", []>;
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };
/** Optional p_actor: only the API (secret key) may act for another user. */
type Actor = { p_actor?: string | null };

export type WorkFunctions = {
  work_my_role: Fn<{ p_workspace: string }, WorkRole | null>;
  work_can_view_task: Fn<{ p_task: string }, boolean>;
  work_create_workspace: Fn<{ p_name: string; p_slug: string }, string>;
  work_rename_workspace: Fn<{ p_workspace: string; p_name: string } & Actor, undefined>;
  work_set_member: Fn<
    { p_workspace: string; p_user: string; p_role: WorkRole; p_access_expires_at: string | null } & Actor,
    undefined
  >;
  work_deactivate_member: Fn<{ p_workspace: string; p_user: string; p_transfer_to: string | null } & Actor, number>;
  work_reactivate_member: Fn<{ p_workspace: string; p_user: string } & Actor, undefined>;
  work_create_project: Fn<
    {
      p_workspace: string;
      p_name: string;
      p_description?: string | null;
      p_visibility?: WorkVisibility;
      p_guests_see_assigned_only?: boolean;
    } & Actor,
    string
  >;
  work_update_project: Fn<
    {
      p_project: string;
      p_name: string;
      p_description: string | null;
      p_visibility: WorkVisibility;
      p_guests_see_assigned_only: boolean;
      p_archived?: boolean;
    } & Actor,
    undefined
  >;
  work_add_project_member: Fn<
    { p_project: string; p_user: string; p_access_expires_at?: string | null } & Actor,
    undefined
  >;
  work_remove_project_member: Fn<{ p_project: string; p_user: string } & Actor, undefined>;
  work_create_invite: Fn<
    {
      p_workspace: string;
      p_project: string | null;
      p_email: string;
      p_role: WorkRole;
      p_access_expires_at: string | null;
      p_token_hash: string;
    } & Actor,
    string
  >;
  work_revoke_invite: Fn<{ p_invite: string } & Actor, undefined>;
  work_invite_preview: Fn<
    { p_token_hash: string },
    {
      status: "open" | "accepted" | "expired" | "revoked";
      email: string;
      role: WorkRole;
      workspace_name: string;
      project_name: string | null;
      invited_by_name: string | null;
    }[]
  >;
  work_accept_invite: Fn<{ p_token_hash: string }, { workspace_slug: string; project_id: string | null }[]>;
  work_create_task: Fn<
    {
      p_project: string;
      p_title: string;
      p_description?: string | null;
      p_priority?: WorkPriority;
      p_due_at?: string | null;
      p_reviewer?: string | null;
      p_assignees?: string[];
      p_parent?: string | null;
      p_status?: WorkStatus;
      p_is_log?: boolean;
    } & Actor,
    string
  >;
  work_update_task: Fn<{ p_task: string; p_fields: Json } & Actor, undefined>;
  work_set_assignees: Fn<{ p_task: string; p_users: string[] } & Actor, undefined>;
  work_set_status: Fn<{ p_task: string; p_status: WorkStatus; p_comment?: string | null } & Actor, undefined>;
  work_add_comment: Fn<{ p_task: string; p_body: string; p_mentions?: string[] } & Actor, string>;
  work_move_task: Fn<{ p_task: string; p_project: string } & Actor, undefined>;
  work_duplicate_task: Fn<{ p_task: string } & Actor, string>;
  work_archive_task: Fn<{ p_task: string } & Actor, undefined>;
  work_restore_task: Fn<{ p_task: string } & Actor, undefined>;
  work_add_attachment: Fn<
    {
      p_task: string;
      p_path: string;
      p_file_name: string;
      p_mime_type: string | null;
      p_size_bytes: number;
    } & Actor,
    string
  >;
  work_remove_attachment: Fn<{ p_attachment: string } & Actor, string>;
  work_search: Fn<{ p_query: string; p_limit?: number } & Actor, WorkTaskRow[]>;
  work_api_can_view_task: Fn<{ p_task: string; p_user: string }, boolean>;
  work_api_can_view_project: Fn<{ p_project: string; p_user: string }, boolean>;
  work_api_can_see_user: Fn<{ p_viewer: string; p_user: string }, boolean>;
  work_api_visible_projects: Fn<{ p_user: string }, WorkProjectRow[]>;
  work_api_visible_people: Fn<
    { p_viewer: string; p_ids: string[] },
    { id: string; full_name: string | null; email: string | null }[]
  >;
  work_api_list_tasks: Fn<
    {
      p_user: string;
      p_project?: string | null;
      p_workspace?: string | null;
      p_status?: WorkStatus | null;
      p_assignee?: string | null;
      p_reviewer?: string | null;
      p_include_subtasks?: boolean;
      p_limit?: number;
      p_offset?: number;
    },
    WorkTaskRow[]
  >;
  work_claim_notifications: Fn<{ p_delivery: WorkDelivery; p_limit?: number }, WorkNotificationRow[]>;
  work_finish_notifications: Fn<{ p_ids: number[]; p_sent: boolean }, undefined>;
  work_daily_checks: Fn<Record<string, never>, Json>;
  work_purge_trash: Fn<Record<string, never>, string[]>;
};
