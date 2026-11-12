-- Leads and Contacts: LinkedIn links kept as given, member ids, roles and
-- tiers, call notes out of the description, possible duplicates, merging
-- and the facts of the tables (supabase/migrations/202611233*_leads_*.sql).
-- Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leads_contacts.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000033a1', 'sales33@nordavo.nl', '{"full_name": "Sales"}'),
  ('00000000-0000-0000-0000-0000000033a2', 'recruiter33@nordavo.nl', '{"full_name": "Recruiter"}');
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000033a1';
update public.profiles set role = 'member', modules = array['recruitment'] where id = '00000000-0000-0000-0000-0000000033a2';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
grant execute on function pg_temp.act(uuid) to authenticated;

insert into public.companies (id, name, domain, linkedin_url, description) values
  ('00000000-0000-0000-0000-0000000033c1', 'Brightcape', 'brightcape.nl', 'linkedin.com/company/brightcape', null),
  ('00000000-0000-0000-0000-0000000033c2', 'Brightcape B.V.', 'brightcape.com', null, 'Apps.'),
  ('00000000-0000-0000-0000-0000000033c3', 'Semplor', 'semplor.nl', null, null);

-- ---------------------------------------------------------------------------
-- LinkedIn: case kept, https://, a lowercase key for matching
-- ---------------------------------------------------------------------------

insert into public.contacts (id, company_id, first_name, last_name, title, linkedin_url) values
  ('00000000-0000-0000-0000-0000000033e1', '00000000-0000-0000-0000-0000000033c1', 'Nick', 'Dijk', 'CTO', 'nl.linkedin.com/in/ACwAAB12CdEfGh/?trk=x'),
  ('00000000-0000-0000-0000-0000000033e2', '00000000-0000-0000-0000-0000000033c1', 'Anna', 'Berg', 'Founder', null),
  ('00000000-0000-0000-0000-0000000033e3', '00000000-0000-0000-0000-0000000033c1', 'Cees', 'Bos', 'Recruiter', null);

do $$ begin
  if (select linkedin_url from public.contacts where id = '00000000-0000-0000-0000-0000000033e1') <> 'https://www.linkedin.com/in/ACwAAB12CdEfGh' then
    raise exception 'FAIL: the link should keep its case and get https://';
  end if;
  if (select linkedin_member_urn from public.contacts where id = '00000000-0000-0000-0000-0000000033e1') <> 'ACwAAB12CdEfGh' then
    raise exception 'FAIL: the member id should come from the Apify link';
  end if;
  if (select linkedin_url from public.companies where id = '00000000-0000-0000-0000-0000000033c1') <> 'https://www.linkedin.com/company/brightcape' then
    raise exception 'FAIL: a company page should get https://';
  end if;
end $$;

do $$ begin
  insert into public.contacts (company_id, first_name, linkedin_url)
  values ('00000000-0000-0000-0000-0000000033c3', 'Copy', 'https://www.linkedin.com/in/acwaab12cdefgh');
  raise exception 'FAIL: the same profile in another case should be refused';
exception when unique_violation then null;
end $$;

-- ---------------------------------------------------------------------------
-- Roles and tiers: one main per company, then backup, then extra
-- ---------------------------------------------------------------------------

do $$ begin
  if (select string_agg(first_name || ':' || role || ':' || coalesce(tier::text, '-') || ':' || is_primary::text, ',' order by first_name)
      from public.contacts where company_id = '00000000-0000-0000-0000-0000000033c1')
     <> 'Anna:reserve:2:false,Cees:extra:3:false,Nick:main:1:true' then
    raise exception 'FAIL: roles should be main, backup, extra with the tier of the title, got %',
      (select string_agg(first_name || ':' || role || ':' || coalesce(tier::text, '-'), ',' order by first_name)
       from public.contacts where company_id = '00000000-0000-0000-0000-0000000033c1');
  end if;
end $$;

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000033a1');

select public.sales_update('contact', array['00000000-0000-0000-0000-0000000033e2'::uuid], '{"role": "main"}'::jsonb);
do $$ begin
  if (select role || ':' || is_primary::text from public.contacts where id = '00000000-0000-0000-0000-0000000033e2') <> 'main:true'
     or (select role || ':' || is_primary::text from public.contacts where id = '00000000-0000-0000-0000-0000000033e1') <> 'reserve:false' then
    raise exception 'FAIL: a new main should be primary and move the old main to backup';
  end if;
end $$;

-- The member id next to a normal link, through the sales rights.
select public.sales_set_contact_linkedin('00000000-0000-0000-0000-0000000033e3', 'https://www.linkedin.com/in/Cees-Bos', 'ACwAAC33Xy99zz');
do $$ begin
  if (select linkedin_url || ' ' || linkedin_member_urn from public.contacts where id = '00000000-0000-0000-0000-0000000033e3')
     <> 'https://www.linkedin.com/in/Cees-Bos ACwAAC33Xy99zz' then
    raise exception 'FAIL: link and member id should both be stored';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Opening line, red flags and number out of the description
-- ---------------------------------------------------------------------------

do $$
declare
  v jsonb := public.sales_extract_lead_notes(E'We build apps.\nOPENING LINE: Saw your post\nRED FLAGS: small team; offshore\nGENERAL NUMBER: 030 123 4567');
begin
  if v ->> 'description' <> 'We build apps.' or v ->> 'opening_line' <> 'Saw your post'
     or v -> 'red_flags' <> '["small team", "offshore"]'::jsonb or v ->> 'general_phone' <> '030 123 4567' then
    raise exception 'FAIL: notes not extracted: %', v;
  end if;
  if public.sales_extract_lead_notes('Just apps.') is not null then
    raise exception 'FAIL: a text without markers is left alone';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Possible duplicates and the facts of the tables
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from public.sales_similar_companies('BrightCape', 'brightcape.de') where domain = 'brightcape.com') then
    raise exception 'FAIL: the same name on another domain should be a possible duplicate';
  end if;
  if exists (select 1 from public.sales_similar_companies('Brightcape', 'brightcape.nl') where domain = 'brightcape.nl') then
    raise exception 'FAIL: the exact domain is not a possible duplicate';
  end if;
end $$;

reset role;
insert into public.signals (company_id, type, title, source_url, source, dedupe_key, posted_at) values
  ('00000000-0000-0000-0000-0000000033c3', 'vacature', 'Data engineer', 'https://nl.indeed.com/viewjob?jk=a1', 'apify', 'apify:nl.indeed.com/viewjob?jk=a1', current_date - 10),
  ('00000000-0000-0000-0000-0000000033c3', 'vacature', 'Backend developer', 'https://nl.indeed.com/viewjob?jk=b2', 'apify', 'apify:nl.indeed.com/viewjob?jk=b2', null);
insert into public.signals (company_id, type, title, source, dedupe_key, closed_at) values
  ('00000000-0000-0000-0000-0000000033c3', 'vacature', 'Closed one', 'apify', 'apify:closed', now());
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000033a1');

do $$
declare
  f record;
begin
  select * into f from public.sales_company_facts() where company_id = '00000000-0000-0000-0000-0000000033c3';
  if f.signals_count <> 3 or jsonb_array_length(f.open_vacancies) <> 2 then
    raise exception 'FAIL: two open vacancies of three signals expected, got %', f.open_vacancies;
  end if;
  if f.open_vacancies -> 0 ->> 'title' <> 'Data engineer' then
    raise exception 'FAIL: the oldest vacancy should come first';
  end if;
  select * into f from public.sales_company_facts() where company_id = '00000000-0000-0000-0000-0000000033c1';
  if f.contacts_count <> 3 or f.primary_contact ->> 'name' <> 'Anna Berg' then
    raise exception 'FAIL: contacts and the primary contact expected, got %', f.primary_contact;
  end if;
end $$;

-- Without the sales module: nothing.
select pg_temp.act('00000000-0000-0000-0000-0000000033a2');
do $$ begin
  if exists (select 1 from public.sales_company_facts()) then
    raise exception 'FAIL: no facts without the sales module';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Merging
-- ---------------------------------------------------------------------------

select pg_temp.act('00000000-0000-0000-0000-0000000033a1');
reset role;
insert into public.contacts (id, company_id, first_name, last_name, linkedin_url, phone) values
  ('00000000-0000-0000-0000-0000000033e4', '00000000-0000-0000-0000-0000000033c2', 'Nick', 'Dijk', 'https://www.linkedin.com/in/nickphdijk', '+31612345678');
insert into public.notes (entity_type, entity_id, body) values ('company', '00000000-0000-0000-0000-0000000033c2', 'Note on the duplicate');
set local role authenticated;

select public.sales_merge_companies('00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-0000000033c2');
do $$ begin
  if exists (select 1 from public.companies where id = '00000000-0000-0000-0000-0000000033c2') then
    raise exception 'FAIL: the merged company should be gone';
  end if;
  if (select company_id from public.contacts where id = '00000000-0000-0000-0000-0000000033e4') <> '00000000-0000-0000-0000-0000000033c1' then
    raise exception 'FAIL: contacts should move to the company that stays';
  end if;
  if (select description from public.companies where id = '00000000-0000-0000-0000-0000000033c1') is distinct from 'Apps.'
     or not exists (select 1 from public.companies where id = '00000000-0000-0000-0000-0000000033c1' and 'brightcape.com' = any (alias_domains)) then
    raise exception 'FAIL: empty fields should be filled and the domain kept as alias';
  end if;
  if not exists (select 1 from public.activities where company_id = '00000000-0000-0000-0000-0000000033c1' and field = 'merged_company'
                 and old_value ->> 'domain' = 'brightcape.com') then
    raise exception 'FAIL: the old record should be in Activities';
  end if;
end $$;
reset role;
do $$ begin
  if (select entity_id from public.notes where body = 'Note on the duplicate') <> '00000000-0000-0000-0000-0000000033c1' then
    raise exception 'FAIL: notes should move along';
  end if;
end $$;
set local role authenticated;

-- The same person with the Apify link and with the normal link.
select public.sales_merge_contacts('00000000-0000-0000-0000-0000000033e4', '00000000-0000-0000-0000-0000000033e1');
do $$ begin
  if exists (select 1 from public.contacts where id = '00000000-0000-0000-0000-0000000033e1') then
    raise exception 'FAIL: the merged contact should be gone';
  end if;
  if (select linkedin_url || ' ' || linkedin_member_urn || ' ' || tier from public.contacts where id = '00000000-0000-0000-0000-0000000033e4')
     <> 'https://www.linkedin.com/in/nickphdijk ACwAAB12CdEfGh 1' then
    raise exception 'FAIL: both links and the tier should be kept';
  end if;
end $$;

-- Someone without the sales module cannot merge.
select pg_temp.act('00000000-0000-0000-0000-0000000033a2');
do $$ begin
  perform public.sales_merge_contacts('00000000-0000-0000-0000-0000000033e4', '00000000-0000-0000-0000-0000000033e2');
  raise exception 'FAIL: merging needs the sales module';
exception when insufficient_privilege then null;
end $$;

reset role;
select 'leads contacts tests passed';

rollback;
