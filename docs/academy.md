# Nordavo Academy

De Academy is de leeromgeving van Nordavo in het portaal: een klantcourse in het Nederlands voor klanten, een developercourse in het Engels voor developers en kandidaten. Nordavo beheert alles zelf in `/dashboard/academy`; deelnemers leren in `/academy`. Zelfde login als de rest van het portaal.

Dit document is het contract voor iedereen die de Academy uitbreidt. Het beschrijft het datamodel, de rollen, de routes, het lesblokken-framework met de afrondregels en wat nog gebouwd moet worden. Houd het bij als je iets toevoegt.

| Onderdeel | Waar |
| --- | --- |
| Migraties | `supabase/migrations/20261112000000_academy_foundation.sql` (rollen, mensen, content, toegang), `20261112010000_academy_placements.sql` (plaatsing, ritme, verlof, meldingen), `20261112020000_academy_learning.sql` (leerdata, afrond-engine, RPC's), `20261112030000_academy_curriculum.sql` (startcurriculum), `20261112040000_academy_editor.sql` (editorhulpen) |
| SQL tests | `supabase/tests/academy_rls.test.sql` (rollen en zichtbaarheid), `supabase/tests/academy_engine.test.sql` (afrondregels, ontgrendelen, dupliceren) |
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

Bloktypes (check op `academy_lesson_blocks.type`): `explanation`, `video`, `document`, `worksheet`, `assignment`, `tasks`, `knowledge_check`, `notes`, `questionnaire`. Het type `questionnaire` is gereserveerd voor de persoonlijkheidstest.

Deelnemers lezen gepubliceerde courses waar ze toegang toe hebben, de titels van alle gepubliceerde modules en lessen daarin (ook op slot, die tonen met een slotje), en de blokken alleen als de les open is. Concepten zien alleen beheerders.

### Leerdata

| Tabel | Wat | Wie |
| --- | --- | --- |
| `academy_block_progress` | Per blok per persoon: `viewed_at`, `state` (vrij jsonb) | Eigen lezen; schrijven via `academy_record_block_view()` |
| `academy_notes` | Eigen notitie per les (`lesson_id`) of module (`module_id`) | Eigen beheren; beheer leest; nooit klanten of meelezers |
| `academy_watch_progress` | Per video (niet per versie): `version_id`, `position_seconds`, `percent` (gaat nooit omlaag), `watched_seconds`, `completed_at` | Schrijven via `academy_record_watch()`; lezen eigen en wie voortgang mag zien |
| `academy_worksheet_answers` | Per document per persoon: `answers`, `submitted_at` | Eigen beheren; beheer leest |
| `academy_assignment_submissions` | Per blok per persoon per poging: `body`, `file_path`, `link_url`, `status` (submitted, changes_requested, approved), `feedback`, `final_score` | Eigen inleveren en aanpassen zolang niet goedgekeurd; status, feedback en score alleen beheer (trigger `academy_submissions_guard`) |
| `academy_assignment_assessments` | AI voorstel op de rubric (`ai_scores`, `ai_total`, `ai_summary`, `ai_status`) en `rubric_scores` van Nordavo | Alleen beheer |
| `academy_tasks` | Taken van een takenblok: `deadline_offset_days`, `shared`, `placement_only`, `required` | Lezen als de les open is (placement-only pas met een plaatsing) of als gedeelde taak van de eigen plaatsing |
| `academy_task_status` | Status per persoon (`profile_id`) of per plaatsing voor gedeelde taken (`profile_id` null, `placement_id`): `due_at`, `done_at`, `done_by`, `reminded_at` | Eigen taken afvinken; gedeelde taken door klantbeheerder, klant lid of developer van de plaatsing; lezen voor de hele plaatsing |
| `academy_check_questions` | Vragen met `options` en `correct_index`, `explanation` | Alleen beheer (de deelnemer krijgt vragen zonder antwoord via een functie, nog te bouwen) |
| `academy_check_attempts` | Pogingen: `answers`, `score`, `max_score` | Eigen lezen; schrijven via een functie (nog te bouwen) |
| `academy_questionnaire_consents`, `academy_questionnaire_responses` | Persoonlijkheidstest: eigen toestemming, antwoorden alleen met geldige toestemming | De persoon zelf en admins (niet alle beheerders) |
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

Bucket `attachments`, paden onder `academy/`:

| Pad | Wie leest |
| --- | --- |
| `academy/video/<video_id>/...` | `academy_can_see_video` |
| `academy/document/<document_id>/...` | `academy_can_see_document` |
| `academy/submission/<profile_id>/...` | De persoon (mag ook uploaden) en beheer |
| `academy/certificate/<profile_id>/...` | Wie voortgang van die persoon mag zien |

Beheer beheert alles onder `academy/` (`can_access_entity('academy')` is nu module `academy`).

## 3. Afrondregels en ontgrendelen

### Wanneer is een les af

Per blok zet beheer `required` aan of uit, en voor sommige types een regel in `completion`:

| Type | Regel (`completion`) | Klaar als (`academy_block_done_<type>`) |
| --- | --- | --- |
| explanation | | Gezien (`academy_record_block_view`) |
| document | | Geopend of gedownload (`academy_record_block_view`) |
| notes | | Een notitie die niet leeg is, op de les of (content `scope: module`) op de module |
| video | `min_percent` (standaard 90) | `academy_watch_progress.percent` minstens zoveel |
| worksheet | | Antwoorden ingeleverd (`submitted_at`) voor het document van het blok |
| assignment | `require`: `submitted` (standaard) of `approved` | Laatste poging ingeleverd of goedgekeurd |
| tasks | | Alle verplichte taken die voor de persoon gelden zijn af (placement-only telt pas met een plaatsing, gedeelde taken via de plaatsing) |
| knowledge_check | `min_percent` (standaard 0) | Een poging met minstens die score |
| questionnaire | | Ingeleverd |

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
| `academy_record_watch(video, version, position, percent, watched_seconds)` | Deelnemer | Kijkvoortgang; percent alleen omhoog |
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
| `/academy/security` | | Tweestapsverificatie en passkeys |
| `/dashboard/academy` | Beheer | Courses, nieuwe course |
| `/dashboard/academy/courses/[id]` | Beheer | Course: publiceren, instellingen, modules slepen, per module de vrijgaveregel, lessen slepen, nieuwe of hergebruikte les, dupliceren, toegang per persoon of groep |
| `/dashboard/academy/lessons/[id]` | Beheer | Les: instellingen, publiceren, dupliceren, blokken toevoegen en slepen, per blok verplicht en de regel, waar de les gebruikt wordt |
| `/dashboard/academy/people` | Beheer | Mensen filteren, toevoegen per stuk of in bulk (lijst of CSV) |
| `/dashboard/academy/people/[id]` | Beheer | Taal, startdatum, mailsamenvatting, nieuwe inloglink, courses met scope en open modules per persoon, groepen |
| `/dashboard/academy/groups` | Beheer | Kandidatengroepen |
| `/dashboard/academy/library` | Beheer | Alle lessen en documenten en waar ze gebruikt worden |

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

Gebouwd: **Uitleg** (rijke tekst met koppen, lijsten, vet, cursief, citaat, links en afbeeldingen via URL; `sanitizeHtml` bij opslaan en bij tonen, zie `src/lib/academy/sanitize.ts`; geplakte tekst wordt opgeschoond; klaar als het einde van de tekst in beeld is geweest) en **Notities** (per les of per module, met optionele vraag erboven, automatisch opslaan na 0,8 seconde en bij verlaten van het veld). De andere types hebben een tijdelijke editor en viewer (`placeholder.tsx`): ze kunnen al worden toegevoegd, gesleept, benoemd en verplicht gemaakt, en hun tabellen en afrondfuncties bestaan.

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

Beide courses staan als **concept**: niemand buiten Nordavo ziet ze tot een beheerder de course publiceert. De modules staan op gepubliceerd en op volgorde. Lessen, video's en documenten komen later; een module zonder gepubliceerde lessen houdt de volgende niet tegen.

## 10. Nog te bouwen (door anderen)

| Taak | Aanknopingspunten |
| --- | --- |
| Videoblok | `academy_videos`, `academy_video_versions`, `academy_watch_progress`, `academy_record_watch()`, `academy_block_done_video` (min_percent), opslag `academy/video/<id>/`, registry `video`, `blockStateLoaders.video` (ondertekende URL, positie). Transcript en ondertitels: kolommen op de versie |
| Documenten en werkbladen | `academy_documents` (+ versies, `new_until`), `academy_worksheet_answers`, `academy_record_block_view()` voor downloads, registry `document` en `worksheet`, module-werkboek via `academy_modules.workbook_document_id` (staat al als label op de coursepagina) |
| Opdrachtblok | `academy_assignment_submissions`, `academy_assignment_assessments` (AI voorstel, alleen beheer), opslag `academy/submission/<profile_id>/`, `completion.require` |
| Takenblok | `academy_tasks`, `academy_task_status`, `deadlineFromOffset`, `relativeDeadlineLabel`, het vak `OpenTasksSection` in `src/components/academy/home/sections.tsx` |
| Kennischeck | `academy_check_questions` (alleen beheer), `academy_check_attempts`; nog nodig: een security definer functie die vragen zonder antwoord geeft en een poging scoort |
| Persoonlijkheidstest | Bloktype `questionnaire`, `academy_questionnaire_consents`, `academy_questionnaire_responses` (persoon en admins) |
| Plaatsingspagina, verlof, feestdagen, rituelen, pulse, reviews | Tabellen in `20261112010000_academy_placements.sql`, `academy_my_placements()`, de vakken `RitualsSection` en `UpcomingSection`, de kaart `PlacementSection`. Plaatsingsleden toevoegen (`academy_placement_members`) heeft nog geen scherm |
| Certificaat, meldingen, mailsamenvatting | `academy_certificates`, `academy_course_done()`, pdf-lib (zoals profile-pdf), `academy_notifications`, `academy_notify()`, `academy_members.digest_frequency` en `digest_sent_at`. De bel in de kop telt ongelezen meldingen; een meldingenpagina bestaat nog niet |
| Beheeroverzichten, afhaakanalyse, AI-concept uit transcript | `academy_people_progress()`, `academy_lesson_progress`, `academy_members.last_active_at`. De mensenlijst toont de 300 laatst toegevoegden |
| Kandidatenbeheer en ATS-koppeling | `candidates.top_candidate`, `academy_members.candidate_id`, `academy_groups` (met `vacancy_id`), `academy_add_person()` met scope en open modules. Bij "geplaatst": rol naar developer en scope `all` (opnieuw `academy_add_person` met rol developer); voortgang blijft |

## 11. Omgevingsvariabelen

| Variabele | Waarvoor | Zonder |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Nieuwe accounts maken bij mensen toevoegen, nieuwe wachtwoordlink | Alleen bestaande accounts toevoegen; inloglink naar `/login` |
| `RESEND_API_KEY`, `MAIL_FROM` | Uitnodigingen | De mail wordt gelogd, niet verstuurd |
| `NEXT_PUBLIC_ACADEMY_BOOKING_URL` | Knop "Plan een call met Nordavo" als de plaatsing geen Nordavo contact met boekingslink heeft | Geen knop |
