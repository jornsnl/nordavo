# Nordavo Academy

De Academy is de leeromgeving van Nordavo in het portaal: een klantcourse in het Nederlands voor klanten, een developercourse in het Engels voor developers en kandidaten. Nordavo beheert alles zelf in `/dashboard/academy`; deelnemers leren in `/academy`. Zelfde login als de rest van het portaal.

Dit document is het contract voor iedereen die de Academy uitbreidt. Het beschrijft het datamodel, de rollen, de routes, het lesblokken-framework met de afrondregels en wat nog gebouwd moet worden. Houd het bij als je iets toevoegt.

| Onderdeel | Waar |
| --- | --- |
| Migraties | `supabase/migrations/20261112000000_academy_foundation.sql` (rollen, mensen, content, toegang), `20261112010000_academy_placements.sql` (plaatsing, ritme, verlof, meldingen), `20261112020000_academy_learning.sql` (leerdata, afrond-engine, RPC's), `20261112030000_academy_curriculum.sql` (startcurriculum), `20261112040000_academy_editor.sql` (editorhulpen), `20261113000000_academy_media.sql` (video, documenten, werkbladen, certificaten, zie 12) |
| SQL tests | `supabase/tests/academy_rls.test.sql` (rollen en zichtbaarheid), `supabase/tests/academy_engine.test.sql` (afrondregels, ontgrendelen, dupliceren), `supabase/tests/academy_media.test.sql` (media, werkbladen, certificaat) |
| Types | `src/lib/academy/database.ts` (samengevoegd in `src/lib/database.types.ts`) |
| Puur (getest) | `src/lib/academy/i18n.ts`, `time.ts`, `sanitize.ts`, `progress.ts`, `people.ts`, `routing.ts`, `mail.ts`, `blocks/types.ts` |
| Server | `src/lib/academy/auth.ts`, `data.ts` (deelnemer), `admin.ts` (beheer), `blocks/server.ts` |
| Acties | `src/app/academy/actions.ts` (deelnemer), `src/app/dashboard/academy/actions.ts` (content en toegang), `src/app/dashboard/academy/people/actions.ts` (mensen en groepen) |
| UI | `src/components/academy/*` (deelnemer), `src/components/academy/admin/*` (beheer), `src/components/academy/blocks/*` (bloktypes) |
| Unit tests | `tests/academy-*.test.ts` |

## 1. Rollen en zichtbaarheid

| Rol | Hoe herkend | Ziet |
| --- | --- | --- |
| Nordavo beheer | `profiles.role = 'admin'`, of `member` met module `academy` in `profiles.modules` | Alles: content, mensen, antwoorden, opdrachten, pulse. Beheert in `/dashboard/academy`, ziet `/academy` als voorbeeld (er wordt dan geen voortgang opgeslagen) |
| Klantbeheerder | `profiles.role = 'client'`, `academy_members.academy_role = 'client_admin'` | Klantcourse, eigen plaatsingen, voortgang en scores van collega's (zelfde `client_id`) en van de developer in zijn plaatsingen |
| Klant lid | `client`, `client_member` | Klantcourse en de plaatsing; alleen eigen voortgang |
| Meelezer | `client`, `client_reader` | Alleen voortgang en scores van collega's en de developer, nooit antwoorden of notities. Volgt zelf geen course |
| Developer | `profiles.role = 'developer'`, `academy_role = 'developer'` | Developercourse en eigen plaatsing |
| Kandidaat | `profiles.role = 'candidate'`, `academy_role = 'candidate'` | Alleen de open modules van de developercourse; niets van klanten of plaatsingen |

Regels:

* Alleen Nordavo voegt mensen toe (`academy_add_person()` controleert `academy_is_manager()`); niemand kan zichzelf of een ander uitnodigen.
* De klant ziet nooit salaris of kosten van de developer. Klanten en developers lezen de tabel `placements` niet; plaatsingsgegevens komen alleen via `academy_my_placements()` en `academy_placement_people()`, zonder geldkolommen (getest).
* Module `academy` is nieuw in Settings, Users. Net als bij de andere modules kregen bestaande teamleden hem erbij; een admin kan hem per lid uitzetten.
* De rol staat in het sessietoken (`app_metadata.portal_role`, door de database bijgehouden). De proxy (`src/lib/supabase/proxy.ts` met `src/lib/academy/routing.ts`) stuurt developers en kandidaten altijd naar `/academy` (plus `/auth` en `/login`; een API geeft 403) en klanten naar `/portal` of `/academy` (plus Work, `/auth`, `/login`, `/api`). Na het inloggen landen developers en kandidaten op `/academy`.
* Pagina's controleren opnieuw: `requireAcademyUser()` (deelnemers en beheer) en `requireAcademyManager()` (`requireModule('academy')`) in `src/lib/academy/auth.ts`.

### Helpers in SQL

| Functie | Wat |
| --- | --- |
| `academy_is_manager()` | Admin of member met module `academy` |
| `academy_member_role(profile?)` | Academy rol, null als geen deelnemer |
| `academy_course_scope(course, profile)` | `all`, `default` of null; alleen intern |
| `academy_has_course(course, profile?)` | Heeft toegang (eigen of via groep) |
| `academy_course_visible(course)`, `academy_module_visible(module)`, `academy_lesson_visible(lesson)` | Titels die de ingelogde gebruiker mag zien (ook als ze op slot zitten) |
| `academy_can_open_lesson(lesson)`, `academy_can_open_module(module)` | Mag de inhoud openen (beheer altijd) |
| `academy_placement_role(placement, profile?)`, `academy_can_see_placement(placement)` | Rol in een plaatsing; lid of beheer |
| `academy_can_view_progress(profile)` | Mag voortgang en scores van deze persoon zien (zie tabel hierboven) |
| `academy_can_see_video(video)`, `academy_can_see_document(document)`, `academy_can_read_file(path)` | Media en bestanden (storage) |
| `academy_task_open(task)`, `academy_task_can_tick(task, profile, placement)` | Taken zien en afvinken |

## 2. Datamodel

Alle tabellen hebben RLS. Beheer heeft overal de policy `Academy managers manage <tabel>` (behalve de vragenlijst, zie onder). Waar hieronder "eigen" staat is dat `profile_id = auth.uid()`.

### Hergebruikt

| Begrip | Tabel | Toegevoegd |
| --- | --- | --- |
| Organisatie (klantbedrijf) | `clients` | Niets. Beheer leest namen via `academy_client_options()` |
| Gebruiker | `profiles` | Rollen `developer` en `candidate`, module `academy`. Tijdzone is `profiles.time_zone` (Europe/Amsterdam of Asia/Kolkata in de Academy) |
| Kandidaat | `candidates` | `top_candidate`, `top_candidate_at` (los van `is_topper`, de ster van de recruiter in een pipeline). Beheer zoekt via `academy_candidate_options(search)` (alleen naam en mail) |
| Plaatsing | `placements` | `hours_per_week`, `overlap_start`, `overlap_end`, `overlap_time_zone` (standaard Europe/Amsterdam), `probation_end_date`, `nordavo_contact_id`. `status` bestond al (active, notice, ended) |

### Mensen en toegang

| Tabel | Wat | Deelnemer mag |
| --- | --- | --- |
| `academy_members` | Eén rij per deelnemer: `academy_role`, `locale` (nl/en), `start_date`, `candidate_id` (uniek, de ATS kandidaat), `digest_frequency` (daily/weekly/off), `digest_sent_at`, `last_active_at`, `invited_at`, `invited_by` | Eigen rij lezen, alleen `locale` en `digest_frequency` wijzigen (trigger `academy_members_guard`) |
| `academy_groups` | Kandidatengroep: `name`, `kind` (vacancy, month, campaign, other), `vacancy_id` | Niets |
| `academy_group_members` | Groep, persoon | Niets |
| `academy_course_access` | Toegang tot een course voor een persoon of een groep, `scope` `all` of `default` | Eigen rijen (en die van eigen groepen) lezen |
| `academy_open_modules` | Extra open modules per persoon, `force` opent meteen | Eigen rijen lezen |
| `academy_placement_members` | De driehoek: `client_admin`, `client_member`, `client_reader`, `developer` per plaatsing | Leden van dezelfde plaatsing lezen |

### Content

| Tabel | Wat |
| --- | --- |
| `academy_courses` | `slug` (`client`, `developer` voor het startcurriculum), `title`, `language`, `audience` (client/developer), `status` (draft/published), `position` |
| `academy_modules` | Per course: `position`, `status`, `requires_previous` (op volgorde), `release_offset_days` (dagen na startdatum), `in_default_access` (open bij scope default, dus voor kandidaten), `is_core`, `required_before_start`, `workbook_document_id`, `seed_key` |
| `academy_module_requirements` | Module vereist andere modules (ook uit een andere course) |
| `academy_lessons` | Losse les: `title`, `summary`, `language`, `status`, `duration_minutes` |
| `academy_module_lessons` | Koppeling module en les met `position`. Eén les kan in meer modules en courses staan; een wijziging werkt overal door en voortgang telt overal |
| `academy_lesson_blocks` | Blokken van een les: `type`, `position`, `title`, `content` (jsonb per type), `required`, `completion` (jsonb, de afrondregel), `video_id`, `document_id` |
| `academy_videos`, `academy_video_versions` | Een video (vaste id) met versies: `storage_path`, `duration_seconds`, `subtitles_nl_path`, `subtitles_en_path`, `transcript`, `transcript_status`. `academy_videos.current_version_id` wijst de actieve versie aan |
| `academy_documents`, `academy_document_versions` | Document: `kind` (download/worksheet), `scope` (global of placement met `placement_id`), `category` (workbook, template, checklist, contract_summary, gdpr, policy, escalation_matrix, decision_matrix, blocker_agreement, other), `worksheet_fields` (jsonb), `current_version`, `new_until` (label "nieuw"). Versies met `storage_path`, `file_name` |

Bloktypes (check op `academy_lesson_blocks.type`): `explanation`, `video`, `document`, `worksheet`, `assignment`, `tasks`, `knowledge_check`, `notes`, `questionnaire`. Het type `questionnaire` is de persoonlijkheidstest (sectie 12).

Deelnemers lezen gepubliceerde courses waar ze toegang toe hebben, de titels van alle gepubliceerde modules en lessen daarin (ook op slot, die tonen met een slotje), en de blokken alleen als de les open is. Concepten zien alleen beheerders.

### Leerdata

| Tabel | Wat | Wie |
| --- | --- | --- |
| `academy_block_progress` | Per blok per persoon: `viewed_at`, `state` (vrij jsonb) | Eigen lezen; schrijven via `academy_record_block_view()` |
| `academy_notes` | Eigen notitie per les (`lesson_id`) of module (`module_id`) | Eigen beheren; beheer leest; nooit klanten of meelezers |
| `academy_watch_progress` | Per video (niet per versie): `version_id`, `position_seconds`, `percent` (gaat nooit omlaag), `watched_seconds`, `completed_at` | Schrijven via `academy_record_watch()`; lezen eigen en wie voortgang mag zien |
| `academy_worksheet_answers` | Per document per persoon: `answers`, `submitted_at` | Eigen beheren; beheer leest |
| `academy_assignment_submissions` | Per blok per persoon per poging: `body`, `file_path`, `link_url`, `status` (submitted, changes_requested, approved), `feedback`, `final_score` | Eigen lezen; inleveren via `academy_submit_assignment()`; status, feedback en score alleen beheer via `academy_review_submission()` (trigger `academy_submissions_guard`). Zie sectie 12 |
| `academy_assignment_assessments` | AI voorstel op de rubric (`ai_scores`, `ai_total`, `ai_summary`, `ai_status`) en `rubric_scores` van Nordavo | Alleen beheer |
| `academy_tasks` | Taken van een takenblok: `deadline_offset_days`, `shared`, `placement_only`, `required` | Lezen als de les open is (placement-only pas met een plaatsing) of als gedeelde taak van de eigen plaatsing |
| `academy_task_status` | Status per persoon (`profile_id`) of per plaatsing voor gedeelde taken (`profile_id` null, `placement_id`): `due_at`, `done_at`, `done_by`, `reminded_at`, `reminder_count` | Eigen taken afvinken; gedeelde taken door klantbeheerder, klant lid of developer van de plaatsing; lezen voor de hele plaatsing |
| `academy_check_questions` | Vragen met `options` en `correct_index`, `explanation` | Alleen beheer; de deelnemer krijgt vragen zonder antwoord via `academy_check_questions_for()` |
| `academy_check_attempts` | Pogingen: `answers`, `score`, `max_score` | Eigen lezen; schrijven via `academy_submit_check()` (scoort in de database) |
| `academy_questionnaire_consents`, `academy_questionnaire_responses` | Persoonlijkheidstest: eigen toestemming (met tijdstip, in te trekken), antwoorden alleen met geldige toestemming | De persoon zelf leest; schrijven via functies; beheer (admin of module `academy`) leest en beheert. Nooit klanten, meelezers of andere deelnemers |
| `academy_lesson_progress` | Per les per persoon: `started_at`, `last_viewed_at`, `last_course_id`, `required_total`, `required_done`, `percent`, `completed_at` | Alleen via functies; lezen eigen en wie voortgang mag zien |
| `academy_module_completions` | Module afgerond (eenmaal vastgelegd, blijft) | Idem |
| `academy_certificates` | `number`, `full_name`, `storage_path`, `issued_at` per persoon per course | Lezen eigen en wie voortgang mag zien; schrijven beheer |

### Plaatsing en ritme

| Tabel | Wat | Wie |
| --- | --- | --- |
| `academy_rituals` | Per course (sjabloon) of per plaatsing: `cadence` (daily, weekly, monthly), `weekday`, `audience` | Lezen voor leden van de plaatsing en voor wie de course volgt |
| `academy_ritual_logs` | Afgevinkt per `period_date` | Leden van de plaatsing lezen; klantbeheerder, klant lid en developer vinken eigen af |
| `academy_pulses`, `academy_pulse_answers` | Tweewekelijkse check: `score` 1 tot 10, `going_well`, `friction`, `flagged` | De ontvanger leest en beantwoordt de eigen pulse; scores en trend alleen Nordavo |
| `academy_leave_requests` | `kind`, `start_date`, `end_date`, `days`, `status` (requested, client_agreed, approved, rejected, cancelled) | Alle drie de kanten lezen; de developer vraagt aan; besluiten via Nordavo |
| `academy_leave_balances` | Per persoon per plaatsing per jaar: `entitled_days`, `carried_over_days`, `adjustment_days` | Leden van de plaatsing lezen |
| `academy_holidays` | `country` (NL, IN), `region` (bijv. KA), `year`, `date`, `name_nl`, `name_en` | Iedereen ingelogd leest |
| `academy_milestones` | `kind` (day_1, week_1, day_30, day_90, custom), `due_date`, `completed_at` | Leden van de plaatsing lezen |
| `academy_reviews` | Reviewformulier (`answers`) en verslag (`report`), `draft`/`submitted` | Auteur eigen concept; ingediend voor klantbeheerder, klant lid en developer |
| `academy_notifications` | `kind`, `title`, `body`, `link`, `payload`, `read_at`, `digested_at` | Eigen lezen en alleen `read_at` zetten; aanmaken via `academy_notify(profile, kind, title, body, link, payload)` (service role en security definer functies) of beheer |

### Opslag

Bucket `attachments`, paden onder `academy/` (video's staan in de bucket `academy-media`, zie 12):

| Pad | Wie leest |
| --- | --- |
| `academy/video/<video_id>/...` (bucket `academy-media`) | `academy_can_see_video` |
| `academy/document/<document_id>/...` | `academy_can_see_document` |
| `academy/submission/<profile_id>/...` | De persoon (mag ook uploaden) en beheer |
| `academy/certificate/<profile_id>/...` | Wie voortgang van die persoon mag zien (het certificaat wordt nu bij het downloaden gemaakt, zie 12) |
| `academy/image/<id>/<bestand>` | Iedere deelnemer en beheer (afbeeldingen in de uitleg) |

Beheer beheert alles onder `academy/` (`can_access_entity('academy')` is nu module `academy`).

## 3. Afrondregels en ontgrendelen

### Wanneer is een les af

Per blok zet beheer `required` aan of uit, en voor sommige types een regel in `completion`:

| Type | Regel (`completion`) | Klaar als (`academy_block_done_<type>`) |
| --- | --- | --- |
| explanation | | Gezien (`academy_record_block_view`) |
| document | | Geopend of gedownload (`academy_record_block_view`, ook via de downloadroute). Zonder document of bestand: klaar |
| notes | | Een notitie die niet leeg is, op de les of (content `scope: module`) op de module |
| video | `min_percent` (standaard 90) | `academy_watch_progress.percent` minstens zoveel, of tot het eind gekeken. Zonder video of zonder bestand: klaar |
| worksheet | | Antwoorden ingeleverd (`submitted_at`) voor het document van het blok. Zonder werkblad of zonder velden: klaar |
| assignment | `require`: `submitted` (standaard) of `approved` | Laatste poging ingeleverd (of na aanpassing opnieuw) of goedgekeurd |
| tasks | | Alle verplichte taakinstanties die voor de persoon gelden zijn af (`academy_task_instances`): eigen taken, placement-only pas met een plaatsing, gedeelde taken per plaatsing waar de taak geldt. Zonder plaatsing tellen gedeelde taken niet |
| knowledge_check | `min_percent` (standaard 0) | Een poging met minstens die score |
| questionnaire | | Ingeleverd, met toestemming die niet is ingetrokken |

Een les is af (groen vinkje) als alle verplichte blokken klaar zijn; een les zonder verplichte blokken is af zodra hij geopend is. Er is geen afrondknop. `completed_at` wordt één keer gezet en nooit gewist, ook niet als er later verplichte blokken bij komen. Een module is af als alle gepubliceerde lessen af zijn; dat wordt in `academy_module_completions` vastgelegd en blijft staan als er lessen bijkomen.

De motor: `academy_block_done(block, profile)` roept `academy_block_done_<type>(block, profile)` aan. `academy_refresh_lesson(lesson, profile)` telt de verplichte blokken, schrijft `academy_lesson_progress` en legt module-afronding vast. Triggers op `academy_block_progress`, `academy_notes`, `academy_watch_progress`, `academy_worksheet_answers`, `academy_assignment_submissions`, `academy_task_status`, `academy_check_attempts` en `academy_questionnaire_responses` roepen dat aan voor de lessen die de wijziging raakt. Een bloktype hoeft dus alleen zijn eigen data te schrijven.

### Wanneer gaat een module open

`academy_module_state(module, profile)` geeft, in deze volgorde:

| Toestand | Wanneer |
| --- | --- |
| null | Niet zichtbaar: concept, course in concept, of geen toegang |
| `completed` | Afgerond (blijft altijd) |
| `open` | `academy_open_modules.force` voor deze persoon |
| `locked_scope` | Scope `default` en de module is niet `in_default_access` en niet per persoon open |
| `open` | Er is al voortgang in een les van de module (blijft open, verder waar je was) |
| `locked_release` | `release_offset_days` gezet en vandaag (in de tijdzone van de persoon) voor startdatum + offset, of geen startdatum |
| `locked_requirement` | Een vereiste module is niet af |
| `locked_order` | `requires_previous` en de vorige module in de scope van de persoon (gepubliceerd, met lessen) is niet af. Lege modules blokkeren niet |
| `open` | Anders |

Scopes: `all` is de hele course (een geplaatste developer, klanten), `default` zijn de modules met `in_default_access` plus de modules in `academy_open_modules` (kandidaten standaard module 1 en 2, topkandidaten per persoon meer). Een open module per persoon zonder `force` volgt nog wel de volgorde; met `force` gaat hij meteen open. Toegang intrekken laat de voortgang staan; komt de toegang terug, dan telt alles weer.

### In TypeScript

`src/lib/academy/progress.ts` bouwt uit `academy_course_outline()` de modules met lessen (`buildOutline`), de voortgang van een course (`courseProgress`, een les in twee modules telt één keer, modules buiten de scope tellen niet), "verder waar je was" (`continueTarget`), Vorige en Volgende (`neighbours`, slaat dichte modules over), de reden van een slot (`moduleStateLabel`) en wat een les nog nodig heeft (`lessonRequirements`, tekst uit het register). De regels zelf staan in SQL.

## 4. RPC's

| Functie | Voor | Wat |
| --- | --- | --- |
| `academy_my_courses()` | Deelnemer | Courses met scope, lessen in scope, lessen af, laatst bekeken, afgerond. Beheer: alle courses |
| `academy_course_outline(course)` | Deelnemer | Per module de toestand en `release_date`, per les de eigen voortgang. Beheer: alles open, ook concepten |
| `academy_lesson_blocks_state(lesson)` | Deelnemer | `done` per blok |
| `academy_open_lesson(lesson, course?)` | Deelnemer | Les geopend: `last_viewed_at`, `last_course_id`, voortgang opnieuw berekend; geeft de voortgang als json. Beheer zonder toegang: niets (voorbeeld) |
| `academy_record_block_view(block)` | Deelnemer | Blok gezien |
| `academy_record_watch(video, version, position, percent, watched_seconds, ranges)` | Deelnemer | Kijkvoortgang; percent alleen omhoog. Met `ranges` (wat echt is afgespeeld) rekent de server het percent uit, zie 12 |
| `academy_touch()` | Deelnemer | `last_active_at` (hooguit eens per 5 minuten) |
| `academy_my_placements()` | Klant, developer | Eigen plaatsingen zonder geld: rol, status, data, uren, overlapvenster, proeftijd, klant, developer, vacature, Nordavo contact (naam, mail, boekingslink) |
| `academy_placement_people(placement)` | Leden, beheer | Namen, mail en rol in de plaatsing |
| `academy_people_progress()` | Iedereen | Voortgang en scores (lessen, kennischeck gemiddelde, goedgekeurde opdrachten, laatst actief, certificaat) van wie je mag volgen |
| `academy_add_person(profile, role, locale, start_date, client, candidate, course, scope, open_module_ids, time_zone)` | Beheer | Persoon toevoegen of bijwerken: profielrol (klanten blijven `client`, het team houdt zijn rol, een developer wordt nooit terug kandidaat, een beller of klant kan geen developer worden), Academy rij, toegang (scope wordt nooit kleiner) en open modules |
| `academy_duplicate_lesson(lesson, module?)` | Beheer | Kopie als concept met blokken, taken en kennischeckvragen; video's en documenten worden gedeeld |
| `academy_duplicate_module(module)` | Beheer | Kopie aan het eind van de course, met kopieën van de lessen |
| `academy_client_options()`, `academy_candidate_options(search)` | Beheer | Keuzelijsten |
| `academy_course_done(course, profile)`, `academy_refresh_lesson(lesson, profile)`, `academy_module_state(module, profile)` | Service role | Voor jobs (certificaat, herinneringen) |

## 5. Routes

| Route | Wie | Wat |
| --- | --- | --- |
| `/academy` | Deelnemers, beheer (voorbeeld) | Startpagina: welkom, voortgang per course, verder waar je was, voortgang van je team (klantbeheerder, meelezer), plaatsingskaart, plan een call. Vakken voor anderen: openstaande taken, rituelen deze week, komende momenten |
| `/academy/courses/[courseId]` | | Modules met lessen, vinkjes en slotjes, reden van het slot |
| `/academy/courses/[courseId]/lessons/[lessonId]?module=` | | Lesspeler: lessen links, voortgangsbalk, wat nog moet, blokken, Vorige en Volgende. `module` kiest de plek als de les in meer modules staat |
| `/academy/settings` | | Taal, tijdzone (NL of India), mailsamenvatting |
| `/academy/notifications` | | Meldingen, gelezen markeren (zie 12) |
| `/academy/certificates/[id]` | Persoon, beheer, wie voortgang mag zien | Certificaat als PDF |
| `/academy/files/document/[id]`, `/academy/files/image/...`, `/academy/files/subtitles/[version]/[nl\|en]` | Volgens RLS | Download, afbeelding, ondertitels |
| `/academy/security` | | Tweestapsverificatie en passkeys |
| `/dashboard/academy` | Beheer | Courses, nieuwe course |
| `/dashboard/academy/courses/[id]` | Beheer | Course: publiceren, instellingen, modules slepen, per module de vrijgaveregel, lessen slepen, nieuwe of hergebruikte les, dupliceren, toegang per persoon of groep |
| `/dashboard/academy/lessons/[id]` | Beheer | Les: instellingen, publiceren, dupliceren, blokken toevoegen en slepen, per blok verplicht en de regel, waar de les gebruikt wordt |
| `/dashboard/academy/people` | Beheer | Mensen filteren, toevoegen per stuk of in bulk (lijst of CSV) |
| `/dashboard/academy/people/[id]` | Beheer | Taal, startdatum, mailsamenvatting, nieuwe inloglink, courses met scope en open modules per persoon, groepen |
| `/dashboard/academy/groups` | Beheer | Kandidatengroepen |
| `/dashboard/academy/library` | Beheer | Alle lessen en documenten en waar ze gebruikt worden |
| `/dashboard/academy/reviews`, `/dashboard/academy/reviews/[id]` | Beheer | Wachtrij en beoordeling van opdrachten met AI-voorstel (sectie 12) |
| `/dashboard/academy/tasks` | Beheer | Achterstallige taken (sectie 12) |
| `/dashboard/academy/documents`, `/dashboard/academy/documents/[id]` | Beheer | Documenten en werkbladen: versies, velden, werkboek van een module, alle antwoorden (ook als CSV) |

Klanten zien in het klantportaal een tab Academy. In het Academy-scherm staat een knop terug naar het klantportaal.

## 6. Taal, tijdzone en huisstijl

* Alle teksten van `/academy` staan in `src/lib/academy/i18n.ts`, Nederlands en Engels. Een sleutel moet in beide woordenboeken (de test controleert sleutels en placeholders). Gebruik `t(locale, key, vars)` of `translator(locale)`. Klanten krijgen standaard Nederlands, developers en kandidaten Engels; de taalknop in de kop slaat de keuze op (`academy_members.locale`). De beheer-editor is Engels, zoals de rest van het dashboard.
* Tijden staan in UTC, datums (startdatum, vrijgave) als `YYYY-MM-DD`. `src/lib/academy/time.ts`: `localDateIso` (vandaag voor iemand), `formatAcademyDate`, `formatAcademyDateTime`, `deadlineFromOffset(start, offset, zone)` (einde van de dag in de eigen tijdzone), `relativeDeadlineLabel` ("uiterlijk dag 1", "in week 2"), `convertWallTime` (overlapvenster voor beide kanten), `releaseDateFor`. Tijdzones in de Academy: `Europe/Amsterdam` en `Asia/Kolkata`.
* Huisstijl: oranje voor knoppen en acties, lichtblauw voor de rest. Tokens `--academy-orange-*` en `--academy-blue-*` in `src/app/globals.css` (Tailwind: `bg-academy-orange-600`, `text-academy-blue-900`, ...). Bouwstenen in `src/components/academy/ui.tsx`: `ActionLink`, `ActionButton`, `actionClasses`, `Panel`, `ProgressBar`, `LessonMark`, `StateBadge`. Uitlegtekst krijgt de class `academy-prose`. Alles werkt op een telefoon (lessenlijst klapt in boven de les).

## 7. Lesblokken-framework

Een bloktype bestaat uit vier delen:

| Deel | Bestand | Wat |
| --- | --- | --- |
| Puur | `src/lib/academy/blocks/types.ts`, `blockTypes[type]` | `adminLabel`, `adminDescription`, `media` (`video`, `document` of null), `defaultContent`, `defaultRequired`, `completionFields` (velden van de regel in de editor: `percent` of `select`), `requirement(completion, locale)` (tekst voor de deelnemer), `reserved` |
| UI | `src/components/academy/blocks/registry.tsx`, `blockRegistry[type]` | `icon`, `editor` (props `BlockEditorProps`: `block`, `content`, `onChange`, `disabled`), `viewer` (props `BlockViewerProps`: `block`, `done`, `state`, `locale`, `timeZone`, `courseId`, `moduleId`, `preview`). Types in `src/components/academy/blocks/types.ts` |
| Server | `src/lib/academy/blocks/server.ts` | `contentSanitizers[type]` (content opschonen bij opslaan), `blockStateLoaders[type]` (wat de viewer nodig heeft voor de ingelogde deelnemer, bijvoorbeeld een ondertekende URL of de kijkpositie; komt binnen als `state`) |
| SQL | `public.academy_block_done_<type>(block_id, profile_id)` | Wanneer het blok klaar is |

De editor bewerkt alleen `content` van het blok; de blokkaart (`src/components/academy/admin/block-card.tsx`) slaat titel, verplicht, regel en content samen op met `updateBlock()`. Heeft een type eigen rijen (taken, vragen, versies), dan roept de editor eigen server actions aan. De viewer schrijft zijn data met eigen server actions of RPC's; de triggers berekenen de les opnieuw en de viewer roept daarna `router.refresh()` aan. Voor "gezien" is er `useRecordViewWhenSeen(blockId, enabled)` in `explanation-viewer.tsx`.

Gebouwd: **Uitleg** (rijke tekst met koppen, lijsten, vet, cursief, citaat, links en afbeeldingen via URL of upload; `sanitizeHtml` bij opslaan en bij tonen, zie `src/lib/academy/sanitize.ts`; geplakte tekst wordt opgeschoond; klaar als het einde van de tekst in beeld is geweest) en **Notities** (per les of per module, met optionele vraag erboven, automatisch opslaan na 0,8 seconde en bij verlaten van het veld). **Video**, **Document** en **Werkblad** staan in sectie 13. De andere types hebben een tijdelijke editor en viewer (`placeholder.tsx`): ze kunnen al worden toegevoegd, gesleept, benoemd en verplicht gemaakt, en hun tabellen en afrondfuncties bestaan.

### Een bloktype toevoegen of afbouwen

1. SQL: staat het type nog niet in de check op `academy_lesson_blocks.type`, voeg het toe in een nieuwe migratie. Schrijf of vervang alleen je eigen `academy_block_done_<type>` (`create or replace`), en als je een nieuwe tabel met leerdata maakt: zet er een eigen after-trigger op die `academy_refresh_block(block_id, profile_id)` of `academy_refresh_lesson(lesson_id, profile_id)` aanroept, zodat de les vanzelf opnieuw berekend wordt. Pas `academy_after_learning_change` niet aan: andere bouwers gebruiken die ook (de bestaande tabellen staan er al in). Revoke execute van de functie voor `authenticated`, zoals de bestaande.
2. `AcademyBlockType` in `src/lib/academy/database.ts` en `blockTypes` in `src/lib/academy/blocks/types.ts`.
3. i18n: `block.<type>` en de teksten die `requirement` gebruikt, in beide talen.
4. `blockRegistry[type]` met je editor en viewer; zo nodig `contentSanitizers[type]` en `blockStateLoaders[type]`.
5. SQL test voor je afrondfunctie en RLS, unit test voor pure logica.

## 8. Mensen toevoegen

`/dashboard/academy/people`: per stuk (naam, mail) of in bulk (geplakte lijst `Naam, mail[, startdatum]` per regel, ook `Naam <mail>`, of een CSV met kopregel `name, email, start_date`; hooguit 200 tegelijk, `parseBulkPeople` in `src/lib/academy/people.ts`). Je kiest rol, klant (voor klantrollen) of ATS kandidaat, course, scope, extra open modules, startdatum en taal.

* Nieuw adres: account met `auth.admin.generateLink({ type: 'invite' })` (vereist `SUPABASE_SECRET_KEY`); de mail bevat de link om een wachtwoord in te stellen.
* Bestaand account: wordt ingeschreven, ook zonder secret key; de mail bevat een inloglink naar `/login?next=/academy`. Een Work gast (rol `external`, logt in met een maillink) krijgt een link om een wachtwoord in te stellen, want Academy-rollen loggen in met wachtwoord of passkey.
* Daarna `academy_add_person()` en de rol in `app_metadata`. De mail (`academyInviteMail` in `src/lib/academy/mail.ts`, NL of EN, categorie `academy_invite` in het maillog) gaat via `sendMail`; zonder `RESEND_API_KEY` wordt hij gelogd in plaats van verstuurd.
* Op de persoonspagina: nieuwe inloglink, taal, startdatum, mailsamenvatting, courses met scope en open modules (met "Open now" voor `force`).

## 9. Startcurriculum

`20261112030000_academy_curriculum.sql` zet de structuur klaar (idempotent op `slug` en `seed_key`; rijen die in de editor zijn aangepast blijven staan):

* Klantcourse `client` (NL): Voordat je begint (kern, af voor de start van de developer), De eerste 30 dagen, Communiceren over 4.000 km, Delegeren en beslissingsruimte (1 tot en met 4 zijn kern), Feedback en corrigeren, Van externe naar teamgenoot (opent 30 dagen na de startdatum, als voorbeeld van "module 6 vanaf maand 2"), Plannen, verlof en meten, Als het schuurt, en opschalen, Een team bouwen (vanaf derde plaatsing).
* Developercourse `developer` (EN): Welcome to a Dutch team en Communicating with Dutch colleagues (open voor kandidaten: `in_default_access`), Working independently and escalating, Quality, security and growth.

Beide courses staan als **concept**: niemand buiten Nordavo ziet ze tot een beheerder de course publiceert. De modules staan op gepubliceerd en op volgorde. Een module zonder gepubliceerde lessen houdt de volgende niet tegen. De lessen met hun blokken (eerste versie, concepttekst) staan in sectie 14.

## 10. Nog te bouwen (door anderen)

| Taak | Aanknopingspunten |
| --- | --- |
| Plaatsingspagina, verlof, feestdagen, rituelen, pulse, reviews | Tabellen in `20261112010000_academy_placements.sql`, `academy_my_placements()`, de vakken `RitualsSection` en `UpcomingSection`, de kaart `PlacementSection`. Plaatsingsleden toevoegen (`academy_placement_members`) heeft nog geen scherm. Openstaande coursetaken van de plaatsing: `<PlacementTasksPanel>` of `getPlacementTasks()` (sectie 12) |
| Beheeroverzichten, afhaakanalyse, AI-concept uit transcript | `academy_people_progress()`, `academy_lesson_progress`, `academy_members.last_active_at`. De mensenlijst toont de 300 laatst toegevoegden |
| Kandidatenbeheer en ATS-koppeling | `candidates.top_candidate`, `academy_members.candidate_id`, `academy_groups` (met `vacancy_id`), `academy_add_person()` met scope en open modules. Bij "geplaatst": rol naar developer en scope `all` (opnieuw `academy_add_person` met rol developer); voortgang blijft. Scores voor de kandidaatkaart en de talentpool: `academy_candidate_check_scores()`, `academy_candidate_assignments()`, `academy_candidate_questionnaire_results()`, `academy_candidate_learn_summary()` (sectie 12) |

## 11. Omgevingsvariabelen

| Variabele | Waarvoor | Zonder |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Nieuwe accounts maken bij mensen toevoegen, nieuwe wachtwoordlink | Alleen bestaande accounts toevoegen; inloglink naar `/login` |
| `RESEND_API_KEY`, `MAIL_FROM` | Uitnodigingen | De mail wordt gelogd, niet verstuurd |
| `ACADEMY_TRANSCRIPTION_PROVIDER`, `OPENAI_API_KEY` (+ `OPENAI_TRANSCRIPTION_MODEL`), `DEEPGRAM_API_KEY` (+ `DEEPGRAM_MODEL`) | Automatisch transcript van video's (zie 12) | Transcript typen of uploaden; de editor meldt dat het uit staat |
| `RESEND_API_KEY`, `MAIL_FROM`, `SUPABASE_SECRET_KEY`, `CRON_SECRET` | Mailsamenvatting (job `academy-digest`) | De mail wordt gelogd; niets wordt als verstuurd gemarkeerd |
| `NEXT_PUBLIC_ACADEMY_BOOKING_URL` | Knop "Plan een call met Nordavo" als de plaatsing geen Nordavo contact met boekingslink heeft | Geen knop |
| `ANTHROPIC_API_KEY` | AI-voorstel op de rubric bij opdrachten (sectie 12). Automatisch na inleveren vraagt ook `SUPABASE_SECRET_KEY`; anders met de knop op de beoordelingspagina | Geen voorstel; Nordavo beoordeelt zelf |
| `CRON_SECRET` | De dagelijkse job `academy-task-reminders` (`.github/workflows/academy-task-reminders.yml`) | De job draait alleen met de hand (Jobs of `npm run job`) |

## 12. Opdracht, taken, kennischeck en vragenlijst (gebied learn)

Vier bloktypes: opdracht (`assignment`), taken (`tasks`), kennischeck (`knowledge_check`) en vragenlijst (`questionnaire`, de persoonlijkheidstest). Alles wat iemand inlevert, afvinkt of beantwoordt gaat via security definer functies; RLS laat de deelnemer alleen eigen rijen lezen.

| Onderdeel | Waar |
| --- | --- |
| Migratie | `supabase/migrations/20261113100000_academy_learn_blocks.sql` (vervangt `academy_block_done_tasks`, `academy_block_done_questionnaire` en de policies van de vragenlijst) |
| SQL test | `supabase/tests/academy_learn.test.sql` |
| Types | `src/lib/academy/learn/database.ts` (`LearnFunctions`, samengevoegd in `src/lib/database.types.ts`) |
| Puur (getest in `tests/academy-learn.test.ts`) | `src/lib/academy/learn/assignment.ts` (rubric, formats, bestandsnamen), `tasks.ts` (deadline-status, sorteren, invoer), `check.ts` (vraaginvoer, resultaat), `questionnaire.ts` (definitie, scoren) |
| Server | `src/lib/academy/learn/states.ts` (`blockStateLoaders`), `data.ts` (deelnemer: taken, plaatsingstaken), `admin.ts` (beheer), `ai.ts` (AI-voorstel) |
| Acties | `src/app/academy/learn-actions.ts` (deelnemer), `src/app/dashboard/academy/learn-actions.ts` (taken en vragen in de editor, beoordelen, AI) |
| UI | `src/components/academy/blocks/{assignment,tasks,knowledge-check,questionnaire}.tsx`, `src/components/academy/learn/*` |
| Teksten | `src/lib/academy/i18n/learn.ts` (samengevoegd in `i18n.ts`) |
| Job | `src/jobs/academy-tasks.ts` (`academy-task-reminders`), planning in `.github/workflows/academy-task-reminders.yml` (dagelijks 08:00 Amsterdam) |

### Opdracht

* Content: `prompt` (de opdracht in de eigen situatie, bijvoorbeeld "schrijf je eerste taak uit volgens het 5W sjabloon") en `formats` (`text`, `file`, `link`; standaard alle drie). Regel `completion.require`: `submitted` (standaard) of `approved`.
* Inleveren: `academy_submit_assignment(block, body, file_path, file_name, link_url)`. Bestanden (hooguit 20 MB) gaan naar `attachments` onder `academy/submission/<profile_id>/<block_id>/...`; de functie weigert een pad buiten de eigen map. Zolang Nordavo niet heeft gereageerd past de deelnemer dezelfde poging aan (het AI-voorstel wordt dan opnieuw gemaakt). Na "aanpassing gevraagd" wordt opnieuw inleveren een nieuwe poging; alle pogingen blijven. Goedgekeurd is klaar.
* Beoordelen: `/dashboard/academy/reviews` (wachtrij: wacht op Nordavo, aanpassing gevraagd, goedgekeurd, alles) en `/dashboard/academy/reviews/[id]`: de opdracht, wat is ingeleverd, de geschiedenis, het AI-voorstel en het formulier. `academy_review_submission(submission, status, feedback, final_score, rubric)` alleen voor de laatste poging; bij aanpassing is feedback verplicht. De deelnemer krijgt een melding (`academy_notify`, soort `assignment_approved` of `assignment_changes_requested`, in zijn taal, met link naar de les) en ziet feedback, status en eindscore in de les; nooit het AI-voorstel of de rubric.
* Rubric (vast): helderheid (`clarity`), proactiviteit (`proactivity`), durft nee te zeggen (`says_no`), Engels (`english`), elk 1 tot 5. Het totaal is het aandeel van het maximum (`rubricTotal`, 0 tot 100).
* AI-voorstel: `proposeAssessment()` in `ai.ts` met de Anthropic SDK (`src/lib/ai/claude.ts`), leest tekst en een PDF tot 10 MB, opent links niet. Opgeslagen in `academy_assignment_assessments` (`ai_scores`, `ai_total`, `ai_summary`, `ai_status`); alleen beheer leest dat. Na inleveren draait het vanzelf (met `ANTHROPIC_API_KEY` en `SUPABASE_SECRET_KEY`), anders met de knop "Ask the AI for a proposal". Het is altijd een voorstel: Nordavo kan het overnemen in de rubric en zet zelf de eindscore. Zonder sleutel staat het voorstel uit en beoordeelt Nordavo zelf.

### Taken

* In de editor per taak: titel, uitleg, deadline in dagen na de startdatum (0 is dag 1; snelkeuzes dag 1, dag 3, week 1, 2, 4, dag 30, dag 90), verplicht, alleen bij een plaatsing, gedeeld binnen de plaatsing (gedeeld is altijd ook alleen bij plaatsing). Taken worden per stuk opgeslagen, los van "Save block".
* `academy_task_instances(profiel?, plaatsing?, blok?)` (intern) bepaalt voor wie een taak geldt en de echte deadline:

| Soort | Geldt voor | Deadline |
| --- | --- | --- |
| Eigen taak | Iedereen die de les mag openen | Startdatum van de persoon (anders de eerste plaatsingsstart) plus offset, einde van die dag in de eigen tijdzone (`academy_deadline`, gelijk aan `deadlineFromOffset`) |
| Alleen bij plaatsing | Idem, maar pas als de persoon in een plaatsing zit. Kandidaten zien hem niet | Idem |
| Gedeeld | Per plaatsing (niet beëindigd) waar iemand die afvinkt (klantbeheerder, klant lid, developer) de les mag openen | Start van de plaatsing plus offset, in `overlap_time_zone` |

* Afvinken (en terugzetten): `academy_set_task_done(task, placement?, done)`. Eigen taken door de persoon; gedeelde taken door klantbeheerder, klant lid of developer van de plaatsing, en dan ziet de hele plaatsing het (met wie het deed). Meelezers zien, maar vinken niet af.
* De deelnemer ziet zijn taken in de les (`academy_my_tasks(block)`) en de openstaande op de startpagina (`OpenTasksSection`, hooguit 8, achterstallige eerst), met de datum in zijn eigen tijdzone en "uiterlijk dag 1" / "in week 2" zolang er nog geen startdatum is.
* **Voor de plaatsingspagina** (andere bouwer): `getPlacementTasks(placementId)` in `src/lib/academy/learn/data.ts` geeft de rijen van `academy_placement_tasks(placement)` (gedeelde taken en de placement-only taken van de mensen van wie de kijker voortgang mag zien; leden van de plaatsing en beheer), en `<PlacementTasksPanel placementId user showDone? />` in `src/components/academy/learn/placement-tasks.tsx` is een kant-en-klaar paneel met afvinken (server component, binnen `<Suspense>`). `TaskCheckList` (client) is de lijst zelf.
* Achterstallig: `/dashboard/academy/tasks` (`academy_overdue_tasks()`, alleen beheer) en per persoon op de mensenpagina (`academy_person_tasks()`). De job `academy-task-reminders` roept `academy_remind_overdue_tasks()` aan: een melding (`task_overdue`) aan de persoon of, bij gedeelde taken, aan wie in de plaatsing afvinkt; hooguit drie keer, een week ertussen (`reminded_at`, `reminder_count`). De mailsamenvatting neemt de meldingen mee.

### Kennischeck

* Drie meerkeuzevragen per check (de editor waarschuwt bij een ander aantal): vraag, 2 tot 6 opties, het goede antwoord, uitleg. Per stuk opgeslagen in `academy_check_questions` (alleen beheer leest die, met antwoord).
* `academy_check_questions_for(block)` geeft vragen en opties zonder antwoord aan wie de les mag openen. `academy_submit_check(block, answers)` scoort in de database (alle vragen beantwoord), slaat de poging op en geeft per vraag goed/fout, het goede antwoord en de uitleg terug. `academy_check_results(block)` geeft de laatste eigen poging met uitleg, het aantal pogingen en de beste score. Opnieuw proberen mag; elke poging blijft. De regel `min_percent` telt per poging. Een beheerder in voorbeeld krijgt een score, maar er wordt niets opgeslagen.
* Scores: Nordavo op de mensenpagina (beste, laatste, pogingen); klantbeheerders en meelezers alleen het gemiddelde via `academy_people_progress()`, nooit antwoorden.

### Vragenlijst (persoonlijkheidstest)

**De inhoud van de persoonlijkheidstest volgt nog (Julius specificeert die).** Gebouwd is het generieke mechanisme:

* In de editor: inleiding, toestemmingstekst, labels voor 1 en 5 van de schaal, of de deelnemer zijn uitslag ziet (standaard niet), scoringsdimensies (optioneel) en vragen: schaal 1 tot 5 (eventueel omgekeerd), keuze (per optie een score 1 tot 5 voor de dimensie) of open, elk verplicht of niet. Vaste vraag-id's; pas vragen aan voordat mensen beginnen.
* Toestemming eerst: `academy_questionnaire_consent(block, true)` legt `consented_at` vast; intrekken (`false`) zet `withdrawn_at` en verwijdert de antwoorden. Daarna kan de persoon opnieuw beginnen.
* `academy_save_questionnaire(block, answers, submit)`: bewaren als concept of versturen. De database controleert de antwoorden per soort en rekent per dimensie het gemiddelde uit (`academy_questionnaire_score`, gelijk aan `scoreQuestionnaire` in TS); het resultaat staat in `result` als `{ dimensions: [{ key, label, score, answered }] }`. Verstuurd blijft verstuurd.
* Toegang: antwoorden en toestemming leest alleen de persoon zelf en Nordavo met module `academy` (admins en members met de module); nooit klanten, meelezers of andere deelnemers (getest). De mensenpagina toont toestemming, uitslag en antwoorden. Werkt voor kandidaten en topkandidaten zodra de les in hun open modules staat.
* Let op: de definitie (vragen, dimensies, optiescores) staat in de blokcontent en is dus leesbaar voor wie de les mag openen; de antwoorden en uitslagen niet.

### Voor het ATS

Functies voor Academy beheerders en teamleden met module `recruitment`; per ATS-kandidaat (`academy_members.candidate_id`), `null` is iedereen. Nooit antwoorden.

| Functie | Per rij |
| --- | --- |
| `academy_candidate_check_scores(candidate?)` | Kandidaat, kennischeck (blok, titel, les), pogingen, `best_percent`, `last_percent`, `last_attempt_at` |
| `academy_candidate_assignments(candidate?)` | Kandidaat, opdracht: laatste poging, status, `ai_total` (voorstel), `final_score` (Nordavo), `review_path` (link naar de beoordeling) |
| `academy_candidate_questionnaire_results(candidate?)` | Kandidaat, vragenlijst: `consented_at`, `submitted_at`, `result` (dimensiescores); alleen met geldige toestemming |
| `academy_candidate_learn_summary(candidates[]?)` | Eén rij per kandidaat voor kolommen in de talentpool: `checks_done`, `check_average_percent` (gemiddelde van de beste scores), `assignments_submitted`, `assignments_approved`, `assignment_average_score`, `questionnaire_done` |

## 13. Media, werkbladen, certificaten en meldingen

Migratie `20261113000000_academy_media.sql`, test `supabase/tests/academy_media.test.sql`, unit tests `tests/academy-media.test.ts`. Code in `src/lib/academy/media/*` (puur: `files.ts`, `vtt.ts`, `watch.ts`, `worksheet.ts`, `digest.ts`, `certificate-pdf.ts`, `state.ts`; server: `server.ts`, `learner.ts`, `transcription.ts`, `transcribe-run.ts`), acties in `src/app/dashboard/academy/media-actions.ts` (beheer) en `src/app/academy/media-actions.ts` (deelnemer), teksten in `src/lib/academy/i18n-media.ts` (samengevoegd in `i18n.ts`).

### Videoblok

| Onderdeel | Hoe |
| --- | --- |
| Opslag | Bucket `academy-media` (privé, 5 GB per bestand, mp4, webm, mov, vtt), pad `academy/video/<video_id>/v<versie>-<naam>`, ondertitels `.../v<versie>-subtitles-<nl\|en>.vtt`. Lezen: `academy_can_read_file`; schrijven alleen beheer. De uploadlimiet van het Supabase-project (Storage settings) moet minstens zo hoog staan |
| Uploaden | De server action geeft een ondertekende upload-URL (`createSignedUploadUrl`). Tot 6 MB één PUT, groter resumable (TUS, `/storage/v1/upload/resumable`) in stukken van 6 MB met de sessie van de beheerder, per stuk opnieuw geprobeerd; lukt resumable niet, dan de hele file naar de ondertekende URL. De lengte leest de browser uit het bestand (`duration_seconds`) |
| Vervangen | Nieuwe versie, `current_version_id` schuift. Voortgang staat per video, dus niemand raakt iets kwijt. Ondertitels en transcript horen bij een versie. Oudere versies: weer live zetten of verwijderen |
| Hergebruik | Dezelfde video in meer lessen ("use a video that is already in the Academy"); voortgang telt overal |
| Verwijderen | Video met alle versies, bestanden en ieders kijkvoortgang erop; of alleen uit het blok halen |
| Ondertitels NL en EN | WebVTT of SRT uploaden, bewerken in de editor (wordt opgeschoond naar WebVTT), of maken uit een transcript met tijden. De speler laadt ze via `/academy/files/subtitles/<versie>/<taal>` (zelfde domein, RLS) |
| Transcript | Automatisch na het uploaden als er een sleutel is (`after()`, daarna de job `academy-transcribe` als vangnet), daarna te corrigeren in de editor (status `corrected`; een latere automatische run overschrijft dat niet). Met tijden staat het als cue-blokken (`00:00:01.000 --> 00:00:04.000` en de tekst), zonder tijden als gewone tekst. Ook te typen of te uploaden (.vtt, .srt, .txt). Fout: `transcript_error` op de versie, zichtbaar in de editor |
| Providers | `ACADEMY_TRANSCRIPTION_PROVIDER` = `openai` (`OPENAI_API_KEY`, `whisper-1`, bestand tot 25 MB) of `deepgram` (`DEEPGRAM_API_KEY`, `nova-2`, krijgt een ondertekende link, elke grootte). Leeg: de eerste met een sleutel. Zonder sleutel: melding in de editor, handmatig transcript. Een nieuwe provider is één object in `transcription.ts` |
| Speler | Huisstijl, werkt op een telefoon (`playsInline`). 1x, 1.25x, 1.5x, 2x (onthouden in de browser), verder waar je was (niet als je bijna klaar was), transcript onder de video (aan of uit per blok, klik op een regel springt erheen), melding als de video is vernieuwd. Beheer ziet een voorbeeld, er wordt niets opgeslagen |
| Kijkpercentage | Alleen echt afspelen telt: de speler maakt per `timeupdate` een stukje `[van, tot]` als de tijd niet sneller liep dan de klok bij die snelheid toelaat (`playedStep`), dus spoelen telt niet. Elke 15 seconden, bij pauze, aan het eind en bij weggaan gaan de stukjes naar `academy_record_watch(..., p_ranges)`. De server voegt ze samen met wat al bekeken is van deze versie (`academy_watch_ranges`) en rekent `percent` = gedekte seconden / lengte (100 als er hooguit 1,5 seconde ontbreekt); het percent dat de speler stuurt telt dan niet. Zonder ranges (oude aanroepen) begrenst de som van `watched_seconds` het percent. `percent` gaat nooit omlaag; bij een nieuwe versie beginnen de ranges opnieuw |
| Klaar | `academy_block_done_video`: percent minstens `min_percent` of tot het eind; zonder video of bestand klaar |

### Documenten en werkbladen

* Een document is globaal en herbruikbaar: in lesblokken van beide courses en als werkboek van een module (`academy_modules.workbook_document_id`, op de documentpagina in te stellen; op de coursepagina een downloadlink). Wijzig je het document, dan geldt dat overal. Beheer in `/dashboard/academy/documents` (ook vanuit het blok: nieuw maken of uit de bibliotheek kiezen).
* **Download** (`kind = download`): PDF, Word, Excel (ook PowerPoint, CSV, ODT, ODS, TXT), tot 20 MB, in `attachments/academy/document/<id>/v<versie>-<naam>`. Elke upload is een nieuwe versie (`current_version`), met optioneel "wat is er veranderd" en het label "nieuw" voor twee weken (`new_until`, weg te halen). De deelnemer ziet soort, formaat, grootte, versie, datum en "Nieuw", en downloadt via `/academy/files/document/<id>?block=<blok>`: die route registreert het blok als geopend en stuurt door naar een ondertekende link.
* **Werkblad** (`kind = worksheet`): Nordavo zet de velden in `worksheet_fields`: kort antwoord, lang antwoord, keuze (één optie), vinkje (één, of meer opties), getal (met min en max), datum; met label, hulptekst en verplicht. Sleutels blijven als je een label wijzigt, dus antwoorden blijven staan.
* De deelnemer vult in, het wordt na 0,8 seconde en bij weggaan opgeslagen (`academy_worksheet_answers`, per persoon), en levert in. Inleveren kan pas als de verplichte velden ingevuld zijn; de database controleert dat opnieuw (`academy_worksheet_answers_guard`, de tijd is die van de server) en zet de antwoorden dan op slot. Nordavo kan een werkblad weer openzetten; een afgeronde les blijft afgerond.
* Zien: de persoon zijn eigen antwoorden, Nordavo alles: per werkblad op de documentpagina (tabel en CSV via `/dashboard/academy/documents/<id>/answers`) en per persoon op `/dashboard/academy/people/<id>`. Klanten, klantbeheerders en meelezers nooit (getest).

### Afbeeldingen in de uitleg

Knop "Upload an image" in de uitlegeditor: PNG, JPG, GIF of WebP tot 10 MB naar `attachments/academy/image/<id>/<naam>`. De HTML krijgt `/academy/files/image/<id>/<naam>`; die route stuurt een ingelogde deelnemer of beheerder door naar een ondertekende link (RLS: iedereen met een Academy-rij en beheer). Afbeeldingen via een URL blijven werken.

### Certificaat

* Automatisch: als een module wordt afgerond (`academy_module_completions`) kijkt `academy_issue_certificate(course, profile)` of de course (gepubliceerd, met toegang) helemaal af is. Zo ja: rij in `academy_certificates` op naam (`profiles.full_name`), met nummer, en een melding `certificate`. Eén keer per persoon per course; wie al klaar was bij de migratie krijgt hem meteen.
* De PDF (pdf-lib, A4 liggend, lichtblauw met oranje, het kompas, naam, course, datum, nummer, NL of EN) wordt bij het openen gemaakt uit de rij: `/academy/certificates/<id>` (download, `?view=1` in de browser, `?lang=nl|en`). Lezen volgens RLS: de persoon, Nordavo en wie de voortgang mag zien. `storage_path` blijft leeg.
* De deelnemer ziet de knop op de coursepagina; Nordavo op de persoonspagina.

### Meldingen

* De bel in de kop telt ongelezen meldingen en opent `/academy/notifications`: nieuwste eerst, ongelezen gemarkeerd, gelezen bij openen, per stuk of alles tegelijk.
* **Een melding maken (voor alle bouwers):** in TypeScript altijd via `notifyAcademy()` uit `src/lib/academy/notify.ts`:

  ```ts
  await notifyAcademy({
    profileId,
    kind: "task_overdue",
    title: { nl: "Een taak is te laat", en: "A task is overdue" },
    body: { nl: "...", en: "..." },
    link: `/academy/courses/${courseId}`,
    payload: { task_id: taskId },
  });
  ```

  Tekst als string of `{ nl, en }` (de taal van de ontvanger kiest), `link` een pad in het portaal, ook een lijst in één keer. Schrijft met de service role als `SUPABASE_SECRET_KEY` er is, anders met de meegegeven client (beheer mag via RLS). Gooit nooit een fout. In SQL (security definer functies, triggers): `perform public.academy_notify(profile, kind, title, body, link, payload)`.
* **Mailsamenvatting:** job `academy-digest`, elk uur (`.github/workflows/academy-jobs.yml`, of `npm run job -- academy-digest`, `--dry-run=1` telt alleen). Per persoon met `digest_frequency` `daily` of `weekly`: vanaf 08:00 in de eigen tijdzone (`profiles.time_zone`), dagelijks één keer per lokale dag, wekelijks op maandag. Inhoud: ongelezen meldingen van de laatste 30 dagen die nog niet in een samenvatting zaten (hooguit 25 in de mail), in de eigen taal, met links. Verstuurd via `sendMail` (categorie `academy_digest`); daarna `digested_at` op de meldingen en `digest_sent_at` op de persoon. Zonder `RESEND_API_KEY` wordt de mail gelogd en niets gemarkeerd, zodat hij later alsnog gaat. Geen nieuwe meldingen: geen mail.
* Jobs `academy-*` horen bij module `academy` (`job_module`).

## 14. Startcurriculum (inhoud)

**Concept.** De bronnen (nordavo_academy.xlsx, de HTML courses, "Nordavo course structuur klant.docx" en de policies in Drive) waren niet beschikbaar bij het bouwen. De teksten, vragen, taken en werkbladen zijn daarom een eerste versie, geschreven vanuit wat we van Nordavo weten (de driehoek, 30 dagen garantie, maandelijkse opzegging, overlapvenster, rituelen, pulse, review na 90 dagen, escalatie via Nordavo). Julius en Floris lopen alles na voordat de courses live gaan. Waar een feit of getal van Nordavo nodig is, staat `[Nordavo vult in: ...]` (klantcourse) of `[Nordavo to fill in: ...]` (developercourse); er zijn geen verlofdagen, bedragen of termijnen verzonnen.

| Onderdeel | Waar |
| --- | --- |
| Migratie | `supabase/migrations/20261114000000_academy_start_content.sql`: de functie `academy_seed_start_curriculum()` met de inhoud als json, en één aanroep |
| SQL test | `supabase/tests/academy_curriculum.test.sql` (aantallen, drie vragen per check, lege video blokkeert niet, opnieuw draaien voegt niets toe en overschrijft niets) |
| Unit test | `tests/academy-curriculum.test.ts` (de inhoud is precies wat de editor zou opslaan: HTML door `sanitizeHtml`, werkbladvelden door `normalizeFields`, opdracht, notities en video in hun opgeslagen vorm) |
| Editor | Videoblok zonder video toont "Waiting for a recording" met de opnamebrief (`content.recording_note`, `videoRecordingNote` en `videoBlockContent` in `src/lib/academy/media/state.ts`) |

### Hoe het zaadje werkt

* Elke rij heeft een vaste id: `md5('nordavo-academy-start:' || sleutel)::uuid`. Sleutels: les `client-4.1`, blok `client-4.1:block:3`, taak `...:task:1`, vraag `...:question:2`, document `document:ws-client-5w`.
* Een les die al bestaat wordt overgeslagen, met alles erin. Wat een beheerder in de editor aanpast (tekst, blokken, taken, vragen, volgorde, status, een les uit een module halen) blijft dus staan. Is de module weg (geen `seed_key`), dan wordt de les overgeslagen.
* `select public.academy_seed_start_curriculum();` (alleen database-eigenaar of service role) voegt alleen ontbrekende lessen toe en geeft het aantal terug. Een verwijderde les komt zo terug, in de oorspronkelijke versie. Werkbladen en policy-documenten worden gedeeld en één keer aangemaakt.
* Courses blijven concept; de instellingen van de modules (kern, module 1 voor de start, developer modules 1 en 2 open voor kandidaten, module 6 na 30 dagen, op volgorde) zijn niet aangeraakt. De lessen staan op gepubliceerd, zodat publiceren van de course één stap is.

### Opbouw van een les en afrondregels

Elke les: **video** (plaats voor de opname), **uitleg** (300 tot 700 woorden, koppen en lijsten), en waar het past **kennischeck** (precies drie vragen met uitleg), **document**, **werkblad**, **opdracht**, **taken** en **notities**.

| Blok | Verplicht | Regel | Opmerking |
| --- | --- | --- | --- |
| Video | Ja | minstens 90% | Zonder video of bestand telt het blok als klaar (`academy_block_done_video`), dus het houdt geen les tegen. Zodra Julius of Floris de opname uploadt, geldt 90% voor wie de les nog niet af had; een afgeronde les blijft afgerond. De deelnemer ziet "De video volgt binnenkort", de editor "Waiting for a recording" met wat er opgenomen moet worden |
| Uitleg | Ja | gezien | |
| Kennischeck | Ja | een poging (min 0%) | Zet `min_percent` hoger als een score verplicht moet zijn |
| Document (policies) | Ja | geopend | Zonder bestand klaar; na upload moet de developer het openen |
| Werkblad | Ja | ingeleverd | |
| Opdracht | Ja | ingeleverd | Op "approved" zetten als Nordavo eerst moet goedkeuren |
| Taken | Ja | verplichte taken af | Deadlines relatief aan de startdatum (0 is dag 1). Taken "alleen bij plaatsing" en gedeelde taken tellen pas met een plaatsing. Zet de startdatum van klantmensen gelijk aan de startdatum van hun developer, anders kloppen de deadlines niet |
| Notities | Nee | | Met een vraag erboven |

### Klantcourse (NL)

| Module | Les | Na video en uitleg |
| --- | --- | --- |
| 1. Voordat je begint | 1.1 Hoe de samenwerking werkt: de driehoek | kennischeck, notities |
| 1. Voordat je begint | 1.2 Tijdzones en het overlapvenster | kennischeck, 3 taken (1 alleen bij plaatsing, 1 gedeeld) |
| 1. Voordat je begint | 1.3 De eerste week voorbereiden | kennischeck, 4 taken (3 alleen bij plaatsing, 1 gedeeld) |
| 2. De eerste 30 dagen | 2.1 Dag 1 en week 1 | kennischeck, 3 taken (1 alleen bij plaatsing, 2 gedeeld) |
| 2. De eerste 30 dagen | 2.2 Het ritme: weekplan, check-in en vrijdagreview | kennischeck, 2 taken (1 alleen bij plaatsing, 1 gedeeld), notities |
| 2. De eerste 30 dagen | 2.3 De 30-dagengarantie en je eerste evaluatie | kennischeck, werkblad "30-dagenevaluatie", 2 taken (1 alleen bij plaatsing, 1 gedeeld) |
| 3. Communiceren over 4.000 km | 3.1 Schrijven dat in één keer landt | kennischeck, notities |
| 3. Communiceren over 4.000 km | 3.2 Calls, camera en stiltes | kennischeck, notities |
| 3. Communiceren over 4.000 km | 3.3 Kanalen en reactietijden afspreken | kennischeck, werkblad "Communicatieafspraken", 1 taak (1 gedeeld) |
| 4. Delegeren en beslissingsruimte | 4.1 Een taak uitschrijven met het 5W-sjabloon | kennischeck, werkblad "5W-sjabloon: een taak uitschrijven", opdracht "Schrijf je eerste taak uit volgens het 5W-sjabloon" |
| 4. Delegeren en beslissingsruimte | 4.2 Beslissingsruimte: wat mag je developer zelf beslissen | kennischeck, werkblad "Beslissingsmatrix" |
| 4. Delegeren en beslissingsruimte | 4.3 Blokkades: afspreken wanneer je developer aan de bel trekt | kennischeck, werkblad "Blokkadeafspraak", 1 taak (1 gedeeld) |
| 5. Feedback en corrigeren | 5.1 Feedback geven die aankomt | kennischeck, notities |
| 5. Feedback en corrigeren | 5.2 Corrigeren zonder gezichtsverlies | kennischeck |
| 5. Feedback en corrigeren | 5.3 Feedback vragen en de pulse | kennischeck, 1 taak (1 alleen bij plaatsing) |
| 6. Van externe naar teamgenoot | 6.1 Onderdeel van het team, niet van de leverancier | kennischeck, 2 taken (2 alleen bij plaatsing) |
| 6. Van externe naar teamgenoot | 6.2 Eigenaarschap geven | kennischeck, notities |
| 6. Van externe naar teamgenoot | 6.3 Cultuur, feestdagen en een gezamenlijke agenda | kennischeck, 1 taak (1 alleen bij plaatsing) |
| 7. Plannen, verlof en meten | 7.1 Plannen met een tijdsverschil | kennischeck |
| 7. Plannen, verlof en meten | 7.2 Verlof en afwezigheid | kennischeck |
| 7. Plannen, verlof en meten | 7.3 Meten zonder te micromanagen, en de review na 90 dagen | kennischeck, werkblad "Review na 90 dagen: voorbereiding", 1 taak (1 alleen bij plaatsing) |
| 8. Als het schuurt, en opschalen | 8.1 Signalen herkennen | kennischeck |
| 8. Als het schuurt, en opschalen | 8.2 Het lastige gesprek voeren | kennischeck, notities |
| 8. Als het schuurt, en opschalen | 8.3 Opschalen via Nordavo: de escalatiematrix | kennischeck, werkblad "Escalatiematrix" |
| 9. Een team bouwen (vanaf derde plaatsing) | 9.1 Van een paar developers naar een team | kennischeck |
| 9. Een team bouwen (vanaf derde plaatsing) | 9.2 Structuur: documentatie, overdracht en groei | kennischeck, notities |

### Developercourse (EN)

| Module | Les | Na video en uitleg |
| --- | --- | --- |
| 1. Welcome to a Dutch team | 1.1 How Nordavo works: you, your client and Nordavo | kennischeck, notities |
| 1. Welcome to a Dutch team | 1.2 What Dutch work culture looks like | kennischeck |
| 1. Welcome to a Dutch team | 1.3 Time zones and the overlap window | kennischeck, 2 taken (1 alleen bij plaatsing) |
| 2. Communicating with Dutch colleagues | 2.1 Directness: hearing it and using it | kennischeck, notities |
| 2. Communicating with Dutch colleagues | 2.2 Asking questions and saying no | kennischeck |
| 2. Communicating with Dutch colleagues | 2.3 Writing clear updates: the daily check-in | kennischeck, notities |
| 3. Working independently and escalating | 3.1 Nordavo policies: leave, working from home, conduct and compensation | kennischeck, document "Leave Policy", document "Work From Home Policy", document "Code of Conduct", document "Compensation Policy" |
| 3. Working independently and escalating | 3.2 Your week: weekly plan, check-in and Friday review | kennischeck, opdracht "Write your weekly plan", 2 taken (2 alleen bij plaatsing) |
| 3. Working independently and escalating | 3.3 When you are stuck: blockers and decisions | kennischeck |
| 3. Working independently and escalating | 3.4 Escalating: when and how | kennischeck, werkblad "Escalation matrix", opdracht "Write an escalation message" |
| 4. Quality, security and growth | 4.1 Quality you can show | kennischeck |
| 4. Quality, security and growth | 4.2 Security and client data | kennischeck, 2 taken (1 alleen bij plaatsing) |
| 4. Quality, security and growth | 4.3 Growing in your role: feedback and the 90-day review | kennischeck, werkblad "90-day review: preparation", 1 taak (1 alleen bij plaatsing), notities |

De policy-les (developer 3.1) staat bewust in module 3: kandidaten zien alleen module 1 en 2, en de policies (met name Compensation) zijn voor geplaatste developers. Wil je hem eerder, sleep hem dan naar module 1 of zet de policies per plaatsing op de plaatsingspagina.

Werkbladen: 5W-sjabloon, Beslissingsmatrix, Communicatieafspraken, Blokkadeafspraak, 30-dagenevaluatie, Review na 90 dagen (klant), Escalatiematrix (klant en developer, eigen versie), 90-day review preparation (developer). Policy-documenten zonder bestand: Leave Policy, Work From Home Policy, Code of Conduct, Compensation Policy (soort download, categorie policy).

### Nog te doen voor Julius en Floris

1. **Teksten nalopen.** Elke uitleg, kennischeck (vraag, opties, goede antwoord, uitleg), taak en werkblad. Klopt de toon, klopt wat er over Nordavo staat, mist er iets uit de oorspronkelijke HTML courses of de docx?
2. **Placeholders invullen** (zoek in `/dashboard/academy` of met de query hieronder):
   * Klant 1.1: voorwaarden van de garantie, opzegtermijn en hoe je opzegt, reactietijd van Nordavo.
   * Klant 2.3: exacte voorwaarden van de 30-dagengarantie en vanaf wanneer de 30 dagen tellen.
   * Klant 6.1: of en hoe Nordavo een bezoek ondersteunt.
   * Klant 7.2: verlofdagen en aanvraagtermijn, ziekmelding en facturatie, afspraak over Nederlandse en Indiase feestdagen.
   * Klant 8.3: reactietijden per niveau, telefoonnummer voor urgente zaken, opzegtermijn en vervanging.
   * Klant 9.1: hoe Nordavo een lead-rol inricht.
   * Developer 1.1: hoe en hoe snel Nordavo bereikbaar is.
   * Developer 3.1: een regel samenvatting per policy (na upload).
   * Developer 4.2: regels voor apparaten en werkplek (of verwijzing naar de Work From Home Policy).
   * Developer 4.3: hoe Nordavo groei ondersteunt (training, budget), als dat er is.
3. **Policies uploaden** in `/dashboard/academy/documents` (Leave, Work From Home, Code of Conduct, Compensation): het document bestaat al, upload het bestand als versie 1.
4. **Video's opnemen** (39, één per les). In de editor staat bij elk videoblok wat erin moet; upload de opname in hetzelfde blok. Transcript en ondertitels volgen vanzelf als de transcriptiesleutel er is (sectie 13).
5. **Instellingen kiezen**: minimumscore op kennischecks, opdrachten op "approved", eventueel een werkboek per module.
6. **Publiceren**: `/dashboard/academy`, course openen, Publish. Eerst de klantcourse of de developercourse, of allebei.

Overgebleven placeholders vinden:

```sql
select l.title, b.type
from academy_lesson_blocks b join academy_lessons l on l.id = b.lesson_id
where b.content::text ~ '\[Nordavo (vult in|to fill in):';
```

