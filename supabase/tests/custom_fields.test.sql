-- Custom fields and the Work time zone check
-- (supabase/migrations/*_custom_fields_and_extras.sql), played out with real
-- RLS. Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/custom_fields.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'judith.cf@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000005a2', 'floris.cf@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-0000000005a3', 'sabine.cf@kg.nl', '{"full_name": "Sabine"}'),
  ('00000000-0000-0000-0000-0000000005a4', 'freelancer.cf@example.com', '{"full_name": "Freelancer"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000005c1', 'KG', 'active');

update public.profiles set role = 'member' where email = 'judith.cf@nordavo.nl';
update public.profiles set role = 'admin' where email = 'floris.cf@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000005c1'
  where email = 'sabine.cf@kg.nl';
-- freelancer.cf keeps the default role of a new account: external (Work only).

create or replace function pg_temp.act(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where email = p_email),
    'role', 'authenticated',
    'email', p_email)::text, false);
end $$;

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
end $$;

-- True when the statement raises an error whose message contains p_like.
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm ilike '%' || p_like || '%' then return true; end if;
  raise notice 'unexpected error: %', sqlerrm;
  return false;
end $$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.fails(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff (member) adds fields and fills them
-- ---------------------------------------------------------------------------

select pg_temp.act('judith.cf@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005c1', 'Data engineer');
insert into public.candidates (id, full_name) values
  ('00000000-0000-0000-0000-0000000005f1', 'Asha'),
  ('00000000-0000-0000-0000-0000000005f2', 'Ravi');
insert into public.applications (id, vacancy_id, candidate_id) values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005f1'),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005f2');

insert into public.custom_field_definitions (entity, key, label, field_type, options, position, show_in_list) values
  ('candidate', 'notice_period', 'Notice period', 'text', '{}', 1, true),
  ('candidate', 'salary_lpa', 'Expected salary (LPA)', 'number', '{}', 2, true),
  ('candidate', 'available_from', 'Available from', 'date', '{}', 3, false),
  ('candidate', 'relocate', 'Open to relocate', 'boolean', '{}', 4, false),
  ('candidate', 'tier', 'Tier', 'single_choice', '{" A ", "B", "C", ""}', 5, true),
  ('candidate', 'tools', 'Tools', 'multi_choice', '{dbt, Airflow, Spark}', 6, false),
  ('candidate', 'github', 'GitHub', 'url', '{}', 7, false),
  ('application', 'hiring_report', 'Hiring report note', 'long_text', '{}', 1, false),
  ('vacancy', 'budget_eur', 'Budget per month', 'number', '{}', 1, false);

select pg_temp.check((select options = '{A,B,C}' from public.custom_field_definitions where key = 'tier'), 'options trimmed, empty ones dropped');
select pg_temp.check((select created_by = '00000000-0000-0000-0000-0000000005a1' from public.custom_field_definitions where key = 'tier'), 'created_by is the staff member');
select pg_temp.check((select options = '{}' from public.custom_field_definitions where key = 'salary_lpa'), 'non choice fields keep no options');

select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type) values ('candidate', 'stack', 'Stack', 'single_choice')$$, 'at least one option'), 'choice field without options refused');
select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type, options) values ('candidate', 'stack', 'Stack', 'multi_choice', '{a,a}')$$, 'twice'), 'duplicate option refused');
select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type) values ('candidate', 'tier', 'Tier again', 'text')$$, 'duplicate key'), 'duplicate key refused');
select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type) values ('candidate', 'Bad Key', 'Bad', 'text')$$, 'check constraint'), 'bad key refused');
select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type) values ('placement', 'x', 'X', 'text')$$, 'check constraint'), 'unknown entity refused');
select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type) values ('candidate', 'x', 'X', 'rating')$$, 'check constraint'), 'unknown type refused');

-- Valid values, every type.
update public.candidates set custom_fields = jsonb_build_object(
  'notice_period', '30 days',
  'salary_lpa', 24.5,
  'available_from', '2027-01-15',
  'relocate', true,
  'tier', 'A',
  'tools', jsonb_build_array('dbt', 'Spark'),
  'github', 'https://github.com/asha',
  'empty_text', null
) - 'empty_text' where id = '00000000-0000-0000-0000-0000000005f1';
select pg_temp.check((select custom_fields ->> 'tier' = 'A' and (custom_fields -> 'salary_lpa')::numeric = 24.5
  from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'valid values stored');

-- Empty values are dropped.
update public.candidates set custom_fields = custom_fields || '{"notice_period": "", "tools": []}'::jsonb
  where id = '00000000-0000-0000-0000-0000000005f1';
select pg_temp.check((select not (custom_fields ? 'notice_period') and not (custom_fields ? 'tools')
  from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'empty values dropped');

-- Invalid values, per type.
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"salary_lpa": "lots"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'takes a number'), 'number as text refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"available_from": "2026-02-30"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'takes a date'), 'impossible date refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"available_from": "15-01-2027"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'takes a date'), 'wrong date format refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"relocate": "yes"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'yes or no'), 'boolean as text refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"tier": "D"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'one of its options'), 'unknown option refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"tools": ["dbt", "dbt"]}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'each once'), 'repeated option refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"tools": "dbt"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'list of its options'), 'multi choice as text refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"github": "ftp://github.com/x"}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'http'), 'non http url refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = jsonb_build_object('notice_period', repeat('x', 501)) where id = '00000000-0000-0000-0000-0000000005f2'$$, '500'), 'too long text refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"nope": 1}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'Unknown custom field'), 'unknown key refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '{"budget_eur": 1}' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'Unknown custom field'), 'field of another record type refused');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = '[1]' where id = '00000000-0000-0000-0000-0000000005f2'$$, 'object'), 'non object refused');
select pg_temp.check(pg_temp.fails($$insert into public.candidates (full_name, custom_fields) values ('Bad', '{"tier": "Z"}')$$, 'one of its options'), 'checked on insert too');

-- Vacancy and application fields.
update public.vacancies set custom_fields = '{"budget_eur": 6500}' where id = '00000000-0000-0000-0000-0000000005e1';
select pg_temp.check((select (custom_fields ->> 'budget_eur')::int = 6500 from public.vacancies where id = '00000000-0000-0000-0000-0000000005e1'), 'vacancy value stored');
select pg_temp.check(pg_temp.fails($$update public.vacancies set custom_fields = '{"budget_eur": "6500"}' where id = '00000000-0000-0000-0000-0000000005e1'$$, 'takes a number'), 'vacancy value checked');

-- set_custom_field changes one key and keeps the rest.
select public.set_custom_field('application', '00000000-0000-0000-0000-0000000005b1', 'hiring_report', '"Strong on dbt, weak on Spark"');
select public.set_custom_field('candidate', '00000000-0000-0000-0000-0000000005f1', 'tier', '"B"');
select pg_temp.check((select custom_fields ->> 'tier' = 'B' and custom_fields ->> 'github' = 'https://github.com/asha'
  from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'set_custom_field keeps other values');
select public.set_custom_field('candidate', '00000000-0000-0000-0000-0000000005f1', 'relocate', null);
select pg_temp.check((select not (custom_fields ? 'relocate') from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'set_custom_field with null clears');
select pg_temp.check(pg_temp.fails($$select public.set_custom_field('candidate', '00000000-0000-0000-0000-0000000005f1', 'tier', '"Q"')$$, 'one of its options'), 'set_custom_field validates');
select pg_temp.check(pg_temp.fails($$select public.set_custom_field('company', '00000000-0000-0000-0000-0000000005f1', 'tier', '"A"')$$, 'Unknown record type'), 'set_custom_field unknown entity');

-- Definitions: no delete, fixed key and type, archiving is for admins.
select pg_temp.check(pg_temp.fails($$delete from public.custom_field_definitions where key = 'github'$$, 'permission denied'), 'staff cannot delete a field');
select pg_temp.check(pg_temp.fails($$update public.custom_field_definitions set field_type = 'number' where key = 'notice_period'$$, 'cannot change'), 'type is fixed');
select pg_temp.check(pg_temp.fails($$update public.custom_field_definitions set key = 'notice' where key = 'notice_period'$$, 'cannot change'), 'key is fixed');
update public.custom_field_definitions set field_type = 'long_text', label = 'Notice period (details)' where key = 'notice_period';
select pg_temp.check((select field_type = 'long_text' from public.custom_field_definitions where key = 'notice_period'), 'text may become long text');
select pg_temp.check(pg_temp.fails($$update public.custom_field_definitions set archived_at = now() where key = 'github'$$, 'Only an admin'), 'member cannot archive');

-- Removing an option keeps the stored value; unrelated edits still work.
update public.custom_field_definitions set options = '{A,C}' where key = 'tier';
update public.candidates set custom_fields = custom_fields || '{"salary_lpa": 26}' where id = '00000000-0000-0000-0000-0000000005f1';
select pg_temp.check((select custom_fields ->> 'tier' = 'B' and (custom_fields ->> 'salary_lpa')::int = 26
  from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'old option kept, other value changed');
update public.candidates set current_title = 'Senior data engineer' where id = '00000000-0000-0000-0000-0000000005f1';

reset role;

-- Admin archives a field: hidden from new values, stored values kept.
select pg_temp.act('floris.cf@nordavo.nl');
set role authenticated;
update public.custom_field_definitions set archived_at = now() where key = 'github';
select pg_temp.check((select archived_at is not null from public.custom_field_definitions where key = 'github'), 'admin archived the field');
select pg_temp.check(pg_temp.fails($$update public.candidates set custom_fields = custom_fields || '{"github": "https://github.com/other"}' where id = '00000000-0000-0000-0000-0000000005f1'$$, 'archived'), 'archived field takes no new values');
update public.candidates set custom_fields = custom_fields || '{"salary_lpa": 27}' where id = '00000000-0000-0000-0000-0000000005f1';
select pg_temp.check((select custom_fields ->> 'github' = 'https://github.com/asha' from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'archived value kept on other edits');
update public.custom_field_definitions set archived_at = null where key = 'github';
select pg_temp.check((select archived_at is null from public.custom_field_definitions where key = 'github'), 'admin restored the field');

-- Present Asha (not Ravi) to the client.
select public.move_applications(array['00000000-0000-0000-0000-0000000005b1']::uuid[], 'matched');
update public.candidates set custom_fields = '{"tier": "C"}' where id = '00000000-0000-0000-0000-0000000005f2';
reset role;

-- ---------------------------------------------------------------------------
-- Client: no definitions, values only on rows it may see, cannot write
-- ---------------------------------------------------------------------------

select pg_temp.act('sabine.cf@kg.nl');
set role authenticated;

select pg_temp.check((select count(*) from public.custom_field_definitions) = 0, 'client sees no field definitions');
select pg_temp.check((select count(*) from public.candidates where id = '00000000-0000-0000-0000-0000000005f2') = 0, 'client cannot see the unpresented candidate');
select pg_temp.check((select count(*) from public.candidates where custom_fields ->> 'tier' = 'C') = 0, 'client cannot find custom values of a candidate it cannot see');
-- Clients read through portal_candidates() only, which never returns custom fields.
select pg_temp.check((select count(*) from public.portal_candidates()) = 1, 'client sees only the presented candidate in the portal');
select pg_temp.check((select count(*) from public.applications) = 0 and (select count(*) from public.candidates) = 0, 'client cannot read candidate or application rows (and so no custom fields)');
select pg_temp.check(pg_temp.fails($$select public.set_custom_field('candidate', '00000000-0000-0000-0000-0000000005f1', 'tier', '"A"')$$, 'Only the Nordavo team'), 'client cannot use set_custom_field');
select pg_temp.check(pg_temp.fails($$insert into public.custom_field_definitions (entity, key, label, field_type) values ('candidate', 'client_field', 'Client', 'text')$$, 'row-level security'), 'client cannot add a field');
update public.candidates set custom_fields = '{}' where id = '00000000-0000-0000-0000-0000000005f1';

reset role;
select pg_temp.check((select custom_fields ->> 'tier' = 'B' from public.candidates where id = '00000000-0000-0000-0000-0000000005f1'), 'client update changed nothing');

-- Work guest (external): nothing at all.
select pg_temp.act('freelancer.cf@example.com');
set role authenticated;
select pg_temp.check((select count(*) from public.custom_field_definitions) = 0, 'guest sees no field definitions');
select pg_temp.check((select count(*) from public.candidates) = 0, 'guest sees no candidates');
select pg_temp.check(pg_temp.fails($$select public.set_custom_field('candidate', '00000000-0000-0000-0000-0000000005f1', 'tier', '"A"')$$, 'Only the Nordavo team'), 'guest cannot use set_custom_field');

select pg_temp.check((select count(*) from public.record_layouts) = 0, 'guest sees no page layouts');
select pg_temp.check(pg_temp.fails($$insert into public.record_layouts (entity, config) values ('client', '{}')$$, 'row-level security'), 'guest cannot save a layout');

reset role;

-- ---------------------------------------------------------------------------
-- Clients and placements, page layouts, deleting a field
-- (20261123200000_custom_fields_layouts.sql)
-- ---------------------------------------------------------------------------

select pg_temp.act('judith.cf@nordavo.nl');
set role authenticated;
insert into public.custom_field_definitions (entity, key, label, field_type, block_key)
  values ('client', 'payment_terms', 'Payment terms', 'number', 'b_finance');
select pg_temp.check((select public.set_custom_field('client', '00000000-0000-0000-0000-0000000005c1', 'payment_terms', '30') ->> 'payment_terms') = '30', 'member fills a client field');
select pg_temp.check(pg_temp.fails($$select public.set_custom_field('client', '00000000-0000-0000-0000-0000000005c1', 'payment_terms', '"thirty"')$$, 'takes a number'), 'client field is type checked');
insert into public.record_layouts (entity, config) values ('client', '{"blocks": [{"key": "b_finance", "custom": true, "label": "Finance"}]}');
update public.record_layouts set config = '{"blocks": []}' where entity = 'client';
select pg_temp.check((select updated_by = '00000000-0000-0000-0000-0000000005a1' from public.record_layouts where entity = 'client'), 'layout remembers who changed it');
select pg_temp.check(pg_temp.fails($$insert into public.record_layouts (entity, config) values ('company', '{}')$$, 'check'), 'only known record pages have a layout');
delete from public.record_layouts where entity = 'client';
select pg_temp.check((select count(*) from public.record_layouts where entity = 'client') = 1, 'a member cannot reset a layout');
select pg_temp.check(pg_temp.fails($$select public.delete_custom_field((select id from public.custom_field_definitions where key = 'payment_terms'))$$, 'Only an admin'), 'a member cannot delete a field');
reset role;

select pg_temp.act('floris.cf@nordavo.nl');
set role authenticated;
select pg_temp.check(pg_temp.fails($$select public.delete_custom_field((select id from public.custom_field_definitions where key = 'payment_terms'))$$, 'Archive the field first'), 'only archived fields can be deleted');
update public.custom_field_definitions set archived_at = now() where key = 'payment_terms';
select public.delete_custom_field((select id from public.custom_field_definitions where key = 'payment_terms'));
select pg_temp.check((select count(*) from public.custom_field_definitions where key = 'payment_terms') = 0, 'admin deletes an archived field');
select pg_temp.check((select not (custom_fields ? 'payment_terms') from public.clients where id = '00000000-0000-0000-0000-0000000005c1'), 'its values are gone too');
reset role;

-- Back to the Work guest for the time zone checks.
select pg_temp.act('freelancer.cf@example.com');
set role authenticated;

-- ---------------------------------------------------------------------------
-- Work time zone: any zone Postgres knows, nothing else
-- ---------------------------------------------------------------------------

update public.profiles set time_zone = 'America/Argentina/Buenos_Aires' where id = '00000000-0000-0000-0000-0000000005a4';
select pg_temp.check((select time_zone = 'America/Argentina/Buenos_Aires' from public.profiles where id = '00000000-0000-0000-0000-0000000005a4'), 'full IANA zone accepted');
select pg_temp.check(pg_temp.fails($$update public.profiles set time_zone = 'Mars/Olympus' where id = '00000000-0000-0000-0000-0000000005a4'$$, 'Unknown time zone'), 'unknown zone refused');
update public.profiles set full_name = 'Freelancer B' where id = '00000000-0000-0000-0000-0000000005a4';

reset role;

rollback;
