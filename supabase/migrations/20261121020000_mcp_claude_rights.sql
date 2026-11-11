-- What Claude may do through the MCP (feedback Julius, 11 November 2026).
--
-- 1. Per module an admin decides how far Claude may write: read (nothing),
--    suggest (drafts and suggestions only) or write (everything the token
--    owner may do). A module without a row is "suggest": every new module
--    comes with a Claude connection to read, draft and suggest, and an admin
--    opens up writing. The modules that already had write tools keep them.
-- 2. Meetings: status (held, approved, rejected, no show, cancelled) with a
--    reason or note, and the fee, in the name of the token owner.
-- 3. Work tasks for the MCP can be filtered on workspace and project.

-- ---------------------------------------------------------------------------
-- 1. Claude's rights per module
-- ---------------------------------------------------------------------------

create table public.mcp_module_access (
  module text primary key check (module ~ '^[a-z][a-z_]{1,39}$'),
  level text not null check (level in ('read', 'suggest', 'write')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.mcp_module_access (module, level) values
  ('work', 'write'),
  ('sales', 'write'),
  ('recruitment', 'write'),
  ('academy', 'write'),
  ('content', 'write'),
  ('records', 'write');

alter table public.mcp_module_access enable row level security;

create policy "Claude's rights are visible to the team"
  on public.mcp_module_access for select to authenticated
  using (public.is_staff());
create policy "Claude's rights are set by admins"
  on public.mcp_module_access for insert to authenticated with check (public.is_admin());
create policy "Claude's rights are changed by admins"
  on public.mcp_module_access for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.mcp_module_access to authenticated;

create or replace function public.mcp_module_access_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

revoke execute on function public.mcp_module_access_stamp() from public, anon, authenticated;

create trigger mcp_module_access_stamp before insert or update on public.mcp_module_access
  for each row execute function public.mcp_module_access_stamp();

-- ---------------------------------------------------------------------------
-- 2. Meetings: status, note and fee from the MCP
-- ---------------------------------------------------------------------------
--
-- The same as the Meetings register in the portal (setMeetingStatus,
-- updateMeetingFee): approving, rejecting and the fee are for admins, the
-- company follows the meeting through meetings_after_change, and every
-- change is in Activities as the token owner with source claude. A note goes
-- on the meeting and on the activity of the status change.

create or replace function public.sales_update_meeting(
  p_meeting uuid,
  p_status text default null,
  p_fee numeric default null,
  p_note text default null,
  p_actor uuid default null
)
returns public.meetings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'claude');
  v_old public.meetings;
  v_new public.meetings;
  v_admin boolean;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_old from public.meetings where id = p_meeting for update;
  if v_old.id is null then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;
  v_admin := exists (select 1 from public.profiles where id = v_uid and role = 'admin');
  if p_status is not null and p_status not in ('planned', 'held', 'approved', 'rejected', 'no_show', 'cancelled') then
    raise exception 'Unknown meeting status';
  end if;
  if p_status is not null and p_status is distinct from v_old.status
     and (p_status in ('approved', 'rejected') or v_old.status in ('approved', 'rejected')) and not v_admin then
    raise exception 'Only an admin approves or rejects a meeting' using errcode = '42501';
  end if;
  if p_fee is not null and p_fee is distinct from v_old.fee and not v_admin then
    raise exception 'Only an admin changes the fee of a meeting' using errcode = '42501';
  end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 10000) then
    raise exception 'The fee is between 0 and 10,000';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'A note is at most 2000 characters';
  end if;

  update public.meetings
  set status = coalesce(p_status, status),
      fee = coalesce(p_fee, fee),
      notes = case
        when v_note is null then notes
        else left(concat_ws(E'\n', notes, to_char(now() at time zone 'Europe/Amsterdam', 'YYYY-MM-DD') || ': ' || v_note), 5000)
      end
  where id = p_meeting
  returning * into v_new;

  if v_note is not null then
    -- The activity of this status change (meetings_after_change) gets the note;
    -- without a status change the note is an activity of its own.
    if p_status is not null and p_status is distinct from v_old.status then
      update public.activities set notes = v_note
      where id = (
        select a.id from public.activities a
        where a.meeting_id = p_meeting and a.created_at >= now() and a.notes is null
          and a.outcome = case p_status
            when 'held' then 'meeting_held'
            when 'approved' then 'afspraak_goedgekeurd'
            when 'rejected' then 'afspraak_afgekeurd'
            when 'no_show' then 'meeting_no_show'
            when 'cancelled' then 'meeting_cancelled'
          end
        order by a.created_at desc limit 1
      );
    else
      insert into public.activities (company_id, contact_id, channel, type, outcome, notes, date, source, created_by, caller_id, meeting_id)
      values (v_new.company_id, v_new.contact_id, 'meeting', 'note', 'notitie', v_note, now(), 'claude', v_uid, v_new.caller_id, v_new.id);
    end if;
  end if;
  if p_fee is not null and p_fee is distinct from v_old.fee then
    insert into public.activities (company_id, contact_id, channel, type, outcome, notes, date, source, created_by, caller_id, meeting_id)
    values (v_new.company_id, v_new.contact_id, 'meeting', 'note', 'notitie',
      format('Fee changed from %s to %s', v_old.fee, v_new.fee), now(), 'claude', v_uid, v_new.caller_id, v_new.id);
  end if;
  return v_new;
end;
$$;

revoke execute on function public.sales_update_meeting(uuid, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.sales_update_meeting(uuid, text, numeric, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Work tasks for the MCP, also per workspace and project
-- ---------------------------------------------------------------------------

drop function public.work_api_record_tasks(uuid, uuid, text[], timestamptz, timestamptz, boolean, text, uuid, int, int);

create or replace function public.work_api_record_tasks(
  p_user uuid,
  p_assignee uuid default null,
  p_statuses text[] default null,
  p_due_from timestamptz default null,
  p_due_to timestamptz default null,
  p_no_due boolean default false,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_limit int default 25,
  p_offset int default 0,
  p_workspace uuid default null,
  p_project uuid default null
)
returns setof public.work_tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_entity_type is not null and not work_private.can_link(p_user, p_entity_type) then
    raise exception 'You cannot see the tasks of this kind of record' using errcode = '42501';
  end if;
  return query
    select t.*
    from public.work_tasks t
    where t.archived_at is null
      and (p_workspace is null or t.workspace_id = p_workspace)
      and (p_project is null or t.project_id = p_project)
      and (p_statuses is null or t.status = any (p_statuses))
      and (p_assignee is null or exists (
        select 1 from public.work_task_assignees a where a.task_id = t.id and a.user_id = p_assignee))
      and (not coalesce(p_no_due, false) or t.due_at is null)
      and (p_due_from is null or t.due_at >= p_due_from)
      and (p_due_to is null or t.due_at < p_due_to)
      and (p_entity_type is null or exists (
        select 1 from public.work_task_links l
        where l.task_id = t.id and l.entity_type = p_entity_type and l.entity_id = p_entity_id))
      and work_private.can_view_task(t.id, p_user)
    order by t.due_at nulls last, t.created_at
    limit least(greatest(coalesce(p_limit, 25), 1), 101)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.work_api_record_tasks(uuid, uuid, text[], timestamptz, timestamptz, boolean, text, uuid, int, int, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.work_api_record_tasks(uuid, uuid, text[], timestamptz, timestamptz, boolean, text, uuid, int, int, uuid, uuid)
  to service_role;
