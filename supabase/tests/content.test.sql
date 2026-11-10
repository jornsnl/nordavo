-- Content module (supabase/migrations/20261119000000_content.sql): the
-- "done when" of the brief of Julius as a test. One transaction, rolled back.
--
--   * an idea never shows up as a post until it is turned into one
--   * Floris has his own workspace and cannot see Julius' ideas
--   * Sabine (reviewer) sees posts from In review onwards, never ideas, and
--     can never approve
--   * a post cannot go live without approval and cannot be Published
--     without a URL; Measured needs the 7 day results
--   * someone other than the author editing an approved text sends it back
--   * every status change is logged
--   * suggestions are accepted by the author only; Claude only suggests

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000c0001', 'julius.c@nordavo.nl', '{"full_name": "Julius"}'),
  ('00000000-0000-0000-0000-0000000c0002', 'floris.c@nordavo.nl', '{"full_name": "Floris"}'),
  ('00000000-0000-0000-0000-0000000c0003', 'sabine.c@example.nl', '{"full_name": "Sabine"}'),
  ('00000000-0000-0000-0000-0000000c0004', 'viewer.c@nordavo.nl', '{"full_name": "Viewer"}'),
  ('00000000-0000-0000-0000-0000000c0005', 'cand.c@example.in', '{"full_name": "Candidate"}');

update public.profiles set role = 'admin' where email = 'julius.c@nordavo.nl';
update public.profiles set role = 'member' where email in ('floris.c@nordavo.nl', 'viewer.c@nordavo.nl');
update public.profiles set role = 'candidate' where email = 'cand.c@example.in';

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

-- Runs a statement and passes when it raises.
create or replace function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'FAIL (should have been refused): %', p_what;
end $$;

grant execute on function pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.fails(text, text) to authenticated;

-- Julius (admin) creates the workspaces.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
select pg_temp.check(public.content_create_workspace('Julius', 'julius', '00000000-0000-0000-0000-0000000c0001') is not null, 'workspace julius');
select pg_temp.check(public.content_create_workspace('Floris', 'floris', '00000000-0000-0000-0000-0000000c0002') is not null, 'workspace floris');
insert into public.content_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000c0003', 'reviewer' from public.content_workspaces where slug in ('julius', 'floris');
insert into public.content_members (workspace_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000c0004', 'viewer' from public.content_workspaces where slug = 'julius';
select pg_temp.check((select count(*) from public.content_statuses s join public.content_workspaces w on w.id = s.workspace_id where w.slug = 'julius') = 9, 'statuses seeded');
reset role;

-- Floris cannot create workspaces, a candidate has no Content at all.
select pg_temp.act('floris.c@nordavo.nl');
set role authenticated;
select pg_temp.fails($$select public.content_create_workspace('X', 'x', null)$$, 'member creates a workspace');
select pg_temp.check((select count(*) from public.content_workspaces) = 1, 'floris sees only his workspace');
reset role;

select pg_temp.act('cand.c@example.in');
set role authenticated;
select pg_temp.check((select count(*) from public.content_workspaces) = 0, 'candidate sees no workspace');
reset role;

-- Julius captures an idea: it is not a post.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
insert into public.content_ideas (id, workspace_id, text, tags)
select '00000000-0000-0000-0000-0000000ce001', id, 'Why Dutch companies hesitate to hire in India', array['India', ' hiring ']
from public.content_workspaces where slug = 'julius';
select pg_temp.check((select count(*) from public.content_posts) = 0, 'an idea is not a post');
select pg_temp.check((select tags from public.content_ideas where id = '00000000-0000-0000-0000-0000000ce001') = array['hiring', 'india'], 'tags normalised');
reset role;

-- Nobody else sees the idea.
select pg_temp.act('floris.c@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.content_ideas) = 0, 'floris cannot see julius ideas');
reset role;
select pg_temp.act('sabine.c@example.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.content_ideas) = 0, 'reviewer cannot see ideas');
select pg_temp.fails($$insert into public.content_ideas (workspace_id, text) select id, 'x' from public.content_workspaces where slug = 'julius'$$, 'reviewer adds an idea');
reset role;
select pg_temp.act('viewer.c@nordavo.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.content_ideas) = 0, 'viewer cannot see private ideas');
reset role;

-- Turn into post: a draft linked to the idea, the idea Converted.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
create temp table t_post on commit drop as
  select public.content_ideas_to_post(array['00000000-0000-0000-0000-0000000ce001']::uuid[], 'Hiring in India') as id;
grant select on t_post to authenticated, service_role;
select pg_temp.check((select status from public.content_posts where id = (select id from t_post)) = 'draft', 'post starts as draft');
select pg_temp.check((select status from public.content_ideas where id = '00000000-0000-0000-0000-0000000ce001') = 'converted', 'idea converted');
select pg_temp.check((select count(*) from public.content_idea_posts) = 1, 'idea linked');
select pg_temp.check((select count(*) from public.content_status_log where post_id = (select id from t_post)) = 1, 'creation logged');
update public.content_posts set hook = 'Most Dutch companies never try.', body = 'Here is why.', format = 'text' where id = (select id from t_post);
select pg_temp.check((select version from public.content_posts where id = (select id from t_post)) = 2, 'edit makes a version');
reset role;

-- The reviewer does not see drafts.
select pg_temp.act('sabine.c@example.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.content_posts) = 0, 'reviewer does not see drafts');
reset role;

-- Julius sends it to review; Sabine gets a notification and sees it.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
update public.content_posts set status = 'in_review' where id = (select id from t_post);
reset role;
select pg_temp.check((select count(*) from public.content_notifications n join auth.users u on u.id = n.user_id
  where u.email = 'sabine.c@example.nl' and n.kind = 'in_review') = 1, 'reviewer notified');

select pg_temp.act('sabine.c@example.nl');
set role authenticated;
select pg_temp.check((select count(*) from public.content_posts) = 1, 'reviewer sees post in review');
-- She cannot edit the text, nor approve.
select pg_temp.fails(format($$update public.content_posts set body = 'Changed' where id = %L$$, (select id from t_post)), 'reviewer edits text');
select pg_temp.fails(format($$update public.content_posts set status = 'approved' where id = %L$$, (select id from t_post)), 'reviewer approves');
-- She suggests a change instead.
insert into public.content_suggestions (post_id, field, start_offset, original_text, replacement_text, base_version)
values ((select id from t_post), 'hook', 5, 'Dutch companies', 'Dutch scale-ups', 0);
select pg_temp.fails(format($$insert into public.content_suggestions (post_id, field, start_offset, original_text, replacement_text, base_version) values (%L, 'hook', 0, 'Nope', 'x', 0)$$, (select id from t_post)), 'suggestion on text that is not there');
-- And comments on a piece of text.
insert into public.content_comments (post_id, field, quote, start_offset, body)
values ((select id from t_post), 'body', 'Here is why.', 0, 'Make this concrete');
-- She cannot accept her own suggestion.
select pg_temp.fails(format($$select public.content_accept_suggestion(%L)$$, (select id from public.content_suggestions limit 1)), 'reviewer accepts');
update public.content_posts set status = 'changes_requested' where id = (select id from t_post);
reset role;
select pg_temp.check((select count(*) from public.content_notifications n where n.kind = 'suggestions_ready') = 1, 'author notified of suggestions');
select pg_temp.check((select count(*) from public.content_notifications n where n.kind = 'changes_requested') = 1, 'author notified of changes requested');

-- Julius accepts the suggestion: the text changes, a version is made.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
select public.content_accept_suggestion((select id from public.content_suggestions limit 1));
select pg_temp.check((select hook from public.content_posts where id = (select id from t_post)) = 'Most Dutch scale-ups never try.', 'suggestion applied');
select pg_temp.check((select status from public.content_suggestions limit 1) = 'accepted', 'suggestion accepted');
-- Scheduling before approval is refused.
update public.content_posts set status = 'in_review' where id = (select id from t_post);
select pg_temp.fails(format($$update public.content_posts set status = 'scheduled' where id = %L$$, (select id from t_post)), 'schedule without approval');
update public.content_posts set status = 'approved' where id = (select id from t_post);
select pg_temp.check((select approved_at is not null from public.content_posts where id = (select id from t_post)), 'approved');
reset role;
select pg_temp.check((select count(*) from public.content_notifications n where n.kind = 'approved') = 1, 'reviewer notified of approval');

-- Sabine schedules: needs a date and a time slot.
select pg_temp.act('sabine.c@example.nl');
set role authenticated;
select pg_temp.fails(format($$update public.content_posts set status = 'scheduled' where id = %L$$, (select id from t_post)), 'schedule without date');
update public.content_posts set planned_date = current_date + 1, time_slot = 't0830', status = 'scheduled' where id = (select id from t_post);
-- Published needs the URL.
select pg_temp.fails(format($$update public.content_posts set status = 'published' where id = %L$$, (select id from t_post)), 'publish without url');
reset role;

-- Julius as admin edits the approved... no: he is the author. Floris is not
-- in this workspace; the viewer cannot edit at all.
select pg_temp.act('viewer.c@nordavo.nl');
set role authenticated;
update public.content_posts set body = 'Viewer edit' where id = (select id from t_post);
select pg_temp.check((select body from public.content_posts where id = (select id from t_post)) = 'Here is why.', 'viewer cannot edit');
reset role;

-- An admin who is not the author editing a scheduled text sends it back.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000c0006', 'jorn.c@nordavo.nl', '{"full_name": "Jorn"}');
update public.profiles set role = 'admin' where email = 'jorn.c@nordavo.nl';
select pg_temp.act('jorn.c@nordavo.nl');
set role authenticated;
update public.content_posts set body = 'Here is why, in three numbers.' where id = (select id from t_post);
select pg_temp.check((select status from public.content_posts where id = (select id from t_post)) = 'changes_requested', 'edit by someone else sends back');
select pg_temp.check((select approved_at is null from public.content_posts where id = (select id from t_post)), 'approval cleared');
reset role;

-- Back through approval to published, then results and measured.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
update public.content_posts set status = 'approved' where id = (select id from t_post);
reset role;
select pg_temp.act('sabine.c@example.nl');
set role authenticated;
update public.content_posts set status = 'scheduled' where id = (select id from t_post);
update public.content_posts set linkedin_url = 'https://www.linkedin.com/feed/update/urn:li:activity:1', status = 'published' where id = (select id from t_post);
select pg_temp.fails(format($$update public.content_posts set status = 'measured' where id = %L$$, (select id from t_post)), 'measured without results');
insert into public.content_results (post_id, measured_after, impressions, likes, comments, reposts) values ((select id from t_post), '7d', 1200, 18, 6, 1);
update public.content_posts set status = 'measured' where id = (select id from t_post);
reset role;

select pg_temp.check((select count(*) from public.content_status_log where post_id = (select id from t_post)) >= 10, 'every status change logged');
select pg_temp.check((select count(*) from public.content_events where kind = 'post_published') = 1, 'published event');

-- Reviewer count: Sabine reviewed and published one post this month.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
select pg_temp.check((select reviewed from public.content_reviewer_counts(current_date)) = 1, 'reviewed count');
select pg_temp.check((select published from public.content_reviewer_counts(current_date)) = 1, 'published count');
reset role;

-- Admin approval required: the author can no longer approve.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
update public.content_workspaces set admin_approval_required = true where slug = 'floris';
reset role;
select pg_temp.act('floris.c@nordavo.nl');
set role authenticated;
insert into public.content_posts (workspace_id, title) select id, 'First post' from public.content_workspaces where slug = 'floris';
update public.content_posts set status = 'in_review' where title = 'First post';
select pg_temp.fails($$update public.content_posts set status = 'approved' where title = 'First post'$$, 'author approves with admin approval required');
-- Floris cannot move his own workspace to someone else.
update public.content_workspaces set rhythm_goal = 3 where slug = 'floris';
select pg_temp.fails($$update public.content_workspaces set owner_id = null where slug = 'floris'$$, 'author changes owner');
reset role;
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
update public.content_posts set status = 'approved' where title = 'First post';
reset role;

-- Claude: suggestions only, and never on a published post.
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
set role service_role;
select pg_temp.fails(format($$select public.content_api_suggest_text(%L, 'body', 0, 'Here', 'This', 'Shorter', '00000000-0000-0000-0000-0000000c0001')$$, (select id from t_post)), 'suggestion on a published post');
select public.content_api_suggest_text((select id from public.content_posts where title = 'First post'), 'title', 0, 'First', 'My first', null, '00000000-0000-0000-0000-0000000c0001');
select pg_temp.check((select count(*) from public.content_suggestions where suggested_by = 'claude' and status = 'pending') = 1, 'claude suggestion saved');
select pg_temp.fails($$select public.content_api_suggest_text((select id from public.content_posts where title = 'First post'), 'title', 0, 'First', 'X', null, '00000000-0000-0000-0000-0000000c0005')$$, 'claude for an outsider');
select public.content_api_suggest_image_brief((select id from public.content_posts where title = 'First post'), '{"what": "Floris at his desk", "format": "portrait 4:5", "evil": "x"}', '00000000-0000-0000-0000-0000000c0001');
select pg_temp.check((select image_brief from public.content_posts where title = 'First post') = '{"what": "Floris at his desk", "format": "portrait 4:5"}', 'brief saved without unknown keys');
select pg_temp.check((select status from public.content_posts where title = 'First post') = 'approved', 'claude does not change the status');
reset role;
-- Without the secret key the API functions are closed.
select pg_temp.act('julius.c@nordavo.nl');
set role authenticated;
select pg_temp.fails($$select public.content_api_role(null, null)$$, 'api function for a signed-in user');
reset role;

-- Hourly checks queue notifications and are idempotent.
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
set role service_role;
select public.content_run_checks();
select public.content_run_checks();
reset role;
select pg_temp.check((select count(*) from public.content_notifications where kind = 'buffer_low') = (select count(distinct workspace_id) from public.content_notifications where kind = 'buffer_low'), 'buffer warning once per week');

rollback;
