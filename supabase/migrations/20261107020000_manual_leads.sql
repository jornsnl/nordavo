-- Leads and contacts added by hand in the portal ("Add lead", "Add contact").
--
-- They are ordinary rows in companies and contacts with source = 'manual'
-- (the free-text source column that the flow and the CSV import already
-- fill). No new columns are needed. Writes go through RLS as staff
-- ("Staff manage companies" / "Staff manage contacts").
--
-- The flow writes companies and contacts all the time with the service role,
-- so these tables have no general activity trigger. Only manual inserts are
-- logged, in the same activity_log the other portal records use.

-- A manual lead: the standard trigger, "<name> aangemaakt" on the lead.
create trigger companies_manual_activity after insert on public.companies
  for each row when (new.source = 'manual')
  execute function public.log_activity('company');

-- A manual contact: logged on the lead it belongs to, so it shows up in the
-- lead's timeline. The change key contact_added is read by describeActivity.
create or replace function public.log_manual_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_name text;
begin
  select name into v_company from public.companies where id = new.company_id;
  v_name := nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
  v_name := concat_ws(', ', coalesce(v_name, new.email, 'Onbekend'), nullif(trim(new.title), ''));

  insert into public.activity_log (entity_type, entity_id, action, summary, changes, actor_id)
  values (
    'company',
    new.company_id,
    'updated',
    trim(both ' ' from coalesce(v_company, '') || ' contact toegevoegd'),
    jsonb_build_object('contact_added', jsonb_build_object('from', null, 'to', v_name)),
    (select auth.uid())
  );
  return null;
end;
$$;

revoke execute on function public.log_manual_contact() from public, anon, authenticated;

create trigger contacts_manual_activity after insert on public.contacts
  for each row when (new.source = 'manual')
  execute function public.log_manual_contact();
