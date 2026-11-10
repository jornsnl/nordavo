-- Content: LinkedIn content module next to Work (docs/content.md).
--
-- Brief of Julius: capture ideas fast, keep them apart from real posts, and
-- move every post through one flow that only ends when it is live and
-- measured. Every employee has their own workspace.
--
-- Roles per workspace (content_members.role), plus portal admins:
--   admin     portal admin (profiles.role = 'admin'): sees and manages every
--             workspace, has the overview dashboard
--   author    owns the workspace, writes and approves their own posts
--   reviewer  can be linked to several workspaces: reviews, suggests text
--             changes, picks media, schedules, publishes and fills in
--             results. Never approves. Sees posts once they were sent to
--             review (submitted_at), never ideas.
--   viewer    reads only
--
-- How rights are enforced:
--   * Reads go through RLS, with the rules once in content_private.*.
--   * Writes go through RLS as well (insert and update policies per role),
--     and the triggers on content_posts enforce the status flow and the
--     field rules for everyone, also for admins and the API.
--   * The few multi-step writes (turn an idea into a post, merge ideas,
--     accept a suggestion, pick an image) are plain plpgsql functions that
--     run as the caller, so RLS still applies to every row they touch.
--   * Claude writes through content_api_* (secret key, p_actor) and only
--     ever writes suggestions: it never picks, approves, schedules or
--     publishes.
--   * Files live in the private bucket "content" and are only served through
--     short-lived signed URLs, made by the app after RLS allowed the row.

create schema if not exists content_private;
revoke all on schema content_private from public, anon, authenticated;
grant usage on schema content_private to service_role;

-- ---------------------------------------------------------------------------
-- Workspaces and members
-- ---------------------------------------------------------------------------

create table public.content_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  owner_id uuid references public.profiles (id) on delete set null,
  -- Posts per week the workspace aims for.
  rhythm_goal int not null default 2 check (rhythm_goal between 0 and 21),
  -- Posts in Approved or Scheduled the workspace wants ready ahead.
  buffer_min int not null default 5 check (buffer_min between 0 and 100),
  buffer_max int not null default 10 check (buffer_max between 0 and 100),
  -- Likes plus comments after 7 days for a post to count as a success.
  success_threshold int not null default 20 check (success_threshold between 0 and 100000),
  -- Reusing a photo within this many months shows a warning.
  media_reuse_months int not null default 6 check (media_reuse_months between 0 and 60),
  -- New employees: only an admin may approve their posts.
  admin_approval_required boolean not null default false,
  -- Modules switched on for this workspace.
  modules jsonb not null default '{"ideas": true, "series": true, "media": true, "image_suggestions": true, "sources": true, "results": true, "reviewer_count": true}',
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buffer_max >= buffer_min)
);

create table public.content_members (
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('author', 'reviewer', 'viewer')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index content_members_user_idx on public.content_members (user_id);

-- ---------------------------------------------------------------------------
-- Configuration: option lists, extra fields, statuses and transitions
-- ---------------------------------------------------------------------------

-- Every dropdown: channel, language, audience, theme, angle, format,
-- priority, time_slot, platform (of a source). Posts store the value, so
-- renaming the label or archiving the option keeps the history.
create table public.content_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  list_key text not null check (list_key in (
    'channel', 'language', 'audience', 'theme', 'angle', 'format', 'priority', 'time_slot', 'platform'
  )),
  value text not null check (value ~ '^[a-z0-9]+(_[a-z0-9]+)*$' and char_length(value) <= 60),
  label text not null check (char_length(label) between 1 and 80),
  position int not null default 0,
  -- format: {"needs_media": true}; time_slot: {"weekdays": [2, 4]} (ISO, 1 = Monday)
  meta jsonb not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, list_key, value)
);

create table public.content_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  entity text not null check (entity in ('post', 'idea', 'media')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$' and char_length(key) <= 40),
  label text not null check (char_length(label) between 1 and 80),
  field_type text not null check (field_type in (
    'text', 'number', 'date', 'single_choice', 'multiple_choice', 'link', 'file', 'relation'
  )),
  -- choices: {"choices": ["a", "b"]}; relation: {"target": "post" | "idea" | "series" | "source"}
  config jsonb not null default '{}',
  position int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, entity, key)
);

-- Statuses of a post. The core keys carry the rules (approved, scheduled,
-- published, measured); labels, order, who may set them and extra statuses
-- are up to the workspace.
create table public.content_statuses (
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$' and char_length(key) <= 40),
  label text not null check (char_length(label) between 1 and 60),
  position int not null default 0,
  is_core boolean not null default false,
  allowed_roles text[] not null default array['author', 'reviewer'],
  archived_at timestamptz,
  primary key (workspace_id, key),
  check (allowed_roles <@ array['author', 'reviewer']::text[])
);

-- Which status may follow which. Parked and Rejected are reachable from
-- every status; admins are not bound to this list (they are to the rules).
create table public.content_workflow_transitions (
  workspace_id uuid not null,
  from_status text not null,
  to_status text not null,
  primary key (workspace_id, from_status, to_status),
  foreign key (workspace_id, from_status) references public.content_statuses (workspace_id, key) on delete cascade on update cascade,
  foreign key (workspace_id, to_status) references public.content_statuses (workspace_id, key) on delete cascade on update cascade
);

-- ---------------------------------------------------------------------------
-- Sources, series, ideas and posts
-- ---------------------------------------------------------------------------

create table public.content_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  url text check (char_length(url) <= 2000),
  platform text,
  title text check (char_length(title) <= 300),
  upvotes int check (upvotes >= 0),
  comments_count int check (comments_count >= 0),
  source_date date,
  screenshot_path text,
  names_blurred boolean not null default false,
  screenshot_instruction text check (char_length(screenshot_instruction) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (url is not null or title is not null)
);

create index content_sources_workspace_idx on public.content_sources (workspace_id);

create table public.content_series (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 2000),
  -- Planned number of posts, for the progress bar.
  target_count int check (target_count between 1 and 500),
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index content_series_workspace_idx on public.content_series (workspace_id);

create table public.content_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  channel text not null default 'linkedin',
  language text,
  status text not null default 'draft',
  planned_date date,
  time_slot text,
  audience text,
  theme text,
  angle text,
  format text,
  hook text not null default '' check (char_length(hook) <= 3000),
  body text not null default '' check (char_length(body) <= 10000),
  closing_question text not null default '' check (char_length(closing_question) <= 3000),
  first_comment text not null default '' check (char_length(first_comment) <= 3000),
  series_id uuid references public.content_series (id) on delete set null,
  source_id uuid references public.content_sources (id) on delete set null,
  -- {what, setting, mood, who, type, format}; done when the image exists.
  image_brief jsonb,
  image_brief_by text check (image_brief_by in ('user', 'claude')),
  image_brief_done_at timestamptz,
  notes text check (char_length(notes) <= 10000),
  priority text,
  linkedin_url text check (linkedin_url ~ '^https?://' and char_length(linkedin_url) <= 2000),
  custom_fields jsonb not null default '{}',
  -- Number of the latest version (content_post_versions).
  version int not null default 1,
  -- First time the post went to review: from then on reviewers see it.
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  scheduled_at timestamptz,
  published_at timestamptz,
  measured_at timestamptz,
  -- The "next idea" question after publishing was answered or skipped.
  next_idea_done_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, status) references public.content_statuses (workspace_id, key) on update cascade
);

create index content_posts_workspace_idx on public.content_posts (workspace_id, status);
create index content_posts_planned_idx on public.content_posts (planned_date) where planned_date is not null;

create table public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  text text not null check (char_length(text) between 1 and 5000),
  tags text[] not null default '{}',
  link text check (char_length(link) <= 2000),
  photo_path text,
  source_id uuid references public.content_sources (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'shortlisted', 'converted', 'archived')),
  -- Private to the author (and admins) unless shared with the workspace.
  is_private boolean not null default true,
  -- A "next idea" written after this post was published.
  from_post_id uuid references public.content_posts (id) on delete set null,
  merged_into uuid references public.content_ideas (id) on delete set null,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_ideas_workspace_idx on public.content_ideas (workspace_id, status);

-- One idea can feed several posts, one post can be built from several ideas.
create table public.content_idea_posts (
  idea_id uuid not null references public.content_ideas (id) on delete cascade,
  post_id uuid not null references public.content_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, post_id)
);

create index content_idea_posts_post_idx on public.content_idea_posts (post_id);

-- ---------------------------------------------------------------------------
-- Editor: versions, suggestions, comments, status log
-- ---------------------------------------------------------------------------

create table public.content_post_versions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.content_posts (id) on delete cascade,
  version int not null,
  title text not null,
  hook text not null,
  body text not null,
  closing_question text not null,
  first_comment text not null,
  edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (post_id, version)
);

-- Text changes proposed by a reviewer (or Claude): the author accepts or
-- rejects each. A suggestion replaces original_text at start_offset of the
-- field; it is never written into the text by itself.
create table public.content_suggestions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.content_posts (id) on delete cascade,
  field text not null check (field in ('title', 'hook', 'body', 'closing_question', 'first_comment')),
  start_offset int not null check (start_offset >= 0),
  original_text text not null default '' check (char_length(original_text) <= 10000),
  replacement_text text not null default '' check (char_length(replacement_text) <= 10000),
  note text check (char_length(note) <= 2000),
  -- The post version the offsets refer to.
  base_version int not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'outdated')),
  suggested_by text not null default 'user' check (suggested_by in ('user', 'claude')),
  author_id uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (original_text <> replacement_text)
);

create index content_suggestions_post_idx on public.content_suggestions (post_id, status);

-- Comments on a selected piece of text, with replies. Feedback never goes
-- into the text itself.
create table public.content_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.content_posts (id) on delete cascade,
  parent_id uuid references public.content_comments (id) on delete cascade,
  field text check (field in ('title', 'hook', 'body', 'closing_question', 'first_comment')),
  quote text check (char_length(quote) <= 2000),
  start_offset int check (start_offset >= 0),
  body text not null check (char_length(body) between 1 and 5000),
  author_id uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index content_comments_post_idx on public.content_comments (post_id, created_at);

create table public.content_status_log (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.content_posts (id) on delete cascade,
  workspace_id uuid not null references public.content_workspaces (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  -- The role the actor had at that moment (reviewer count).
  actor_role text,
  created_at timestamptz not null default now()
);

create index content_status_log_post_idx on public.content_status_log (post_id, created_at);
create index content_status_log_month_idx on public.content_status_log (workspace_id, created_at);

-- ---------------------------------------------------------------------------
-- Media library
-- ---------------------------------------------------------------------------

-- workspace_id null: the shared company library (for example the Nordavo
-- photoshoot), available to every workspace.
create table public.content_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.content_workspaces (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  folder text check (char_length(folder) <= 300),
  source text not null default 'upload' check (source in ('upload', 'drive')),
  drive_file_id text unique,
  taken_on date,
  people text[] not null default '{}',
  author_in_photo boolean,
  setting text check (char_length(setting) <= 200),
  mood text check (char_length(mood) <= 200),
  clothing text check (char_length(clothing) <= 200),
  orientation text check (orientation in ('portrait', 'landscape', 'square')),
  usable_for_linkedin boolean not null default true,
  do_not_use boolean not null default false,
  description text check (char_length(description) <= 2000),
  tags text[] not null default '{}',
  -- Description and tags proposed by Claude, shown until someone accepts or
  -- rejects them: {description, tags, people, setting, mood, clothing, orientation}.
  suggested jsonb,
  suggested_at timestamptz,
  custom_fields jsonb not null default '{}',
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_media_workspace_idx on public.content_media (workspace_id);

-- Chosen media of a post, in order (carousels, documents).
create table public.content_post_media (
  post_id uuid not null references public.content_posts (id) on delete cascade,
  media_id uuid not null references public.content_media (id) on delete cascade,
  position int not null default 0,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (post_id, media_id)
);

create index content_post_media_media_idx on public.content_post_media (media_id);

-- Where a file went live, written when its post is published.
create table public.content_media_usage (
  media_id uuid not null references public.content_media (id) on delete cascade,
  post_id uuid not null references public.content_posts (id) on delete cascade,
  used_on date not null,
  primary key (media_id, post_id)
);

-- Up to three suggested media files per post, each with a reason and a score.
create table public.content_image_suggestions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.content_posts (id) on delete cascade,
  media_id uuid not null references public.content_media (id) on delete cascade,
  reason text check (char_length(reason) <= 500),
  score int check (score between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'picked', 'rejected')),
  suggested_by text not null default 'user' check (suggested_by in ('user', 'claude')),
  created_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index content_image_suggestions_post_idx on public.content_image_suggestions (post_id, status);

-- Google Drive folders that are imported and kept in sync.
create table public.content_drive_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.content_workspaces (id) on delete cascade,
  folder_id text not null check (folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  name text check (char_length(name) <= 200),
  last_synced_at timestamptz,
  last_result text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, folder_id)
);

-- ---------------------------------------------------------------------------
-- Results, notifications, events
-- ---------------------------------------------------------------------------

create table public.content_results (
  post_id uuid not null references public.content_posts (id) on delete cascade,
  measured_after text not null check (measured_after in ('48h', '7d')),
  impressions int check (impressions >= 0),
  likes int not null default 0 check (likes >= 0),
  comments int not null default 0 check (comments >= 0),
  reposts int not null default 0 check (reposts >= 0),
  entered_by uuid references public.profiles (id) on delete set null,
  entered_at timestamptz not null default now(),
  primary key (post_id, measured_after)
);

create table public.content_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid references public.content_workspaces (id) on delete cascade,
  post_id uuid references public.content_posts (id) on delete cascade,
  kind text not null check (kind in (
    'in_review', 'approved', 'no_url', 'results_due',
    'changes_requested', 'suggestions_ready', 'image_suggestions_ready',
    'unapproved_tomorrow', 'buffer_low', 'week_below_rhythm',
    'comment', 'next_idea', 'image_brief'
  )),
  message text not null check (char_length(message) <= 500),
  -- One notification per reason and period (for example one per post per day).
  dedupe_key text unique,
  read_at timestamptz,
  email_state text not null default 'pending' check (email_state in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  email_attempts int not null default 0,
  created_at timestamptz not null default now()
);

create index content_notifications_user_idx on public.content_notifications (user_id, created_at desc);
create index content_notifications_mail_idx on public.content_notifications (email_state) where email_state in ('pending', 'sending');

-- What a user wants per kind; no row means in the app and by email.
create table public.content_notification_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'in_review', 'approved', 'no_url', 'results_due',
    'changes_requested', 'suggestions_ready', 'image_suggestions_ready',
    'unapproved_tomorrow', 'buffer_low', 'week_below_rhythm',
    'comment', 'next_idea', 'image_brief', 'weekly_summary'
  )),
  in_app boolean not null default true,
  email boolean not null default true,
  primary key (user_id, kind)
);

-- Internal events of the core, so new modules can hook in without changing
-- it: the app runs registered handlers for every new event
-- (src/lib/content/events.ts, job content-events), and pg_notify announces
-- them on the channel content_events.
create table public.content_events (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.content_workspaces (id) on delete cascade,
  kind text not null,
  entity text not null,
  entity_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}',
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create index content_events_open_idx on public.content_events (id) where handled_at is null;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create trigger content_workspaces_set_updated_at before update on public.content_workspaces
  for each row execute function public.set_updated_at();
create trigger content_posts_set_updated_at before update on public.content_posts
  for each row execute function public.set_updated_at();
create trigger content_ideas_set_updated_at before update on public.content_ideas
  for each row execute function public.set_updated_at();
create trigger content_media_set_updated_at before update on public.content_media
  for each row execute function public.set_updated_at();
create trigger content_sources_set_updated_at before update on public.content_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access rules (content_private)
-- ---------------------------------------------------------------------------

-- The acting user: content.actor (set by content_api_* for Claude) or the
-- signed-in user. Null for jobs with the secret key.
create or replace function content_private.current_actor()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('content.actor', true), '')::uuid, (select auth.uid()));
$$;

-- Portal admins manage every content workspace.
create or replace function content_private.is_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select role = 'admin' from public.profiles where id = p_user), false);
$$;

-- admin, author, reviewer, viewer or null. Developers, candidates, callers
-- and clients never have Content.
create or replace function content_private.role_in(p_workspace uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is null then null
    when (select role from public.profiles where id = p_user) = 'admin' then 'admin'
    when (select role from public.profiles where id = p_user) not in ('member', 'external') then null
    else (select m.role from public.content_members m where m.workspace_id = p_workspace and m.user_id = p_user)
  end;
$$;

-- Member of any workspace (the shared company library).
create or replace function content_private.has_any_role(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select content_private.is_admin(p_user) or exists (
    select 1
    from public.content_members m
    join public.profiles p on p.id = m.user_id
    where m.user_id = p_user and p.role in ('member', 'external')
  );
$$;

-- May edit as a writer of any workspace (author or reviewer), for the shared library.
create or replace function content_private.is_writer_anywhere(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select content_private.is_admin(p_user) or exists (
    select 1
    from public.content_members m
    join public.profiles p on p.id = m.user_id
    where m.user_id = p_user and m.role in ('author', 'reviewer') and p.role in ('member', 'external')
  );
$$;

-- Reviewers only see posts that were sent to review at least once.
create or replace function content_private.can_view_post(p_post uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case content_private.role_in(p.workspace_id, p_user)
      when 'admin' then true
      when 'author' then true
      when 'viewer' then true
      when 'reviewer' then p.submitted_at is not null
      else false
    end
    from public.content_posts p
    where p.id = p_post
  ), false);
$$;

-- May change things around a post (media, results, suggestions, comments).
create or replace function content_private.can_work_on_post(p_post uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select content_private.can_view_post(p_post, p_user)
    and coalesce((
      select content_private.role_in(p.workspace_id, p_user) in ('admin', 'author', 'reviewer')
      from public.content_posts p where p.id = p_post
    ), false);
$$;

-- The author of the post or an admin (accepting suggestions, resolving).
create or replace function content_private.owns_post(p_post uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select content_private.role_in(p.workspace_id, p_user) = 'admin'
      or (p.author_id = p_user and content_private.role_in(p.workspace_id, p_user) = 'author')
    from public.content_posts p where p.id = p_post
  ), false);
$$;

create or replace function content_private.can_view_idea(p_idea uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when content_private.role_in(i.workspace_id, p_user) = 'admin' then true
      when content_private.role_in(i.workspace_id, p_user) is null then false
      when i.author_id = p_user then true
      when content_private.role_in(i.workspace_id, p_user) = 'reviewer' then false
      else not i.is_private
    end
    from public.content_ideas i where i.id = p_idea
  ), false);
$$;

create or replace function content_private.can_view_media(p_media uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.workspace_id is null then content_private.has_any_role(p_user)
      else content_private.role_in(m.workspace_id, p_user) is not null
    end
    from public.content_media m where m.id = p_media
  ), false);
$$;

create or replace function content_private.can_edit_media(p_workspace uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_workspace is null then content_private.is_writer_anywhere(p_user)
    else coalesce(content_private.role_in(p_workspace, p_user) in ('admin', 'author', 'reviewer'), false)
  end;
$$;

-- Two people share a content workspace (to see each other's name).
create or replace function content_private.shares_workspace(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer = p_target
    or (content_private.is_admin(p_viewer) and exists (select 1 from public.content_members where user_id = p_target))
    or exists (
      select 1
      from public.content_members a
      join public.content_members b on b.workspace_id = a.workspace_id
      where a.user_id = p_viewer and b.user_id = p_target
    )
    or exists (
      select 1 from public.content_members a
      join public.content_workspaces w on w.id = a.workspace_id
      where a.user_id = p_viewer and (w.owner_id = p_target or w.created_by = p_target)
    )
    or exists (
      select 1 from public.content_members b
      where b.user_id = p_viewer and content_private.is_admin(p_target)
    );
$$;

-- Thin wrappers for the policies (always auth.uid()).
create or replace function public.content_my_role(p_workspace uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select content_private.role_in(p_workspace, (select auth.uid())); $$;

create or replace function public.content_can_view_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_view_post(p_post, (select auth.uid())); $$;

create or replace function public.content_can_work_on_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_work_on_post(p_post, (select auth.uid())); $$;

create or replace function public.content_owns_post(p_post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.owns_post(p_post, (select auth.uid())); $$;

create or replace function public.content_can_view_idea(p_idea uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_view_idea(p_idea, (select auth.uid())); $$;

create or replace function public.content_can_view_media(p_media uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_view_media(p_media, (select auth.uid())); $$;

create or replace function public.content_can_edit_media(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_edit_media(p_workspace, (select auth.uid())); $$;

create or replace function public.content_has_any_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.has_any_role((select auth.uid())); $$;

-- ---------------------------------------------------------------------------
-- Events and notifications (helpers)
-- ---------------------------------------------------------------------------

create or replace function content_private.emit(
  p_workspace uuid,
  p_kind text,
  p_entity text,
  p_entity_id uuid,
  p_payload jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.content_events (workspace_id, kind, entity, entity_id, actor_id, payload)
  values (p_workspace, p_kind, p_entity, p_entity_id, content_private.current_actor(), coalesce(p_payload, '{}'))
  returning id into v_id;
  perform pg_notify('content_events', json_build_object('id', v_id, 'kind', p_kind)::text);
end;
$$;

-- Queue a notification, unless the user switched it off in the app and by
-- email, or one with the same dedupe key exists. Never for the actor.
create or replace function content_private.notify(
  p_user uuid,
  p_kind text,
  p_workspace uuid,
  p_post uuid,
  p_message text,
  p_dedupe text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_app boolean;
  v_email boolean;
begin
  if p_user is null or p_user = content_private.current_actor() then
    return;
  end if;
  select coalesce(np.in_app, true), coalesce(np.email, true) into v_in_app, v_email
  from (select 1) d
  left join public.content_notification_prefs np on np.user_id = p_user and np.kind = p_kind;
  if not v_in_app and not v_email then
    return;
  end if;
  insert into public.content_notifications (user_id, kind, workspace_id, post_id, message, dedupe_key, read_at, email_state)
  values (
    p_user, p_kind, p_workspace, p_post, left(p_message, 500), p_dedupe,
    case when v_in_app then null else now() end,
    case when v_email then 'pending' else 'skipped' end
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

-- Reviewers of a workspace.
create or replace function content_private.reviewers(p_workspace uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.content_members m
  join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace and m.role = 'reviewer' and p.role in ('member', 'external');
$$;

-- ---------------------------------------------------------------------------
-- Post rules
-- ---------------------------------------------------------------------------

create or replace function content_private.format_needs_media(p_workspace uuid, p_format text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (o.meta ->> 'needs_media')::boolean
    from public.content_options o
    where o.workspace_id = p_workspace and o.list_key = 'format' and o.value = p_format
  ), false);
$$;

create or replace function content_private.before_post_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := content_private.current_actor();
  v_role text;
begin
  if v_actor is not null then
    v_role := content_private.role_in(new.workspace_id, v_actor);
    if v_role is null or v_role not in ('admin', 'author') then
      raise exception 'Only the author of this workspace can add posts' using errcode = '42501';
    end if;
    new.created_by := v_actor;
    if v_role = 'author' or new.author_id is null then
      new.author_id := coalesce(
        case when v_role = 'author' then v_actor end,
        (select owner_id from public.content_workspaces where id = new.workspace_id),
        v_actor
      );
    end if;
    -- Every post starts as a draft.
    new.status := 'draft';
  end if;
  new.version := 1;
  new.submitted_at := null;
  new.approved_at := null;
  new.approved_by := null;
  new.scheduled_at := null;
  new.published_at := null;
  new.measured_at := null;
  return new;
end;
$$;

create trigger content_posts_before_insert before insert on public.content_posts
  for each row execute function content_private.before_post_insert();

create or replace function content_private.before_post_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := content_private.current_actor();
  v_role text;
  v_text_changed boolean;
  v_forced boolean := false;
  v_target record;
  v_ws record;
begin
  v_role := case when v_actor is null then 'system' else content_private.role_in(old.workspace_id, v_actor) end;
  if v_role is null or v_role = 'viewer' then
    raise exception 'You cannot change this post' using errcode = '42501';
  end if;
  if v_role = 'reviewer' and old.submitted_at is null then
    raise exception 'You cannot change this post' using errcode = '42501';
  end if;

  if new.workspace_id <> old.workspace_id then
    raise exception 'A post cannot move to another workspace';
  end if;
  if new.author_id is distinct from old.author_id and v_role not in ('admin', 'system') then
    raise exception 'Only an admin can change the author';
  end if;
  -- Bookkeeping columns follow the status, never the client.
  new.submitted_at := old.submitted_at;
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  new.scheduled_at := old.scheduled_at;
  new.published_at := old.published_at;
  new.measured_at := old.measured_at;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if v_role <> 'system' then
    new.version := old.version;
  end if;

  v_text_changed := (new.title, new.hook, new.body, new.closing_question, new.first_comment)
    is distinct from (old.title, old.hook, old.body, old.closing_question, old.first_comment);

  -- Reviewers suggest text changes and choose media, dates and the link;
  -- they never edit the text or what the post is about.
  if v_role = 'reviewer' and (
    v_text_changed
    or (new.channel, new.language, new.audience, new.theme, new.angle, new.format, new.series_id,
        new.source_id, new.priority, new.custom_fields)
       is distinct from
       (old.channel, old.language, old.audience, old.theme, old.angle, old.format, old.series_id,
        old.source_id, old.priority, old.custom_fields)
  ) then
    raise exception 'Reviewers suggest changes instead of editing the post' using errcode = '42501';
  end if;

  if v_text_changed then
    new.version := old.version + 1;
    -- Anyone but the author editing an approved text sends it back.
    if v_role <> 'system' and v_actor is distinct from old.author_id
       and old.status in ('approved', 'scheduled') and new.status = old.status then
      new.status := 'changes_requested';
      v_forced := true;
    end if;
  end if;

  if new.status is distinct from old.status then
    select * into v_target from public.content_statuses s
    where s.workspace_id = old.workspace_id and s.key = new.status;
    if not found or v_target.archived_at is not null then
      raise exception 'Unknown status %', new.status;
    end if;

    if not v_forced and v_role not in ('admin', 'system') then
      if not (v_role = any (v_target.allowed_roles)) then
        raise exception 'You cannot set a post to %', v_target.label using errcode = '42501';
      end if;
      if new.status not in ('parked', 'rejected') and not exists (
        select 1 from public.content_workflow_transitions t
        where t.workspace_id = old.workspace_id and t.from_status = old.status and t.to_status = new.status
      ) then
        raise exception 'A post cannot go from % to %',
          coalesce((select label from public.content_statuses where workspace_id = old.workspace_id and key = old.status), old.status),
          v_target.label;
      end if;
    end if;

    select * into v_ws from public.content_workspaces where id = old.workspace_id;

    if new.status = 'approved' then
      if v_role = 'reviewer' then
        raise exception 'Reviewers cannot approve posts' using errcode = '42501';
      end if;
      if v_role = 'author' and v_actor is distinct from old.author_id then
        raise exception 'Only the author can approve this post' using errcode = '42501';
      end if;
      if v_ws.admin_approval_required and v_role not in ('admin', 'system') then
        raise exception 'Posts in this workspace need approval from an admin' using errcode = '42501';
      end if;
      new.approved_at := now();
      new.approved_by := v_actor;
    elsif new.status in ('draft', 'in_review', 'changes_requested') then
      new.approved_at := null;
      new.approved_by := null;
    end if;

    if new.status = 'in_review' then
      new.submitted_at := coalesce(old.submitted_at, now());
    end if;

    if new.status = 'scheduled' then
      if new.approved_at is null then
        raise exception 'A post needs approval before it can be scheduled';
      end if;
      if new.planned_date is null or new.time_slot is null then
        raise exception 'Pick a date and a time slot before scheduling';
      end if;
      if content_private.format_needs_media(old.workspace_id, new.format)
         and not exists (select 1 from public.content_post_media pm where pm.post_id = old.id) then
        raise exception 'This format needs media: choose it before scheduling';
      end if;
      new.scheduled_at := now();
    end if;

    if new.status = 'published' then
      if new.approved_at is null then
        raise exception 'A post needs approval before it can go live';
      end if;
      if new.linkedin_url is null then
        raise exception 'Paste the LinkedIn URL to mark the post as published';
      end if;
      new.published_at := coalesce(old.published_at, now());
    end if;

    if new.status = 'measured' then
      if new.published_at is null then
        raise exception 'Only published posts can be measured';
      end if;
      if not exists (select 1 from public.content_results r where r.post_id = old.id and r.measured_after = '7d') then
        raise exception 'Fill in the 7 day results first';
      end if;
      new.measured_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger content_posts_before_update before update on public.content_posts
  for each row execute function content_private.before_post_update();

-- Versions, status log, notifications, media usage and events.
create or replace function content_private.after_post_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := content_private.current_actor();
  v_reviewer uuid;
  v_title text := left(new.title, 120);
begin
  if tg_op = 'INSERT' then
    insert into public.content_post_versions (post_id, version, title, hook, body, closing_question, first_comment, edited_by)
    values (new.id, new.version, new.title, new.hook, new.body, new.closing_question, new.first_comment, v_actor);
    insert into public.content_status_log (post_id, workspace_id, from_status, to_status, actor_id, actor_role)
    values (new.id, new.workspace_id, null, new.status, v_actor, content_private.role_in(new.workspace_id, v_actor));
    perform content_private.emit(new.workspace_id, 'post_created', 'post', new.id, jsonb_build_object('title', new.title));
    return new;
  end if;

  if new.version <> old.version then
    insert into public.content_post_versions (post_id, version, title, hook, body, closing_question, first_comment, edited_by)
    values (new.id, new.version, new.title, new.hook, new.body, new.closing_question, new.first_comment, v_actor)
    on conflict (post_id, version) do nothing;
    -- Suggestions on an older text may no longer fit.
    update public.content_suggestions s set status = 'outdated'
    where s.post_id = new.id and s.status = 'pending'
      and substr(
        case s.field
          when 'title' then new.title when 'hook' then new.hook when 'body' then new.body
          when 'closing_question' then new.closing_question else new.first_comment end,
        s.start_offset + 1, char_length(s.original_text)
      ) is distinct from s.original_text;
  end if;

  if new.status is distinct from old.status then
    insert into public.content_status_log (post_id, workspace_id, from_status, to_status, actor_id, actor_role)
    values (new.id, new.workspace_id, old.status, new.status, v_actor, content_private.role_in(new.workspace_id, v_actor));
    perform content_private.emit(new.workspace_id, 'status_changed', 'post', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));

    if new.status = 'in_review' then
      for v_reviewer in select content_private.reviewers(new.workspace_id) loop
        perform content_private.notify(v_reviewer, 'in_review', new.workspace_id, new.id,
          format('Ready for review: %s', v_title), format('in_review:%s:%s:%s', new.id, v_reviewer, new.version));
      end loop;
    elsif new.status = 'approved' then
      for v_reviewer in select content_private.reviewers(new.workspace_id) loop
        perform content_private.notify(v_reviewer, 'approved', new.workspace_id, new.id,
          format('Approved and ready to schedule: %s', v_title), format('approved:%s:%s:%s', new.id, v_reviewer, new.approved_at));
      end loop;
    elsif new.status = 'changes_requested' then
      perform content_private.notify(new.author_id, 'changes_requested', new.workspace_id, new.id,
        format('Changes requested: %s', v_title), format('changes:%s:%s', new.id, now()));
    elsif new.status = 'published' then
      insert into public.content_media_usage (media_id, post_id, used_on)
      select pm.media_id, new.id, (new.published_at at time zone 'Europe/Amsterdam')::date
      from public.content_post_media pm where pm.post_id = new.id
      on conflict (media_id, post_id) do nothing;
      perform content_private.emit(new.workspace_id, 'post_published', 'post', new.id,
        jsonb_build_object('url', new.linkedin_url, 'author_id', new.author_id));
    end if;
  end if;

  if new.image_brief is not null and new.image_brief_done_at is null
     and (old.image_brief is null or old.image_brief is distinct from new.image_brief) then
    for v_reviewer in select content_private.reviewers(new.workspace_id) loop
      if new.submitted_at is not null then
        perform content_private.notify(v_reviewer, 'image_brief', new.workspace_id, new.id,
          format('Image needed: %s', v_title), format('brief:%s:%s:%s', new.id, v_reviewer, md5(new.image_brief::text)));
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger content_posts_after_write after insert or update on public.content_posts
  for each row execute function content_private.after_post_write();

create or replace function content_private.after_idea_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform content_private.emit(new.workspace_id, 'idea_created', 'idea', new.id,
    jsonb_build_object('from_post_id', new.from_post_id));
  return new;
end;
$$;

create trigger content_ideas_after_insert after insert on public.content_ideas
  for each row execute function content_private.after_idea_insert();

create or replace function content_private.before_idea_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := content_private.current_actor();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.author_id := v_actor;
    end if;
  elsif new.author_id is distinct from old.author_id or new.workspace_id <> old.workspace_id then
    raise exception 'An idea keeps its author and workspace';
  end if;
  new.tags := coalesce((select array_agg(distinct lower(trim(t))) from unnest(new.tags) t where trim(t) <> ''), '{}');
  return new;
end;
$$;

create trigger content_ideas_before_write before insert or update on public.content_ideas
  for each row execute function content_private.before_idea_write();

-- Suggestions and comments: who wrote them, and a notification for the author.
create or replace function content_private.before_suggestion_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
  v_text text;
begin
  select * into v_post from public.content_posts where id = new.post_id;
  if content_private.current_actor() is not null and new.suggested_by = 'user' then
    new.author_id := content_private.current_actor();
  end if;
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.base_version := v_post.version;
  v_text := case new.field
    when 'title' then v_post.title when 'hook' then v_post.hook when 'body' then v_post.body
    when 'closing_question' then v_post.closing_question else v_post.first_comment end;
  if substr(v_text, new.start_offset + 1, char_length(new.original_text)) is distinct from new.original_text then
    raise exception 'The text changed in the meantime: reload and try again';
  end if;
  if v_post.status in ('published', 'measured') then
    raise exception 'This post is already published';
  end if;
  return new;
end;
$$;

create trigger content_suggestions_before_insert before insert on public.content_suggestions
  for each row execute function content_private.before_suggestion_insert();

create or replace function content_private.after_suggestion_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
begin
  select * into v_post from public.content_posts where id = new.post_id;
  -- One notification per post and version: a reviewer saves several at once.
  perform content_private.notify(v_post.author_id, 'suggestions_ready', v_post.workspace_id, v_post.id,
    format('New suggestions on: %s', left(v_post.title, 120)), format('suggestions:%s:%s', v_post.id, v_post.version));
  return new;
end;
$$;

create trigger content_suggestions_after_insert after insert on public.content_suggestions
  for each row execute function content_private.after_suggestion_insert();

-- Only the decision columns may change, and only by the author or an admin.
create or replace function content_private.before_suggestion_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.post_id, new.field, new.start_offset, new.original_text, new.replacement_text, new.base_version, new.suggested_by, new.author_id, new.created_at)
     is distinct from
     (old.post_id, old.field, old.start_offset, old.original_text, old.replacement_text, old.base_version, old.suggested_by, old.author_id, old.created_at) then
    raise exception 'A suggestion cannot be edited, only accepted or rejected';
  end if;
  if new.status <> old.status then
    new.decided_by := content_private.current_actor();
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger content_suggestions_before_update before update on public.content_suggestions
  for each row execute function content_private.before_suggestion_update();

create or replace function content_private.before_comment_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if content_private.current_actor() is not null then
      new.author_id := content_private.current_actor();
    end if;
    new.resolved_at := null;
    new.resolved_by := null;
    if new.parent_id is not null and not exists (
      select 1 from public.content_comments c where c.id = new.parent_id and c.post_id = new.post_id and c.parent_id is null
    ) then
      raise exception 'Reply to a comment on the same post';
    end if;
  else
    if (new.post_id, new.parent_id, new.field, new.quote, new.start_offset, new.body, new.author_id, new.created_at)
       is distinct from (old.post_id, old.parent_id, old.field, old.quote, old.start_offset, old.body, old.author_id, old.created_at) then
      raise exception 'A comment cannot be edited, only resolved';
    end if;
    if new.resolved_at is not null and old.resolved_at is null then
      new.resolved_at := now();
      new.resolved_by := content_private.current_actor();
    elsif new.resolved_at is null then
      new.resolved_by := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger content_comments_before_write before insert or update on public.content_comments
  for each row execute function content_private.before_comment_write();

create or replace function content_private.after_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
  v_user uuid;
begin
  select * into v_post from public.content_posts where id = new.post_id;
  -- The author, the writer of the thread and the reviewers who took part.
  for v_user in
    select distinct u from (
      select v_post.author_id as u
      union all select c.author_id from public.content_comments c
        where c.id = new.parent_id or c.parent_id = new.parent_id
    ) people where u is not null
  loop
    perform content_private.notify(v_user, 'comment', v_post.workspace_id, v_post.id,
      format('New comment on: %s', left(v_post.title, 120)), format('comment:%s:%s', new.id, v_user));
  end loop;
  return new;
end;
$$;

create trigger content_comments_after_insert after insert on public.content_comments
  for each row execute function content_private.after_comment_insert();

-- At most three open image suggestions per post.
create or replace function content_private.before_image_suggestion_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if content_private.current_actor() is not null then
      new.created_by := content_private.current_actor();
    end if;
    new.status := 'pending';
    if (select count(*) from public.content_image_suggestions s where s.post_id = new.post_id and s.status = 'pending') >= 3 then
      raise exception 'A post has at most 3 open image suggestions';
    end if;
    if not content_private.can_view_media(new.media_id, coalesce(content_private.current_actor(),
      (select author_id from public.content_posts where id = new.post_id))) then
      raise exception 'That file is not in this library';
    end if;
  elsif (new.post_id, new.media_id, new.reason, new.score, new.suggested_by, new.created_by)
        is distinct from (old.post_id, old.media_id, old.reason, old.score, old.suggested_by, old.created_by) then
    raise exception 'An image suggestion can only be picked or rejected';
  else
    new.decided_by := content_private.current_actor();
  end if;
  return new;
end;
$$;

create trigger content_image_suggestions_before_write before insert or update on public.content_image_suggestions
  for each row execute function content_private.before_image_suggestion_write();

create or replace function content_private.after_image_suggestion_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
begin
  select * into v_post from public.content_posts where id = new.post_id;
  perform content_private.notify(v_post.author_id, 'image_suggestions_ready', v_post.workspace_id, v_post.id,
    format('Image suggestions for: %s', left(v_post.title, 120)), format('images:%s:%s', v_post.id, current_date));
  return new;
end;
$$;

create trigger content_image_suggestions_after_insert after insert on public.content_image_suggestions
  for each row execute function content_private.after_image_suggestion_insert();

-- Chosen media: a file from the workspace library or the company library.
create or replace function content_private.before_post_media_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_media_ws uuid;
begin
  select workspace_id into v_ws from public.content_posts where id = new.post_id;
  select workspace_id into v_media_ws from public.content_media where id = new.media_id;
  if v_media_ws is not null and v_media_ws <> v_ws then
    raise exception 'That file belongs to another workspace';
  end if;
  if content_private.current_actor() is not null then
    new.added_by := content_private.current_actor();
  end if;
  return new;
end;
$$;

create trigger content_post_media_before_insert before insert on public.content_post_media
  for each row execute function content_private.before_post_media_insert();

create or replace function content_private.before_result_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if content_private.current_actor() is not null then
    new.entered_by := content_private.current_actor();
  end if;
  new.entered_at := now();
  if not exists (select 1 from public.content_posts p where p.id = new.post_id and p.published_at is not null) then
    raise exception 'Results can be filled in once the post is published';
  end if;
  return new;
end;
$$;

create trigger content_results_before_write before insert or update on public.content_results
  for each row execute function content_private.before_result_write();

-- Settings keep their identity; only an admin moves ownership or archives.
create or replace function content_private.before_workspace_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.owner_id is distinct from old.owner_id or new.slug <> old.slug or new.archived_at is distinct from old.archived_at)
     and content_private.current_actor() is not null
     and not content_private.is_admin(content_private.current_actor()) then
    raise exception 'Only an admin can change the owner, address or archive a workspace' using errcode = '42501';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger content_workspaces_before_update before update on public.content_workspaces
  for each row execute function content_private.before_workspace_update();

-- Core statuses cannot be renamed away or archived.
create or replace function content_private.before_status_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.is_core and (new.key <> old.key or new.archived_at is not null or not new.is_core) then
      raise exception 'Core statuses can be renamed and reordered, not removed';
    end if;
  elsif new.is_core and coalesce(current_setting('content.seeding', true), '') <> 'on'
        and content_private.current_actor() is not null then
    raise exception 'Only the built-in statuses are core statuses';
  end if;
  if new.key in ('approved') then
    new.allowed_roles := array_remove(new.allowed_roles, 'reviewer');
  end if;
  return new;
end;
$$;

create trigger content_statuses_before_write before insert or update on public.content_statuses
  for each row execute function content_private.before_status_write();

-- ---------------------------------------------------------------------------
-- Defaults for a new workspace
-- ---------------------------------------------------------------------------

create or replace function content_private.seed_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('content.seeding', 'on', true);
  insert into public.content_statuses (workspace_id, key, label, position, is_core, allowed_roles) values
    (p_workspace, 'draft', 'Draft', 10, true, array['author']),
    (p_workspace, 'in_review', 'In review', 20, true, array['author', 'reviewer']),
    (p_workspace, 'changes_requested', 'Changes requested', 30, true, array['author', 'reviewer']),
    (p_workspace, 'approved', 'Approved', 40, true, array['author']),
    (p_workspace, 'scheduled', 'Scheduled', 50, true, array['author', 'reviewer']),
    (p_workspace, 'published', 'Published', 60, true, array['author', 'reviewer']),
    (p_workspace, 'measured', 'Measured', 70, true, array['author', 'reviewer']),
    (p_workspace, 'parked', 'Parked', 80, true, array['author']),
    (p_workspace, 'rejected', 'Rejected', 90, true, array['author'])
  on conflict do nothing;

  insert into public.content_workflow_transitions (workspace_id, from_status, to_status)
  select p_workspace, t.f, t.t from (values
    ('draft', 'in_review'),
    ('in_review', 'changes_requested'),
    ('in_review', 'approved'),
    ('in_review', 'draft'),
    ('changes_requested', 'in_review'),
    ('changes_requested', 'approved'),
    ('changes_requested', 'draft'),
    ('approved', 'scheduled'),
    ('approved', 'changes_requested'),
    ('approved', 'in_review'),
    ('scheduled', 'published'),
    ('scheduled', 'approved'),
    ('published', 'measured'),
    ('parked', 'draft'),
    ('parked', 'in_review'),
    ('rejected', 'draft')
  ) as t(f, t)
  on conflict do nothing;
  perform set_config('content.seeding', '', true);

  insert into public.content_options (workspace_id, list_key, value, label, position, meta) values
    (p_workspace, 'channel', 'linkedin', 'LinkedIn', 10, '{}'),
    (p_workspace, 'language', 'nl', 'Dutch', 10, '{}'),
    (p_workspace, 'language', 'en', 'English', 20, '{}'),
    (p_workspace, 'audience', 'dutch_companies', 'Dutch companies', 10, '{}'),
    (p_workspace, 'audience', 'candidates_india', 'Candidates in India', 20, '{}'),
    (p_workspace, 'audience', 'both', 'Both', 30, '{}'),
    (p_workspace, 'angle', 'story', 'Story', 10, '{}'),
    (p_workspace, 'angle', 'data', 'Data', 20, '{}'),
    (p_workspace, 'angle', 'objection', 'Objection', 30, '{}'),
    (p_workspace, 'angle', 'reflection', 'Reflection', 40, '{}'),
    (p_workspace, 'angle', 'reaction', 'Reaction to a discussion', 50, '{}'),
    (p_workspace, 'angle', 'screenshot', 'Reddit/X screenshot', 60, '{}'),
    (p_workspace, 'format', 'text', 'Text', 10, '{"needs_media": false}'),
    (p_workspace, 'format', 'photo', 'Photo', 20, '{"needs_media": true}'),
    (p_workspace, 'format', 'carousel', 'Carousel', 30, '{"needs_media": true}'),
    (p_workspace, 'format', 'document', 'Document', 40, '{"needs_media": true}'),
    (p_workspace, 'format', 'poll', 'Poll', 50, '{"needs_media": false}'),
    (p_workspace, 'format', 'video', 'Video', 60, '{"needs_media": true}'),
    (p_workspace, 'priority', 'low', 'Low', 10, '{}'),
    (p_workspace, 'priority', 'normal', 'Normal', 20, '{}'),
    (p_workspace, 'priority', 'high', 'High', 30, '{}'),
    (p_workspace, 'time_slot', 't0830', '08:30', 10, '{"time": "08:30", "weekdays": [2, 4]}'),
    (p_workspace, 'platform', 'reddit', 'Reddit', 10, '{}'),
    (p_workspace, 'platform', 'x', 'X', 20, '{}'),
    (p_workspace, 'platform', 'news', 'News', 30, '{}'),
    (p_workspace, 'platform', 'own_experience', 'Own experience', 40, '{}'),
    (p_workspace, 'theme', 'hiring', 'Hiring', 10, '{}'),
    (p_workspace, 'theme', 'india', 'India', 20, '{}'),
    (p_workspace, 'theme', 'entrepreneurship', 'Entrepreneurship', 30, '{}')
  on conflict do nothing;
end;
$$;

create or replace function content_private.after_workspace_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform content_private.seed_workspace(new.id);
  if new.owner_id is not null then
    insert into public.content_members (workspace_id, user_id, role, added_by)
    values (new.id, new.owner_id, 'author', new.created_by)
    on conflict (workspace_id, user_id) do update set role = 'author';
  end if;
  return new;
end;
$$;

create trigger content_workspaces_after_insert after insert on public.content_workspaces
  for each row execute function content_private.after_workspace_insert();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.content_workspaces enable row level security;
alter table public.content_members enable row level security;
alter table public.content_options enable row level security;
alter table public.content_field_definitions enable row level security;
alter table public.content_statuses enable row level security;
alter table public.content_workflow_transitions enable row level security;
alter table public.content_sources enable row level security;
alter table public.content_series enable row level security;
alter table public.content_posts enable row level security;
alter table public.content_ideas enable row level security;
alter table public.content_idea_posts enable row level security;
alter table public.content_post_versions enable row level security;
alter table public.content_suggestions enable row level security;
alter table public.content_comments enable row level security;
alter table public.content_status_log enable row level security;
alter table public.content_media enable row level security;
alter table public.content_post_media enable row level security;
alter table public.content_media_usage enable row level security;
alter table public.content_image_suggestions enable row level security;
alter table public.content_drive_folders enable row level security;
alter table public.content_results enable row level security;
alter table public.content_notifications enable row level security;
alter table public.content_notification_prefs enable row level security;
alter table public.content_events enable row level security;

revoke all on
  public.content_workspaces, public.content_members, public.content_options, public.content_field_definitions,
  public.content_statuses, public.content_workflow_transitions, public.content_sources, public.content_series,
  public.content_posts, public.content_ideas, public.content_idea_posts, public.content_post_versions,
  public.content_suggestions, public.content_comments, public.content_status_log, public.content_media,
  public.content_post_media, public.content_media_usage, public.content_image_suggestions,
  public.content_drive_folders, public.content_results, public.content_notifications,
  public.content_notification_prefs, public.content_events
from anon, authenticated;

grant select on
  public.content_workspaces, public.content_members, public.content_options, public.content_field_definitions,
  public.content_statuses, public.content_workflow_transitions, public.content_sources, public.content_series,
  public.content_posts, public.content_ideas, public.content_idea_posts, public.content_post_versions,
  public.content_suggestions, public.content_comments, public.content_status_log, public.content_media,
  public.content_post_media, public.content_media_usage, public.content_image_suggestions,
  public.content_drive_folders, public.content_results, public.content_notifications,
  public.content_notification_prefs, public.content_events
to authenticated;

-- Writes signed-in users may do themselves; the policies and triggers decide.
grant update (name, rhythm_goal, buffer_min, buffer_max, success_threshold, media_reuse_months,
  admin_approval_required, modules, owner_id, archived_at) on public.content_workspaces to authenticated;
grant insert, update, delete on public.content_members to authenticated;
grant insert, update on public.content_options, public.content_field_definitions, public.content_statuses to authenticated;
grant insert, delete on public.content_workflow_transitions to authenticated;
grant insert, update on public.content_sources, public.content_series to authenticated;
grant insert, update on public.content_posts, public.content_ideas to authenticated;
grant insert, delete on public.content_idea_posts to authenticated;
grant insert, update on public.content_suggestions, public.content_comments to authenticated;
grant insert, update on public.content_media to authenticated;
grant insert, update, delete on public.content_post_media to authenticated;
grant insert, update on public.content_image_suggestions to authenticated;
grant insert, update, delete on public.content_drive_folders to authenticated;
grant insert, update on public.content_results to authenticated;
grant update (read_at) on public.content_notifications to authenticated;
grant insert, update on public.content_notification_prefs to authenticated;

-- Workspaces
create policy "Content workspaces are visible to their people"
  on public.content_workspaces for select to authenticated
  using (public.content_my_role(id) is not null);
create policy "Content workspace settings are for its author and admins"
  on public.content_workspaces for update to authenticated
  using (public.content_my_role(id) in ('admin', 'author'))
  with check (public.content_my_role(id) in ('admin', 'author'));

create policy "Content members are visible inside the workspace"
  on public.content_members for select to authenticated
  using (public.content_my_role(workspace_id) is not null);
create policy "Content members are managed by admins"
  on public.content_members for insert to authenticated
  with check (public.is_admin());
create policy "Content members are changed by admins"
  on public.content_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Content members are removed by admins"
  on public.content_members for delete to authenticated
  using (public.is_admin());

-- Configuration: readable in the workspace, changed by its author and admins.
create policy "Content options are visible in the workspace"
  on public.content_options for select to authenticated using (public.content_my_role(workspace_id) is not null);
create policy "Content options are added by the author"
  on public.content_options for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content options are changed by the author"
  on public.content_options for update to authenticated
  using (public.content_my_role(workspace_id) in ('admin', 'author'))
  with check (public.content_my_role(workspace_id) in ('admin', 'author'));

create policy "Content fields are visible in the workspace"
  on public.content_field_definitions for select to authenticated using (public.content_my_role(workspace_id) is not null);
create policy "Content fields are added by the author"
  on public.content_field_definitions for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content fields are changed by the author"
  on public.content_field_definitions for update to authenticated
  using (public.content_my_role(workspace_id) in ('admin', 'author'))
  with check (public.content_my_role(workspace_id) in ('admin', 'author'));

create policy "Content statuses are visible in the workspace"
  on public.content_statuses for select to authenticated using (public.content_my_role(workspace_id) is not null);
create policy "Content statuses are added by the author"
  on public.content_statuses for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content statuses are changed by the author"
  on public.content_statuses for update to authenticated
  using (public.content_my_role(workspace_id) in ('admin', 'author'))
  with check (public.content_my_role(workspace_id) in ('admin', 'author'));

create policy "Content transitions are visible in the workspace"
  on public.content_workflow_transitions for select to authenticated using (public.content_my_role(workspace_id) is not null);
create policy "Content transitions are added by the author"
  on public.content_workflow_transitions for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content transitions are removed by the author"
  on public.content_workflow_transitions for delete to authenticated using (public.content_my_role(workspace_id) in ('admin', 'author'));

-- Sources and series
create policy "Content sources are visible in the workspace"
  on public.content_sources for select to authenticated using (public.content_my_role(workspace_id) is not null);
create policy "Content sources are added by writers"
  on public.content_sources for insert to authenticated
  with check (public.content_my_role(workspace_id) in ('admin', 'author', 'reviewer'));
create policy "Content sources are changed by writers"
  on public.content_sources for update to authenticated
  using (public.content_my_role(workspace_id) in ('admin', 'author', 'reviewer'))
  with check (public.content_my_role(workspace_id) in ('admin', 'author', 'reviewer'));

create policy "Content series are visible in the workspace"
  on public.content_series for select to authenticated using (public.content_my_role(workspace_id) is not null);
create policy "Content series are added by the author"
  on public.content_series for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content series are changed by the author"
  on public.content_series for update to authenticated
  using (public.content_my_role(workspace_id) in ('admin', 'author'))
  with check (public.content_my_role(workspace_id) in ('admin', 'author'));

-- Posts (the triggers enforce the status flow and field rules)
-- Inline (not by id), so a new row can be returned to who inserted it.
create policy "Content posts are visible to who may see them"
  on public.content_posts for select to authenticated
  using (
    public.content_my_role(workspace_id) in ('admin', 'author', 'viewer')
    or (submitted_at is not null and public.content_my_role(workspace_id) = 'reviewer')
  );
create policy "Content posts are added by the author"
  on public.content_posts for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content posts are changed by writers"
  on public.content_posts for update to authenticated
  using (public.content_can_work_on_post(id))
  with check (public.content_my_role(workspace_id) in ('admin', 'author', 'reviewer'));

-- Ideas: private to the author unless shared; never for reviewers.
create policy "Content ideas are visible to who may see them"
  on public.content_ideas for select to authenticated
  using (
    public.content_my_role(workspace_id) = 'admin'
    or (author_id = (select auth.uid()) and public.content_my_role(workspace_id) is not null)
    or (not is_private and public.content_my_role(workspace_id) in ('author', 'viewer'))
  );
create policy "Content ideas are added by the author"
  on public.content_ideas for insert to authenticated with check (public.content_my_role(workspace_id) in ('admin', 'author'));
create policy "Content ideas are changed by their author"
  on public.content_ideas for update to authenticated
  using (author_id = (select auth.uid()) or public.content_my_role(workspace_id) = 'admin')
  with check (public.content_my_role(workspace_id) in ('admin', 'author'));

create policy "Idea links are visible with their idea or post"
  on public.content_idea_posts for select to authenticated
  using (public.content_can_view_idea(idea_id) or public.content_can_view_post(post_id));
create policy "Idea links are made by the idea's author"
  on public.content_idea_posts for insert to authenticated
  with check (
    exists (select 1 from public.content_ideas i where i.id = idea_id
            and (i.author_id = (select auth.uid()) or public.content_my_role(i.workspace_id) = 'admin'))
    and exists (select 1 from public.content_posts p join public.content_ideas i on i.workspace_id = p.workspace_id
                where p.id = post_id and i.id = idea_id and public.content_my_role(p.workspace_id) in ('admin', 'author'))
  );
create policy "Idea links are removed by the idea's author"
  on public.content_idea_posts for delete to authenticated
  using (exists (select 1 from public.content_ideas i where i.id = idea_id
                 and (i.author_id = (select auth.uid()) or public.content_my_role(i.workspace_id) = 'admin')));

-- Editor
create policy "Versions follow their post"
  on public.content_post_versions for select to authenticated using (public.content_can_view_post(post_id));

create policy "Suggestions follow their post"
  on public.content_suggestions for select to authenticated using (public.content_can_view_post(post_id));
create policy "Suggestions are made by writers"
  on public.content_suggestions for insert to authenticated
  with check (public.content_can_work_on_post(post_id) and suggested_by = 'user');
create policy "Suggestions are decided by the author"
  on public.content_suggestions for update to authenticated
  using (public.content_owns_post(post_id)) with check (public.content_owns_post(post_id));

create policy "Comments follow their post"
  on public.content_comments for select to authenticated using (public.content_can_view_post(post_id));
create policy "Comments are written by writers"
  on public.content_comments for insert to authenticated with check (public.content_can_work_on_post(post_id));
create policy "Comments are resolved by writers"
  on public.content_comments for update to authenticated
  using (public.content_can_work_on_post(post_id)) with check (public.content_can_work_on_post(post_id));

create policy "Status log follows its post"
  on public.content_status_log for select to authenticated using (public.content_can_view_post(post_id));

-- Media
create policy "Media is visible in its library"
  on public.content_media for select to authenticated
  using (case when workspace_id is null then public.content_has_any_role() else public.content_my_role(workspace_id) is not null end);
create policy "Media is added by writers"
  on public.content_media for insert to authenticated with check (public.content_can_edit_media(workspace_id));
create policy "Media is described by writers"
  on public.content_media for update to authenticated
  using (public.content_can_edit_media(workspace_id)) with check (public.content_can_edit_media(workspace_id));

create policy "Chosen media follows its post"
  on public.content_post_media for select to authenticated using (public.content_can_view_post(post_id));
create policy "Chosen media is picked by writers"
  on public.content_post_media for insert to authenticated
  with check (public.content_can_work_on_post(post_id) and public.content_can_view_media(media_id));
create policy "Chosen media is reordered by writers"
  on public.content_post_media for update to authenticated
  using (public.content_can_work_on_post(post_id)) with check (public.content_can_work_on_post(post_id));
create policy "Chosen media is removed by writers"
  on public.content_post_media for delete to authenticated using (public.content_can_work_on_post(post_id));

create policy "Media usage follows its file"
  on public.content_media_usage for select to authenticated using (public.content_can_view_media(media_id));

create policy "Image suggestions follow their post"
  on public.content_image_suggestions for select to authenticated using (public.content_can_view_post(post_id));
create policy "Image suggestions are made by writers"
  on public.content_image_suggestions for insert to authenticated
  with check (public.content_can_work_on_post(post_id) and suggested_by = 'user');
create policy "Image suggestions are decided by writers"
  on public.content_image_suggestions for update to authenticated
  using (public.content_can_work_on_post(post_id)) with check (public.content_can_work_on_post(post_id));

create policy "Drive folders are visible with their library"
  on public.content_drive_folders for select to authenticated
  using (case when workspace_id is null then public.content_has_any_role() else public.content_my_role(workspace_id) is not null end);
create policy "Drive folders are added by the author"
  on public.content_drive_folders for insert to authenticated
  with check (case when workspace_id is null then public.is_admin() else public.content_my_role(workspace_id) in ('admin', 'author') end);
create policy "Drive folders are changed by the author"
  on public.content_drive_folders for update to authenticated
  using (case when workspace_id is null then public.is_admin() else public.content_my_role(workspace_id) in ('admin', 'author') end);
create policy "Drive folders are removed by the author"
  on public.content_drive_folders for delete to authenticated
  using (case when workspace_id is null then public.is_admin() else public.content_my_role(workspace_id) in ('admin', 'author') end);

-- Results
create policy "Results follow their post"
  on public.content_results for select to authenticated using (public.content_can_view_post(post_id));
create policy "Results are entered by writers"
  on public.content_results for insert to authenticated with check (public.content_can_work_on_post(post_id));
create policy "Results are corrected by writers"
  on public.content_results for update to authenticated
  using (public.content_can_work_on_post(post_id)) with check (public.content_can_work_on_post(post_id));

-- Notifications and events
create policy "Content notifications are private"
  on public.content_notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "Content notifications are marked read by their owner"
  on public.content_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Content notification settings are private"
  on public.content_notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy "Content notification settings are added by their owner"
  on public.content_notification_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Content notification settings are changed by their owner"
  on public.content_notification_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Content events are for admins"
  on public.content_events for select to authenticated using (public.is_admin());

-- Names of the people you work with in Content.
create policy "Content colleagues can read each other's profile"
  on public.profiles for select to authenticated
  using (content_private.shares_workspace((select auth.uid()), id));

-- ---------------------------------------------------------------------------
-- Multi-step writes (run as the caller: RLS applies to every row)
-- ---------------------------------------------------------------------------

-- Create a draft from ideas: links them and sets them to Converted.
create or replace function public.content_ideas_to_post(p_ideas uuid[], p_title text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_ws uuid;
  v_post uuid;
  v_text text;
begin
  if coalesce(array_length(p_ideas, 1), 0) = 0 then
    raise exception 'Pick at least one idea';
  end if;
  select min(workspace_id::text)::uuid, string_agg(text, E'\n\n' order by created_at)
  into v_ws, v_text
  from public.content_ideas where id = any (p_ideas);
  if v_ws is null or (select count(distinct workspace_id) from public.content_ideas where id = any (p_ideas)) <> 1
     or (select count(*) from public.content_ideas where id = any (p_ideas)) <> array_length(p_ideas, 1) then
    raise exception 'Ideas not found';
  end if;

  insert into public.content_posts (workspace_id, title, body, source_id)
  values (
    v_ws,
    coalesce(nullif(trim(p_title), ''), left(split_part(v_text, E'\n', 1), 120)),
    v_text,
    (select source_id from public.content_ideas where id = any (p_ideas) and source_id is not null limit 1)
  )
  returning id into v_post;

  insert into public.content_idea_posts (idea_id, post_id)
  select unnest(p_ideas), v_post;

  update public.content_ideas set status = 'converted' where id = any (p_ideas);
  return v_post;
end;
$$;

-- Merge ideas into one: texts and tags are combined, links move along and
-- the others are archived with merged_into.
create or replace function public.content_merge_ideas(p_target uuid, p_others uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_target record;
begin
  select * into v_target from public.content_ideas where id = p_target;
  if not found then
    raise exception 'Idea not found';
  end if;
  if exists (select 1 from public.content_ideas where id = any (p_others) and workspace_id <> v_target.workspace_id)
     or (select count(*) from public.content_ideas where id = any (p_others) and id <> p_target)
        <> (select count(distinct x) from unnest(p_others) x where x <> p_target) then
    raise exception 'Ideas not found';
  end if;

  update public.content_ideas t set
    text = left(t.text || coalesce((
      select string_agg(E'\n\n' || o.text, '' order by o.created_at)
      from public.content_ideas o where o.id = any (p_others) and o.id <> p_target
    ), ''), 5000),
    tags = (select coalesce(array_agg(distinct x), '{}') from (
      select unnest(t.tags) x
      union select unnest(o.tags) from public.content_ideas o where o.id = any (p_others)
    ) tags),
    link = coalesce(t.link, (select o.link from public.content_ideas o where o.id = any (p_others) and o.link is not null limit 1)),
    source_id = coalesce(t.source_id, (select o.source_id from public.content_ideas o where o.id = any (p_others) and o.source_id is not null limit 1))
  where t.id = p_target;

  insert into public.content_idea_posts (idea_id, post_id)
  select p_target, ip.post_id from public.content_idea_posts ip where ip.idea_id = any (p_others)
  on conflict do nothing;

  update public.content_ideas set status = 'archived', merged_into = p_target
  where id = any (p_others) and id <> p_target;
end;
$$;

-- Accept a suggestion: replaces the original text in the field.
create or replace function public.content_accept_suggestion(p_suggestion uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_s record;
  v_text text;
  v_new text;
begin
  select * into v_s from public.content_suggestions where id = p_suggestion and status = 'pending';
  if not found then
    raise exception 'Suggestion not found or already decided';
  end if;
  if not public.content_owns_post(v_s.post_id) then
    raise exception 'Only the author can accept suggestions' using errcode = '42501';
  end if;
  select case v_s.field
    when 'title' then title when 'hook' then hook when 'body' then body
    when 'closing_question' then closing_question else first_comment end
  into v_text
  from public.content_posts where id = v_s.post_id;

  if substr(v_text, v_s.start_offset + 1, char_length(v_s.original_text)) is distinct from v_s.original_text then
    update public.content_suggestions set status = 'outdated' where id = p_suggestion;
    raise exception 'The text changed since this suggestion was made';
  end if;
  v_new := substr(v_text, 1, v_s.start_offset) || v_s.replacement_text
    || substr(v_text, v_s.start_offset + char_length(v_s.original_text) + 1);

  -- Mark it first, so the version trigger does not mark it outdated.
  update public.content_suggestions set status = 'accepted' where id = p_suggestion;

  -- Later suggestions in the same field shift with the length difference.
  update public.content_suggestions s
  set start_offset = s.start_offset + char_length(v_s.replacement_text) - char_length(v_s.original_text)
  where s.post_id = v_s.post_id and s.field = v_s.field and s.status = 'pending'
    and s.start_offset >= v_s.start_offset + char_length(v_s.original_text);

  execute format('update public.content_posts set %I = $1 where id = $2', v_s.field) using v_new, v_s.post_id;
end;
$$;

-- Pick a suggested image: it becomes chosen media, the others stay open.
create or replace function public.content_pick_image(p_suggestion uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_s record;
begin
  select * into v_s from public.content_image_suggestions where id = p_suggestion and status = 'pending';
  if not found then
    raise exception 'Suggestion not found or already decided';
  end if;
  insert into public.content_post_media (post_id, media_id, position)
  values (v_s.post_id, v_s.media_id, coalesce((select max(position) + 1 from public.content_post_media where post_id = v_s.post_id), 0))
  on conflict do nothing;
  update public.content_image_suggestions set status = 'picked' where id = p_suggestion;
end;
$$;

-- Restore an older version as a new version.
create or replace function public.content_restore_version(p_post uuid, p_version int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from public.content_post_versions where post_id = p_post and version = p_version;
  if not found then
    raise exception 'Version not found';
  end if;
  update public.content_posts
  set title = v.title, hook = v.hook, body = v.body, closing_question = v.closing_question, first_comment = v.first_comment
  where id = p_post;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: workspaces
-- ---------------------------------------------------------------------------

create or replace function public.content_create_workspace(p_name text, p_slug text, p_owner uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can create content workspaces' using errcode = '42501';
  end if;
  if p_owner is not null and not exists (select 1 from public.profiles where id = p_owner and role in ('admin', 'member', 'external')) then
    raise exception 'That person cannot use Content';
  end if;
  insert into public.content_workspaces (name, slug, owner_id, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_owner, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer count: per month and workspace, the posts a reviewer reviewed
-- (sent back, commented or suggested on) and published. Monthly totals only.
-- ---------------------------------------------------------------------------

create or replace function public.content_reviewer_counts(p_month date)
returns table (workspace_id uuid, reviewer_id uuid, reviewed bigint, published bigint)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_end
  ),
  reviewers as (
    select m.workspace_id, m.user_id from public.content_members m where m.role = 'reviewer'
  ),
  touched as (
    select l.workspace_id, l.actor_id as reviewer_id, l.post_id, 'review' as what
    from public.content_status_log l, bounds b
    where l.actor_role = 'reviewer' and l.from_status = 'in_review'
      and (l.created_at at time zone 'Europe/Amsterdam')::date >= b.m_start
      and (l.created_at at time zone 'Europe/Amsterdam')::date < b.m_end
    union all
    select p.workspace_id, s.author_id, s.post_id, 'review'
    from public.content_suggestions s join public.content_posts p on p.id = s.post_id, bounds b
    where (s.created_at at time zone 'Europe/Amsterdam')::date >= b.m_start
      and (s.created_at at time zone 'Europe/Amsterdam')::date < b.m_end
    union all
    select p.workspace_id, c.author_id, c.post_id, 'review'
    from public.content_comments c join public.content_posts p on p.id = c.post_id, bounds b
    where (c.created_at at time zone 'Europe/Amsterdam')::date >= b.m_start
      and (c.created_at at time zone 'Europe/Amsterdam')::date < b.m_end
    union all
    select l.workspace_id, l.actor_id, l.post_id, 'publish'
    from public.content_status_log l, bounds b
    where l.actor_role = 'reviewer' and l.to_status = 'published'
      and (l.created_at at time zone 'Europe/Amsterdam')::date >= b.m_start
      and (l.created_at at time zone 'Europe/Amsterdam')::date < b.m_end
  )
  select t.workspace_id, t.reviewer_id,
    count(distinct t.post_id) filter (where t.what = 'review'),
    count(distinct t.post_id) filter (where t.what = 'publish')
  from touched t
  join reviewers r on r.workspace_id = t.workspace_id and r.user_id = t.reviewer_id
  group by t.workspace_id, t.reviewer_id;
$$;

-- ---------------------------------------------------------------------------
-- Checks for the jobs (secret key only)
-- ---------------------------------------------------------------------------

-- Hourly: the day before an unapproved post, no URL on the planned date,
-- results due, buffer below target and a week below the rhythm goal. Every
-- notification has a dedupe key, so running it more often is harmless.
create or replace function public.content_run_checks(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Amsterdam')::date;
  v_hour int := extract(hour from (p_now at time zone 'Europe/Amsterdam'));
  v_week_start date := date_trunc('week', (p_now at time zone 'Europe/Amsterdam'))::date;
  v_counts jsonb := '{}';
  v_n int;
  r record;
  v_user uuid;
begin
  -- The most important signal: tomorrow's post is not approved yet.
  v_n := 0;
  for r in
    select p.* from public.content_posts p
    join public.content_workspaces w on w.id = p.workspace_id and w.archived_at is null
    where p.planned_date = v_today + 1
      and p.status not in ('approved', 'scheduled', 'published', 'measured', 'parked', 'rejected')
  loop
    perform content_private.notify(r.author_id, 'unapproved_tomorrow', r.workspace_id, r.id,
      format('Planned for tomorrow and not approved yet: %s', left(r.title, 120)), format('tomorrow:%s:%s', r.id, v_today));
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('unapproved_tomorrow', v_n);

  -- No LinkedIn URL on the planned date (from 18:00) or after it.
  v_n := 0;
  for r in
    select p.* from public.content_posts p
    join public.content_workspaces w on w.id = p.workspace_id and w.archived_at is null
    where p.status in ('approved', 'scheduled') and p.linkedin_url is null and p.planned_date is not null
      and (p.planned_date < v_today or (p.planned_date = v_today and v_hour >= 18))
  loop
    for v_user in select content_private.reviewers(r.workspace_id) loop
      perform content_private.notify(v_user, 'no_url', r.workspace_id, r.id,
        format('No LinkedIn URL yet for: %s', left(r.title, 120)), format('no_url:%s:%s:%s', r.id, v_user, v_today));
    end loop;
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('no_url', v_n);

  -- Results due after 48 hours and after 7 days.
  v_n := 0;
  for r in
    select p.*, x.after_label from public.content_posts p
    join public.content_workspaces w on w.id = p.workspace_id and w.archived_at is null
    cross join lateral (values ('48h', interval '48 hours'), ('7d', interval '7 days')) as x(after_label, wait)
    where p.published_at is not null and p.published_at + x.wait <= p_now
      and p.published_at > p_now - interval '60 days'
      and coalesce((w.modules ->> 'results')::boolean, true)
      and not exists (select 1 from public.content_results cr where cr.post_id = p.id and cr.measured_after = x.after_label)
  loop
    for v_user in select content_private.reviewers(r.workspace_id) loop
      perform content_private.notify(v_user, 'results_due', r.workspace_id, r.id,
        format('Results after %s due: %s', case r.after_label when '48h' then '48 hours' else '7 days' end, left(r.title, 120)),
        format('results:%s:%s:%s', r.id, r.after_label, v_user));
    end loop;
    v_n := v_n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('results_due', v_n);

  -- Buffer below target (once a week) and weeks below the rhythm goal.
  v_n := 0;
  for r in
    select w.*,
      (select count(*) from public.content_posts p where p.workspace_id = w.id and p.status in ('approved', 'scheduled')) as buffer,
      (select count(*) from public.content_posts p where p.workspace_id = w.id
         and p.planned_date >= v_week_start and p.planned_date < v_week_start + 7
         and p.status not in ('parked', 'rejected')) as this_week,
      (select count(*) from public.content_posts p where p.workspace_id = w.id
         and p.planned_date >= v_week_start + 7 and p.planned_date < v_week_start + 14
         and p.status not in ('parked', 'rejected')) as next_week
    from public.content_workspaces w where w.archived_at is null and w.owner_id is not null
  loop
    if r.buffer < r.buffer_min then
      perform content_private.notify(r.owner_id, 'buffer_low', r.id, null,
        format('%s: %s posts ready ahead, target %s to %s', r.name, r.buffer, r.buffer_min, r.buffer_max),
        format('buffer:%s:%s', r.id, v_week_start));
      v_n := v_n + 1;
    end if;
    if r.rhythm_goal > 0 and r.this_week < r.rhythm_goal then
      perform content_private.notify(r.owner_id, 'week_below_rhythm', r.id, null,
        format('%s: %s of %s posts planned this week', r.name, r.this_week, r.rhythm_goal),
        format('rhythm:%s:%s', r.id, v_week_start));
    end if;
    if r.rhythm_goal > 0 and r.next_week < r.rhythm_goal then
      perform content_private.notify(r.owner_id, 'week_below_rhythm', r.id, null,
        format('%s: %s of %s posts planned next week', r.name, r.next_week, r.rhythm_goal),
        format('rhythm:%s:%s', r.id, v_week_start + 7));
    end if;
  end loop;
  v_counts := v_counts || jsonb_build_object('buffer_low', v_n);
  return v_counts;
end;
$$;

-- Mails: claim a batch, then mark them sent or failed.
create or replace function public.content_claim_mail(p_limit int default 100)
returns setof public.content_notifications
language sql
security definer
set search_path = ''
as $$
  update public.content_notifications n
  set email_state = 'sending', email_attempts = n.email_attempts + 1
  where n.id in (
    select id from public.content_notifications
    where email_state = 'pending'
       or (email_state = 'sending' and email_attempts < 5 and created_at < now() - interval '15 minutes')
    order by id
    limit p_limit
    for update skip locked
  )
  returning n.*;
$$;

create or replace function public.content_finish_mail(p_ids bigint[], p_sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.content_notifications
  set email_state = case
    when p_sent then 'sent'
    when email_attempts >= 5 then 'failed'
    else 'pending' end
  where id = any (p_ids);
$$;

-- Events: claim the next batch for the handlers in the app.
create or replace function public.content_claim_events(p_limit int default 100)
returns setof public.content_events
language sql
security definer
set search_path = ''
as $$
  update public.content_events e set handled_at = now()
  where e.id in (
    select id from public.content_events where handled_at is null order by id limit p_limit for update skip locked
  )
  returning e.*;
$$;

-- ---------------------------------------------------------------------------
-- Claude (content_api_*, secret key with p_actor): reads follow the rights
-- of the token owner, writes are suggestions only.
-- ---------------------------------------------------------------------------

create or replace function content_private.api_actor(p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' or p_actor is null then
    raise exception 'Only the API can act for a user' using errcode = '42501';
  end if;
  perform set_config('content.actor', p_actor::text, true);
  return p_actor;
end;
$$;

create or replace function public.content_api_role(p_workspace uuid, p_actor uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select content_private.role_in(p_workspace, p_actor); $$;

create or replace function public.content_api_can_view_post(p_post uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_view_post(p_post, p_actor); $$;

create or replace function public.content_api_can_view_media(p_media uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_view_media(p_media, p_actor); $$;

-- Description and tags for a file, shown as a suggestion.
create or replace function public.content_api_suggest_media(p_media uuid, p_suggestion jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  perform content_private.api_actor(p_actor);
  select workspace_id into v_ws from public.content_media where id = p_media;
  if not found or not content_private.can_view_media(p_media, p_actor) or not content_private.can_edit_media(v_ws, p_actor) then
    raise exception 'File not found' using errcode = '42501';
  end if;
  update public.content_media
  set suggested = (
        select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_suggestion, '{}'))
        as e(k, v) where k in ('description', 'tags', 'people', 'setting', 'mood', 'clothing', 'orientation', 'author_in_photo')
      ),
      suggested_at = now()
  where id = p_media;
end;
$$;

-- Up to three image suggestions for a post.
create or replace function public.content_api_suggest_images(p_post uuid, p_items jsonb, p_actor uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_n int := 0;
begin
  perform content_private.api_actor(p_actor);
  if not content_private.can_work_on_post(p_post, p_actor) then
    raise exception 'Post not found' using errcode = '42501';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    insert into public.content_image_suggestions (post_id, media_id, reason, score, suggested_by)
    values (p_post, (v_item ->> 'media_id')::uuid, left(v_item ->> 'reason', 500), (v_item ->> 'score')::int, 'claude');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- An image brief for a post, marked as written by Claude.
create or replace function public.content_api_suggest_image_brief(p_post uuid, p_brief jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform content_private.api_actor(p_actor);
  if not content_private.can_work_on_post(p_post, p_actor) then
    raise exception 'Post not found' using errcode = '42501';
  end if;
  if content_private.role_in((select workspace_id from public.content_posts where id = p_post), p_actor) = 'reviewer' then
    raise exception 'Image briefs are written for the author' using errcode = '42501';
  end if;
  -- Claude only fills an empty brief or replaces its own.
  update public.content_posts
  set image_brief = (
        select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_brief, '{}'))
        as e(k, v) where k in ('what', 'setting', 'mood', 'who', 'type', 'format')
      ),
      image_brief_by = 'claude',
      image_brief_done_at = null
  where id = p_post and (image_brief is null or image_brief_by = 'claude');
  if not found then
    raise exception 'This post already has a brief written by a person';
  end if;
end;
$$;

-- A text suggestion, decided by the author like any other.
create or replace function public.content_api_suggest_text(
  p_post uuid,
  p_field text,
  p_start int,
  p_original text,
  p_replacement text,
  p_note text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform content_private.api_actor(p_actor);
  if not content_private.can_work_on_post(p_post, p_actor) then
    raise exception 'Post not found' using errcode = '42501';
  end if;
  insert into public.content_suggestions (post_id, field, start_offset, original_text, replacement_text, note, suggested_by, author_id, base_version)
  values (p_post, p_field, p_start, coalesce(p_original, ''), coalesce(p_replacement, ''), p_note, 'claude', p_actor, 0)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema content_private from public, anon, authenticated;
grant execute on all functions in schema content_private to service_role;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'content_my_role(uuid)',
    'content_can_view_post(uuid)',
    'content_can_work_on_post(uuid)',
    'content_owns_post(uuid)',
    'content_can_view_idea(uuid)',
    'content_can_view_media(uuid)',
    'content_can_edit_media(uuid)',
    'content_has_any_role()',
    'content_ideas_to_post(uuid[], text)',
    'content_merge_ideas(uuid, uuid[])',
    'content_accept_suggestion(uuid)',
    'content_pick_image(uuid)',
    'content_restore_version(uuid, int)',
    'content_create_workspace(text, text, uuid)',
    'content_reviewer_counts(date)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;

  foreach v_fn in array array[
    'content_run_checks(timestamptz)',
    'content_claim_mail(int)',
    'content_finish_mail(bigint[], boolean)',
    'content_claim_events(int)',
    'content_api_role(uuid, uuid)',
    'content_api_can_view_post(uuid, uuid)',
    'content_api_can_view_media(uuid, uuid)',
    'content_api_suggest_media(uuid, jsonb, uuid)',
    'content_api_suggest_images(uuid, jsonb, uuid)',
    'content_api_suggest_image_brief(uuid, jsonb, uuid)',
    'content_api_suggest_text(uuid, text, int, text, text, text, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end;
$$;

-- The policies call content_private helpers through the public wrappers;
-- the profiles policy calls one directly, so signed-in users need it.
grant usage on schema content_private to authenticated;
revoke execute on all functions in schema content_private from authenticated;
grant execute on function content_private.shares_workspace(uuid, uuid) to authenticated;
grant execute on function content_private.current_actor() to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket "content" (media/<library>/..., ideas/<id>/...,
-- sources/<id>/...). The app serves files through signed URLs after RLS
-- allowed the row; signed-in users have no direct access to the bucket.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('content', 'content', false, 104857600)
on conflict (id) do nothing;
