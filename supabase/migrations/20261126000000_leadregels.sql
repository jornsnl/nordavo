-- Leadregels of 20 November 2026 (Google Doc "01 Leadregels", docs/leadregels.md).
--
--  1. ICP: GO, NO_GO or empty (not judged yet). REVIEW is gone. NO_GO needs a
--     reason. Talking points get their own field next to the red flags.
--  2. Segment A (SaaS and software with an own product) or B (any other ICP
--     company with an own IT or data team, and software and automation
--     agencies). Only with GO.
--  3. Score 0 to 100 = base of the segment (A 50, B 30) plus the points of the
--     active signals. Computed by the database, never written by hand.
--  4. Signals with a valid until date and a points table in Settings.
--  5. Prio leaves the screens; a score group gets an approach later
--     (sales_score_groups).
--  6. Lead statuses with cooling down: nee_geen_interesse and nu_niet with a
--     date to approach again, cooled_down for a week after a route without
--     reply, do_not_contact for good (only an admin turns it back).
--  7. Call screen outcomes for a person or the whole company.
--  8. Contact 1 and contact 2 per company in a default order by tier.
--  9. sales_check_outreach(): may a domain or mail address be approached?
-- 10. A company in a running campaign is in_sequence.
--
-- A daily run (pg_cron, sales_daily_tick) moves dates that passed and keeps
-- the scores current (signals expire, vacancies turn evergreen).

-- ---------------------------------------------------------------------------
-- 1. ICP
-- ---------------------------------------------------------------------------

select set_config('sales.source', 'system', true);

update public.companies set icp_decision = null where icp_decision = 'REVIEW';
update public.companies set lead_status = 'new' where lead_status = 'review';

alter table public.companies drop constraint if exists companies_icp_decision_check;
alter table public.companies add constraint companies_icp_decision_check
  check (icp_decision in ('GO', 'NO_GO'));
alter table public.companies add constraint companies_no_go_needs_reason
  check (icp_decision is distinct from 'NO_GO' or nullif(btrim(icp_reason), '') is not null);

-- Talking points (gesprekspunten) next to the red flags, both whole sentences.
alter table public.companies
  add column if not exists talking_points text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 2. Segment
-- ---------------------------------------------------------------------------

alter table public.companies drop constraint if exists companies_segment_check;
update public.companies set segment = null where icp_decision is distinct from 'GO';
update public.companies set segment = case segment when 'saas' then 'A' else 'B' end
where segment is not null and segment not in ('A', 'B');
alter table public.companies add constraint companies_segment_check check (segment in ('A', 'B'));
alter table public.companies add constraint companies_segment_needs_go
  check (segment is null or coalesce(icp_decision = 'GO', false));

-- ---------------------------------------------------------------------------
-- 4. Signals: valid until, the points table
-- ---------------------------------------------------------------------------

alter table public.signals add column if not exists valid_until date;

create table if not exists public.sales_signal_points (
  type text primary key check (type ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (char_length(label) between 1 and 100),
  description text check (char_length(description) <= 500),
  points integer not null check (points between -100 and 100),
  active boolean not null default false,
  -- Derived from the vacancies, not a signal row of its own.
  derived boolean not null default false,
  -- Days a new signal of this type counts when it has no valid until date.
  valid_days integer check (valid_days between 1 and 3650),
  position integer not null default 0,
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.sales_signal_points enable row level security;

create policy "Sales read signal points"
  on public.sales_signal_points for select to authenticated
  using ((select public.has_module('sales')));
create policy "Admins change signal points"
  on public.sales_signal_points for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.sales_signal_points from anon;
grant select on public.sales_signal_points to authenticated;
grant update (points, active, label, description, valid_days, updated_by, updated_at) on public.sales_signal_points to authenticated;
grant all on public.sales_signal_points to service_role;

create trigger sales_signal_points_set_updated_at before update on public.sales_signal_points
  for each row execute function public.set_updated_at();

insert into public.sales_signal_points (type, label, description, points, active, derived, valid_days, position) values
  ('vacature', 'Actieve dev of data vacature', 'Een open dev of data vacature die geen evergreen is. Dev en data tellen gelijk.', 30, true, true, null, 10),
  ('meerdere_rollen', 'Meerdere vacatures tegelijk', 'Afgeleid: twee of meer actieve vacatures.', 10, true, true, null, 20),
  ('india_outsourced', 'Team in India of eerder uitbesteed', 'Al een team in India, of ontwikkeling eerder uitbesteed.', 10, true, false, null, 30),
  ('funding', 'Funding', 'Funding of investering in de afgelopen 12 maanden.', 10, false, false, 365, 40),
  ('employee_growth', 'Groei van 20% of meer', 'Groei in medewerkers van 20% of meer in 12 maanden.', 10, false, false, 365, 50),
  ('nieuwe_cto', 'Nieuwe CTO', 'Nieuwe CTO of head of engineering of data in de afgelopen 6 maanden.', 5, false, false, 183, 60),
  ('lang_open', 'Vacature 60 dagen of langer open', 'Afgeleid: een actieve vacature die 60 dagen of langer openstaat.', 5, false, true, null, 70),
  ('via_recruiter', 'Vacature via recruiter', 'De vacature loopt via een recruiter: ze betalen al een fee.', 5, false, false, null, 80),
  ('stack_match', 'Stack past bij de talentpool', 'De stack past bij onze talentpool.', 5, false, false, null, 90),
  ('overname_product', 'Overname of nieuw product', 'Overname, nieuwe vestiging of nieuw product.', 5, false, false, 365, 100),
  ('interactie', 'Interactie met Nordavo', 'Een reactie op een LinkedIn post, websitebezoek of eerder gesprek.', 10, false, false, 180, 110),
  ('ontslagen', 'Ontslagen of hiring freeze', 'Ontslagronde, reorganisatie of hiring freeze.', -15, false, false, 365, 120)
on conflict (type) do nothing;

/** The day a signal is from: online since, else first seen (Amsterdam). */
create or replace function public.sales_signal_date(p_posted date, p_first timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_posted, (p_first at time zone 'Europe/Amsterdam')::date);
$$;

/** Open and not past its valid until date. A vacancy that went offline has expired. */
create or replace function public.sales_signal_is_active(p_closed timestamptz, p_valid date, p_today date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_closed is null and (p_valid is null or p_valid >= p_today);
$$;

/** Evergreen: open longer than 180 days, or a title like open sollicitatie, talent pool or always hiring. */
create or replace function public.sales_vacancy_is_evergreen(p_title text, p_since date, p_today date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_since is not null and p_since < p_today - 180)
    or coalesce(p_title, '') ~* '(open (sollicitatie|application)|talent ?pool|always hiring|altijd op zoek|general application|algemene sollicitatie)';
$$;

/** A dev or data vacancy: a dev or data title, or a role group that is not sales or service. */
create or replace function public.sales_is_dev_data_vacancy(p_title text, p_role_group text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_role_group, '') !~* '^(sales|service|projecten)\M'
    and (public.sales_is_dev_data_title(p_title) or nullif(btrim(p_role_group), '') is not null);
$$;

/** A vacancy that counts for the score: active, dev or data, not evergreen. */
create or replace function public.sales_vacancy_counts(
  p_type text, p_title text, p_role_group text, p_posted date, p_first timestamptz,
  p_closed timestamptz, p_valid date, p_today date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type = 'vacature'
    and public.sales_signal_is_active(p_closed, p_valid, p_today)
    and not public.sales_vacancy_is_evergreen(p_title, public.sales_signal_date(p_posted, p_first), p_today)
    and public.sales_is_dev_data_vacancy(p_title, p_role_group);
$$;

grant execute on function
  public.sales_signal_date(date, timestamptz),
  public.sales_signal_is_active(timestamptz, date, date),
  public.sales_vacancy_is_evergreen(text, date, date),
  public.sales_is_dev_data_vacancy(text, text),
  public.sales_vacancy_counts(text, text, text, date, timestamptz, timestamptz, date, date)
to authenticated, service_role;

-- A new signal without valid until gets the default days of its type.
create or replace function public.signals_default_valid_until()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if new.valid_until is null and new.type <> 'vacature' then
    select valid_days into v_days from public.sales_signal_points where type = new.type;
    if v_days is not null then
      new.valid_until := public.sales_signal_date(new.posted_at, coalesce(new.first_seen_at, now())) + v_days;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists signals_default_valid_until on public.signals;
create trigger signals_default_valid_until before insert on public.signals
  for each row execute function public.signals_default_valid_until();

-- ---------------------------------------------------------------------------
-- 3. Score
-- ---------------------------------------------------------------------------

/**
 * How the score of a company is built: the base of the segment, then each
 * active signal type once, with its points. Null without segment.
 * {"segment": "A", "parts": [{"type", "label", "points"}], "total": 90}
 */
create or replace function public.sales_score_parts(p_company uuid, p_segment text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_parts jsonb;
  v_total integer;
  v_vacancies integer;
  v_long boolean;
  r public.sales_signal_points;
begin
  if p_segment is null then
    return null;
  end if;
  v_parts := jsonb_build_array(jsonb_build_object(
    'type', 'segment', 'label', p_segment, 'points', case p_segment when 'A' then 50 else 30 end
  ));

  select count(*), coalesce(bool_or(public.sales_signal_date(s.posted_at, s.first_seen_at) <= v_today - 60), false)
  into v_vacancies, v_long
  from public.signals s
  where s.company_id = p_company
    and public.sales_vacancy_counts(s.type, s.title, s.role_group, s.posted_at, s.first_seen_at, s.closed_at, s.valid_until, v_today);

  for r in select * from public.sales_signal_points where active order by position, type loop
    if (r.type = 'vacature' and v_vacancies >= 1)
       or (r.type = 'meerdere_rollen' and v_vacancies >= 2)
       or (r.type = 'lang_open' and v_long)
       or (not r.derived and exists (
         select 1 from public.signals s
         where s.company_id = p_company and s.type = r.type
           and public.sales_signal_is_active(s.closed_at, s.valid_until, v_today)
       )) then
      v_parts := v_parts || jsonb_build_array(jsonb_build_object('type', r.type, 'label', r.label, 'points', r.points));
    end if;
  end loop;

  select greatest(0, least(100, coalesce(sum((p ->> 'points')::integer), 0)))
  into v_total
  from jsonb_array_elements(v_parts) p;
  return jsonb_build_object('segment', p_segment, 'parts', v_parts, 'total', v_total);
end;
$$;

/** The score and how it is built, for the lead page. */
create or replace function public.sales_company_score(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segment text;
begin
  if not public.has_module('sales') and (select auth.role()) <> 'service_role' then
    raise exception 'No access to sales' using errcode = '42501';
  end if;
  select segment into v_segment from public.companies where id = p_company;
  return public.sales_score_parts(p_company, v_segment);
end;
$$;

revoke execute on function public.sales_score_parts(uuid, text) from public, anon, authenticated;
grant execute on function public.sales_score_parts(uuid, text) to service_role;
revoke execute on function public.sales_company_score(uuid) from public, anon;
grant execute on function public.sales_company_score(uuid) to authenticated, service_role;

/** Recomputes the stored score of these companies (all with a segment when null). Returns how many changed. */
create or replace function public.sales_refresh_scores(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.companies c
  set icp_score = x.total
  from (
    select co.id, (public.sales_score_parts(co.id, co.segment) ->> 'total')::integer as total
    from public.companies co
    where (p_ids is null and (co.segment is not null or co.icp_score is not null))
       or co.id = any (p_ids)
  ) x
  where c.id = x.id and c.icp_score is distinct from x.total;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.sales_refresh_scores(uuid[]) from public, anon, authenticated;
grant execute on function public.sales_refresh_scores(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Score groups and their approach (filled in later)
-- ---------------------------------------------------------------------------

create table if not exists public.sales_score_groups (
  key text primary key check (key in ('90_100', '80_89', '60_79', '50_59', 'lt_50')),
  label text not null,
  min_score integer not null,
  max_score integer not null,
  approach text check (char_length(approach) <= 500),
  position integer not null default 0,
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.sales_score_groups enable row level security;

create policy "Sales read score groups"
  on public.sales_score_groups for select to authenticated
  using ((select public.has_module('sales')));
create policy "Admins change score groups"
  on public.sales_score_groups for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.sales_score_groups from anon;
grant select on public.sales_score_groups to authenticated;
grant update (approach, updated_by, updated_at) on public.sales_score_groups to authenticated;
grant all on public.sales_score_groups to service_role;

create trigger sales_score_groups_set_updated_at before update on public.sales_score_groups
  for each row execute function public.set_updated_at();

insert into public.sales_score_groups (key, label, min_score, max_score, position) values
  ('90_100', '90 tot 100', 90, 100, 10),
  ('80_89', '80 tot 89', 80, 89, 20),
  ('60_79', '60 tot 79', 60, 79, 30),
  ('50_59', '50 tot 59', 50, 59, 40),
  ('lt_50', 'Onder 50', 0, 49, 50)
on conflict (key) do nothing;

/** The score group of a score: 90_100, 80_89, 60_79, 50_59 or lt_50; null without score. */
create or replace function public.sales_score_group(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_score is null then null
    when p_score >= 90 then '90_100'
    when p_score >= 80 then '80_89'
    when p_score >= 60 then '60_79'
    when p_score >= 50 then '50_59'
    else 'lt_50'
  end;
$$;

grant execute on function public.sales_score_group(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Lead statuses and cooling down
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists recontact_from date,
  add column if not exists declined_channel text,
  -- Contact 1 and 2 were picked by hand: the default order leaves them alone.
  add column if not exists contact_order_manual boolean not null default false;

alter table public.companies drop constraint if exists companies_declined_channel_check;
alter table public.companies add constraint companies_declined_channel_check
  check (declined_channel in ('bellen', 'mail', 'linkedin'));

alter table public.companies drop constraint if exists companies_lead_status_check;
alter table public.companies add constraint companies_lead_status_check check (lead_status in (
  'new', 'enrich', 'ready', 'in_sequence', 'cooled_down', 'nee_geen_interesse', 'nu_niet', 'no_go', 'do_not_contact'
));

-- Cooled down: a week after the change (the existing ones keep their own date).
update public.companies
set recontact_from = (lead_status_changed_at at time zone 'Europe/Amsterdam')::date + 7
where lead_status = 'cooled_down' and recontact_from is null;

alter table public.companies drop constraint if exists companies_recontact_needs_date;
alter table public.companies add constraint companies_recontact_needs_date
  check (lead_status not in ('cooled_down', 'nee_geen_interesse', 'nu_niet') or recontact_from is not null);

-- The ICP verdict moves the lead status while it was only judged: GO is ready,
-- NO_GO is no go, empty is new. A NO_GO or empty verdict has no segment.
create or replace function public.companies_icp_lead_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.icp_decision is distinct from old.icp_decision then
    if new.lead_status = old.lead_status and new.lead_status in ('new', 'ready', 'no_go') then
      new.lead_status := case new.icp_decision
        when 'GO' then 'ready'
        when 'NO_GO' then 'no_go'
        else 'new'
      end;
    end if;
    if new.icp_decision is distinct from 'GO' then
      new.segment := null;
    end if;
  end if;
  return new;
end;
$$;

/** Whether the person acting now is an admin. */
create or replace function public.sales_actor_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = public.sales_current_actor()), false);
$$;

revoke execute on function public.sales_actor_is_admin() from public, anon;
grant execute on function public.sales_actor_is_admin() to authenticated, service_role;

-- The lead rules on a company row: the score, the date to approach again and
-- do not contact for good.
create or replace function public.companies_lead_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_status_changed boolean := tg_op = 'INSERT' or new.lead_status is distinct from old.lead_status;
  v_date_set boolean := tg_op = 'UPDATE' and new.recontact_from is distinct from old.recontact_from;
begin
  -- Do not contact is for good, also when a signal comes in. Only an admin turns it back.
  if tg_op = 'UPDATE' and old.lead_status = 'do_not_contact' and new.lead_status <> 'do_not_contact'
     and coalesce(current_setting('sales.undo_call', true), '') <> 'on'
     and not public.sales_actor_is_admin() then
    raise exception 'Do not contact is final: only an admin can change it' using errcode = '42501';
  end if;

  if v_status_changed then
    if new.lead_status in ('nee_geen_interesse', 'nu_niet') then
      if new.recontact_from is null or (tg_op = 'UPDATE' and not v_date_set) then
        new.recontact_from := (v_today + interval '3 months')::date;
      end if;
    elsif new.lead_status = 'cooled_down' then
      if new.recontact_from is null or (tg_op = 'UPDATE' and not v_date_set) then
        new.recontact_from := v_today + 7;
      end if;
    else
      new.recontact_from := null;
    end if;
    if new.lead_status <> 'nee_geen_interesse' then
      new.declined_channel := null;
    end if;
  elsif new.lead_status in ('nee_geen_interesse', 'nu_niet', 'cooled_down') and new.recontact_from is null then
    -- Emptying the date puts the default back.
    new.recontact_from := case when new.lead_status = 'cooled_down' then v_today + 7 else (v_today + interval '3 months')::date end;
  end if;

  -- The score follows the segment and the signals; never set by hand.
  if tg_op = 'INSERT' then
    new.icp_score := (public.sales_score_parts(new.id, new.segment) ->> 'total')::integer;
  elsif new.segment is distinct from old.segment or new.icp_score is distinct from old.icp_score
        or new.icp_decision is distinct from old.icp_decision then
    new.icp_score := (public.sales_score_parts(new.id, new.segment) ->> 'total')::integer;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_lead_rules on public.companies;
create trigger companies_lead_rules before insert or update of lead_status, recontact_from, segment, icp_score, icp_decision
  on public.companies for each row execute function public.companies_lead_rules();

-- Every field a person or Claude may change goes through sales_update (and is logged).
create or replace function public.sales_update(
  p_entity text,
  p_ids uuid[],
  p_fields jsonb,
  p_source text default 'handmatig',
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
  v_allowed text[];
  v_cols text[];
  v_table text;
  v_count integer;
  v_key text;
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers change contacts on the call screen only' using errcode = '42501';
  end if;
  if p_entity = 'company' then
    v_table := 'companies';
    v_allowed := array[
      'name', 'website', 'prio', 'category', 'description', 'sector', 'employees', 'city',
      'linkedin_url', 'general_phone', 'red_flags', 'talking_points', 'opening_line', 'source_note', 'segment',
      'icp_decision', 'icp_reason', 'icp_score', 'lead_status', 'recontact_from', 'declined_channel',
      'pipeline_stage', 'lost_reason', 'parked_until', 'profiles_due_on',
      'owner_id', 'partner_id', 'next_action', 'next_action_date',
      'pinned_at', 'manual_position', 'legal_form', 'kvk_number'
    ];
  elsif p_entity = 'contact' then
    v_table := 'contacts';
    v_allowed := array[
      'first_name', 'last_name', 'title', 'tier', 'role', 'route', 'phone', 'phone_type',
      'email', 'email_status', 'linkedin_url', 'status', 'attempts', 'last_attempt_at',
      'callback_at', 'referred_to', 'caller_note', 'assigned_caller_id', 'assigned_until',
      'pinned_at', 'manual_position', 'is_primary'
    ];
  else
    raise exception 'Unknown record type';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    return 0;
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not v_key = any (v_allowed) then
      raise exception 'Field % cannot be changed here', v_key;
    end if;
  end loop;

  if p_entity = 'contact' and p_fields ? 'assigned_caller_id'
     and nullif(p_fields ->> 'assigned_caller_id', '') is not null
     and not exists (select 1 from public.callers where id = (p_fields ->> 'assigned_caller_id')::uuid and status = 'active') then
    raise exception 'That caller is not active';
  end if;

  select array_agg(k order by k) into v_cols from jsonb_object_keys(p_fields) k;

  -- Contact 1 or 2 picked by hand: the default order no longer moves them (set
  -- before the update, whose statement trigger would put the default back).
  if p_entity = 'contact' and (p_fields ? 'role' or p_fields ? 'is_primary') then
    update public.companies set contact_order_manual = true
    where id in (select company_id from public.contacts where id = any (p_ids)) and not contact_order_manual;
  end if;

  execute format(
    'update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) r) where t.id = any ($2)',
    v_table,
    (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
    (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c),
    v_table
  ) using p_fields, p_ids;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.sales_log_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_key text;
  v_fields text[];
  v_company uuid;
  v_contact uuid;
begin
  if coalesce(current_setting('sales.skip_log', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'companies' then
    v_fields := array[
      'name', 'website', 'prio', 'category', 'description', 'sector', 'employees', 'city',
      'linkedin_url', 'general_phone', 'red_flags', 'talking_points', 'opening_line', 'source_note', 'segment',
      'icp_decision', 'icp_reason', 'icp_score', 'lead_status', 'recontact_from', 'declined_channel',
      'pipeline_stage', 'lost_reason', 'parked_until', 'profiles_due_on',
      'owner_id', 'partner_id', 'next_action', 'next_action_date', 'pinned_at', 'manual_position',
      'legal_form', 'kvk_number'
    ];
    v_company := new.id;
  else
    v_fields := array[
      'first_name', 'last_name', 'title', 'tier', 'role', 'route', 'phone', 'phone_type', 'email',
      'email_status', 'linkedin_url', 'status', 'attempts', 'callback_at', 'referred_to', 'caller_note',
      'assigned_caller_id', 'assigned_until', 'pinned_at', 'manual_position', 'company_id', 'is_primary'
    ];
    v_company := new.company_id;
    v_contact := new.id;
  end if;

  foreach v_key in array v_fields loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      insert into public.activities (
        company_id, contact_id, channel, type, field, old_value, new_value, source, created_by, caller_id
      ) values (
        v_company, v_contact, 'system', 'change', v_key, v_old -> v_key, v_new -> v_key,
        public.sales_current_source(), public.sales_current_actor(),
        public.caller_id_for(public.sales_current_actor())
      );
    end if;
  end loop;
  return null;
end;
$$;

-- Built in choices (Settings, Sales lists): the new statuses, call outcomes and signal types.
create or replace function public.sales_choice_builtin(p_list text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_list
    when 'prio' then p_value in ('1', '2', '3', '4', '5')
    when 'category' then p_value in ('development', 'data_bi', 'both')
    when 'lead_status' then p_value in ('new', 'enrich', 'ready', 'in_sequence', 'cooled_down', 'nee_geen_interesse', 'nu_niet', 'no_go', 'do_not_contact')
    when 'contact_status' then p_value in ('new', 'qualified', 'enrich', 'enriched', 'in_outreach', 'reached', 'not_reached', 'not_interested', 'do_not_contact')
    when 'call_outcome' then p_value in ('no_answer', 'call_back', 'reached_interested', 'meeting_planned', 'reached_not_interested',
      'not_interested_person', 'not_interested_company', 'not_now', 'do_not_contact', 'referred', 'wrong_person', 'wrong_number')
    when 'reject_reason' then p_value in ('no_vacancies', 'has_agency', 'offshore_no', 'too_small', 'too_expensive', 'no_time', 'bad_experience', 'wrong_moment')
    when 'signal_type' then p_value in ('funding', 'nieuwe_cto', 'employee_growth', 'meerdere_rollen', 'lang_open', 'vacature', 'remote_extern', 'freelance', 'overig',
      'india_outsourced', 'via_recruiter', 'stack_match', 'overname_product', 'interactie', 'ontslagen')
    else false
  end;
$$;

/** Who follows up a company personally: the owner, else who last set its lead status, else who follows it. */
create or replace function public.sales_follow_up_person(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select owner_id from public.companies where id = p_company),
    (select a.created_by from public.activities a
      join public.profiles p on p.id = a.created_by and p.role in ('admin', 'member')
      where a.company_id = p_company and a.field = 'lead_status' and a.created_by is not null
      order by a.created_at desc limit 1),
    (select followed_by from public.companies where id = p_company)
  );
$$;

revoke execute on function public.sales_follow_up_person(uuid) from public, anon, authenticated;
grant execute on function public.sales_follow_up_person(uuid) to service_role;

/** A task for personal follow up, linked to the company; quietly skipped when nobody can get it. */
create or replace function public.sales_follow_up_task(p_company uuid, p_title text, p_description text, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_who uuid := public.sales_follow_up_person(p_company);
  v_activity uuid;
begin
  insert into public.activities (company_id, channel, type, notes, source, created_by, external_id)
  values (p_company, 'system', 'system', left(p_title || coalesce(E'\n' || p_description, ''), 2000), 'system', v_who, p_key)
  on conflict (external_id) do nothing
  returning id into v_activity;
  if v_activity is null or v_who is null then
    return;
  end if;
  begin
    perform public.work_create_record_task(
      'company', p_company, left(p_title, 300), p_description, 'high',
      ((now() at time zone 'Europe/Amsterdam')::date + 1)::timestamptz, array[v_who], null, 'todo', v_who
    );
  exception when others then
    raise warning 'sales_follow_up_task: no task for % (%)', p_company, sqlerrm;
  end;
end;
$$;

revoke execute on function public.sales_follow_up_task(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sales_follow_up_task(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4 and 6. A signal comes in, changes or expires
-- ---------------------------------------------------------------------------

/** Whether a signal is a new reason to approach: a counting vacancy, or an active signal type with plus points. */
create or replace function public.sales_signal_is_hook(p_signal public.signals)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_signal.type = 'vacature' then public.sales_vacancy_counts(
      p_signal.type, p_signal.title, p_signal.role_group, p_signal.posted_at, p_signal.first_seen_at,
      p_signal.closed_at, p_signal.valid_until, (now() at time zone 'Europe/Amsterdam')::date)
    else public.sales_signal_is_active(p_signal.closed_at, p_signal.valid_until, (now() at time zone 'Europe/Amsterdam')::date)
      and exists (select 1 from public.sales_signal_points p where p.type = p_signal.type and p.active and p.points > 0)
  end;
$$;

revoke execute on function public.sales_signal_is_hook(public.signals) from public, anon, authenticated;
grant execute on function public.sales_signal_is_hook(public.signals) to service_role;

create or replace function public.signals_lead_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
begin
  if tg_op = 'DELETE' then
    perform public.sales_refresh_scores(array[old.company_id]);
    return null;
  end if;
  perform public.sales_refresh_scores(case
    when tg_op = 'UPDATE' and old.company_id <> new.company_id then array[old.company_id, new.company_id]
    else array[new.company_id] end);

  -- A new hook: cooled down goes straight back to ready; a company that said
  -- no gets a personal follow up instead of a campaign. Do not contact stays.
  if tg_op = 'INSERT' and public.sales_signal_is_hook(new) then
    select * into v_company from public.companies where id = new.company_id;
    if v_company.lead_status = 'cooled_down' then
      perform set_config('sales.source', 'system', true);
      update public.companies set lead_status = 'ready' where id = v_company.id;
    elsif v_company.lead_status = 'nee_geen_interesse' and v_company.recontact_from > v_today then
      perform public.sales_follow_up_task(
        v_company.id,
        left('New signal at ' || v_company.name || ': follow up personally', 300),
        'This company said no (nee of geen interesse) until ' || to_char(v_company.recontact_from, 'YYYY-MM-DD')
          || '. A new signal came in: ' || coalesce(new.title, new.type) || coalesce(' (' || new.source_url || ')', '')
          || E'.\n\nFollow up personally, not in a campaign.',
        'leadrule:signal:' || new.id
      );
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists signals_lead_rules on public.signals;
create trigger signals_lead_rules after insert or update or delete on public.signals
  for each row execute function public.signals_lead_rules();

-- A change in the points table changes every score.
create or replace function public.sales_signal_points_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sales_refresh_scores(null);
  return null;
end;
$$;

drop trigger if exists sales_signal_points_changed on public.sales_signal_points;
create trigger sales_signal_points_changed after update on public.sales_signal_points
  for each statement execute function public.sales_signal_points_changed();

-- ---------------------------------------------------------------------------
-- 6 and 10. Routes: in a running campaign is in sequence, a route that ends
-- without reply cools down, a positive reaction leaves every route
-- ---------------------------------------------------------------------------

/** In a running route: the company is in_sequence (from new, ready, enrich or cooled down). */
create or replace function public.sales_mark_in_sequence(p_company uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.companies set lead_status = 'in_sequence'
  where id = p_company and lead_status in ('new', 'ready', 'enrich', 'cooled_down');
  return found;
end;
$$;

/** Nothing runs any more and the company did not become warm: cooled down, a week from now. */
create or replace function public.sales_route_ended(p_company uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.campaign_members m join public.campaigns c on c.id = m.campaign_id
    where m.company_id = p_company and m.status in ('queued', 'active') and c.status in ('active', 'paused')
  ) or exists (
    select 1 from public.sequence_enrollments e where e.company_id = p_company and e.status in ('active', 'paused')
  ) then
    return false;
  end if;
  update public.companies set lead_status = 'cooled_down'
  where id = p_company and lead_status = 'in_sequence'
    and (pipeline_stage is null or pipeline_stage in ('lost', 'parked'));
  return found;
end;
$$;

revoke execute on function public.sales_mark_in_sequence(uuid), public.sales_route_ended(uuid) from public, anon, authenticated;
grant execute on function public.sales_mark_in_sequence(uuid), public.sales_route_ended(uuid) to service_role;

create or replace function public.campaign_members_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_campaign public.campaigns;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select * into v_campaign from public.campaigns where id = new.campaign_id;
  if new.status in ('queued', 'active') and v_campaign.status = 'active' then
    perform public.sales_mark_in_sequence(new.company_id);
  end if;
  if new.status in ('finished', 'stopped', 'bounced', 'unsubscribed') and new.replied_at is null then
    select * into v_company from public.companies where id = new.company_id;
    if v_company.bucket in ('mail_campaign', 'linkedin_campaign')
       and (v_company.bucket_campaign_id is null or v_company.bucket_campaign_id = new.campaign_id)
       and public.sales_running_campaign(new.company_id) is null then
      perform public.sales_set_bucket(new.company_id, 'free', p_note => 'Campaign ended without a reply');
    end if;
    perform public.sales_route_ended(new.company_id);
  end if;
  return null;
end;
$$;

create or replace function public.campaigns_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' then
    update public.campaigns set ended_at = coalesce(ended_at, now()) where id = new.id and ended_at is null;
    update public.campaign_members set status = 'finished'
    where campaign_id = new.id and status in ('queued', 'active');
  elsif new.status = 'active' and old.status is distinct from 'active' then
    update public.campaigns set started_at = coalesce(started_at, now()) where id = new.id and started_at is null;
    perform public.sales_mark_in_sequence(m.company_id)
    from (select distinct company_id from public.campaign_members where campaign_id = new.id and status in ('queued', 'active')) m;
  end if;
  return null;
end;
$$;

create or replace function public.sequence_enrollments_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('finished', 'stopped')
     and not exists (
       select 1 from public.activities a
       where a.company_id = new.company_id and a.date >= new.started_at
         and (a.type = 'reply' or a.outcome in ('reply_positief', 'reply_neutraal', 'reply_negatief'))
     ) then
    perform public.sales_route_ended(new.company_id);
  end if;
  return null;
end;
$$;

drop trigger if exists sequence_enrollments_lead_status on public.sequence_enrollments;
create trigger sequence_enrollments_lead_status after update of status on public.sequence_enrollments
  for each row execute function public.sequence_enrollments_lead_status();

/** A positive reaction: out of every route (the pipeline takes over). */
create or replace function public.sales_exit_routes(p_company uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.campaign_members set status = 'stopped'
  where company_id = p_company and status in ('queued', 'active');
  update public.sequence_enrollments
  set status = 'stopped', paused_at = coalesce(paused_at, now()), pause_reason = left(coalesce(p_reason, 'Positive reaction'), 500)
  where company_id = p_company and status in ('active', 'paused');
  update public.sequence_tasks set status = 'cancelled'
  where company_id = p_company and status = 'open';
end;
$$;

revoke execute on function public.sales_exit_routes(uuid, text) from public, anon, authenticated;
grant execute on function public.sales_exit_routes(uuid, text) to service_role;

-- What a reaction does to the company (after activities_after_insert moved the pipeline):
-- positive leaves every route, no thanks is nee_geen_interesse, unsubscribe is do not contact.
create or replace function public.activities_lead_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.company_id is null or new.review_status is not distinct from 'pending' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.review_status is not distinct from new.review_status then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.review_status = 'accepted' and new.outcome = 'reply_positief' then
    perform public.sales_advance_stage(new.company_id, 'interested');
  end if;

  if new.outcome in ('reply_positief', 'reached_interested', 'afspraak', 'meeting_planned') then
    perform public.sales_exit_routes(new.company_id, 'Positive reaction via ' || new.channel);
  elsif new.outcome = 'reply_negatief' then
    update public.companies
    set lead_status = 'nee_geen_interesse',
        declined_channel = case when new.channel in ('bellen', 'mail', 'linkedin') then new.channel end
    where id = new.company_id and lead_status not in ('do_not_contact', 'no_go', 'nee_geen_interesse')
      and (pipeline_stage is null or pipeline_stage in ('lost', 'parked'));
    update public.campaign_members set status = 'stopped' where company_id = new.company_id and status in ('queued', 'active');
  elsif new.outcome = 'afgemeld' then
    update public.companies set lead_status = 'do_not_contact' where id = new.company_id and lead_status <> 'do_not_contact';
    update public.campaign_members set status = 'stopped' where company_id = new.company_id and status in ('queued', 'active');
  end if;
  return null;
end;
$$;

drop trigger if exists activities_lead_rules on public.activities;
create trigger activities_lead_rules after insert or update of review_status on public.activities
  for each row execute function public.activities_lead_rules();

-- ---------------------------------------------------------------------------
-- The daily run
-- ---------------------------------------------------------------------------

/**
 * Dates that passed: cooled down and nee_geen_interesse go back to ready (the
 * latter with the note to use another channel and a new hook), nu_niet goes
 * back to ready with a task for personal follow up. Then every score is
 * computed again (signals expire, vacancies turn evergreen).
 */
create or replace function public.sales_daily_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_row public.companies;
  v_cooled integer := 0;
  v_declined integer := 0;
  v_not_now integer := 0;
  v_scores integer;
  v_channel text;
begin
  perform set_config('sales.source', 'system', true);
  perform set_config('sales.actor', '', true);

  for v_row in
    select * from public.companies
    where lead_status in ('cooled_down', 'nee_geen_interesse', 'nu_niet') and recontact_from <= v_today
    for update
  loop
    if v_row.lead_status = 'cooled_down' then
      update public.companies set lead_status = 'ready' where id = v_row.id;
      v_cooled := v_cooled + 1;
    elsif v_row.lead_status = 'nee_geen_interesse' then
      v_channel := case v_row.declined_channel when 'bellen' then 'bellen' when 'mail' then 'mail' when 'linkedin' then 'LinkedIn' end;
      update public.companies
      set lead_status = 'ready',
          next_action = left('Opnieuw benaderen: liever een ander kanaal'
            || coalesce(' dan ' || v_channel, '') || ' en een nieuwe haak', 500),
          next_action_date = v_today
      where id = v_row.id;
      insert into public.activities (company_id, channel, type, notes, source, external_id)
      values (v_row.id, 'system', 'note',
        'Drie maanden na nee of geen interesse' || coalesce(' (via ' || v_channel || ')', '')
          || ': mag weer benaderd worden, bij voorkeur via een ander kanaal en met een nieuwe haak.',
        'system', 'leadrule:declined:' || v_row.id || ':' || v_today)
      on conflict (external_id) do nothing;
      v_declined := v_declined + 1;
    else
      update public.companies
      set lead_status = 'ready', next_action = 'Persoonlijk opvolgen (nu niet)', next_action_date = v_today
      where id = v_row.id;
      perform public.sales_follow_up_task(
        v_row.id,
        left('Follow up ' || v_row.name || ' personally (nu niet until ' || to_char(v_row.recontact_from, 'YYYY-MM-DD') || ')', 300),
        'This company asked to wait (nu niet). The date has come: follow up personally.',
        'leadrule:not_now:' || v_row.id || ':' || v_today
      );
      v_not_now := v_not_now + 1;
    end if;
  end loop;

  v_scores := public.sales_refresh_scores(null);
  return jsonb_build_object('cooled_down_to_ready', v_cooled, 'declined_to_ready', v_declined,
    'not_now_to_ready', v_not_now, 'scores_changed', v_scores);
end;
$$;

revoke execute on function public.sales_daily_tick() from public, anon, authenticated;
grant execute on function public.sales_daily_tick() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Call screen outcomes: the person, or the whole company
-- ---------------------------------------------------------------------------

alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (outcome in (
  'verstuurd', 'geen_gehoor', 'bereikt', 'terugbellen', 'afspraak', 'afspraak_goedgekeurd', 'afspraak_afgekeurd',
  'niet_geinteresseerd', 'reply_positief', 'reply_neutraal', 'reply_negatief', 'bounce', 'afgemeld', 'gesprek_gehad',
  'gewonnen', 'verloren', 'notitie', 'no_answer', 'call_back', 'reached_interested', 'meeting_planned',
  'reached_not_interested', 'referred', 'wrong_person', 'wrong_number', 'meeting_held', 'meeting_no_show',
  'meeting_cancelled', 'not_interested_person', 'not_interested_company', 'not_now', 'do_not_contact'
));

-- not_interested_person: only this contact is blocked, the next one follows.
-- not_interested_company: the company goes to nee_geen_interesse for three months.
-- not_now: the company waits until the date (default three months).
-- do_not_contact: angry or unsubscribe, for good.
-- Each needs a short note. The rest of the rules are those of 20261123600000_call_outcome_flow.sql.
create or replace function public.sales_log_call(p_contact uuid, p_outcome text, p_callback_at date DEFAULT NULL::date, p_referred_name text DEFAULT NULL::text, p_referred_title text DEFAULT NULL::text, p_referred_phone text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid, p_callback_time text DEFAULT NULL::text, p_callback_with text DEFAULT NULL::text, p_referred_email text DEFAULT NULL::text, p_reasons text[] DEFAULT NULL::text[], p_reason_text text DEFAULT NULL::text, p_reason_label text DEFAULT NULL::text, p_until date DEFAULT NULL::date, p_next_step text DEFAULT NULL::text, p_next_step_at date DEFAULT NULL::date, p_next_owner uuid DEFAULT NULL::uuid, p_new_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid := public.caller_id_for(v_uid);
  v_row public.contacts;
  v_company public.companies;
  v_attempts integer;
  v_status text;
  v_role text;
  v_new_contact uuid;
  v_meeting uuid;
  v_activity uuid;
  v_first text;
  v_last text;
  v_at timestamptz := now();
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_time text := nullif(btrim(p_callback_time), '');
  v_with text := nullif(btrim(p_callback_with), '');
  v_next_action text;
  v_next_date date;
  v_reasons text[] := '{}';
  v_text text := nullif(btrim(p_reason_text), '');
  v_label text;
  v_lost text;
  v_park boolean := false;
  v_new_phone text := nullif(btrim(p_new_phone), '');
  v_until date;
  v_email text := nullif(btrim(p_referred_email), '');
  v_snapshot jsonb;
  v_known uuid[];
  v_written uuid[];
begin
  if p_outcome not in (
    'no_answer', 'call_back', 'reached_interested', 'meeting_planned',
    'reached_not_interested', 'referred', 'wrong_person', 'wrong_number',
    'not_interested_person', 'not_interested_company', 'not_now', 'do_not_contact'
  ) then
    raise exception 'Unknown call outcome';
  end if;
  select * into v_row from public.contacts where id = p_contact for update;
  if v_row.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if v_caller is not null and v_row.claimed_by is distinct from v_uid then
    raise exception 'Open this contact on the call screen first' using errcode = '42501';
  end if;
  if p_outcome = 'call_back' and p_callback_at is null then
    raise exception 'Pick a date to call back';
  end if;
  if p_outcome = 'call_back' and v_time is not null and v_time !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Pick a time to call back';
  end if;
  if p_outcome = 'referred' and coalesce(trim(p_referred_name), '') = '' then
    raise exception 'Who were you referred to?';
  end if;
  -- A "no" always gets a short note: was it the person or the company (leadregels, deel 5)?
  if p_outcome in ('not_interested_person', 'not_interested_company', 'not_now', 'do_not_contact')
     and nullif(btrim(p_note), '') is null then
    raise exception 'Write a short note';
  end if;
  if p_outcome = 'not_now' then
    v_until := coalesce(p_until, (v_today + interval '3 months')::date);
    if v_until <= v_today then
      raise exception 'Pick a date in the future';
    end if;
  end if;

  if p_outcome = 'reached_not_interested' then
    select coalesce(array_agg(distinct btrim(r)), '{}') into v_reasons
    from unnest(coalesce(p_reasons, '{}')) as r
    where btrim(r) <> '';
    if exists (select 1 from unnest(v_reasons) as r where r !~ '^[a-z0-9_]{1,40}$') then
      raise exception 'Unknown reason';
    end if;
    if cardinality(v_reasons) = 0 and v_text is null then
      raise exception 'Pick a reason or write one';
    end if;
    if 'wrong_moment' = any (v_reasons) and p_until is null then
      raise exception 'Pick a date to get back in touch';
    end if;
    if p_until is not null and p_until <= v_today then
      raise exception 'Pick a date in the future';
    end if;
    v_park := p_until is not null;
    v_label := coalesce(nullif(btrim(p_reason_label), ''), array_to_string(v_reasons, ', '));
    v_lost := left(nullif(concat_ws('. ', nullif(v_label, ''), v_text), ''), 2000);
  end if;

  if p_outcome = 'reached_interested' and p_next_owner is not null
     and not public.has_module_for(p_next_owner, 'sales') then
    raise exception 'Pick someone from the team as owner';
  end if;

  -- What the call is about to change, for sales_undo_call.
  select coalesce(array_agg(id), '{}') into v_known
  from public.activities where company_id = v_row.company_id and created_at = v_at;
  select * into v_company from public.companies where id = v_row.company_id for update;
  v_snapshot := jsonb_build_object(
    'contact', to_jsonb(v_row),
    'company', to_jsonb(v_company),
    'others', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status))
      from public.contacts c where c.company_id = v_row.company_id and c.id <> v_row.id
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(t.id) from public.sequence_tasks t
      where t.company_id = v_row.company_id and t.channel = 'call' and t.status = 'open'
    ), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(e.id) from public.sequence_enrollments e
      where e.company_id = v_row.company_id and e.status = 'active'
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status))
      from public.campaign_members m
      where m.company_id = v_row.company_id and m.status in ('queued', 'active')
    ), '[]'::jsonb)
  );

  v_attempts := v_row.attempts + 1;
  v_status := v_row.status;
  v_role := v_row.role;

  case p_outcome
    when 'no_answer' then
      v_status := case when v_attempts >= 3 then 'not_reached' else 'in_outreach' end;
    when 'call_back' then
      v_status := 'in_outreach';
    when 'reached_interested', 'meeting_planned' then
      v_status := 'reached';
    when 'reached_not_interested' then
      -- Parked: the person waits for the date like any call back; else closed.
      v_status := case when v_park then 'in_outreach' else 'not_interested' end;
    when 'referred' then
      v_status := 'reached';
    when 'wrong_person' then
      v_status := 'reached';
      v_role := 'reserve';
    when 'wrong_number' then
      -- The right number, when known, keeps the contact in the game.
      v_status := case when v_new_phone is not null then 'in_outreach' else 'enrich' end;
    when 'not_interested_person', 'not_interested_company' then
      v_status := 'not_interested';
    when 'not_now' then
      v_status := 'reached';
    when 'do_not_contact' then
      v_status := 'do_not_contact';
  end case;

  -- Callers change only what 2.10 allows; the rest follows from the outcome.
  perform set_config('sales.source', 'handmatig', true);
  update public.contacts
  set attempts = v_attempts,
      last_attempt_at = v_at,
      status = v_status,
      role = v_role,
      phone = case when p_outcome = 'wrong_number' and v_new_phone is not null then left(v_new_phone, 50) else phone end,
      callback_at = case
        when p_outcome = 'call_back' then p_callback_at
        when p_outcome = 'reached_not_interested' and v_park then p_until
        else null end,
      referred_to = case when p_outcome = 'referred'
        then left(trim(concat_ws(', ', trim(p_referred_name), nullif(trim(p_referred_title), ''))), 300)
        else referred_to end,
      caller_note = coalesce(nullif(trim(p_note), ''), caller_note),
      claimed_by = null,
      claimed_at = null
  where id = p_contact;

  v_next_action := case p_outcome
    when 'call_back' then concat('Call back', case when v_time is not null then ' at ' || v_time end, case when v_with is not null then ' with ' || v_with end)
    when 'reached_interested' then nullif(btrim(p_next_step), '')
    else null end;
  v_next_date := case p_outcome
    when 'call_back' then p_callback_at
    when 'reached_interested' then p_next_step_at
    else null end;

  insert into public.activities (
    company_id, contact_id, channel, type, direction, outcome, notes, source, created_by, caller_id,
    next_action, next_action_date
  ) values (
    v_row.company_id, v_row.id, 'bellen', 'contact', 'outbound', p_outcome, nullif(trim(p_note), ''),
    'handmatig', v_uid, v_caller,
    v_next_action, v_next_date
  )
  returning id into v_activity;

  -- Three attempts without result: the other contacts go to Enrich (2.9).
  if p_outcome = 'no_answer' and v_attempts >= 3 then
    update public.contacts
    set status = 'enrich'
    where company_id = v_row.company_id and id <> v_row.id
      and status not in ('reached', 'not_interested', 'do_not_contact', 'not_reached');
    if not exists (
      select 1 from public.contacts
      where company_id = v_row.company_id and phone is not null
        and status not in ('not_reached', 'not_interested', 'do_not_contact', 'enrich')
    ) then
      update public.companies set lead_status = 'enrich'
      where id = v_row.company_id and lead_status in ('new', 'review', 'ready', 'in_sequence');
    end if;
  end if;

  -- A referral, or the right person after "wrong person", becomes a contact at the same company.
  if p_outcome = 'referred'
     or (p_outcome = 'wrong_person' and coalesce(trim(p_referred_name), '') <> '') then
    v_first := split_part(trim(p_referred_name), ' ', 1);
    v_last := nullif(trim(substr(trim(p_referred_name), length(v_first) + 1)), '');
    -- A mail address that another contact already has is not copied.
    if v_email is not null and exists (select 1 from public.contacts where lower(email) = lower(v_email)) then
      v_email := null;
    end if;
    insert into public.contacts (company_id, first_name, last_name, title, phone, phone_type, email, role, status, source, sources)
    values (
      v_row.company_id, v_first, v_last, nullif(trim(p_referred_title), ''), nullif(trim(p_referred_phone), ''),
      case when nullif(trim(p_referred_phone), '') is not null then 'mobiel' end,
      v_email,
      'main', case when nullif(trim(p_referred_phone), '') is null then 'enrich' else 'new' end,
      case when p_outcome = 'referred' then 'referred' else 'wrong_person' end,
      array[case when p_outcome = 'referred' then 'referred' else 'wrong_person' end]
    )
    returning id into v_new_contact;
    -- A referral from a caller stays with that caller.
    if v_caller is not null then
      update public.contacts set assigned_caller_id = v_caller, assigned_until = v_row.assigned_until
      where id = v_new_contact;
    end if;
  end if;

  if p_outcome = 'meeting_planned' then
    v_meeting := public.sales_save_meeting(v_row.company_id, v_row.id, v_caller, null,
      nullif(trim(p_note), ''), null, 'handmatig', p_actor);
  end if;

  if p_outcome = 'reached_interested' or p_outcome = 'meeting_planned' then
    update public.companies set lead_status = 'in_sequence'
    where id = v_row.company_id and lead_status in ('new', 'review', 'ready', 'enrich', 'cooled_down');
  end if;

  -- What to do next and who does it (Reached: interested).
  if p_outcome = 'reached_interested' and (v_next_action is not null or p_next_owner is not null) then
    update public.companies
    set next_action = coalesce(v_next_action, next_action),
        next_action_date = case when v_next_action is not null then p_next_step_at else next_action_date end,
        owner_id = coalesce(p_next_owner, owner_id)
    where id = v_row.company_id;
  end if;

  -- Not interested: the reasons, and the company goes to lost or parked, out of
  -- sequences, mailing and LinkedIn. A company in the pipeline is left alone.
  if p_outcome = 'reached_not_interested' then
    insert into public.call_rejections (activity_id, company_id, contact_id, caller_id, created_by, reasons, reason_text, parked_until)
    values (v_activity, v_row.company_id, v_row.id, v_caller, v_uid, v_reasons, v_text, case when v_park then p_until end);

    if v_company.pipeline_stage is null or v_company.pipeline_stage in ('lost', 'parked') then
      -- Sequences pause and open call steps go away; running campaign memberships stop.
      -- Claude takes the lead out of Instantly and Seleqt (docs/calls.md).
      perform public.sales_pause_company(v_row.company_id, left('Not interested: ' || coalesce(v_lost, ''), 500));
      update public.campaign_members set status = 'stopped'
      where company_id = v_row.company_id and status in ('queued', 'active');

      if v_park then
        update public.companies set pipeline_stage = 'parked', parked_until = p_until where id = v_row.company_id;
        perform public.sales_set_bucket(v_row.company_id, 'parked', p_until, v_lost, p_note => 'Not interested, parked until ' || p_until);
      else
        update public.companies set pipeline_stage = 'lost', lost_reason = coalesce(v_lost, 'Not interested')
        where id = v_row.company_id;
        perform public.sales_set_bucket(v_row.company_id, 'no_go', null, coalesce(v_lost, 'Not interested'), p_note => 'Not interested');
      end if;
    end if;
  end if;

  -- A no for the whole company (leadregels, deel 5): nee_geen_interesse for three
  -- months, nu_niet until the date, or do not contact for good. The status
  -- first, so the routes that stop do not cool the company down.
  if p_outcome in ('not_interested_company', 'not_now', 'do_not_contact') then
    if p_outcome = 'not_interested_company' then
      update public.companies
      set lead_status = 'nee_geen_interesse', recontact_from = (v_today + interval '3 months')::date, declined_channel = 'bellen'
      where id = v_row.company_id and lead_status <> 'do_not_contact';
    elsif p_outcome = 'not_now' then
      update public.companies set lead_status = 'nu_niet', recontact_from = v_until
      where id = v_row.company_id and lead_status <> 'do_not_contact';
    else
      update public.companies set lead_status = 'do_not_contact' where id = v_row.company_id;
      insert into public.suppression (company_id, reason, scope, notes, created_by)
      values (v_row.company_id, 'afgemeld', 'alle_kanalen', left('Do not contact via the call screen: ' || btrim(p_note), 2000), v_uid);
    end if;

    perform public.sales_pause_company(v_row.company_id, left(
      case p_outcome when 'not_interested_company' then 'No interest' when 'not_now' then 'Not now' else 'Do not contact' end
      || ': ' || btrim(p_note), 500));
    update public.campaign_members set status = 'stopped'
    where company_id = v_row.company_id and status in ('queued', 'active');

    if v_company.pipeline_stage is null or v_company.pipeline_stage in ('lost', 'parked') then
      if p_outcome = 'do_not_contact' then
        perform public.sales_set_bucket(v_row.company_id, 'no_go', null, left('Do not contact: ' || btrim(p_note), 2000), p_note => 'Do not contact');
      else
        perform public.sales_set_bucket(v_row.company_id, 'parked',
          (select recontact_from from public.companies where id = v_row.company_id),
          left(btrim(p_note), 2000),
          p_note => case p_outcome when 'not_now' then 'Not now' else 'No interest' end);
      end if;
    end if;
  end if;

  -- The call step of a sequence for this company is done.
  update public.sequence_tasks set status = 'done', done_at = now()
  where company_id = v_row.company_id and channel = 'call' and status = 'open' and due_date <= current_date;

  -- Every Activities row this call wrote carries the time of the call; the ones that were
  -- there before it started (another call in the same transaction) are not ours.
  select coalesce(array_agg(id), '{}') into v_written
  from public.activities
  where company_id = v_row.company_id and created_at = v_at and id <> all (v_known);
  insert into public.call_undo (activity_id, actor, contact_id, company_id, snapshot, new_contact_id, meeting_id, activity_ids, logged_at)
  values (v_activity, v_uid, v_row.id, v_row.company_id, v_snapshot, v_new_contact, v_meeting, v_written, v_at);
  -- Undo is for a minute; keep the table small.
  delete from public.call_undo where created_at < now() - interval '1 day';

  return jsonb_build_object(
    'attempts', v_attempts, 'status', v_status, 'new_contact_id', v_new_contact, 'meeting_id', v_meeting,
    'activity_id', v_activity
  );
end;
$function$;

-- Undo also puts back the date, the channel and a do not contact of the call.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'sales_undo_call_base' and pronamespace = 'public'::regnamespace) then
    alter function public.sales_undo_call(uuid, uuid) rename to sales_undo_call_base;
  end if;
end $$;
revoke execute on function public.sales_undo_call_base(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sales_undo_call_base(uuid, uuid) to service_role;

create or replace function public.sales_undo_call(p_activity uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_u public.call_undo;
  v_result jsonb;
begin
  select * into v_u from public.call_undo where activity_id = p_activity;
  perform set_config('sales.undo_call', 'on', true);
  v_result := public.sales_undo_call_base(p_activity, p_actor);
  if v_u.activity_id is not null then
    update public.companies co
    set lead_status = s.lead_status, recontact_from = s.recontact_from, declined_channel = s.declined_channel
    from jsonb_populate_record(null::public.companies, v_u.snapshot -> 'company') s
    where co.id = v_u.company_id;
    delete from public.suppression
    where company_id = v_u.company_id and contact_id is null and created_at = v_u.logged_at;
    -- The change rows this undo wrote.
    delete from public.activities
    where company_id = v_u.company_id and created_at = now() and type = 'change'
      and field in ('lead_status', 'recontact_from', 'declined_channel');
  end if;
  perform set_config('sales.undo_call', '', true);
  return v_result;
end;
$$;

revoke execute on function public.sales_undo_call(uuid, uuid) from public, anon;
grant execute on function public.sales_undo_call(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Tiers and contact 1 and 2
-- ---------------------------------------------------------------------------

-- Tier 1 technical (CTO, head of engineering, data or IT, tech lead), tier 2
-- owner or board (CEO, founder, directeur), tier 3 HR or recruitment.
create or replace function public.contact_tier_for_title(p_title text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when v is null or v = '' then null
    when v ~ '\mcto\M' or v ~ '\mcdo\M' or v ~ '\mcio\M'
      or v ~ '\mchief (technology|technical|data|information|digital) officer\M'
      or v ~ '\mhead of (engineering|data|development|software|technology|tech|it|ict|bi|business intelligence|analytics|platform)\M'
      or v ~ '\mv\.?p\.? (of )?(engineering|technology|data)\M'
      or v ~ '\mvice president (of )?(engineering|technology|data)\M'
      or v ~ '\m(engineering|development|it|ict|data|bi|software) manager\M'
      or v ~ '\mmanager (it|ict|data|bi|engineering|development|software)\M'
      or v ~ '\m(director|directeur) (of )?(engineering|technology|data|it|ict)\M'
      or v ~ '\m(it|ict)[ -]?(director|directeur)\M'
      or v ~ '\mtechnisch directeur\M'
      or v ~ '\mtech(nical)? lead\M' or v ~ '\mlead (developer|engineer|architect)\M' or v ~ '\mteam ?lead (development|engineering|data|bi)\M'
      or v ~ '\mhoofd (ontwikkeling|engineering|data|software|it|ict|bi|automatisering)' then 1
    when v ~ '\mrecruit' or v ~ '\mhr\M' or v ~ '\mhuman resources\M' or v ~ '\mtalent\M' or v ~ '\mp&o\M' then 3
    when v ~ '\mowner\M'
      or v ~ '\m(co[ -]?)?founder\M'
      or v ~ '\moprichter\M'
      or v ~ '\meigenaar\M'
      or v ~ '\mdirecteur\M'
      or v ~ '\mdirector\M'
      or v ~ '\mceo\M'
      or v ~ '\mchief executive\M'
      or v ~ '\mmanaging (director|partner)\M' then 2
    else null
  end
  from (select lower(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g')) as v) t;
$$;

/** Head of data or BI, for a data vacancy. */
create or replace function public.sales_is_data_lead_title(p_title text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(p_title), '') ~ '(\mcdo\M|chief data|head of (data|bi|business intelligence|analytics)|hoofd (data|bi)|(data|bi|analytics) (lead|manager|director|directeur)|(lead|manager|director) (of )?(data|bi|analytics)|teamlead (data|bi))';
$$;

/**
 * The contacts of a company in the default order (leadregels, deel 4):
 * a data vacancy puts the head of data or BI first; under about 30 FTE tier 2
 * (owner) before tier 1 (technical), from 30 tier 1 first; tier 3 (HR) only
 * when there is no tier 1 or 2. Contacts that are out (not interested, do not
 * contact, left, wrong person) are not in the list.
 */
create or replace function public.sales_default_contact_order(p_company uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with co as (
    select c.id, c.employees, c.category,
      exists (
        select 1 from public.signals s
        where s.company_id = c.id and s.type = 'vacature' and s.closed_at is null
          and (coalesce(s.role_group, '') ~* '(data|\mbi\M)' or coalesce(s.title, '') ~* '(\mdata\M|\mbi\M|business intelligence|analytics|power ?bi)')
      ) or c.category = 'data_bi' as data_vacancy
    from public.companies c where c.id = p_company
  )
  select coalesce(array_agg(k.id order by
      case when co.data_vacancy and public.sales_is_data_lead_title(k.title) then 0 else 1 end,
      case
        when k.tier = 1 then case when coalesce(co.employees, 30) < 30 then 2 else 1 end
        when k.tier = 2 then case when coalesce(co.employees, 30) < 30 then 1 else 2 end
        when k.tier = 3 then 4
        else 3
      end,
      (k.phone is null), (k.email is null), k.created_at, k.id
    ), '{}')
  from public.contacts k cross join co
  where k.company_id = p_company
    and k.status not in ('not_interested', 'do_not_contact')
    and k.contact_flag is distinct from 'left_company'
    and k.contact_flag is distinct from 'wrong_person';
$$;

/**
 * Contact 1 (role main) and contact 2 (reserve) in the default order, the rest
 * extra. Leaves a company alone whose contacts were picked by hand, unless
 * p_force (the button "Use default order", which also clears that).
 */
create or replace function public.sales_order_contacts(p_company uuid, p_force boolean)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid[];
  v_manual boolean;
begin
  select contact_order_manual into v_manual from public.companies where id = p_company;
  if not found or (v_manual and not p_force) then
    return null;
  end if;
  v_order := public.sales_default_contact_order(p_company);
  perform set_config('sales.skip_roles', 'on', true);
  -- First the others (so one primary trigger has nothing to clear), then contact 1.
  update public.contacts k
  set role = case when k.id = v_order[2] then 'reserve' else 'extra' end, is_primary = false
  where k.company_id = p_company and k.id is distinct from v_order[1]
    and (k.role is distinct from case when k.id = v_order[2] then 'reserve' else 'extra' end or k.is_primary);
  if v_order[1] is not null then
    update public.contacts set role = 'main', is_primary = true
    where id = v_order[1] and (role <> 'main' or not is_primary);
  end if;
  perform set_config('sales.skip_roles', '', true);
  if p_force then
    update public.companies set contact_order_manual = false where id = p_company and contact_order_manual;
  end if;
  return v_order[1:2];
end;
$$;

revoke execute on function public.sales_order_contacts(uuid, boolean) from public, anon, authenticated;
grant execute on function public.sales_order_contacts(uuid, boolean) to service_role;

/** "Use default order" on the lead page and for Claude: contacts 1 and 2 by the rules, from now on automatic. */
create or replace function public.sales_apply_contact_order(p_company uuid, p_source text default 'handmatig', p_actor uuid default null)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, p_source);
begin
  if public.caller_id_for(v_uid) is not null then
    raise exception 'Callers cannot change the contact order' using errcode = '42501';
  end if;
  return public.sales_order_contacts(p_company, true);
end;
$$;

revoke execute on function public.sales_default_contact_order(uuid) from public, anon;
grant execute on function public.sales_default_contact_order(uuid) to authenticated, service_role;
revoke execute on function public.sales_apply_contact_order(uuid, text, uuid) from public, anon;
grant execute on function public.sales_apply_contact_order(uuid, text, uuid) to authenticated, service_role;

-- A new or changed contact puts contacts 1 and 2 in the default order (unless picked by hand).
create or replace function public.contacts_default_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if coalesce(current_setting('sales.skip_roles', true), '') = 'on' or pg_trigger_depth() > 1 then
    return null;
  end if;
  for v_company in
    select distinct company_id from new_rows
    where company_id in (select id from public.companies where not contact_order_manual)
  loop
    perform public.sales_order_contacts(v_company, false);
  end loop;
  return null;
end;
$$;

drop trigger if exists contacts_default_order_insert on public.contacts;
create trigger contacts_default_order_insert after insert on public.contacts
  referencing new table as new_rows
  for each statement execute function public.contacts_default_order();
drop trigger if exists contacts_default_order_update on public.contacts;
create trigger contacts_default_order_update after update on public.contacts
  referencing new table as new_rows
  for each statement execute function public.contacts_default_order();

-- The companies that have contacts keep the order they have now; new ones follow the default.
update public.companies c set contact_order_manual = true
where exists (select 1 from public.contacts k where k.company_id = c.id) and not c.contact_order_manual;

-- ---------------------------------------------------------------------------
-- 9. May we approach this domain or mail address?
-- ---------------------------------------------------------------------------

/**
 * Per domain or mail address: allowed yes or no, with the reasons. A domain
 * that is not in the portal is allowed. Reasons: own contact, pipeline, do not
 * contact, no go, in sequence, campagne X, nee_geen_interesse tot datum,
 * nu_niet tot datum, minder dan 1 week sinds de vorige route zonder nieuw signaal.
 */
create or replace function public.sales_check_outreach(p_items text[], p_actor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item text;
  v_clean text;
  v_email text;
  v_domain text;
  v_contact public.contacts;
  v_company public.companies;
  v_reasons text[];
  v_out jsonb := '[]';
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_campaign text;
  v_free boolean;
begin
  if (select auth.role()) <> 'service_role' and not public.has_module('sales') then
    raise exception 'No access to sales' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_items), 0) > 2000 then
    raise exception 'At most 2000 at once';
  end if;

  foreach v_item in array coalesce(p_items, '{}') loop
    v_clean := lower(btrim(coalesce(v_item, '')));
    continue when v_clean = '';
    v_contact := null;
    v_company := null;
    v_email := null;
    v_reasons := '{}';

    if v_clean like '%@%' then
      v_email := regexp_replace(v_clean, '^mailto:', '');
      v_domain := public.normalize_domain(split_part(v_email, '@', 2));
      select * into v_contact from public.contacts where lower(email) = v_email order by created_at limit 1;
      if v_contact.id is not null then
        select * into v_company from public.companies where id = v_contact.company_id;
      end if;
    else
      v_domain := public.normalize_domain(v_clean);
    end if;
    v_free := v_domain ~ '^(gmail|googlemail|hotmail|outlook|live|icloud|me|yahoo|ziggo|kpnmail|kpnplanet|planet|xs4all|home|chello|hetnet|casema|quicknet|upcmail|protonmail|proton)\.';
    if v_company.id is null and v_domain is not null and not v_free then
      select * into v_company from public.companies
      where domain = v_domain or v_domain = any (alias_domains)
      order by (domain = v_domain) desc, created_at
      limit 1;
    end if;

    if v_company.id is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'input', v_item, 'allowed', true, 'company_id', null, 'company', null,
        'reasons', jsonb_build_array('not in the portal')));
      continue;
    end if;

    if v_company.own_contact or v_company.client_id is not null or v_company.status = 'klant' then
      v_reasons := v_reasons || coalesce('own contact (' || nullif(v_company.own_contact_reason, '') || ')', 'own contact');
    end if;
    if v_company.pipeline_stage is not null and v_company.pipeline_stage <> 'lost' then
      v_reasons := v_reasons || ('pipeline (' || v_company.pipeline_stage || ')');
    end if;
    if v_company.lead_status = 'do_not_contact'
       or exists (select 1 from public.suppression s where s.company_id = v_company.id and s.scope in ('alle_kanalen', 'alleen_mail'))
       or (v_contact.id is not null and (v_contact.status = 'do_not_contact' or v_contact.no_mail
           or exists (select 1 from public.suppression s where (s.contact_id = v_contact.id or lower(s.email) = v_email) and s.scope in ('alle_kanalen', 'alleen_mail'))))
       or (v_email is not null and exists (select 1 from public.suppression s where lower(s.email) = v_email and s.scope in ('alle_kanalen', 'alleen_mail'))) then
      v_reasons := v_reasons || 'do not contact'::text;
    end if;
    if v_company.lead_status = 'no_go' or v_company.icp_decision = 'NO_GO' then
      v_reasons := v_reasons || coalesce('no go: ' || nullif(btrim(v_company.icp_reason), ''), 'no go');
    end if;
    if v_company.lead_status = 'in_sequence'
       or exists (select 1 from public.sequence_enrollments e where e.company_id = v_company.id and e.status in ('active', 'paused')) then
      v_reasons := v_reasons || 'in sequence'::text;
    end if;
    select c.name into v_campaign
    from public.campaign_members m join public.campaigns c on c.id = m.campaign_id
    where m.company_id = v_company.id and m.status in ('queued', 'active') and c.status in ('active', 'paused', 'draft')
    order by m.added_at desc limit 1;
    if v_campaign is not null then
      v_reasons := v_reasons || ('campagne ' || v_campaign);
    end if;
    if v_company.lead_status = 'nee_geen_interesse' and v_company.recontact_from > v_today then
      v_reasons := v_reasons || ('nee_geen_interesse tot ' || to_char(v_company.recontact_from, 'YYYY-MM-DD'));
    end if;
    if v_company.lead_status = 'nu_niet' and v_company.recontact_from > v_today then
      v_reasons := v_reasons || ('nu_niet tot ' || to_char(v_company.recontact_from, 'YYYY-MM-DD'));
    end if;
    if v_company.lead_status = 'cooled_down' and v_company.recontact_from > v_today then
      v_reasons := v_reasons || 'minder dan 1 week sinds de vorige route zonder nieuw signaal'::text;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'input', v_item,
      'allowed', cardinality(v_reasons) = 0,
      'company_id', v_company.id,
      'company', v_company.name,
      'contact_id', v_contact.id,
      'lead_status', v_company.lead_status,
      'reasons', to_jsonb(v_reasons)
    ));
  end loop;
  return v_out;
end;
$$;

revoke execute on function public.sales_check_outreach(text[], uuid) from public, anon;
grant execute on function public.sales_check_outreach(text[], uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- A company in a running campaign is in sequence.
select public.sales_mark_in_sequence(m.company_id)
from (
  select distinct m.company_id from public.campaign_members m
  join public.campaigns c on c.id = m.campaign_id
  where m.status in ('queued', 'active') and c.status = 'active'
) m;

-- Scores from the segment and the signals (scores without segment go).
select public.sales_refresh_scores(null);

-- The daily run at 04:15 UTC (05:15 in Amsterdam in winter, 06:15 in summer).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sales-daily-tick', '15 4 * * *', 'select public.sales_daily_tick()');
  end if;
end $$;
