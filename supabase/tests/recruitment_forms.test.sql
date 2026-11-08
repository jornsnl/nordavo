-- Recruitment forms (supabase/migrations/*_recruitment_forms.sql), played
-- out with real RLS. Run against a database with every migration applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_forms.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000002a1', 'judith@nordavo.nl', '{"full_name": "Judith"}'),
  ('00000000-0000-0000-0000-0000000002a2', 'sabine@kg.nl', '{"full_name": "Sabine"}'),
  ('00000000-0000-0000-0000-0000000002a3', 'julius@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000002a4', 'guest@work.nl', '{"full_name": "Guest"}');

insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000002c1', 'KG', 'active');

update public.profiles set role = 'member' where email = 'judith@nordavo.nl';
update public.profiles set role = 'admin' where email = 'julius@nordavo.nl';
update public.profiles set role = 'external' where email = 'guest@work.nl';
update public.profiles set role = 'client', client_id = '00000000-0000-0000-0000-0000000002c1'
  where email = 'sabine@kg.nl';

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

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Staff build and publish a form.
-- ---------------------------------------------------------------------------

select pg_temp.act('judith@nordavo.nl');
set role authenticated;

insert into public.vacancies (id, client_id, title) values
  ('00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000002c1', 'PHP developer');
insert into public.candidates (id, full_name, email, phone) values
  ('00000000-0000-0000-0000-0000000002f1', 'Asha', 'asha@example.in', '+91 98765 43210'),
  ('00000000-0000-0000-0000-0000000002f2', 'Ravi', null, '098765 11111');
insert into public.applications (id, vacancy_id, candidate_id, stage) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-0000000002f1', 'techstack_check');

insert into public.recruitment_forms (id, vacancy_id, title, role_type, blocks) values
  ('00000000-0000-0000-0000-0000000002d1', '00000000-0000-0000-0000-0000000002e1', 'PHP form', 'fulltime',
   '[{"id":"b1","title":"Details","questions":[{"id":"q1","type":"short_text","label":"Name"}]}]');

select pg_temp.check(public.publish_recruitment_form('00000000-0000-0000-0000-0000000002d1') = 1, 'first publish is version 1');
select pg_temp.check((select status = 'published' and version = 1 from public.recruitment_forms
  where id = '00000000-0000-0000-0000-0000000002d1'), 'form is published');
select pg_temp.check((select count(*) from public.recruitment_form_versions) = 1, 'version stored');
select pg_temp.check((select public_token ~ '^[0-9a-f]{64}$' and headhunted_token <> public_token
  from public.recruitment_forms where id = '00000000-0000-0000-0000-0000000002d1'), 'two distinct link tokens');

-- Versions are immutable for staff too.
update public.recruitment_form_versions set title = 'changed';
select pg_temp.check((select title from public.recruitment_form_versions limit 1) = 'PHP form', 'versions cannot be edited');

-- Send the form to Asha: personal link, stage moves to Fill out.
insert into public.form_invites (id, form_id, application_id, sent_at, sent_to, deadline) values
  ('00000000-0000-0000-0000-0000000002d2', '00000000-0000-0000-0000-0000000002d1', '00000000-0000-0000-0000-0000000002b1',
   now(), 'asha@example.in', current_date + 3);
select public.move_applications(array['00000000-0000-0000-0000-0000000002b1']::uuid[], 'fill_out');

-- Exchange rate: members read, only admins add.
do $$ begin
  insert into public.exchange_rates (inr_per_eur, rate_date) values (95, current_date);
  raise exception 'FAIL: member added an exchange rate';
exception when insufficient_privilege then null;
end $$;

reset role;

select pg_temp.act('julius@nordavo.nl');
set role authenticated;
insert into public.exchange_rates (inr_per_eur, rate_date) values (96.5, current_date - 7), (97.25, current_date);
reset role;

-- ---------------------------------------------------------------------------
-- The public form, as the server does it (service role).
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role": "service_role"}', false);
set role service_role;

-- Personal link: Asha's application, details updated, Fill out -> Video review.
select public.submit_recruitment_form(
  (select token from public.form_invites where id = '00000000-0000-0000-0000-0000000002d2'),
  '{"form_version": 1, "answers": {"q1": "Asha K"}, "candidate": {"full_name": "Asha K", "notice_period": "30 days", "willing_to_relocate": true, "years_experience": 5},
    "compensation": {"current_ctc_inr_year": 1200000, "expected_ctc_inr_year": 1500000}, "ip_hash": "ip-1"}'::jsonb);

select pg_temp.check((select stage from public.applications where id = '00000000-0000-0000-0000-0000000002b1') = 'video_review',
  'completed form advances fill_out to video_review');
select pg_temp.check((select form_completed_at is not null from public.applications where id = '00000000-0000-0000-0000-0000000002b1'), 'form_completed_at set');
select pg_temp.check((select completed_at is not null from public.form_invites where id = '00000000-0000-0000-0000-0000000002d2'), 'invite completed');
select pg_temp.check((select full_name = 'Asha K' and notice_period = '30 days' and willing_to_relocate and years_experience = 5
  from public.candidates where id = '00000000-0000-0000-0000-0000000002f1'), 'personal link updates the candidate');
select pg_temp.check((select via = 'personal' and answers ->> 'q1' = 'Asha K' and form_version = 1
  from public.form_responses where application_id = '00000000-0000-0000-0000-0000000002b1'), 'response stored');
select pg_temp.check((select expected_ctc_inr_year = 1500000 and negotiated_inr_per_eur is null
  from public.application_compensation where application_id = '00000000-0000-0000-0000-0000000002b1'), 'asked compensation stored');
select pg_temp.check((select count(*) from public.application_stage_events
  where application_id = '00000000-0000-0000-0000-0000000002b1' and to_stage = 'video_review') = 1, 'auto advance in the history');

-- General link: Ravi is matched by phone (other formatting), gets an application in Sourced.
select public.submit_recruitment_form(
  (select public_token from public.recruitment_forms where id = '00000000-0000-0000-0000-0000000002d1'),
  '{"form_version": 1, "answers": {"q1": "Someone else"}, "candidate": {"full_name": "Not Ravi", "phone": "+91 98765-11111", "email": "ravi@example.in"},
    "source": "naukri", "ip_hash": "ip-2"}'::jsonb);
select pg_temp.check((select full_name = 'Ravi' and email = 'ravi@example.in'
  from public.candidates where id = '00000000-0000-0000-0000-0000000002f2'), 'general link fills empty fields only');
select pg_temp.check((select stage = 'sourced' and source = 'naukri' and origin = 'applied' and form_completed_at is not null
  from public.applications where candidate_id = '00000000-0000-0000-0000-0000000002f2'), 'new application in sourced');

-- Headhunted link: a new candidate, origin and source headhunted.
select public.submit_recruitment_form(
  (select headhunted_token from public.recruitment_forms where id = '00000000-0000-0000-0000-0000000002d1'),
  '{"form_version": 1, "answers": {}, "candidate": {"full_name": "Meera", "email": "MEERA@example.in"}, "source": "linkedin", "ip_hash": "ip-3"}'::jsonb);
select pg_temp.check((select c.origin = 'headhunted' and c.source = 'headhunted' and c.email = 'meera@example.in'
  and a.origin = 'headhunted' and a.source = 'headhunted'
  from public.candidates c join public.applications a on a.candidate_id = c.id where c.full_name = 'Meera'), 'headhunted link marks origin and source');

-- Same email again: same candidate, one response (replaced).
select public.submit_recruitment_form(
  (select public_token from public.recruitment_forms where id = '00000000-0000-0000-0000-0000000002d1'),
  '{"form_version": 1, "answers": {"q1": "again"}, "candidate": {"full_name": "Meera", "email": "meera@example.in"}, "ip_hash": "ip-3"}'::jsonb);
select pg_temp.check((select count(*) from public.candidates where lower(email) = 'meera@example.in') = 1, 'matched by email');
select pg_temp.check((select count(*) from public.form_responses r join public.candidates c on c.id = r.candidate_id
  where c.full_name = 'Meera') = 1, 'one response per application');
select pg_temp.check((select a.origin = 'headhunted' from public.applications a join public.candidates c on c.id = a.candidate_id
  where c.full_name = 'Meera'), 'origin stays headhunted');

-- CV recorded as attachment kind cv.
select public.attach_form_cv(
  (select id from public.form_responses where application_id = '00000000-0000-0000-0000-0000000002b1'), 'q9',
  'candidate/00000000-0000-0000-0000-0000000002f1/abcd-cv.pdf', 'cv.pdf', 'application/pdf', 1000);
select pg_temp.check((select kind = 'cv' from public.attachments where storage_path = 'candidate/00000000-0000-0000-0000-0000000002f1/abcd-cv.pdf'), 'cv attachment');
select pg_temp.check((select cv_path = 'candidate/00000000-0000-0000-0000-0000000002f1/abcd-cv.pdf' from public.candidates
  where id = '00000000-0000-0000-0000-0000000002f1'), 'cv_path set');
do $$ begin
  perform public.attach_form_cv(
    (select id from public.form_responses where application_id = '00000000-0000-0000-0000-0000000002b1'), 'q9',
    'candidate/00000000-0000-0000-0000-0000000002f2/evil.pdf', 'evil.pdf', 'application/pdf', 1);
  raise exception 'FAIL: cv of another candidate accepted';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Rate limit: five per IP per ten minutes.
do $$
declare i integer;
begin
  for i in 1..6 loop
    perform public.submit_recruitment_form(
      (select public_token from public.recruitment_forms where id = '00000000-0000-0000-0000-0000000002d1'),
      jsonb_build_object('form_version', 1, 'answers', '{}'::jsonb, 'ip_hash', 'ip-flood',
        'candidate', jsonb_build_object('full_name', 'Bot', 'email', 'bot' || i || '@example.com')));
  end loop;
  raise exception 'FAIL: rate limit not applied';
exception when raise_exception then
  if sqlerrm <> 'rate_limited' then raise; end if;
end $$;

-- Unknown and closed links are refused.
do $$ begin
  perform public.submit_recruitment_form(repeat('0', 64), '{"form_version": 1}');
  raise exception 'FAIL: unknown token accepted';
exception when raise_exception then
  if sqlerrm <> 'form_not_found' then raise; end if;
end $$;
update public.recruitment_forms set status = 'draft' where id = '00000000-0000-0000-0000-0000000002d1';
do $$ begin
  perform public.submit_recruitment_form(
    (select public_token from public.recruitment_forms where id = '00000000-0000-0000-0000-0000000002d1'),
    '{"form_version": 1, "candidate": {"full_name": "X"}, "ip_hash": "ip-9"}');
  raise exception 'FAIL: closed form accepted';
exception when raise_exception then
  if sqlerrm <> 'form_closed' then raise; end if;
end $$;
update public.recruitment_forms set status = 'published' where id = '00000000-0000-0000-0000-0000000002d1';

-- Payslip on Asha (staff upload, written here directly).
insert into public.attachments (entity_type, entity_id, storage_path, file_name, kind) values
  ('candidate', '00000000-0000-0000-0000-0000000002f1', 'candidate/00000000-0000-0000-0000-0000000002f1/pay-slip.pdf', 'slip.pdf', 'payslip');
insert into storage.objects (bucket_id, name) values
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000002f1/pay-slip.pdf'),
  ('attachments', 'candidate/00000000-0000-0000-0000-0000000002f1/abcd-cv.pdf');

reset role;

-- ---------------------------------------------------------------------------
-- Staff: negotiated amount snapshots the current rate.
-- ---------------------------------------------------------------------------

select pg_temp.act('judith@nordavo.nl');
set role authenticated;

update public.application_compensation set negotiated_ctc_inr_year = 1400000, payslip_requested_at = current_date
where application_id = '00000000-0000-0000-0000-0000000002b1';
select pg_temp.check((select negotiated_inr_per_eur = 97.25 and negotiated_rate_date = current_date and negotiated_by is not null
  from public.application_compensation where application_id = '00000000-0000-0000-0000-0000000002b1'), 'rate snapshotted with negotiated amount');
select pg_temp.check((select count(*) from public.form_responses) = 3, 'staff read responses');
select pg_temp.check((select count(*) from public.form_invites) = 1, 'staff read invites');

-- Staff cannot call the service role functions.
do $$ begin
  perform public.submit_recruitment_form(repeat('0', 64), '{}');
  raise exception 'FAIL: staff called submit_recruitment_form';
exception when insufficient_privilege then null;
end $$;

-- Present Asha to the client.
select public.move_applications(array['00000000-0000-0000-0000-0000000002b1']::uuid[], 'matched');

reset role;

-- ---------------------------------------------------------------------------
-- Client: sees the presented candidate, never forms, answers, pay or payslips.
-- ---------------------------------------------------------------------------

select pg_temp.act('sabine@kg.nl');
set role authenticated;

select pg_temp.check((select count(*) from public.portal_candidates()) = 1, 'client sees the presented application in the portal');
select pg_temp.check((select count(*) from public.applications) = 0 and (select count(*) from public.candidates) = 0, 'client cannot read internal rows directly');
select pg_temp.check((select count(*) from public.recruitment_forms) = 0, 'client sees no forms');
select pg_temp.check((select count(*) from public.recruitment_form_versions) = 0, 'client sees no form versions');
select pg_temp.check((select count(*) from public.form_responses) = 0, 'client sees no responses');
select pg_temp.check((select count(*) from public.form_invites) = 0, 'client sees no invites');
select pg_temp.check((select count(*) from public.application_compensation) = 0, 'client sees no compensation');
select pg_temp.check((select count(*) from public.exchange_rates) = 0, 'client sees no exchange rates');
select pg_temp.check((select count(*) from public.attachments) = 0, 'client sees no attachment rows');
select pg_temp.check((select count(*) from storage.objects where name like '%pay-slip%') = 0, 'client cannot open the payslip');
select pg_temp.check((select count(*) from storage.objects where name like '%abcd-cv%') = 1, 'client can open the cv');
do $$ begin
  perform public.publish_recruitment_form('00000000-0000-0000-0000-0000000002d1');
  raise exception 'FAIL: client published a form';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

reset role;

-- Task tool guest: nothing.
select pg_temp.act('guest@work.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.recruitment_forms) = 0, 'guest sees no forms');
select pg_temp.check((select count(*) from public.form_responses) = 0, 'guest sees no responses');
select pg_temp.check((select count(*) from public.application_compensation) = 0, 'guest sees no compensation');
reset role;

-- Anonymous: nothing, and cannot submit directly.
select set_config('request.jwt.claims', '{"role": "anon"}', false);
set role anon;
select pg_temp.check((select count(*) from public.recruitment_forms) = 0, 'anon sees no forms');
select pg_temp.check((select count(*) from public.form_invites) = 0, 'anon sees no invites');
select pg_temp.check((select count(*) from public.form_responses) = 0, 'anon sees no responses');
select pg_temp.check((select count(*) from public.application_compensation) = 0, 'anon sees no compensation');
select pg_temp.check((select count(*) from public.attachments) = 0, 'anon sees no attachments');
do $$ begin
  perform public.submit_recruitment_form(repeat('0', 64), '{}');
  raise exception 'FAIL: anon called submit_recruitment_form';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.form_responses (form_id, form_version, vacancy_id, application_id, candidate_id, via)
  values ('00000000-0000-0000-0000-0000000002d1', 1, '00000000-0000-0000-0000-0000000002e1',
          '00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000002f1', 'general');
  raise exception 'FAIL: anon inserted a response';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
