-- Leadregels of 20 November 2026 (supabase/migrations/20261126000000_leadregels.sql).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leadregels.test.sql
--
-- Everything happens in one transaction that is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000061a1', 'admin61@nordavo.nl', '{"full_name": "Admin"}'),
  ('00000000-0000-0000-0000-0000000061a2', 'member61@nordavo.nl', '{"full_name": "Member"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000061a1';
update public.profiles set role = 'member', modules = array['sales'] where id = '00000000-0000-0000-0000-0000000061a2';

create function pg_temp.act(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_what;
  end if;
end;
$$;
create function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAIL: should be refused: %', p_what;
end;
$$;
grant execute on function pg_temp.act(uuid), pg_temp.check(boolean, text), pg_temp.fails(text, text) to authenticated;

insert into public.companies (id, name, domain, employees) values
  ('00000000-0000-0000-0000-0000000061c1', 'Saasco', 'saasco.nl', 80),
  ('00000000-0000-0000-0000-0000000061c2', 'Fabriek', 'fabriek.nl', 20),
  ('00000000-0000-0000-0000-0000000061c3', 'Weigeraar', 'weigeraar.nl', 50);

-- ---------------------------------------------------------------------------
-- 1 and 2. ICP and segment
-- ---------------------------------------------------------------------------

select pg_temp.fails($$update public.companies set icp_decision = 'REVIEW' where id = '00000000-0000-0000-0000-0000000061c1'$$, 'REVIEW is gone');
select pg_temp.fails($$update public.companies set icp_decision = 'NO_GO' where id = '00000000-0000-0000-0000-0000000061c1'$$, 'NO_GO without a reason');
select pg_temp.fails($$update public.companies set segment = 'A' where id = '00000000-0000-0000-0000-0000000061c1'$$, 'a segment without GO');

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000061a2');

select public.sales_update('company', array['00000000-0000-0000-0000-0000000061c1'::uuid],
  '{"icp_decision": "GO", "icp_reason": "SaaS met eigen devteam", "segment": "A", "talking_points": ["Boven 150 FTE: bespreek de beslisser."]}');
select pg_temp.check((select lead_status = 'ready' and icp_score = 50 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'),
  'GO with segment A is ready with score 50');
select pg_temp.check((select talking_points = array['Boven 150 FTE: bespreek de beslisser.'] from public.companies where id = '00000000-0000-0000-0000-0000000061c1'),
  'talking points are their own field');

-- A score set by hand is put back.
select public.sales_update('company', array['00000000-0000-0000-0000-0000000061c1'::uuid], '{"icp_score": 99}');
select pg_temp.check((select icp_score = 50 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'the score is computed, not set');

-- ---------------------------------------------------------------------------
-- 3 and 4. Score from the signals
-- ---------------------------------------------------------------------------

reset role;
insert into public.signals (company_id, type, title, source, dedupe_key, posted_at) values
  ('00000000-0000-0000-0000-0000000061c1', 'vacature', 'Senior Backend Developer', 'linkedin', 'lr61-1', current_date - 10);
select pg_temp.check((select icp_score = 80 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'A 50 + vacancy 30 = 80');

insert into public.signals (company_id, type, title, source, dedupe_key, posted_at) values
  ('00000000-0000-0000-0000-0000000061c1', 'vacature', 'Data Engineer', 'linkedin', 'lr61-2', current_date - 70),
  ('00000000-0000-0000-0000-0000000061c1', 'vacature', 'Open sollicitatie developer', 'linkedin', 'lr61-3', current_date - 5),
  ('00000000-0000-0000-0000-0000000061c1', 'vacature', 'Java Developer', 'linkedin', 'lr61-4', current_date - 200),
  ('00000000-0000-0000-0000-0000000061c1', 'india_outsourced', 'Team in Bangalore', 'overig', 'lr61-5', current_date);
select pg_temp.check((select icp_score = 100 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'),
  'A 50 + vacancy 30 + more vacancies 10 + India 10 = 100');
select pg_temp.check((public.sales_score_parts('00000000-0000-0000-0000-0000000061c1', 'A') -> 'parts') @> '[{"type": "meerdere_rollen", "points": 10}]',
  'the breakdown names the parts');
select pg_temp.check(public.sales_vacancy_is_evergreen('Java Developer', current_date - 200, current_date), 'open over 180 days is evergreen');
select pg_temp.check(public.sales_vacancy_is_evergreen('Open sollicitatie developer', current_date, current_date), 'an open application is evergreen');

-- Switching a signal type on in the points table counts at once.
update public.sales_signal_points set active = true where type = 'lang_open';
select pg_temp.check((public.sales_score_parts('00000000-0000-0000-0000-0000000061c1', 'A') -> 'parts') @> '[{"type": "lang_open"}]',
  'a vacancy open 60 days counts once switched on');
update public.sales_signal_points set active = false where type = 'lang_open';

-- A vacancy that goes offline expires.
update public.signals set closed_at = now() where dedupe_key in ('lr61-1', 'lr61-2');
select pg_temp.check((select icp_score = 60 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'offline vacancies stop counting');

-- A minus signal can never go under 0.
update public.sales_signal_points set active = true where type = 'ontslagen';
update public.sales_signal_points set points = -100 where type = 'ontslagen';
insert into public.signals (company_id, type, title, source, dedupe_key) values
  ('00000000-0000-0000-0000-0000000061c1', 'ontslagen', 'Reorganisatie', 'overig', 'lr61-6');
select pg_temp.check((select icp_score = 0 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'the score never goes under 0');
select pg_temp.check((select valid_until = current_date + 365 from public.signals where dedupe_key = 'lr61-6'), 'a new signal gets its default valid until');
delete from public.signals where dedupe_key = 'lr61-6';
update public.sales_signal_points set active = false, points = -15 where type = 'ontslagen';

-- ---------------------------------------------------------------------------
-- 6. Statuses with a date
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000061a2');
select public.sales_update('company', array['00000000-0000-0000-0000-0000000061c3'::uuid], '{"lead_status": "nee_geen_interesse", "declined_channel": "mail"}');
select pg_temp.check((select recontact_from = (current_date + interval '3 months')::date and declined_channel = 'mail'
  from public.companies where id = '00000000-0000-0000-0000-0000000061c3'), 'nee_geen_interesse waits three months');

reset role;
insert into public.signals (company_id, type, title, source, dedupe_key) values
  ('00000000-0000-0000-0000-0000000061c3', 'vacature', 'PHP Developer', 'linkedin', 'lr61-7');
select pg_temp.check((select lead_status = 'nee_geen_interesse' from public.companies where id = '00000000-0000-0000-0000-0000000061c3'),
  'a new vacancy does not put a no back in a campaign');
select pg_temp.check(exists (select 1 from public.activities where company_id = '00000000-0000-0000-0000-0000000061c3' and external_id like 'leadrule:signal:%'),
  'but asks for a personal follow up');

-- The daily run: the date has come.
update public.companies set recontact_from = current_date where id = '00000000-0000-0000-0000-0000000061c3';
select public.sales_daily_tick();
select pg_temp.check((select lead_status = 'ready' and next_action like '%ander kanaal%' from public.companies where id = '00000000-0000-0000-0000-0000000061c3'),
  'after three months ready, with the note to use another channel');

-- Cooled down: a week, or straight back with a new vacancy.
update public.companies set lead_status = 'cooled_down' where id = '00000000-0000-0000-0000-0000000061c3';
select pg_temp.check((select recontact_from = current_date + 7 from public.companies where id = '00000000-0000-0000-0000-0000000061c3'), 'cooled down for a week');
insert into public.signals (company_id, type, title, source, dedupe_key) values
  ('00000000-0000-0000-0000-0000000061c3', 'vacature', 'Frontend Developer', 'linkedin', 'lr61-8');
select pg_temp.check((select lead_status = 'ready' and recontact_from is null from public.companies where id = '00000000-0000-0000-0000-0000000061c3'),
  'a new vacancy puts a cooled down company back on ready');

-- Do not contact: only an admin turns it back.
update public.companies set lead_status = 'do_not_contact' where id = '00000000-0000-0000-0000-0000000061c3';
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000061a2');
select pg_temp.fails($$select public.sales_update('company', array['00000000-0000-0000-0000-0000000061c3'::uuid], '{"lead_status": "ready"}')$$,
  'a member turning do not contact back');
select pg_temp.act('00000000-0000-0000-0000-0000000061a1');
select public.sales_update('company', array['00000000-0000-0000-0000-0000000061c3'::uuid], '{"lead_status": "ready"}');
select pg_temp.check((select lead_status = 'ready' from public.companies where id = '00000000-0000-0000-0000-0000000061c3'), 'an admin may');

-- ---------------------------------------------------------------------------
-- 10. Campaigns: running is in sequence, ended without reply cools down
-- ---------------------------------------------------------------------------

reset role;
insert into public.campaigns (id, name, channel, provider, status) values
  ('00000000-0000-0000-0000-0000000061f1', 'Test campagne 61', 'mail', 'instantly', 'draft');
insert into public.campaign_members (campaign_id, company_id, status) values
  ('00000000-0000-0000-0000-0000000061f1', '00000000-0000-0000-0000-0000000061c1', 'active');
select pg_temp.check((select lead_status = 'ready' from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'a draft campaign is not running');
update public.campaigns set status = 'active' where id = '00000000-0000-0000-0000-0000000061f1';
select pg_temp.check((select lead_status = 'in_sequence' from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'a running campaign is in sequence');

-- 9. The check before an upload.
select pg_temp.check((select (r -> 'reasons') @> '["campagne Test campagne 61", "in sequence"]' and not (r ->> 'allowed')::boolean
  from jsonb_array_elements(public.sales_check_outreach(array['https://www.saasco.nl/'])) r), 'check_outreach names the campaign');
select pg_temp.check((select (r ->> 'allowed')::boolean from jsonb_array_elements(public.sales_check_outreach(array['iemand@onbekend-bedrijf.nl'])) r),
  'a domain that is not in the portal may be approached');

update public.campaigns set status = 'finished' where id = '00000000-0000-0000-0000-0000000061f1';
select pg_temp.check((select lead_status = 'cooled_down' and recontact_from = current_date + 7 from public.companies where id = '00000000-0000-0000-0000-0000000061c1'),
  'a finished campaign without reply cools down');
select pg_temp.check((select r -> 'reasons' @> '["minder dan 1 week sinds de vorige route zonder nieuw signaal"]'
  from jsonb_array_elements(public.sales_check_outreach(array['saasco.nl'])) r), 'check_outreach names the week');

-- A positive reply: into the pipeline and out of every route.
update public.companies set lead_status = 'ready' where id = '00000000-0000-0000-0000-0000000061c1';
insert into public.campaigns (id, name, channel, provider, status) values
  ('00000000-0000-0000-0000-0000000061f2', 'Test campagne 62', 'linkedin', 'seleqt', 'active');
insert into public.campaign_members (campaign_id, company_id, status) values
  ('00000000-0000-0000-0000-0000000061f2', '00000000-0000-0000-0000-0000000061c1', 'active');
insert into public.activities (company_id, channel, type, direction, outcome, source)
values ('00000000-0000-0000-0000-0000000061c1', 'mail', 'reply', 'inbound', 'reply_positief', 'instantly');
select pg_temp.check((select pipeline_stage = 'interested' from public.companies where id = '00000000-0000-0000-0000-0000000061c1'), 'positive is interested');
select pg_temp.check(not exists (select 1 from public.campaign_members where company_id = '00000000-0000-0000-0000-0000000061c1' and status in ('queued', 'active')),
  'and out of every campaign');
select pg_temp.check((select r -> 'reasons' @> '["pipeline (interested)"]'
  from jsonb_array_elements(public.sales_check_outreach(array['saasco.nl'])) r), 'check_outreach names the pipeline');

-- ---------------------------------------------------------------------------
-- 8. Contact 1 and 2 in the default order
-- ---------------------------------------------------------------------------

-- Fabriek has 20 FTE: the owner (tier 2) goes first.
insert into public.contacts (id, company_id, first_name, title, phone, phone_type) values
  ('00000000-0000-0000-0000-0000000061e1', '00000000-0000-0000-0000-0000000061c2', 'Tom', 'CTO', '+31600006101', 'mobiel'),
  ('00000000-0000-0000-0000-0000000061e2', '00000000-0000-0000-0000-0000000061c2', 'Olga', 'Eigenaar', '+31600006102', 'mobiel'),
  ('00000000-0000-0000-0000-0000000061e3', '00000000-0000-0000-0000-0000000061c2', 'Hanna', 'HR manager', '+31600006103', 'mobiel');
select pg_temp.check((select string_agg(first_name || ':' || role, ',' order by first_name) from public.contacts
  where company_id = '00000000-0000-0000-0000-0000000061c2') = 'Hanna:extra,Olga:main,Tom:reserve', 'under 30 FTE the owner is contact 1');

update public.companies set employees = 120 where id = '00000000-0000-0000-0000-0000000061c2';
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000061a2');
select public.sales_apply_contact_order('00000000-0000-0000-0000-0000000061c2');
select pg_temp.check((select string_agg(first_name || ':' || role, ',' order by first_name) from public.contacts
  where company_id = '00000000-0000-0000-0000-0000000061c2') = 'Hanna:extra,Olga:reserve,Tom:main', 'from 30 FTE the technical contact is contact 1');

-- Picked by hand stays.
select public.sales_update('contact', array['00000000-0000-0000-0000-0000000061e2'::uuid], '{"role": "main"}');
reset role;
insert into public.contacts (company_id, first_name, title) values ('00000000-0000-0000-0000-0000000061c2', 'Dirk', 'Developer');
select pg_temp.check((select role = 'main' from public.contacts where id = '00000000-0000-0000-0000-0000000061e2'), 'a contact 1 picked by hand stays');

-- ---------------------------------------------------------------------------
-- 7. Call screen outcomes
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000061a2');
select pg_temp.fails($$select public.sales_log_call('00000000-0000-0000-0000-0000000061e1', 'not_interested_company')$$, 'a company no without a note');

select public.sales_log_call('00000000-0000-0000-0000-0000000061e3', 'not_interested_person', p_note => 'Gaat er niet over');
select pg_temp.check((select status = 'not_interested' from public.contacts where id = '00000000-0000-0000-0000-0000000061e3'), 'a person no blocks the contact');
select pg_temp.check((select lead_status <> 'nee_geen_interesse' from public.companies where id = '00000000-0000-0000-0000-0000000061c2'), 'and not the company');

select public.sales_log_call('00000000-0000-0000-0000-0000000061e2', 'not_now', p_note => 'Bel in maart terug', p_until => current_date + 100);
select pg_temp.check((select lead_status = 'nu_niet' and recontact_from = current_date + 100 and bucket = 'parked'
  from public.companies where id = '00000000-0000-0000-0000-0000000061c2'), 'not now parks the company until the date');

select public.sales_log_call('00000000-0000-0000-0000-0000000061e1', 'do_not_contact', p_note => 'Boos, wil niet meer gebeld worden');
select pg_temp.check((select lead_status = 'do_not_contact' from public.companies where id = '00000000-0000-0000-0000-0000000061c2'), 'angry is do not contact');
select pg_temp.check(exists (select 1 from public.suppression where company_id = '00000000-0000-0000-0000-0000000061c2'), 'with a suppression');

-- Undo puts the company back, past the do not contact guard.
select public.sales_undo_call((select id from public.activities where contact_id = '00000000-0000-0000-0000-0000000061e1' and outcome = 'do_not_contact'));
select pg_temp.check((select lead_status = 'nu_niet' and recontact_from = current_date + 100 from public.companies where id = '00000000-0000-0000-0000-0000000061c2'),
  'undo puts nu_niet and its date back');
select pg_temp.check(not exists (select 1 from public.suppression where company_id = '00000000-0000-0000-0000-0000000061c2'), 'undo removes the suppression');

-- nu_niet: the date comes, ready again with a follow up.
reset role;
update public.companies set recontact_from = current_date where id = '00000000-0000-0000-0000-0000000061c2';
select public.sales_daily_tick();
select pg_temp.check((select lead_status = 'ready' and next_action = 'Persoonlijk opvolgen (nu niet)' from public.companies where id = '00000000-0000-0000-0000-0000000061c2'),
  'nu_niet comes back on ready with a personal follow up');

rollback;
