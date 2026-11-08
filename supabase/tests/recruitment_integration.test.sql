-- Recruitment integration (supabase/migrations/*_recruitment_integration.sql):
-- module access on the new recruitment tables and the client portal through
-- portal_* functions only. One transaction, rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'judith.i@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000009a2', 'sales.i@nordavo.nl', '{"full_name": "Sales"}'),
  ('00000000-0000-0000-0000-0000000009a3', 'client.i@kg.nl', '{"full_name": "Sabine"}');

insert into public.clients (id, name, status, notes) values
  ('00000000-0000-0000-0000-0000000009c1', 'KG', 'active', 'internal: pays late');

update public.profiles set role = 'member', modules = array['recruitment', 'clients'] where email = 'judith.i@nordavo.nl';
update public.profiles set role = 'member', modules = array['sales'] where email = 'sales.i@nordavo.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000009c1' where email = 'client.i@kg.nl';

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

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text) to authenticated;

-- Judith (recruitment) sets up a presented candidate with internal details.
select pg_temp.act('judith.i@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009c1', 'Laravel developer');
insert into public.candidates (id, full_name, email, phone, cv_text, cv_path) values
  ('00000000-0000-0000-0000-0000000009f1', 'Asha', 'asha@example.com', '+91 80 1234 5678', 'private cv text',
   'candidate/00000000-0000-0000-0000-0000000009f1/cv.pdf');
insert into public.applications (id, vacancy_id, candidate_id, stage, video_notes, background_check_notes) values
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009f1',
   'matched', 'accent is strong', 'diploma pending');
insert into public.application_assessments (application_id, test_score) values
  ('00000000-0000-0000-0000-0000000009b1', 81);
insert into public.application_compensation (application_id) values
  ('00000000-0000-0000-0000-0000000009b1');

select pg_temp.check((select count(*) from public.application_assessments) = 1, 'recruiter reads assessments');
select pg_temp.check((select count(*) from public.application_compensation) = 1, 'recruiter reads compensation');
reset role;

-- Sales only: nothing of recruitment, also not the new tables.
select pg_temp.act('sales.i@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.application_assessments) = 0, 'sales reads no assessments');
select pg_temp.check((select count(*) from public.application_compensation) = 0, 'sales reads no compensation');
select pg_temp.check((select count(*) from public.recruitment_forms) = 0, 'sales reads no forms');
select pg_temp.check((select count(*) from public.cv_scores) = 0, 'sales reads no CV scores');
select pg_temp.check((select count(*) from public.custom_field_definitions) = 0, 'sales reads no custom fields');
select pg_temp.check((select count(*) from public.candidates) = 0, 'sales reads no candidates');
do $$ begin
  insert into public.application_assessments (application_id, test_score) values ('00000000-0000-0000-0000-0000000009b1', 1);
  raise exception 'FAIL: sales wrote an assessment';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Client: only through the portal functions, only safe columns.
insert into storage.objects (bucket_id, name) values
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000009f1/cv.pdf'),
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000009f1/payslip.pdf');
insert into public.attachments (entity_type, entity_id, storage_path, file_name, kind) values
  ('candidate', '00000000-0000-0000-0000-0000000009f1', 'candidate/00000000-0000-0000-0000-0000000009f1/payslip.pdf', 'payslip.pdf', 'payslip');

select pg_temp.act('client.i@kg.nl');
set role authenticated;

select pg_temp.check((select count(*) from public.applications) = 0, 'client reads no application rows');
select pg_temp.check((select count(*) from public.candidates) = 0, 'client reads no candidate rows');
select pg_temp.check((select count(*) from public.vacancies) = 0, 'client reads no vacancy rows');
select pg_temp.check((select count(*) from public.clients) = 0, 'client reads no client rows (internal notes)');
select pg_temp.check((select name from public.portal_company()) = 'KG', 'portal company');
select pg_temp.check((select presented_count from public.portal_vacancies()) = 1, 'portal vacancy with one presented');
select pg_temp.check((select full_name from public.portal_candidates('00000000-0000-0000-0000-0000000009e1')) = 'Asha', 'portal candidate');
select pg_temp.check((select has_cv from public.portal_candidates()), 'portal knows there is a CV');
select pg_temp.check(public.portal_cv_path('00000000-0000-0000-0000-0000000009b1') = 'candidate/00000000-0000-0000-0000-0000000009f1/cv.pdf', 'portal CV path');
select pg_temp.check((select count(*) from storage.objects) = 1, 'client opens the CV only, not the payslip');
select pg_temp.check((select name like '%/cv.pdf' from storage.objects), 'and that file is the CV');
-- The function returns a fixed set of columns: no contact details or internal notes exist in it.
select pg_temp.check(not exists (
  select 1 from information_schema.routines r
  join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_name = 'portal_candidates' and p.parameter_mode = 'OUT'
    and p.parameter_name in ('email', 'phone', 'cv_text', 'video_notes', 'background_check_notes', 'rejection_reason', 'custom_fields')
), 'portal_candidates has no internal columns');
reset role;

-- Another client sees nothing.
update public.profiles set client_id = null, role = 'member', modules = '{}' where email = 'client.i@kg.nl';
select pg_temp.act('client.i@kg.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.portal_candidates()) = 0, 'not a client: portal is empty');
reset role;

rollback;
