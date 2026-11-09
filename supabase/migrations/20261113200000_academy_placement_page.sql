-- Nordavo Academy, the placement page (spec Academy, Deel 2). Builds on
-- 20261112010000_academy_placements.sql.
--
--   1  Nordavo's response time on the placement
--   2  Placement members: only the client's own people and one developer
--   3  academy_placement_view(): the facts of one placement, without money
--   4  academy_notify_nordavo(): signals for the Nordavo contact (or every
--      Academy manager when the placement has none)
--   5  Timeline: day 1, week 1, 30 days, review after 90 days, made from the
--      start date; review forms (client, developer) and Nordavo's report
--   6  Leave: cancel by the developer, notifications on every step
--   7  Global placement documents (contract summary, GDPR, policies,
--      matrices, blocker agreement) for everyone in a placement
--   8  Calendar feed (ICS) per placement, behind a token

-- ---------------------------------------------------------------------------
-- 1. Response time
-- ---------------------------------------------------------------------------

alter table public.placements
  add column nordavo_response_hours integer not null default 4 check (nordavo_response_hours between 1 and 168);

-- ---------------------------------------------------------------------------
-- 2. Placement members
-- ---------------------------------------------------------------------------

-- Client contacts are client users of the placement's own client; the
-- developer is an Academy developer, one per placement.
create or replace function public.academy_placement_members_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academy_role text;
  v_profile_role text;
  v_profile_client uuid;
  v_placement_client uuid;
begin
  -- Only Nordavo adds members; for anyone else RLS refuses the row.
  if (select auth.uid()) is not null and not public.academy_is_manager() then
    return new;
  end if;
  select am.academy_role, pr.role, pr.client_id
    into v_academy_role, v_profile_role, v_profile_client
  from public.academy_members am
  join public.profiles pr on pr.id = am.profile_id
  where am.profile_id = new.profile_id;

  select p.client_id into v_placement_client from public.placements p where p.id = new.placement_id;

  if new.role = 'developer' then
    if v_academy_role is distinct from 'developer' then
      raise exception 'Only an Academy developer can be the developer of a placement' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.academy_placement_members pm
      where pm.placement_id = new.placement_id and pm.role = 'developer' and pm.profile_id <> new.profile_id
    ) then
      raise exception 'This placement already has a developer' using errcode = '23505';
    end if;
  elsif v_academy_role is null or v_academy_role not like 'client_%'
    or v_profile_role is distinct from 'client'
    or v_profile_client is distinct from v_placement_client then
    raise exception 'Only people of the client of this placement can be its client contacts' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.academy_placement_members_check() from public, anon, authenticated;

create trigger academy_placement_members_check before insert or update on public.academy_placement_members
  for each row execute function public.academy_placement_members_check();

-- ---------------------------------------------------------------------------
-- 3. One placement, without money
-- ---------------------------------------------------------------------------

-- For members and managers: no monthly_rate, no compensation, no costs.
-- my_role is null for a manager who is not a member.
create or replace function public.academy_placement_view(p_placement_id uuid)
returns table (
  id uuid,
  my_role text,
  status text,
  start_date date,
  end_date date,
  probation_end_date date,
  hours_per_week numeric,
  overlap_start time,
  overlap_end time,
  overlap_time_zone text,
  client_id uuid,
  client_name text,
  developer_profile_id uuid,
  developer_name text,
  developer_title text,
  vacancy_title text,
  nordavo_contact_id uuid,
  nordavo_contact_name text,
  nordavo_contact_email text,
  nordavo_contact_booking_url text,
  nordavo_response_hours integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.academy_placement_role(p.id), p.status, p.start_date, p.end_date, p.probation_end_date,
    p.hours_per_week, p.overlap_start, p.overlap_end, p.overlap_time_zone,
    p.client_id, c.name,
    dev.profile_id, coalesce(cand.full_name, devp.full_name), cand.current_title, v.title,
    p.nordavo_contact_id, nc.full_name, nc.email, nc.booking_url, p.nordavo_response_hours
  from public.placements p
  left join public.clients c on c.id = p.client_id
  left join public.candidates cand on cand.id = p.candidate_id
  left join public.vacancies v on v.id = p.vacancy_id
  left join public.profiles nc on nc.id = p.nordavo_contact_id
  left join lateral (
    select pm.profile_id from public.academy_placement_members pm
    where pm.placement_id = p.id and pm.role = 'developer' limit 1
  ) dev on true
  left join public.profiles devp on devp.id = dev.profile_id
  where p.id = p_placement_id and public.academy_can_see_placement(p.id);
$$;

revoke execute on function public.academy_placement_view(uuid) from public, anon;
grant execute on function public.academy_placement_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Signals for Nordavo
-- ---------------------------------------------------------------------------

-- The Nordavo contact of the placement, else every Academy manager.
create or replace function public.academy_nordavo_recipients(p_placement_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.nordavo_contact_id from public.placements p
  where p.id = p_placement_id and p.nordavo_contact_id is not null
  union all
  select pr.id from public.profiles pr
  where not exists (select 1 from public.placements p where p.id = p_placement_id and p.nordavo_contact_id is not null)
    and public.has_module_for(pr.id, 'academy');
$$;

create or replace function public.academy_notify_nordavo(
  p_placement_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_count integer := 0;
begin
  for v_profile in select * from public.academy_nordavo_recipients(p_placement_id) loop
    perform public.academy_notify(
      v_profile, p_kind, p_title, p_body,
      '/dashboard/placements/' || p_placement_id || '?tab=academy',
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('placement_id', p_placement_id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Members of a placement with the given roles, with their locale.
create or replace function public.academy_notify_placement(
  p_placement_id uuid,
  p_roles text[],
  p_kind text,
  p_title_nl text,
  p_title_en text,
  p_body_nl text default null,
  p_body_en text default null,
  p_payload jsonb default '{}'::jsonb,
  p_except uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select pm.profile_id, am.locale
    from public.academy_placement_members pm
    join public.academy_members am on am.profile_id = pm.profile_id
    where pm.placement_id = p_placement_id and pm.role = any (p_roles)
      and pm.profile_id is distinct from p_except
  loop
    perform public.academy_notify(
      v_row.profile_id, p_kind,
      case when v_row.locale = 'nl' then p_title_nl else p_title_en end,
      case when v_row.locale = 'nl' then p_body_nl else p_body_en end,
      '/academy/placements/' || p_placement_id,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('placement_id', p_placement_id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.academy_nordavo_recipients(uuid) from public, anon, authenticated;
revoke execute on function public.academy_notify_nordavo(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.academy_notify_placement(uuid, text[], text, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.academy_nordavo_recipients(uuid) to service_role;
grant execute on function public.academy_notify_nordavo(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.academy_notify_placement(uuid, text[], text, text, text, text, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Timeline and reviews
-- ---------------------------------------------------------------------------

-- Set when the members were asked to fill in the review form (job).
alter table public.academy_milestones add column notified_at timestamptz;

create unique index academy_milestones_standard on public.academy_milestones (placement_id, kind) where kind <> 'custom';

-- Day 1 is the start date; week 1 day 7, 30 days day 30, the review day 90.
-- Keep in sync with MILESTONES in src/lib/academy/placement/timeline.ts.
create or replace function public.academy_ensure_milestones(p_placement_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.academy_milestones (placement_id, kind, title, due_date, position)
  select p.id, k.kind, k.title, p.start_date + k.offset_days, k.pos
  from public.placements p
  cross join (values
    ('day_1', 'Day 1', 0, 1),
    ('week_1', 'Week 1', 6, 2),
    ('day_30', '30 days', 29, 3),
    ('day_90', 'Review after 90 days', 89, 4)
  ) k (kind, title, offset_days, pos)
  where p.id = p_placement_id
  on conflict (placement_id, kind) where kind <> 'custom' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- New placement: its timeline. Start date moved: open moments move with it.
create or replace function public.academy_placements_timeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.academy_ensure_milestones(new.id);
  elsif new.start_date is distinct from old.start_date then
    update public.academy_milestones
    set due_date = due_date + (new.start_date - old.start_date)
    where placement_id = new.id and kind <> 'custom' and completed_at is null and due_date is not null;
  end if;
  return null;
end;
$$;

revoke execute on function public.academy_ensure_milestones(uuid) from public, anon, authenticated;
grant execute on function public.academy_ensure_milestones(uuid) to service_role;
revoke execute on function public.academy_placements_timeline() from public, anon, authenticated;

create trigger academy_placements_timeline after insert or update of start_date on public.placements
  for each row execute function public.academy_placements_timeline();

select public.academy_ensure_milestones(id) from public.placements;

-- A review is the form of a client contact or the developer ('form'), or
-- Nordavo's report of the moment ('report', written by managers only).
alter table public.academy_reviews
  add column kind text not null default 'form' check (kind in ('form', 'report'));

create unique index academy_reviews_one_form on public.academy_reviews (milestone_id, author_id)
  where kind = 'form' and milestone_id is not null;
create unique index academy_reviews_one_report on public.academy_reviews (milestone_id)
  where kind = 'report' and milestone_id is not null;

drop policy "Placement members write own reviews" on public.academy_reviews;
create policy "Placement members write own reviews" on public.academy_reviews
  for insert to authenticated with check (
    kind = 'form'
    and author_id = (select auth.uid())
    and public.academy_placement_role(placement_id) in ('client_admin', 'client_member', 'developer')
    and exists (
      select 1 from public.academy_milestones m where m.id = milestone_id and m.placement_id = academy_reviews.placement_id
    )
  );

drop policy "Authors update own reviews" on public.academy_reviews;
create policy "Authors update own reviews" on public.academy_reviews
  for update to authenticated
  using (author_id = (select auth.uid()) and status = 'draft' and kind = 'form')
  with check (
    author_id = (select auth.uid()) and kind = 'form'
    and public.academy_placement_role(placement_id) in ('client_admin', 'client_member', 'developer')
  );

-- submitted_at follows the status; members cannot move a review to another
-- placement or moment.
create or replace function public.academy_reviews_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then
    new.submitted_at := now();
  elsif new.status = 'draft' then
    new.submitted_at := null;
  end if;
  if tg_op = 'UPDATE' and not public.academy_is_manager()
    and (new.placement_id <> old.placement_id or new.milestone_id is distinct from old.milestone_id) then
    raise exception 'A review stays with its moment' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Submitted form: Nordavo hears of it. Published report: the moment is done
-- and the client contacts and the developer hear of it.
create or replace function public.academy_reviews_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_author text;
begin
  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then
    return null;
  end if;
  select m.title into v_title from public.academy_milestones m where m.id = new.milestone_id;
  if new.kind = 'report' then
    if new.milestone_id is not null then
      update public.academy_milestones set completed_at = coalesce(completed_at, now()) where id = new.milestone_id;
    end if;
    perform public.academy_notify_placement(
      new.placement_id, array['client_admin', 'client_member', 'developer'], 'review_report',
      'Het verslag van ' || coalesce(v_title, 'de review') || ' staat klaar',
      'The report of ' || coalesce(v_title, 'the review') || ' is ready',
      null, null, jsonb_build_object('review_id', new.id, 'milestone_id', new.milestone_id)
    );
  else
    select pr.full_name into v_author from public.profiles pr where pr.id = new.author_id;
    perform public.academy_notify_nordavo(
      new.placement_id, 'review_submitted',
      coalesce(v_author, 'Someone') || ' filled in the review form of ' || coalesce(v_title, 'a moment'),
      null, jsonb_build_object('review_id', new.id, 'milestone_id', new.milestone_id)
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.academy_reviews_stamp() from public, anon, authenticated;
revoke execute on function public.academy_reviews_notify() from public, anon, authenticated;

create trigger academy_reviews_stamp before insert or update on public.academy_reviews
  for each row execute function public.academy_reviews_stamp();
create trigger academy_reviews_notify after insert or update of status on public.academy_reviews
  for each row execute function public.academy_reviews_notify();

-- ---------------------------------------------------------------------------
-- 6. Leave
-- ---------------------------------------------------------------------------

-- The developer cancels an own request that is not decided yet.
create or replace function public.academy_cancel_leave(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.academy_leave_requests
  set status = 'cancelled'
  where id = p_request_id and profile_id = (select auth.uid()) and status in ('requested', 'client_agreed');
  return found;
end;
$$;

revoke execute on function public.academy_cancel_leave(uuid) from public, anon;
grant execute on function public.academy_cancel_leave(uuid) to authenticated;

-- Decisions are Nordavo's: decided_by and decided_at are stamped.
create or replace function public.academy_leave_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('client_agreed', 'approved', 'rejected') then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;
  return new;
end;
$$;

-- Request: Nordavo hears of it. Every step after that: the developer and
-- the client contacts (all three sides see the status).
create or replace function public.academy_leave_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_period text;
  v_nl text;
  v_en text;
begin
  select pr.full_name into v_name from public.profiles pr where pr.id = new.profile_id;
  v_period := to_char(new.start_date, 'DD-MM-YYYY') || ' – ' || to_char(new.end_date, 'DD-MM-YYYY');
  if tg_op = 'INSERT' then
    perform public.academy_notify_nordavo(
      new.placement_id, 'leave_requested',
      coalesce(v_name, 'The developer') || ' asks for leave: ' || v_period,
      new.note, jsonb_build_object('leave_request_id', new.id)
    );
    perform public.academy_notify_placement(
      new.placement_id, array['client_admin'], 'leave_requested',
      coalesce(v_name, 'De developer') || ' vraagt verlof aan: ' || v_period,
      coalesce(v_name, 'The developer') || ' asks for leave: ' || v_period,
      'Nordavo stemt dit met je af.', 'Nordavo will check this with you.',
      jsonb_build_object('leave_request_id', new.id)
    );
    return null;
  end if;
  if new.status is not distinct from old.status then
    return null;
  end if;
  v_nl := case new.status
    when 'client_agreed' then 'Verlof afgestemd met de klant: '
    when 'approved' then 'Verlof goedgekeurd: '
    when 'rejected' then 'Verlof afgewezen: '
    when 'cancelled' then 'Verlof ingetrokken: '
    else 'Verlof bijgewerkt: ' end || coalesce(v_name, '') || ', ' || v_period;
  v_en := case new.status
    when 'client_agreed' then 'Leave discussed with the client: '
    when 'approved' then 'Leave approved: '
    when 'rejected' then 'Leave rejected: '
    when 'cancelled' then 'Leave cancelled: '
    else 'Leave updated: ' end || coalesce(v_name, '') || ', ' || v_period;
  perform public.academy_notify_placement(
    new.placement_id, array['client_admin', 'client_member', 'developer'], 'leave_' || new.status,
    v_nl, v_en, new.decision_note, new.decision_note, jsonb_build_object('leave_request_id', new.id)
  );
  if new.status = 'cancelled' then
    perform public.academy_notify_nordavo(new.placement_id, 'leave_cancelled', v_en, null, jsonb_build_object('leave_request_id', new.id));
  end if;
  return null;
end;
$$;

revoke execute on function public.academy_leave_stamp() from public, anon, authenticated;
revoke execute on function public.academy_leave_notify() from public, anon, authenticated;

create trigger academy_leave_stamp before update on public.academy_leave_requests
  for each row execute function public.academy_leave_stamp();
create trigger academy_leave_notify after insert or update of status on public.academy_leave_requests
  for each row execute function public.academy_leave_notify();

-- ---------------------------------------------------------------------------
-- 7. Global placement documents
-- ---------------------------------------------------------------------------

-- The categories of the placement page. A global document in one of them
-- (for example the GDPR text for every client) is shown on every placement
-- page; a placement document only on its own (academy_can_see_document).
create or replace function public.academy_placement_document_categories()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['contract_summary', 'gdpr', 'policy', 'escalation_matrix', 'decision_matrix', 'blocker_agreement'];
$$;

create or replace function public.academy_can_see_placement_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.academy_documents d
    where d.id = p_document_id and d.scope = 'global'
      and d.category = any (public.academy_placement_document_categories())
      and exists (select 1 from public.academy_placement_members pm where pm.profile_id = (select auth.uid()))
  );
$$;

revoke execute on function public.academy_can_see_placement_document(uuid) from public, anon;
grant execute on function public.academy_can_see_placement_document(uuid) to authenticated, service_role;

create policy "Placement members read global placement documents" on public.academy_documents
  for select to authenticated using (public.academy_can_see_placement_document(id));
create policy "Placement members read global placement document versions" on public.academy_document_versions
  for select to authenticated using (public.academy_can_see_placement_document(document_id));
create policy "Placement members read global placement document files" on storage.objects
  for select to authenticated using (
    bucket_id = 'attachments'
    and case
      when split_part(name, '/', 1) = 'academy' and split_part(name, '/', 2) = 'document'
        and split_part(name, '/', 3) ~ '^[0-9a-f-]{36}$'
      then public.academy_can_see_placement_document(split_part(name, '/', 3)::uuid)
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- 8. Calendar feed
-- ---------------------------------------------------------------------------

-- One secret per placement: the subscription URL works without signing in
-- (calendar apps), so the token is the key. Managers can replace it.
create table public.academy_placement_calendars (
  placement_id uuid primary key references public.placements (id) on delete cascade,
  token text not null unique
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    check (char_length(token) between 32 and 128),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.academy_placement_calendars enable row level security;

create policy "Academy managers manage academy_placement_calendars" on public.academy_placement_calendars
  for all to authenticated using (public.academy_is_manager()) with check (public.academy_is_manager());
create policy "Placement members read the calendar token" on public.academy_placement_calendars
  for select to authenticated using (public.academy_placement_role(placement_id) is not null);

-- The token of a placement, made on first use; members and managers.
create or replace function public.academy_calendar_token(p_placement_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.academy_can_see_placement(p_placement_id) then
    return null;
  end if;
  insert into public.academy_placement_calendars (placement_id) values (p_placement_id)
  on conflict (placement_id) do nothing;
  select token into v_token from public.academy_placement_calendars where placement_id = p_placement_id;
  return v_token;
end;
$$;

-- A new token: the old subscription URL stops working.
create or replace function public.academy_rotate_calendar_token(p_placement_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.academy_is_manager() then
    raise exception 'Only Nordavo replaces the calendar link' using errcode = '42501';
  end if;
  insert into public.academy_placement_calendars (placement_id, token, rotated_at) values (p_placement_id, v_token, now())
  on conflict (placement_id) do update set token = excluded.token, rotated_at = now();
  return v_token;
end;
$$;

-- The events behind a token (no session): holidays in the Netherlands and
-- India (Karnataka), the moments of the timeline and approved leave of the
-- placement. Nothing else: no notes, no reviews, no money.
create or replace function public.academy_calendar_feed(p_token text)
returns table (uid text, starts_on date, ends_on date, title_nl text, title_en text, category text)
language sql
stable
security definer
set search_path = ''
as $$
  with cal as (
    select c.placement_id from public.academy_placement_calendars c
    where char_length(coalesce(p_token, '')) >= 32 and c.token = p_token
  )
  select 'holiday-' || h.id, h.date, h.date,
    h.name_nl || case h.country when 'NL' then ' (Nederland)' else ' (India)' end,
    h.name_en || case h.country when 'NL' then ' (Netherlands)' else ' (India)' end,
    'holiday_' || lower(h.country)
  from public.academy_holidays h
  where exists (select 1 from cal) and h.date between current_date - 400 and current_date + 1200
  union all
  select 'milestone-' || m.id, m.due_date, m.due_date,
    case m.kind when 'day_1' then 'Dag 1' when 'week_1' then 'Week 1' when 'day_30' then '30 dagen'
      when 'day_90' then 'Review na 90 dagen' else m.title end,
    case m.kind when 'day_1' then 'Day 1' when 'week_1' then 'Week 1' when 'day_30' then '30 days'
      when 'day_90' then 'Review after 90 days' else m.title end,
    'milestone'
  from public.academy_milestones m
  join cal on cal.placement_id = m.placement_id
  where m.due_date is not null
  union all
  select 'leave-' || l.id, l.start_date, l.end_date,
    'Verlof ' || coalesce(pr.full_name, ''),
    'Leave ' || coalesce(pr.full_name, ''),
    'leave'
  from public.academy_leave_requests l
  join cal on cal.placement_id = l.placement_id
  left join public.profiles pr on pr.id = l.profile_id
  where l.status = 'approved';
$$;

revoke execute on function public.academy_calendar_token(uuid) from public, anon;
grant execute on function public.academy_calendar_token(uuid) to authenticated;
revoke execute on function public.academy_rotate_calendar_token(uuid) from public, anon;
grant execute on function public.academy_rotate_calendar_token(uuid) to authenticated;
revoke execute on function public.academy_calendar_feed(text) from public;
grant execute on function public.academy_calendar_feed(text) to anon, authenticated, service_role;
