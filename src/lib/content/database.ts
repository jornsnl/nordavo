// Types of the content module tables (supabase/migrations/20261120000000_content.sql),
// merged into Database in src/lib/database.types.ts. Signed-in users write
// most tables directly (RLS and the triggers decide), so Insert and Update
// matter here. Relationships are left empty: queries load related rows with
// separate selects instead of embedding.

import type { Json } from "@/lib/database.types";

export type ContentRole = "admin" | "author" | "reviewer" | "viewer";
export type ContentMemberRole = Exclude<ContentRole, "admin">;
export type ContentIdeaStatus = "new" | "shortlisted" | "converted" | "archived";
export type ContentTextField = "title" | "hook" | "body" | "closing_question" | "first_comment";
export type ContentSuggestionStatus = "pending" | "accepted" | "rejected" | "outdated";
export type ContentSuggestedBy = "user" | "claude";
export type ContentOptionList =
  | "channel"
  | "language"
  | "audience"
  | "theme"
  | "angle"
  | "format"
  | "priority"
  | "time_slot"
  | "platform";
export type ContentFieldEntity = "post" | "idea" | "media";
export type ContentFieldType =
  | "text"
  | "number"
  | "date"
  | "single_choice"
  | "multiple_choice"
  | "link"
  | "file"
  | "relation";
export type ContentModuleKey = "ideas" | "series" | "media" | "image_suggestions" | "sources" | "results" | "reviewer_count";
export type ContentMeasuredAfter = "48h" | "7d";
export type ContentNotificationKind =
  | "in_review"
  | "approved"
  | "no_url"
  | "results_due"
  | "changes_requested"
  | "suggestions_ready"
  | "image_suggestions_ready"
  | "unapproved_tomorrow"
  | "buffer_low"
  | "week_below_rhythm"
  | "comment"
  | "next_idea"
  | "image_brief";
export type ContentPrefKind = ContentNotificationKind | "weekly_summary";
export type ContentEmailState = "pending" | "sending" | "sent" | "skipped" | "failed";
/** The statuses with rules attached; workspaces may add their own. */
export type ContentCoreStatus =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "scheduled"
  | "published"
  | "measured"
  | "parked"
  | "rejected";

export type ContentImageBrief = {
  what?: string;
  setting?: string;
  mood?: string;
  who?: string;
  type?: string;
  format?: string;
};

export type ContentWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
  rhythm_goal: number;
  buffer_min: number;
  buffer_max: number;
  success_threshold: number;
  media_reuse_months: number;
  admin_approval_required: boolean;
  modules: Json;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentMemberRow = {
  workspace_id: string;
  user_id: string;
  role: ContentMemberRole;
  added_by: string | null;
  created_at: string;
};

export type ContentOptionRow = {
  id: string;
  workspace_id: string;
  list_key: ContentOptionList;
  value: string;
  label: string;
  position: number;
  meta: Json;
  archived_at: string | null;
  created_at: string;
};

export type ContentFieldDefinitionRow = {
  id: string;
  workspace_id: string;
  entity: ContentFieldEntity;
  key: string;
  label: string;
  field_type: ContentFieldType;
  config: Json;
  position: number;
  archived_at: string | null;
  created_at: string;
};

export type ContentStatusRow = {
  workspace_id: string;
  key: string;
  label: string;
  position: number;
  is_core: boolean;
  allowed_roles: ContentMemberRole[];
  archived_at: string | null;
};

export type ContentTransitionRow = { workspace_id: string; from_status: string; to_status: string };

export type ContentSourceRow = {
  id: string;
  workspace_id: string;
  url: string | null;
  platform: string | null;
  title: string | null;
  upvotes: number | null;
  comments_count: number | null;
  source_date: string | null;
  screenshot_path: string | null;
  names_blurred: boolean;
  screenshot_instruction: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentSeriesRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  target_count: number | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type ContentPostRow = {
  id: string;
  workspace_id: string;
  author_id: string | null;
  title: string;
  channel: string;
  language: string | null;
  status: string;
  planned_date: string | null;
  time_slot: string | null;
  audience: string | null;
  theme: string | null;
  angle: string | null;
  format: string | null;
  hook: string;
  body: string;
  closing_question: string;
  first_comment: string;
  series_id: string | null;
  source_id: string | null;
  image_brief: Json | null;
  image_brief_by: ContentSuggestedBy | null;
  image_brief_done_at: string | null;
  notes: string | null;
  priority: string | null;
  linkedin_url: string | null;
  custom_fields: Json;
  version: number;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  measured_at: string | null;
  next_idea_done_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Archived posts leave the lists; nothing is deleted (20261121010000). */
  archived_at: string | null;
  archived_by: string | null;
};

export type ContentIdeaRow = {
  id: string;
  workspace_id: string;
  author_id: string | null;
  text: string;
  tags: string[];
  link: string | null;
  photo_path: string | null;
  source_id: string | null;
  status: ContentIdeaStatus;
  is_private: boolean;
  from_post_id: string | null;
  merged_into: string | null;
  custom_fields: Json;
  created_at: string;
  updated_at: string;
};

export type ContentIdeaPostRow = { idea_id: string; post_id: string; created_at: string };

export type ContentPostVersionRow = {
  id: number;
  post_id: string;
  version: number;
  title: string;
  hook: string;
  body: string;
  closing_question: string;
  first_comment: string;
  edited_by: string | null;
  created_at: string;
  source: "user" | "claude";
};

export type ContentSuggestionRow = {
  id: string;
  post_id: string;
  field: ContentTextField;
  start_offset: number;
  original_text: string;
  replacement_text: string;
  note: string | null;
  base_version: number;
  status: ContentSuggestionStatus;
  suggested_by: ContentSuggestedBy;
  author_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type ContentCommentRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  field: ContentTextField | null;
  quote: string | null;
  start_offset: number | null;
  body: string;
  author_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

export type ContentStatusLogRow = {
  id: number;
  post_id: string;
  workspace_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_role: string | null;
  created_at: string;
  source: "user" | "claude";
};

export type ContentMediaRow = {
  id: string;
  /** Where a file put in by Claude came from (20261121010000). */
  source_url: string | null;
  workspace_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  folder: string | null;
  source: "upload" | "drive";
  drive_file_id: string | null;
  taken_on: string | null;
  people: string[];
  author_in_photo: boolean | null;
  setting: string | null;
  mood: string | null;
  clothing: string | null;
  orientation: "portrait" | "landscape" | "square" | null;
  usable_for_linkedin: boolean;
  do_not_use: boolean;
  description: string | null;
  tags: string[];
  suggested: Json | null;
  suggested_at: string | null;
  custom_fields: Json;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentPostMediaRow = {
  post_id: string;
  media_id: string;
  position: number;
  added_by: string | null;
  created_at: string;
};

/** Results as often as wanted (20261121010000); the 48h and 7d slots stay in content_results. */
export type ContentMeasurementRow = {
  id: number;
  post_id: string;
  measured_at: string;
  impressions: number | null;
  likes: number;
  comments: number;
  reposts: number;
  entered_by: string | null;
  source: "user" | "claude";
  created_at: string;
};

/** The activity log of Content: who changed what, and whether it was Claude. */
export type ContentActivityRow = {
  id: number;
  workspace_id: string | null;
  post_id: string | null;
  idea_id: string | null;
  media_id: string | null;
  action: string;
  details: Json;
  actor_id: string | null;
  source: "user" | "claude" | "system";
  created_at: string;
};

export type ContentMediaUsageRow = { media_id: string; post_id: string; used_on: string };

export type ContentImageSuggestionRow = {
  id: string;
  post_id: string;
  media_id: string;
  reason: string | null;
  score: number | null;
  status: "pending" | "picked" | "rejected";
  suggested_by: ContentSuggestedBy;
  created_by: string | null;
  decided_by: string | null;
  created_at: string;
};

export type ContentDriveFolderRow = {
  id: string;
  workspace_id: string | null;
  folder_id: string;
  name: string | null;
  last_synced_at: string | null;
  last_result: string | null;
  created_by: string | null;
  created_at: string;
};

export type ContentResultRow = {
  post_id: string;
  measured_after: ContentMeasuredAfter;
  impressions: number | null;
  likes: number;
  comments: number;
  reposts: number;
  entered_by: string | null;
  entered_at: string;
};

export type ContentNotificationRow = {
  id: number;
  user_id: string;
  workspace_id: string | null;
  post_id: string | null;
  kind: ContentNotificationKind;
  message: string;
  dedupe_key: string | null;
  read_at: string | null;
  email_state: ContentEmailState;
  email_attempts: number;
  created_at: string;
};

export type ContentNotificationPrefRow = { user_id: string; kind: ContentPrefKind; in_app: boolean; email: boolean };

export type ContentEventRow = {
  id: number;
  workspace_id: string | null;
  kind: string;
  entity: string;
  entity_id: string | null;
  actor_id: string | null;
  payload: Json;
  handled_at: string | null;
  created_at: string;
};

/** Row, plus Insert with the required columns and Update with everything optional. */
type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ContentTables = {
  content_workspaces: Table<ContentWorkspaceRow, "name" | "slug">;
  content_members: Table<ContentMemberRow, "workspace_id" | "user_id" | "role">;
  content_options: Table<ContentOptionRow, "workspace_id" | "list_key" | "value" | "label">;
  content_field_definitions: Table<ContentFieldDefinitionRow, "workspace_id" | "entity" | "key" | "label" | "field_type">;
  content_statuses: Table<ContentStatusRow, "workspace_id" | "key" | "label">;
  content_workflow_transitions: Table<ContentTransitionRow, "workspace_id" | "from_status" | "to_status">;
  content_sources: Table<ContentSourceRow, "workspace_id">;
  content_series: Table<ContentSeriesRow, "workspace_id" | "name">;
  content_posts: Table<ContentPostRow, "workspace_id" | "title">;
  content_ideas: Table<ContentIdeaRow, "workspace_id" | "text">;
  content_idea_posts: Table<ContentIdeaPostRow, "idea_id" | "post_id">;
  content_post_versions: Table<ContentPostVersionRow, "post_id" | "version">;
  content_suggestions: Table<ContentSuggestionRow, "post_id" | "field" | "start_offset" | "base_version">;
  content_comments: Table<ContentCommentRow, "post_id" | "body">;
  content_status_log: Table<ContentStatusLogRow, "post_id" | "workspace_id" | "to_status">;
  content_media: Table<ContentMediaRow, "storage_path" | "file_name">;
  content_post_media: Table<ContentPostMediaRow, "post_id" | "media_id">;
  content_media_usage: Table<ContentMediaUsageRow, "media_id" | "post_id" | "used_on">;
  content_image_suggestions: Table<ContentImageSuggestionRow, "post_id" | "media_id">;
  content_drive_folders: Table<ContentDriveFolderRow, "folder_id">;
  content_results: Table<ContentResultRow, "post_id" | "measured_after">;
  content_measurements: Table<ContentMeasurementRow, "post_id">;
  content_activity: Table<ContentActivityRow, "action">;
  content_notifications: Table<ContentNotificationRow, "user_id" | "kind" | "message">;
  content_notification_prefs: Table<ContentNotificationPrefRow, "user_id" | "kind">;
  content_events: Table<ContentEventRow, "kind" | "entity">;
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type ContentFunctions = {
  content_my_role: Fn<{ p_workspace: string }, ContentRole | null>;
  content_can_view_post: Fn<{ p_post: string }, boolean>;
  content_can_work_on_post: Fn<{ p_post: string }, boolean>;
  content_owns_post: Fn<{ p_post: string }, boolean>;
  content_can_view_idea: Fn<{ p_idea: string }, boolean>;
  content_can_view_media: Fn<{ p_media: string }, boolean>;
  content_can_edit_media: Fn<{ p_workspace: string | null }, boolean>;
  content_has_any_role: Fn<Record<string, never>, boolean>;
  content_ideas_to_post: Fn<{ p_ideas: string[]; p_title: string }, string>;
  content_merge_ideas: Fn<{ p_target: string; p_others: string[] }, undefined>;
  content_accept_suggestion: Fn<{ p_suggestion: string }, undefined>;
  content_pick_image: Fn<{ p_suggestion: string }, undefined>;
  content_restore_version: Fn<{ p_post: string; p_version: number }, undefined>;
  content_create_workspace: Fn<{ p_name: string; p_slug: string; p_owner: string | null }, string>;
  content_reviewer_counts: Fn<
    { p_month: string },
    { workspace_id: string; reviewer_id: string; reviewed: number; published: number }[]
  >;
  content_run_checks: Fn<{ p_now?: string }, Json>;
  content_claim_mail: Fn<{ p_limit?: number }, ContentNotificationRow[]>;
  content_finish_mail: Fn<{ p_ids: number[]; p_sent: boolean }, undefined>;
  content_claim_events: Fn<{ p_limit?: number }, ContentEventRow[]>;
  content_api_role: Fn<{ p_workspace: string; p_actor: string }, ContentRole | null>;
  content_api_can_view_post: Fn<{ p_post: string; p_actor: string }, boolean>;
  content_api_can_view_media: Fn<{ p_media: string; p_actor: string }, boolean>;
  content_api_suggest_media: Fn<{ p_media: string; p_suggestion: Json; p_actor: string }, undefined>;
  content_api_suggest_images: Fn<{ p_post: string; p_items: Json; p_actor: string }, number>;
  content_api_suggest_image_brief: Fn<{ p_post: string; p_brief: Json; p_actor: string }, undefined>;
  content_api_can_view_idea: Fn<{ p_idea: string; p_actor: string }, boolean>;
  content_api_create_post: Fn<{ p_workspace: string; p_fields: Json; p_status: string | null; p_actor: string }, string>;
  content_api_update_post: Fn<{ p_post: string; p_fields: Json; p_status: string | null; p_actor: string }, undefined>;
  content_api_archive_post: Fn<{ p_post: string; p_archived: boolean; p_actor: string }, undefined>;
  content_api_set_post_media: Fn<{ p_post: string; p_media: string[]; p_actor: string }, number>;
  content_api_add_media: Fn<
    {
      p_workspace: string | null;
      p_path: string;
      p_file_name: string;
      p_mime: string | null;
      p_size: number | null;
      p_details: Json;
      p_source_url: string | null;
      p_actor: string;
    },
    string
  >;
  content_api_describe_media: Fn<{ p_media: string; p_details: Json; p_actor: string }, undefined>;
  content_api_record_results: Fn<
    {
      p_post: string;
      p_measured_at: string | null;
      p_impressions: number | null;
      p_likes: number;
      p_comments: number;
      p_reposts: number;
      p_slot: ContentMeasuredAfter | null;
      p_linkedin_url: string | null;
      p_published_at: string | null;
      p_actor: string;
    },
    number
  >;
  content_api_add_idea: Fn<{ p_workspace: string; p_text: string; p_tags: string[]; p_link: string | null; p_actor: string }, string>;
  content_api_ideas_to_post: Fn<{ p_ideas: string[]; p_title: string | null; p_actor: string }, string>;
  content_api_suggest_text: Fn<
    {
      p_post: string;
      p_field: ContentTextField;
      p_start: number;
      p_original: string;
      p_replacement: string;
      p_note: string | null;
      p_actor: string;
    },
    string
  >;
};
