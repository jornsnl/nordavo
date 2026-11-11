-- Content, round two (feedback Julius, 11 November 2026):
--
-- 1. The reviewer (Sabine) edits the text directly instead of suggesting,
--    approves posts herself, may polish an approved post without it falling
--    back, sees the ideas of the workspaces she reviews and turns them into
--    posts. What she changed stays visible: every edit is a version with her
--    name, and the activity log below.
-- 2. Claude does everything in Content itself (content_api_*): posts with all
--    fields and the status, archiving, media on a post and in the library,
--    results (as often as wanted) and ideas. Suggestions stay for when
--    Claude wants to propose something.
-- 3. An activity log for Content (content_activity): every change to posts,
--    ideas, chosen media, media and results, with who and the source (user
--    or claude), so Claude's changes are told apart from Sabine's and
--    Julius'.
-- 4. Posts can be archived (not deleted), and a publication date can be set
--    for posts that went live elsewhere (the Airtable move).
--
-- "Admin approval required" stays as it was: then only an admin approves,
-- and an edit after approval by anyone but the author sends the post back.

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------

alter table public.content_posts
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null;

create index content_posts_live_idx on public.content_posts (workspace_id, status) where archived_at is null;

alter table public.content_post_versions
  add column source text not null default 'user' check (source in ('user', 'claude'));
alter table public.content_status_log
  add column source text not null default 'user' check (source in ('user', 'claude'));

-- Files Claude puts in the library from a link.
alter table public.content_media drop constraint if exists content_media_source_check;
alter table public.content_media add constraint content_media_source_check check (source in ('upload', 'drive', 'link'));
alter table public.content_media add column source_url text check (char_length(source_url) <= 2000);

-- Results as often as wanted (the 48 hour and 7 day slots stay for the
-- success threshold, the dashboard and Measured).
create table public.content_measurements (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.content_posts (id) on delete cascade,
  measured_at timestamptz not null default now(),
  impressions int check (impressions >= 0),
  likes int not null default 0 check (likes >= 0),
  comments int not null default 0 check (comments >= 0),
  reposts int not null default 0 check (reposts >= 0),
  entered_by uuid references public.profiles (id) on delete set null,
  source text not null default 'user' check (source in ('user', 'claude')),
  created_at timestamptz not null default now()
);

create index content_measurements_post_idx on public.content_measurements (post_id, measured_at);

create table public.content_activity (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.content_workspaces (id) on delete cascade,
  post_id uuid references public.content_posts (id) on delete cascade,
  idea_id uuid references public.content_ideas (id) on delete cascade,
  media_id uuid references public.content_media (id) on delete cascade,
  action text not null check (char_length(action) <= 60),
  details jsonb not null default '{}',
  actor_id uuid references public.profiles (id) on delete set null,
  source text not null default 'user' check (source in ('user', 'claude', 'system')),
  created_at timestamptz not null default now()
);

create index content_activity_post_idx on public.content_activity (post_id, created_at desc) where post_id is not null;
create index content_activity_idea_idx on public.content_activity (idea_id, created_at desc) where idea_id is not null;
create index content_activity_workspace_idx on public.content_activity (workspace_id, created_at desc);

alter table public.content_measurements enable row level security;
alter table public.content_activity enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Who did it: the actor and the source
-- ---------------------------------------------------------------------------

create or replace function content_private.current_source()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when current_setting('content.source', true) = 'claude' then 'claude'
    when content_private.current_actor() is null then 'system'
    else 'user'
  end;
$$;

-- Same as 20261120000000, plus the source: everything through the API is Claude.
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
  perform set_config('content.source', 'claude', true);
  return p_actor;
end;
$$;

create or replace function content_private.log(
  p_workspace uuid,
  p_action text,
  p_details jsonb,
  p_post uuid default null,
  p_idea uuid default null,
  p_media uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.content_activity (workspace_id, post_id, idea_id, media_id, action, details, actor_id, source)
  values (p_workspace, p_post, p_idea, p_media, p_action, coalesce(p_details, '{}'), content_private.current_actor(),
          content_private.current_source());
$$;

-- ---------------------------------------------------------------------------
-- 3. Reviewers: posts they made, ideas, approving
-- ---------------------------------------------------------------------------

-- Reviewers see posts that went to review, and the posts they made themselves.
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
      when 'reviewer' then p.submitted_at is not null or p.created_by = p_user
      else false
    end
    from public.content_posts p
    where p.id = p_post
  ), false);
$$;

-- Reviewers see every idea of the workspaces they review.
create or replace function content_private.can_view_idea(p_idea uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when content_private.role_in(i.workspace_id, p_user) in ('admin', 'reviewer') then true
      when content_private.role_in(i.workspace_id, p_user) is null then false
      when i.author_id = p_user then true
      else not i.is_private
    end
    from public.content_ideas i where i.id = p_idea
  ), false);
$$;

drop policy "Content posts are visible to who may see them" on public.content_posts;
create policy "Content posts are visible to who may see them"
  on public.content_posts for select to authenticated
  using (
    public.content_my_role(workspace_id) in ('admin', 'author', 'viewer')
    or ((submitted_at is not null or created_by = (select auth.uid())) and public.content_my_role(workspace_id) = 'reviewer')
  );
drop policy "Content posts are added by the author" on public.content_posts;
create policy "Content posts are added by writers"
  on public.content_posts for insert to authenticated
  with check (public.content_my_role(workspace_id) in ('admin', 'author', 'reviewer'));

drop policy "Content ideas are visible to who may see them" on public.content_ideas;
create policy "Content ideas are visible to who may see them"
  on public.content_ideas for select to authenticated
  using (
    public.content_my_role(workspace_id) in ('admin', 'reviewer')
    or (author_id = (select auth.uid()) and public.content_my_role(workspace_id) is not null)
    or (not is_private and public.content_my_role(workspace_id) in ('author', 'viewer'))
  );
drop policy "Content ideas are changed by their author" on public.content_ideas;
create policy "Content ideas are changed by their author or the reviewer"
  on public.content_ideas for update to authenticated
  using (author_id = (select auth.uid()) or public.content_my_role(workspace_id) in ('admin', 'reviewer'))
  with check (public.content_my_role(workspace_id) in ('admin', 'author', 'reviewer'));

drop policy "Idea links are made by the idea's author" on public.content_idea_posts;
create policy "Idea links are made by the idea's author or the reviewer"
  on public.content_idea_posts for insert to authenticated
  with check (
    exists (select 1 from public.content_ideas i where i.id = idea_id
            and (i.author_id = (select auth.uid()) or public.content_my_role(i.workspace_id) in ('admin', 'reviewer')))
    and exists (select 1 from public.content_posts p join public.content_ideas i on i.workspace_id = p.workspace_id
                where p.id = post_id and i.id = idea_id and public.content_my_role(p.workspace_id) in ('admin', 'author', 'reviewer'))
  );

-- The reviewer may approve (the status list in Settings decides; this sets
-- the default and the existing workspaces once).
update public.content_statuses
set allowed_roles = array_append(allowed_roles, 'reviewer')
where key = 'approved' and is_core and not ('reviewer' = any (allowed_roles));

create or replace function content_private.after_workspace_seed_reviewer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'approved' and new.is_core and not ('reviewer' = any (new.allowed_roles))
     and current_setting('content.seeding', true) = 'on' then
    new.allowed_roles := array_append(new.allowed_roles, 'reviewer');
  end if;
  return new;
end;
$$;

-- New workspaces get it too (seed_workspace inserts with content.seeding on).
create trigger content_statuses_seed_reviewer before insert on public.content_statuses
  for each row execute function content_private.after_workspace_seed_reviewer();

-- Posts by a reviewer belong to the workspace owner, like Claude's.
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
    if v_role is null or v_role not in ('admin', 'author', 'reviewer') then
      raise exception 'Only the author or the reviewer of this workspace can add posts' using errcode = '42501';
    end if;
    new.created_by := v_actor;
    if v_role <> 'admin' or new.author_id is null then
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
  new.archived_at := null;
  new.archived_by := null;
  return new;
end;
$$;

-- Same rules as 20261120000000, with these changes:
--   * the reviewer edits text and fields directly;
--   * the reviewer approves (unless admin approval is required);
--   * an edit after approval by the reviewer keeps the approval (unless admin
--     approval is required); the author never sent it back, anyone else still does;
--   * a publication date may be given for a published post (not in the future);
--   * archiving sets archived_at and archived_by.
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
  v_can_approve boolean;
  v_published_at timestamptz := new.published_at;
begin
  v_role := case when v_actor is null then 'system' else content_private.role_in(old.workspace_id, v_actor) end;
  if v_role is null or v_role = 'viewer' then
    raise exception 'You cannot change this post' using errcode = '42501';
  end if;
  if v_role = 'reviewer' and old.submitted_at is null and old.created_by is distinct from v_actor then
    raise exception 'You cannot change this post' using errcode = '42501';
  end if;

  if new.workspace_id <> old.workspace_id then
    raise exception 'A post cannot move to another workspace';
  end if;
  if new.author_id is distinct from old.author_id and v_role not in ('admin', 'system') then
    raise exception 'Only an admin can change the author';
  end if;
  select * into v_ws from public.content_workspaces where id = old.workspace_id;
  -- The reviewer may polish an approved post without a new approval, unless
  -- an admin has to approve. Anyone else but the author still sends it back.
  v_can_approve := v_role = 'system' or (v_role = 'reviewer' and not v_ws.admin_approval_required);

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
  if new.archived_at is distinct from old.archived_at then
    new.archived_at := case when new.archived_at is null then null else coalesce(old.archived_at, now()) end;
    new.archived_by := case when new.archived_at is null then null else v_actor end;
  else
    new.archived_by := old.archived_by;
  end if;

  v_text_changed := (new.title, new.hook, new.body, new.closing_question, new.first_comment)
    is distinct from (old.title, old.hook, old.body, old.closing_question, old.first_comment);

  if v_text_changed then
    new.version := old.version + 1;
    -- Someone who could not approve it edits an approved text: back for approval.
    if v_role <> 'system' and v_actor is distinct from old.author_id and not v_can_approve
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

    if new.status = 'approved' then
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
      new.published_at := coalesce(
        case when v_published_at is distinct from old.published_at and v_published_at <= now() then v_published_at end,
        old.published_at,
        now()
      );
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
  elsif v_published_at is distinct from old.published_at and old.published_at is not null
        and v_published_at is not null and v_published_at <= now() then
    -- Correcting when a live post went out.
    new.published_at := v_published_at;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Versions and the status log name the source; the activity log
-- ---------------------------------------------------------------------------

create or replace function content_private.source_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.source := case when content_private.current_source() = 'claude' then 'claude' else 'user' end;
  return new;
end;
$$;

create trigger content_post_versions_source before insert on public.content_post_versions
  for each row execute function content_private.source_on_insert();
create trigger content_status_log_source before insert on public.content_status_log
  for each row execute function content_private.source_on_insert();
create trigger content_measurements_source before insert on public.content_measurements
  for each row execute function content_private.source_on_insert();

create or replace function content_private.log_post_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
  v_key text;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'INSERT' then
    perform content_private.log(new.workspace_id, 'post_created', jsonb_build_object('title', new.title), new.id);
    return null;
  end if;
  v_new := to_jsonb(new);
  v_old := to_jsonb(old);
  foreach v_key in array array[
    'title', 'hook', 'body', 'closing_question', 'first_comment', 'channel', 'language', 'planned_date', 'time_slot',
    'audience', 'theme', 'angle', 'format', 'series_id', 'source_id', 'priority', 'notes', 'linkedin_url',
    'custom_fields', 'image_brief', 'published_at', 'author_id'
  ] loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      v_changed := array_append(v_changed, v_key);
    end if;
  end loop;
  if array_length(v_changed, 1) > 0 then
    perform content_private.log(new.workspace_id, 'post_edited',
      jsonb_build_object('fields', to_jsonb(v_changed), 'version', new.version), new.id);
  end if;
  if new.status is distinct from old.status then
    perform content_private.log(new.workspace_id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status), new.id);
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform content_private.log(new.workspace_id, case when new.archived_at is null then 'post_restored' else 'post_archived' end, '{}', new.id);
  end if;
  return null;
end;
$$;

create trigger content_posts_activity after insert or update on public.content_posts
  for each row execute function content_private.log_post_activity();

create or replace function content_private.log_idea_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform content_private.log(new.workspace_id, 'idea_created', jsonb_build_object('text', left(new.text, 120)), null, new.id);
  elsif new.status is distinct from old.status then
    perform content_private.log(new.workspace_id, 'idea_' || new.status, '{}', null, new.id);
  elsif (new.text, new.tags, new.link, new.is_private) is distinct from (old.text, old.tags, old.link, old.is_private) then
    perform content_private.log(new.workspace_id, 'idea_edited', '{}', null, new.id);
  end if;
  return null;
end;
$$;

create trigger content_ideas_activity after insert or update on public.content_ideas
  for each row execute function content_private.log_idea_activity();

create or replace function content_private.log_post_media_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.content_post_media := case when tg_op = 'DELETE' then old else new end;
  v_ws uuid;
begin
  select workspace_id into v_ws from public.content_posts where id = v_row.post_id;
  if v_ws is null then
    return null;
  end if;
  perform content_private.log(v_ws,
    case tg_op when 'INSERT' then 'media_added' when 'DELETE' then 'media_removed' else 'media_reordered' end,
    jsonb_build_object('position', v_row.position), v_row.post_id, null, v_row.media_id);
  return null;
end;
$$;

create trigger content_post_media_activity after insert or delete or update of position on public.content_post_media
  for each row execute function content_private.log_post_media_activity();

create or replace function content_private.log_media_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform content_private.log(new.workspace_id, 'file_added', jsonb_build_object('file', new.file_name, 'via', new.source), null, null, new.id);
  elsif (new.description, new.tags, new.people, new.setting, new.mood, new.clothing, new.orientation, new.do_not_use)
        is distinct from (old.description, old.tags, old.people, old.setting, old.mood, old.clothing, old.orientation, old.do_not_use) then
    perform content_private.log(new.workspace_id, 'file_described', '{}', null, null, new.id);
  end if;
  return null;
end;
$$;

create trigger content_media_activity after insert or update on public.content_media
  for each row execute function content_private.log_media_activity();

create or replace function content_private.log_result_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.content_posts where id = new.post_id;
  perform content_private.log(v_ws, 'results_entered',
    jsonb_build_object('impressions', new.impressions, 'likes', new.likes, 'comments', new.comments, 'reposts', new.reposts,
      'slot', case when tg_table_name = 'content_results' then to_jsonb(new) ->> 'measured_after' end),
    new.post_id);
  return null;
end;
$$;

create trigger content_results_activity after insert or update on public.content_results
  for each row execute function content_private.log_result_activity();
create trigger content_measurements_activity after insert on public.content_measurements
  for each row execute function content_private.log_result_activity();

create or replace function content_private.before_measurement_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if content_private.current_actor() is not null then
    new.entered_by := content_private.current_actor();
  end if;
  if new.measured_at > now() + interval '5 minutes' then
    raise exception 'A measurement cannot be in the future';
  end if;
  if not exists (select 1 from public.content_posts p where p.id = new.post_id and p.published_at is not null) then
    raise exception 'Results can be filled in once the post is published';
  end if;
  return new;
end;
$$;

create trigger content_measurements_before_insert before insert on public.content_measurements
  for each row execute function content_private.before_measurement_insert();

create policy "Measurements follow their post"
  on public.content_measurements for select to authenticated using (public.content_can_view_post(post_id));
create policy "Measurements are entered by writers"
  on public.content_measurements for insert to authenticated with check (public.content_can_work_on_post(post_id));

create policy "Content activity follows its record"
  on public.content_activity for select to authenticated
  using (
    case
      when post_id is not null then public.content_can_view_post(post_id)
      when idea_id is not null then public.content_can_view_idea(idea_id)
      when media_id is not null then public.content_can_view_media(media_id)
      else public.content_my_role(workspace_id) in ('admin', 'author')
    end
  );

grant select on public.content_activity to authenticated;
grant select, insert on public.content_measurements to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Claude writes (content_api_*, secret key, p_actor = the token owner)
-- ---------------------------------------------------------------------------
--
-- Every function acts as the token owner with source claude, so the same
-- RLS-equivalent checks, triggers, status rules and logs apply as in the
-- app. Nothing here deletes.

create or replace function public.content_api_can_view_idea(p_idea uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select content_private.can_view_idea(p_idea, p_actor); $$;

-- The fields of a post Claude may write, from a json object.
create or replace function content_private.apply_post_fields(p_post uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_fields, '{}');
begin
  update public.content_posts p set
    title = coalesce(nullif(trim(f ->> 'title'), ''), p.title),
    hook = case when f ? 'hook' then coalesce(f ->> 'hook', '') else p.hook end,
    body = case when f ? 'body' then coalesce(f ->> 'body', '') else p.body end,
    closing_question = case when f ? 'closing_question' then coalesce(f ->> 'closing_question', '') else p.closing_question end,
    first_comment = case when f ? 'first_comment' then coalesce(f ->> 'first_comment', '') else p.first_comment end,
    channel = coalesce(nullif(f ->> 'channel', ''), p.channel),
    language = case when f ? 'language' then nullif(f ->> 'language', '') else p.language end,
    audience = case when f ? 'audience' then nullif(f ->> 'audience', '') else p.audience end,
    theme = case when f ? 'theme' then nullif(f ->> 'theme', '') else p.theme end,
    angle = case when f ? 'angle' then nullif(f ->> 'angle', '') else p.angle end,
    format = case when f ? 'format' then nullif(f ->> 'format', '') else p.format end,
    priority = case when f ? 'priority' then nullif(f ->> 'priority', '') else p.priority end,
    planned_date = case when f ? 'planned_date' then nullif(f ->> 'planned_date', '')::date else p.planned_date end,
    time_slot = case when f ? 'time_slot' then nullif(f ->> 'time_slot', '') else p.time_slot end,
    series_id = case when f ? 'series_id' then nullif(f ->> 'series_id', '')::uuid else p.series_id end,
    source_id = case when f ? 'source_id' then nullif(f ->> 'source_id', '')::uuid else p.source_id end,
    notes = case when f ? 'notes' then nullif(f ->> 'notes', '') else p.notes end,
    linkedin_url = case when f ? 'linkedin_url' then nullif(f ->> 'linkedin_url', '') else p.linkedin_url end,
    published_at = case when f ? 'published_at' then nullif(f ->> 'published_at', '')::timestamptz else p.published_at end
  where p.id = p_post;
end;
$$;

-- The steps from one status to another along the built-in flow.
create or replace function content_private.status_path(p_from text, p_to text, p_has_slot boolean)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then '{}'::text[]
    when p_to in ('parked', 'rejected', 'draft') then array[p_to]
    when p_to = 'in_review' then array['in_review']
    when p_to = 'changes_requested' then
      case when p_from = 'draft' then array['in_review', 'changes_requested'] else array['changes_requested'] end
    when p_to = 'approved' then
      case when p_from in ('draft', 'parked', 'rejected') then array['in_review', 'approved'] else array['approved'] end
    when p_to = 'scheduled' then
      (case when p_from in ('draft', 'parked', 'rejected', 'in_review', 'changes_requested')
        then case when p_from in ('in_review', 'changes_requested') then array['approved'] else array['in_review', 'approved'] end
        else '{}'::text[] end) || array['scheduled']
    when p_to = 'published' then
      (case when p_from in ('draft', 'parked', 'rejected') then array['in_review', 'approved']
            when p_from in ('in_review', 'changes_requested') then array['approved']
            else '{}'::text[] end)
      || (case when p_from <> 'scheduled' and p_has_slot then array['scheduled'] else '{}'::text[] end)
      || array['published']
    when p_to = 'measured' then
      (case when p_from not in ('published') then array['published'] else '{}'::text[] end) || array['measured']
    else array[p_to]
  end;
$$;

create or replace function content_private.walk_status(p_post uuid, p_to text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.content_posts;
  v_step text;
begin
  select * into v_post from public.content_posts where id = p_post;
  if p_to is null or p_to = v_post.status then
    return;
  end if;
  -- Custom statuses are one step; the built-in ones go along the flow, so the
  -- rules (approval before scheduled or published) hold for admins too.
  if not exists (select 1 from public.content_statuses where workspace_id = v_post.workspace_id and key = p_to and is_core) then
    update public.content_posts set status = p_to where id = p_post;
    return;
  end if;
  foreach v_step in array content_private.status_path(v_post.status, p_to, v_post.planned_date is not null and v_post.time_slot is not null) loop
    update public.content_posts set status = v_step where id = p_post;
  end loop;
end;
$$;

-- A new post with every field, also one that is already live (status
-- published with linkedin_url and published_at). Returns the post id.
create or replace function public.content_api_create_post(p_workspace uuid, p_fields jsonb, p_status text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
  v_status text := coalesce(nullif(p_status, ''), 'draft');
begin
  perform content_private.api_actor(p_actor);
  v_role := content_private.role_in(p_workspace, p_actor);
  if v_role is null or v_role not in ('admin', 'author', 'reviewer') then
    raise exception 'Workspace not found' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_fields ->> 'title', ''))) = 0 then
    raise exception 'A post needs a title';
  end if;
  insert into public.content_posts (workspace_id, title) values (p_workspace, left(trim(p_fields ->> 'title'), 300))
  returning id into v_id;
  -- The published date is applied when the post reaches published.
  perform content_private.apply_post_fields(v_id, p_fields - 'published_at');
  perform content_private.walk_status_with_date(v_id, v_status, p_actor, p_fields ->> 'published_at');
  return v_id;
end;
$$;

-- walk_status, then a given publication date on the published post.
create or replace function content_private.walk_status_with_date(p_post uuid, p_to text, p_actor uuid, p_published_at text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_to in ('published', 'measured') and nullif(p_published_at, '') is not null then
    -- Publish with the date (the trigger keeps a date that is not in the future).
    perform content_private.walk_status(p_post, 'published', p_actor);
    update public.content_posts set published_at = p_published_at::timestamptz where id = p_post;
    if p_to = 'measured' then
      perform content_private.walk_status(p_post, 'measured', p_actor);
    end if;
  else
    perform content_private.walk_status(p_post, p_to, p_actor);
  end if;
end;
$$;

-- Change any field of a post, and the status (along the flow when needed).
create or replace function public.content_api_update_post(p_post uuid, p_fields jsonb, p_status text, p_actor uuid)
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
  if exists (select 1 from public.content_posts where id = p_post and archived_at is not null) then
    raise exception 'This post is archived. Restore it first.';
  end if;
  perform content_private.apply_post_fields(p_post, coalesce(p_fields, '{}') - 'published_at');
  if nullif(p_status, '') is not null then
    perform content_private.walk_status_with_date(p_post, p_status, p_actor, p_fields ->> 'published_at');
  elsif p_fields ? 'published_at' then
    update public.content_posts set published_at = nullif(p_fields ->> 'published_at', '')::timestamptz where id = p_post;
  end if;
end;
$$;

create or replace function public.content_api_archive_post(p_post uuid, p_archived boolean, p_actor uuid)
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
  update public.content_posts set archived_at = case when p_archived then now() else null end where id = p_post;
end;
$$;

-- The chosen media of a post, in this order (replaces the choice).
create or replace function public.content_api_set_post_media(p_post uuid, p_media uuid[], p_actor uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media uuid;
  v_i int := 0;
begin
  perform content_private.api_actor(p_actor);
  if not content_private.can_work_on_post(p_post, p_actor) then
    raise exception 'Post not found' using errcode = '42501';
  end if;
  if (select count(*) from unnest(coalesce(p_media, '{}')) m) <> (select count(distinct m) from unnest(coalesce(p_media, '{}')) m) then
    raise exception 'A file can be chosen once';
  end if;
  foreach v_media in array coalesce(p_media, '{}') loop
    if not content_private.can_view_media(v_media, p_actor) then
      raise exception 'File % not found', v_media using errcode = '42501';
    end if;
  end loop;
  delete from public.content_post_media where post_id = p_post and not (media_id = any (coalesce(p_media, '{}')));
  foreach v_media in array coalesce(p_media, '{}') loop
    insert into public.content_post_media (post_id, media_id, position) values (p_post, v_media, v_i)
    on conflict (post_id, media_id) do update set position = excluded.position;
    v_i := v_i + 1;
  end loop;
  return v_i;
end;
$$;

-- A file the app already stored in the bucket, as a library row.
create or replace function public.content_api_add_media(
  p_workspace uuid,
  p_path text,
  p_file_name text,
  p_mime text,
  p_size bigint,
  p_details jsonb,
  p_source_url text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  d jsonb := coalesce(p_details, '{}');
begin
  perform content_private.api_actor(p_actor);
  if not content_private.can_edit_media(p_workspace, p_actor) then
    raise exception 'Library not found' using errcode = '42501';
  end if;
  if p_path is null or p_path like '%..%'
     or p_path not like ('media/' || coalesce(p_workspace::text, 'company') || '/%') then
    raise exception 'Invalid path';
  end if;
  insert into public.content_media (workspace_id, storage_path, file_name, mime_type, size_bytes, source, source_url,
    description, tags, people, setting, mood, clothing, orientation, folder, uploaded_by)
  values (
    p_workspace, p_path, left(p_file_name, 255), p_mime, p_size, 'link', nullif(p_source_url, ''),
    nullif(left(d ->> 'description', 2000), ''),
    coalesce((select array_agg(distinct lower(trim(t))) from jsonb_array_elements_text(coalesce(d -> 'tags', '[]')) t where trim(t) <> ''), '{}'),
    coalesce((select array_agg(trim(t)) from jsonb_array_elements_text(coalesce(d -> 'people', '[]')) t where trim(t) <> ''), '{}'),
    nullif(left(d ->> 'setting', 200), ''),
    nullif(left(d ->> 'mood', 200), ''),
    nullif(left(d ->> 'clothing', 200), ''),
    case when d ->> 'orientation' in ('portrait', 'landscape', 'square') then d ->> 'orientation' end,
    nullif(left(d ->> 'folder', 300), ''),
    p_actor
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Description and tags of a file, written directly (not as a suggestion).
create or replace function public.content_api_describe_media(p_media uuid, p_details jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  d jsonb := coalesce(p_details, '{}');
begin
  perform content_private.api_actor(p_actor);
  select workspace_id into v_ws from public.content_media where id = p_media;
  if not found or not content_private.can_view_media(p_media, p_actor) or not content_private.can_edit_media(v_ws, p_actor) then
    raise exception 'File not found' using errcode = '42501';
  end if;
  update public.content_media m set
    description = case when d ? 'description' then nullif(left(d ->> 'description', 2000), '') else m.description end,
    tags = case when d ? 'tags' then coalesce((select array_agg(distinct lower(trim(t))) from jsonb_array_elements_text(d -> 'tags') t where trim(t) <> ''), '{}') else m.tags end,
    people = case when d ? 'people' then coalesce((select array_agg(trim(t)) from jsonb_array_elements_text(d -> 'people') t where trim(t) <> ''), '{}') else m.people end,
    setting = case when d ? 'setting' then nullif(left(d ->> 'setting', 200), '') else m.setting end,
    mood = case when d ? 'mood' then nullif(left(d ->> 'mood', 200), '') else m.mood end,
    clothing = case when d ? 'clothing' then nullif(left(d ->> 'clothing', 200), '') else m.clothing end,
    orientation = case when d ? 'orientation' and d ->> 'orientation' in ('portrait', 'landscape', 'square') then d ->> 'orientation' else m.orientation end,
    author_in_photo = case when d ? 'author_in_photo' then (d ->> 'author_in_photo')::boolean else m.author_in_photo end
  where m.id = p_media;
end;
$$;

-- Results of a live post, as often as wanted. With a LinkedIn URL and an
-- approved post that is not live yet, the post becomes published first
-- (with published_at when given). p_slot also fills the 48 hour or 7 day
-- slot that the dashboard and Measured use.
create or replace function public.content_api_record_results(
  p_post uuid,
  p_measured_at timestamptz,
  p_impressions int,
  p_likes int,
  p_comments int,
  p_reposts int,
  p_slot text,
  p_linkedin_url text,
  p_published_at timestamptz,
  p_actor uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.content_posts;
  v_id bigint;
begin
  perform content_private.api_actor(p_actor);
  if not content_private.can_work_on_post(p_post, p_actor) then
    raise exception 'Post not found' using errcode = '42501';
  end if;
  if p_slot is not null and p_slot not in ('48h', '7d') then
    raise exception 'slot is 48h or 7d';
  end if;
  if nullif(p_linkedin_url, '') is not null then
    update public.content_posts set linkedin_url = p_linkedin_url where id = p_post and linkedin_url is distinct from p_linkedin_url;
  end if;
  select * into v_post from public.content_posts where id = p_post;
  if v_post.published_at is null then
    perform content_private.walk_status_with_date(p_post, 'published', p_actor, p_published_at::text);
  elsif p_published_at is not null and p_published_at is distinct from v_post.published_at then
    update public.content_posts set published_at = p_published_at where id = p_post;
  end if;

  insert into public.content_measurements (post_id, measured_at, impressions, likes, comments, reposts)
  values (p_post, coalesce(p_measured_at, now()), p_impressions, coalesce(p_likes, 0), coalesce(p_comments, 0), coalesce(p_reposts, 0))
  returning id into v_id;

  if p_slot is not null then
    insert into public.content_results (post_id, measured_after, impressions, likes, comments, reposts)
    values (p_post, p_slot, p_impressions, coalesce(p_likes, 0), coalesce(p_comments, 0), coalesce(p_reposts, 0))
    on conflict (post_id, measured_after) do update
    set impressions = excluded.impressions, likes = excluded.likes, comments = excluded.comments, reposts = excluded.reposts;
  end if;
  return v_id;
end;
$$;

-- An idea in a workspace (Claude is its author's helper: the idea is the token owner's).
create or replace function public.content_api_add_idea(p_workspace uuid, p_text text, p_tags text[], p_link text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform content_private.api_actor(p_actor);
  if content_private.role_in(p_workspace, p_actor) not in ('admin', 'author', 'reviewer') then
    raise exception 'Workspace not found' using errcode = '42501';
  end if;
  insert into public.content_ideas (workspace_id, text, tags, link)
  values (p_workspace, left(trim(p_text), 5000), coalesce(p_tags, '{}'), nullif(left(trim(coalesce(p_link, '')), 2000), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Turn ideas into a post (like the button), as the token owner.
create or replace function public.content_api_ideas_to_post(p_ideas uuid[], p_title text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idea uuid;
  v_ws uuid;
  v_text text;
  v_post uuid;
begin
  perform content_private.api_actor(p_actor);
  foreach v_idea in array coalesce(p_ideas, '{}') loop
    if not content_private.can_view_idea(v_idea, p_actor) then
      raise exception 'Idea not found' using errcode = '42501';
    end if;
  end loop;
  if coalesce(array_length(p_ideas, 1), 0) = 0
     or (select count(distinct workspace_id) from public.content_ideas where id = any (p_ideas)) <> 1 then
    raise exception 'Pick ideas of one workspace';
  end if;
  select min(workspace_id::text)::uuid, string_agg(text, E'\n\n' order by created_at) into v_ws, v_text
  from public.content_ideas where id = any (p_ideas);
  if content_private.role_in(v_ws, p_actor) not in ('admin', 'author', 'reviewer') then
    raise exception 'Workspace not found' using errcode = '42501';
  end if;
  insert into public.content_posts (workspace_id, title, body, source_id)
  values (v_ws, coalesce(nullif(trim(p_title), ''), left(split_part(v_text, E'\n', 1), 120)), v_text,
          (select source_id from public.content_ideas where id = any (p_ideas) and source_id is not null limit 1))
  returning id into v_post;
  insert into public.content_idea_posts (idea_id, post_id) select unnest(p_ideas), v_post on conflict do nothing;
  update public.content_ideas set status = 'converted' where id = any (p_ideas);
  return v_post;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Archived posts leave the hourly checks (same as 20261120000000 otherwise)
-- ---------------------------------------------------------------------------

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
    join public.content_workspaces w on w.id = p.workspace_id and w.archived_at is null and p.archived_at is null
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
    join public.content_workspaces w on w.id = p.workspace_id and w.archived_at is null and p.archived_at is null
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
    join public.content_workspaces w on w.id = p.workspace_id and w.archived_at is null and p.archived_at is null
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
      (select count(*) from public.content_posts p where p.workspace_id = w.id and p.archived_at is null and p.status in ('approved', 'scheduled')) as buffer,
      (select count(*) from public.content_posts p where p.workspace_id = w.id and p.archived_at is null
         and p.planned_date >= v_week_start and p.planned_date < v_week_start + 7
         and p.status not in ('parked', 'rejected')) as this_week,
      (select count(*) from public.content_posts p where p.workspace_id = w.id and p.archived_at is null
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


-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema content_private from public, anon, authenticated;
grant execute on all functions in schema content_private to service_role;
-- As in 20261120000000: the profiles policy and the triggers need these.
grant execute on function content_private.shares_workspace(uuid, uuid) to authenticated;
grant execute on function content_private.current_actor() to authenticated;
grant execute on function content_private.current_source() to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'content_api_can_view_idea(uuid, uuid)',
    'content_api_create_post(uuid, jsonb, text, uuid)',
    'content_api_update_post(uuid, jsonb, text, uuid)',
    'content_api_archive_post(uuid, boolean, uuid)',
    'content_api_set_post_media(uuid, uuid[], uuid)',
    'content_api_add_media(uuid, text, text, text, bigint, jsonb, text, uuid)',
    'content_api_describe_media(uuid, jsonb, uuid)',
    'content_api_record_results(uuid, timestamptz, int, int, int, int, text, text, timestamptz, uuid)',
    'content_api_add_idea(uuid, text, text[], text, uuid)',
    'content_api_ideas_to_post(uuid[], text, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end;
$$;
