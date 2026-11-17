-- Call screen: change contacts while calling (feedback Julius, 7200c28b
-- "contactpersonen bewerken op het belscherm").
--
-- A caller has no table access (RLS), so the call screen works with the
-- secret key after requireCaller() and passes the profile of the caller as
-- p_actor, like sales_log_call. Three functions, nothing else:
--
--   sales_caller_update_contact   name, job title, mobile number and mail
--   sales_caller_mark_phone       mark the mobile number as wrong (or clear it)
--   sales_caller_add_contact      a new contact at the company
--
-- What a caller may do:
--   * only contacts of a company where they hold a contact on the call screen
--     (contacts.claimed_by = them, set by sales_claim_contact), so not any
--     contact in the portal;
--   * only those fields: no status, role, assignment, LinkedIn or the call
--     rules (sales_log_call stays the only way to log an outcome);
--   * every change is in Activities with their caller_id, by the existing
--     change log (sales_log_changes) and for the wrong number mark and a new
--     contact by a row written here.
-- The team (a session with the Sales module) may use the same functions for
-- any contact.
--
-- A number marked wrong stays stored (so nobody types it in again) and
-- contacts.phone_wrong_at says since when; the call screen then dials the
-- general number of the company instead. Changing the number clears the mark.
--
-- Not applied by this file's author: run it through the Supabase MCP or the
-- CLI like every other migration (README).

alter table public.contacts
  add column if not exists phone_wrong_at timestamptz;

comment on column public.contacts.phone_wrong_at is 'A caller marked the mobile number as wrong; cleared when the number changes.';

-- May this person change contacts of this company on the call screen?
create or replace function public.sales_call_can_edit(p_uid uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.caller_id_for(p_uid) is null
    or exists (
      select 1 from public.contacts c
      where c.company_id = p_company and c.claimed_by = p_uid
    );
$$;

revoke execute on function public.sales_call_can_edit(uuid, uuid) from public, anon, authenticated;

create or replace function public.sales_call_contact_json(p_contact uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'company_id', c.company_id,
    'first_name', c.first_name,
    'last_name', c.last_name,
    'full_name', c.full_name,
    'title', c.title,
    'phone', c.phone,
    'email', c.email,
    'phone_wrong_at', c.phone_wrong_at
  )
  from public.contacts c
  where c.id = p_contact;
$$;

revoke execute on function public.sales_call_contact_json(uuid) from public, anon, authenticated;

-- Checks shared by update and add: trimmed values, lengths, a number and a mail that look like one.
create or replace function public.sales_call_clean_person(
  p_first text, p_last text, p_title text, p_phone text, p_email text,
  out o_first text, out o_last text, out o_title text, out o_phone text, out o_email text
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  o_first := nullif(btrim(p_first), '');
  o_last := nullif(btrim(p_last), '');
  o_title := nullif(btrim(p_title), '');
  o_phone := nullif(btrim(p_phone), '');
  o_email := nullif(lower(btrim(p_email)), '');
  if o_first is null and o_last is null then
    raise exception 'A contact needs a name' using errcode = '22023';
  end if;
  if char_length(coalesce(o_first, '')) > 100 or char_length(coalesce(o_last, '')) > 100 then
    raise exception 'Use at most 100 characters for a name' using errcode = '22023';
  end if;
  if char_length(coalesce(o_title, '')) > 200 then
    raise exception 'Use at most 200 characters for a job title' using errcode = '22023';
  end if;
  if o_phone is not null and o_phone !~ '^[0-9+()./ -]{5,50}$' then
    raise exception 'That number does not look right' using errcode = '22023';
  end if;
  if o_email is not null and (char_length(o_email) > 320 or o_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'That mail address does not look right' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.sales_call_clean_person(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.sales_caller_update_contact(
  p_contact uuid,
  p_first_name text,
  p_last_name text,
  p_title text,
  p_phone text,
  p_email text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_row public.contacts;
  v_first text;
  v_last text;
  v_title text;
  v_phone text;
  v_email text;
begin
  select * into v_row from public.contacts where id = p_contact for update;
  if v_row.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if not public.sales_call_can_edit(v_uid, v_row.company_id) then
    raise exception 'Open a contact of this company on the call screen first' using errcode = '42501';
  end if;
  select o_first, o_last, o_title, o_phone, o_email
  into v_first, v_last, v_title, v_phone, v_email
  from public.sales_call_clean_person(p_first_name, p_last_name, p_title, p_phone, p_email);

  if v_email is not null and exists (
    select 1 from public.contacts c
    where c.company_id = v_row.company_id and c.id <> v_row.id and lower(c.email) = v_email
  ) then
    raise exception 'Another contact of this company already has this mail address' using errcode = '23505';
  end if;

  update public.contacts
  set first_name = v_first,
      last_name = v_last,
      title = v_title,
      phone = v_phone,
      email = v_email,
      -- A new mail address has not been checked yet; a new number is not wrong until someone says so.
      email_status = case when v_email is distinct from v_row.email then null else email_status end,
      phone_wrong_at = case when v_phone is distinct from v_row.phone then null else phone_wrong_at end
  where id = p_contact;

  return public.sales_call_contact_json(p_contact);
end;
$$;

create or replace function public.sales_caller_mark_phone(
  p_contact uuid,
  p_wrong boolean,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid;
  v_row public.contacts;
  v_at timestamptz;
begin
  v_caller := public.caller_id_for(v_uid);
  select * into v_row from public.contacts where id = p_contact for update;
  if v_row.id is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;
  if not public.sales_call_can_edit(v_uid, v_row.company_id) then
    raise exception 'Open a contact of this company on the call screen first' using errcode = '42501';
  end if;
  if v_row.phone is null then
    raise exception 'This contact has no number' using errcode = '22023';
  end if;
  v_at := case when p_wrong then coalesce(v_row.phone_wrong_at, now()) else null end;
  if v_at is distinct from v_row.phone_wrong_at then
    update public.contacts set phone_wrong_at = v_at where id = p_contact;
    insert into public.activities (
      company_id, contact_id, channel, type, field, old_value, new_value, source, created_by, caller_id
    ) values (
      v_row.company_id, v_row.id, 'system', 'change', 'phone_wrong_at',
      to_jsonb(v_row.phone_wrong_at), to_jsonb(v_at), 'handmatig', v_uid, v_caller
    );
  end if;
  return public.sales_call_contact_json(p_contact);
end;
$$;

create or replace function public.sales_caller_add_contact(
  p_company uuid,
  p_first_name text,
  p_last_name text,
  p_title text,
  p_phone text,
  p_email text,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.sales_actor(p_actor, 'handmatig');
  v_caller uuid;
  v_first text;
  v_last text;
  v_title text;
  v_phone text;
  v_email text;
  v_id uuid;
begin
  v_caller := public.caller_id_for(v_uid);
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  if not public.sales_call_can_edit(v_uid, p_company) then
    raise exception 'Open a contact of this company on the call screen first' using errcode = '42501';
  end if;
  select o_first, o_last, o_title, o_phone, o_email
  into v_first, v_last, v_title, v_phone, v_email
  from public.sales_call_clean_person(p_first_name, p_last_name, p_title, p_phone, p_email);

  if v_email is not null and exists (
    select 1 from public.contacts c where c.company_id = p_company and lower(c.email) = v_email
  ) then
    raise exception 'Another contact of this company already has this mail address' using errcode = '23505';
  end if;

  -- Like a referral: an extra contact, to Enrich when there is no number, and with the caller who found it.
  insert into public.contacts (company_id, first_name, last_name, title, phone, phone_type, email, role, status, source, sources)
  values (
    p_company, v_first, v_last, v_title, v_phone,
    case when v_phone is not null then 'mobiel' end,
    v_email, 'extra', case when v_phone is null then 'enrich' else 'new' end,
    'caller', array['caller']
  )
  returning id into v_id;
  if v_caller is not null then
    update public.contacts set assigned_caller_id = v_caller where id = v_id;
  end if;

  insert into public.activities (company_id, contact_id, channel, type, outcome, notes, source, created_by, caller_id)
  values (p_company, v_id, 'system', 'note', 'notitie', 'Contact added on the call screen', 'handmatig', v_uid, v_caller);

  return public.sales_call_contact_json(v_id);
end;
$$;

revoke execute on function public.sales_caller_update_contact(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.sales_caller_update_contact(uuid, text, text, text, text, text, uuid) to authenticated, service_role;
revoke execute on function public.sales_caller_mark_phone(uuid, boolean, uuid) from public, anon;
grant execute on function public.sales_caller_mark_phone(uuid, boolean, uuid) to authenticated, service_role;
revoke execute on function public.sales_caller_add_contact(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.sales_caller_add_contact(uuid, text, text, text, text, text, uuid) to authenticated, service_role;
