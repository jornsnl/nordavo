-- Calls, callers and meetings (feedback Julius, sections 2.9 to 2.11), on top
-- of 20261110010000_sales_crm.sql:
--
--   1  The portal role in the session token, so the proxy keeps external
--      callers on /caller without a query per request
--   2  Pausing or stopping a caller: timestamps, open contacts released, a
--      stopped caller loses their contacts and call lists
--   3  Only admins approve or reject meetings and change the fee

-- ---------------------------------------------------------------------------
-- 1. profiles.role mirrored to auth.users.raw_app_meta_data.portal_role
-- ---------------------------------------------------------------------------

-- app_metadata ends up in the JWT. Only the database (and the service role)
-- can write it, so a user cannot change it from the browser.
create or replace function public.profiles_sync_portal_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('portal_role', new.role)
  where id = new.id
    and (raw_app_meta_data ->> 'portal_role') is distinct from new.role;
  return null;
end;
$$;

revoke execute on function public.profiles_sync_portal_role() from public, anon, authenticated;

create trigger profiles_sync_portal_role after insert or update of role on public.profiles
  for each row execute function public.profiles_sync_portal_role();

update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('portal_role', p.role)
from public.profiles p
where p.id = u.id
  and (u.raw_app_meta_data ->> 'portal_role') is distinct from p.role;

-- ---------------------------------------------------------------------------
-- 2. Caller status
-- ---------------------------------------------------------------------------

create or replace function public.callers_track_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'paused' then
      new.paused_at := now();
    elsif new.status = 'stopped' then
      new.stopped_at := now();
    elsif new.status = 'active' then
      new.paused_at := null;
      new.stopped_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger callers_track_status before update of status on public.callers
  for each row execute function public.callers_track_status();

-- Access goes at once (current_caller_id checks the status); what the caller
-- had open is released. A stopped caller also gives back their contacts and
-- call lists, so the team or another caller can pick them up.
create or replace function public.callers_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status or new.status = 'active' then
    return null;
  end if;
  -- The change log names the admin who paused or stopped the caller.
  perform set_config('sales.actor', coalesce((select auth.uid())::text, ''), true);
  perform set_config('sales.source', 'handmatig', true);
  if new.profile_id is not null then
    update public.contacts set claimed_by = null, claimed_at = null where claimed_by = new.profile_id;
  end if;
  if new.status = 'stopped' then
    update public.contacts set assigned_caller_id = null, assigned_until = null where assigned_caller_id = new.id;
    delete from public.call_list_callers where caller_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.callers_after_status() from public, anon, authenticated;

create trigger callers_after_status after update of status on public.callers
  for each row execute function public.callers_after_status();

-- ---------------------------------------------------------------------------
-- 3. Meetings: approving, rejecting and the fee are for admins (Julius)
-- ---------------------------------------------------------------------------

create or replace function public.meetings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The secret key (Cal.com webhook, caller pages) and the database itself.
  if (select auth.role()) = 'service_role' or (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;
  if new.status is distinct from old.status
     and (new.status in ('approved', 'rejected') or old.status in ('approved', 'rejected')) then
    raise exception 'Only an admin approves or rejects a meeting' using errcode = '42501';
  end if;
  -- A new caller brings their own fee (meetings_default_fee); anything else is a change.
  if new.fee is distinct from old.fee and new.caller_id is not distinct from old.caller_id then
    raise exception 'Only an admin changes the fee of a meeting' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.meetings_guard() from public, anon, authenticated;

-- Runs after meetings_default_fee (triggers fire in name order).
create trigger meetings_guard before update on public.meetings
  for each row execute function public.meetings_guard();
