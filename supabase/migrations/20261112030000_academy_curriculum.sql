-- Nordavo Academy, the start curriculum structure (spec Academy:
-- startcurriculum). Only courses and modules; lessons, videos and documents
-- are added in the editor (/dashboard/academy) or by a later migration.
--
-- Courses start as draft: nobody outside Nordavo sees them until a manager
-- publishes the course. Modules are published, so they show as soon as the
-- course is; a module without published lessons never blocks the next one.
-- Idempotent: courses by slug, modules by seed_key; existing rows (edited in
-- the editor) are left alone.

insert into public.academy_courses (slug, title, description, language, audience, status, position, created_by)
values
  ('client', 'Werken met je developer in India',
   'De klantcourse: zo haal je het beste uit je Indiase developer. Modules 1 tot en met 4 zijn de kern; module 1 rond je af voordat je developer start.',
   'nl', 'client', 'draft', 1, null),
  ('developer', 'Working in a Dutch team',
   'The developer course: how Dutch teams work, communicate and decide. Modules 1 and 2 are open for candidates.',
   'en', 'developer', 'draft', 2, null)
on conflict (slug) do nothing;

insert into public.academy_modules (
  course_id, seed_key, title, position, status, requires_previous, release_offset_days,
  in_default_access, is_core, required_before_start
)
select c.id, m.seed_key, m.title, m.position, 'published', true, m.release_offset_days,
  m.in_default_access, m.is_core, m.required_before_start
from (values
  ('client', 'client-1', 'Voordat je begint', 1, null::integer, false, true, true),
  ('client', 'client-2', 'De eerste 30 dagen', 2, null, false, true, false),
  ('client', 'client-3', 'Communiceren over 4.000 km', 3, null, false, true, false),
  ('client', 'client-4', 'Delegeren en beslissingsruimte', 4, null, false, true, false),
  ('client', 'client-5', 'Feedback en corrigeren', 5, null, false, false, false),
  -- Example of a module that opens later: from month 2 after the start date.
  ('client', 'client-6', 'Van externe naar teamgenoot', 6, 30, false, false, false),
  ('client', 'client-7', 'Plannen, verlof en meten', 7, null, false, false, false),
  ('client', 'client-8', 'Als het schuurt, en opschalen', 8, null, false, false, false),
  ('client', 'client-9', 'Een team bouwen (vanaf derde plaatsing)', 9, null, false, false, false),
  ('developer', 'developer-1', 'Welcome to a Dutch team', 1, null, true, true, false),
  ('developer', 'developer-2', 'Communicating with Dutch colleagues', 2, null, true, true, false),
  ('developer', 'developer-3', 'Working independently and escalating', 3, null, false, true, false),
  ('developer', 'developer-4', 'Quality, security and growth', 4, null, false, true, false)
) as m (course_slug, seed_key, title, position, release_offset_days, in_default_access, is_core, required_before_start)
join public.academy_courses c on c.slug = m.course_slug
on conflict (seed_key) do nothing;
