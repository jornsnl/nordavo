-- Calling through your own phone system (feedback Julius, b6942cdc "Bellen
-- via eigen belsysteem (Dubline) met gesprek en opname bij lead").
--
--   * profiles.dial_template: per person how the call button dials. Empty is
--     a tel: link; otherwise a URL with {number} (for example the click to
--     call link of Dubline or another phone system). Set in Settings or, for
--     an external caller, on /caller.
--   * activities.recording_url, duration_seconds, telephony_id: a call that
--     the phone system reports through /api/webhooks/calls lands at the lead
--     with its recording (docs/calls.md).
--   * source 'telephony' for those activities.
--   * sales_find_phone(): the contacts and companies with a number, matched
--     on its digits (+31 6..., 06..., 0031 6... are the same number).
--   * sales_log_phone_call(): the write path of the webhook (secret key only).

alter table public.profiles
  add column if not exists dial_template text check (
    dial_template is null
    or (char_length(dial_template) <= 500 and dial_template ~ '\{(number|digits|local)\}'
        and (dial_template ~* '^https://' or dial_template ~* '^(tel|callto|sip|dubline):'))
  );

comment on column public.profiles.dial_template is 'How the call buttons dial for this person: empty is tel:, else a URL with {number} (docs/calls.md).';

alter table public.activities
  add column if not exists recording_url text check (recording_url is null or (char_length(recording_url) <= 2000 and recording_url ~* '^https://')),
  add column if not exists duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  add column if not exists telephony_id text check (char_length(telephony_id) <= 200);

-- 'telephony' as a source, keeping every source that is already allowed.
do $$
declare
  v_def text;
  v_values text[];
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activities'::regclass and conname = 'activities_source_check';
  select array_agg(distinct m[1]) into v_values
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
  if v_values is null or not ('telephony' = any (v_values)) then
    v_values := array(select distinct x from unnest(coalesce(v_values, '{}') || array[
      'handmatig', 'instantly', 'webpartners', 'calcom', 'onepage', 'import', 'seleqt', 'system', 'claude', 'apify', 'prospeo', 'telephony'
    ]) x order by x);
    alter table public.activities drop constraint if exists activities_source_check;
    execute format(
      'alter table public.activities add constraint activities_source_check check (source in (%s))',
      (select string_agg(quote_literal(x), ', ') from unnest(v_values) x)
    );
  end if;
end;
$$;

-- The digits of a phone number in one form: 31612345678 for +31 6 1234 5678,
-- 06 12345678 and 0031 612345678. Mirrored in src/lib/sales/telephony.ts.
create or replace function public.sales_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d is null or d = '' then null
    when d like '00%' then substr(d, 3)
    when d like '0%' then '31' || substr(d, 2)
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x;
$$;

create index if not exists contacts_phone_key_idx on public.contacts (public.sales_phone_key(phone)) where phone is not null;
create index if not exists companies_phone_key_idx on public.companies (public.sales_phone_key(general_phone)) where general_phone is not null;

create or replace function public.sales_find_phone(p_phone text)
returns table (contact_id uuid, company_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.company_id
  from public.contacts c
  where c.phone is not null and public.sales_phone_key(c.phone) = public.sales_phone_key(p_phone)
  union all
  select null::uuid, co.id
  from public.companies co
  where co.general_phone is not null and public.sales_phone_key(co.general_phone) = public.sales_phone_key(p_phone)
    and not exists (
      select 1 from public.contacts c2
      where c2.company_id = co.id and c2.phone is not null
        and public.sales_phone_key(c2.phone) = public.sales_phone_key(p_phone)
    );
$$;

revoke execute on function public.sales_find_phone(text) from public, anon, authenticated;
grant execute on function public.sales_find_phone(text) to service_role;

-- One call from the phone system, at the lead it matched. telephony_id makes
-- a second delivery of the same call a no-op (the recording is added when it
-- comes later). Returns the activity id, or null when nothing matched.
create or replace function public.sales_log_phone_call(
  p_external_id text,
  p_phone text,
  p_direction text,
  p_started_at timestamptz,
  p_duration integer,
  p_recording_url text,
  p_answered boolean,
  p_agent_email text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_company uuid;
  v_agent uuid;
  v_caller uuid;
  v_id uuid;
  v_external text := 'telephony:' || left(p_external_id, 180);
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Only the phone system webhook logs calls' using errcode = '42501';
  end if;

  select id into v_id from public.activities where external_id = v_external;
  if v_id is not null then
    update public.activities
    set recording_url = coalesce(nullif(p_recording_url, ''), recording_url),
        duration_seconds = coalesce(p_duration, duration_seconds)
    where id = v_id;
    return v_id;
  end if;

  select f.contact_id, f.company_id into v_contact, v_company
  from public.sales_find_phone(p_phone) f
  order by (f.contact_id is null)
  limit 1;
  if v_company is null then
    return null;
  end if;

  if nullif(btrim(p_agent_email), '') is not null then
    select p.id into v_agent from public.profiles p where lower(p.email) = lower(btrim(p_agent_email)) limit 1;
    v_caller := public.caller_id_for(v_agent);
  end if;

  perform set_config('sales.actor', coalesce(v_agent::text, ''), true);
  perform set_config('sales.source', 'telephony', true);

  insert into public.activities (
    company_id, contact_id, channel, type, direction, outcome, notes, date, source, external_id,
    created_by, caller_id, recording_url, duration_seconds, telephony_id
  ) values (
    v_company, v_contact, 'bellen', 'contact',
    case when p_direction in ('inbound', 'outbound') then p_direction else 'outbound' end,
    case when p_answered is false then 'no_answer' end,
    left(nullif(btrim(p_notes), ''), 5000),
    coalesce(p_started_at, now()), 'telephony', v_external,
    v_agent, v_caller, nullif(p_recording_url, ''), p_duration, left(p_external_id, 200)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.sales_log_phone_call(text, text, text, timestamptz, integer, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.sales_log_phone_call(text, text, text, timestamptz, integer, text, boolean, text, text) to service_role;

-- Everyone sets their own dial template (like the booking link).
grant update (dial_template) on public.profiles to authenticated;
