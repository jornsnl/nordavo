# Nordavo Working Style Profile

Een korte Big Five vragenlijst voor kandidaten en geplaatste developers: 50 stellingen en 2 controlevragen, ongeveer 10 minuten. Het portaal rekent per dimensie een score van 0 tot 100 uit en maakt er een rapport van. De persoon leert zichzelf beter kennen, de opdrachtgever begrijpt hoe deze persoon het beste werkt.

**Het is geen selectietool.** Geen voldoende of onvoldoende, geen ranking, geen automatische beslissingen. Scoring, teksten, weergave en PDF zijn volledig regelgebaseerd: nergens AI (anders valt het onder de EU AI Act als hoog risico systeem).

Gebouwd naar de opdracht van Julius (vier delen in Athmium, 9 november 2026). Alle stellingen en teksten staan letterlijk in `src/lib/wsp/content.ts`; de stellingen ook in de migratie, een test vergelijkt beide. Een wijziging in tekst of scoring is een nieuwe instrumentversie, nooit een aanpassing van `nordavo-wsp-v1`.

| Onderdeel | Waar |
| --- | --- |
| Migraties | `supabase/migrations/20261116000000_wsp_core.sql` (tabellen, de 52 stellingen, instellingen, RLS, scoring en vlaggen), `20261116010000_wsp_flow.sql` (uitnodigen, vragenlijst, rapport, delen, verwijderen, bewaren, dagelijkse job) |
| SQL test | `supabase/tests/wsp.test.sql` |
| Unit tests | `tests/wsp.test.ts` |
| Puur (getest) | `src/lib/wsp/content.ts` (alle vaste teksten), `scoring.ts` (scoring en vlaggen), `text.ts` (namen, intro per rol, toestemmingstekst, watermerk, bestandsnaam), `view.ts`, `report.ts`, `mail.ts`, `pdf.ts` |
| Server | `src/lib/wsp/data.ts` (lezen), `outbox.ts` (mail versturen), `after.ts`, `pdf-response.ts` |
| Acties | `src/app/working-style/actions.ts` (de persoon), `src/app/dashboard/candidates/[id]/working-style/actions.ts` (staff en instellingen) |
| UI | `src/components/wsp/*` |
| Types | `src/lib/wsp/database.ts` (samengevoegd in `src/lib/database.types.ts`) |
| Jobs | `src/jobs/wsp.ts`: `wsp-daily` (dagelijks 07:00) en `wsp-mail` (elk uur), planning in `.github/workflows/wsp-jobs.yml` |

## Routes

| Route | Wie | Wat |
| --- | --- | --- |
| `/working-style/<token>` | Iedereen met de persoonlijke link, zonder inloggen | Intro, vragenlijst, bedankscherm, het eigen rapport, PDF, "Delete my profile". Delen kan hier niet (alleen vanuit het eigen account) |
| `/working-style/<token>/pdf` | Idem | Het eigen rapport als PDF |
| `/academy/working-style` | Developers en kandidaten met een Academy-account | "My working style profile": alle afnames met datum, per gekoppelde opdrachtgever een vinkje, de status en de datum van toestemming |
| `/academy/working-style/<id>`, `.../pdf` | De persoon zelf | Vragenlijst of rapport met de toestemmingen eronder, PDF |
| `/dashboard/candidates/<id>` | Staff (recruitment) | Kaart Working style profile: persoonsinstelling, talentpool toestemming, "Send working style profile", afnames met status (geen scores) |
| `/dashboard/candidates/<id>/working-style/<assessment>`, `.../pdf` | Staff | Rapport met de intro voor de opdrachtgever, "Interpret with caution" met de reden en "Send the test again", ruwe antwoorden, tijd per pagina, status per opdrachtgever met "Ask for permission", koppelen, opnieuw versturen, verwijderen, auditlog, PDF |
| `/dashboard/academy/people/<id>`, `/dashboard/placements/<id>` | Staff | Dezelfde kaart voor developers (via de ATS-kandidaat) |
| `/dashboard/vacancies/<id>` | Staff | Vacature-instelling aan of uit |
| `/dashboard/settings/working-style` | Admin | Systeeminstellingen (tab Working style) |
| `/portal/working-style`, `/portal/working-style/<id>`, `.../pdf` | Klantgebruikers met het klantportaal | Alleen profielen met een actieve toestemming voor de eigen klant. Het overzicht staat ook op `/portal` zodra er iets gedeeld is |
| `/apply/<token>` | Iedereen | Het sollicitatieform: staat het profiel aan voor de vacature, dan staat de vaste zin onder de vacaturetekst |

De persoonlijke link staat in de proxy bij de publieke paden (`src/lib/supabase/proxy.ts`); de database controleert de token. Developers en kandidaten mogen alleen `/academy`, dus hun eigen pagina staat onder `/academy/working-style`. In de kop van de Academy staat een icoon naar die pagina voor wie aan een ATS-kandidaat gekoppeld is, zolang de functie aan staat.

## Rollen en rechten

| Rol | Hoe herkend | Mag |
| --- | --- | --- |
| Admin | `profiles.role = 'admin'` | Systeeminstellingen (`wsp_update_settings`), en alles van staff |
| Staff | `wsp_is_staff()`: module `recruitment` of `academy` (admins hebben beide) | Vacature- en persoonsinstellingen, handmatig uitnodigen, opnieuw versturen, koppelen, alles inzien (ook ruwe antwoorden en vlaggen), toestemming vragen, verwijderen, PDF. **Nooit** toestemming geven of intrekken |
| De persoon | Persoonlijke link (`invite_token`) of het eigen account (`academy_members.candidate_id` = `person_id`, `wsp_my_person_id()`) | Intro en vragenlijst, eigen rapport en PDF, eigen profiel verwijderen. Toestemming geven en intrekken alleen vanuit het eigen account |
| Opdrachtgever | Klantgebruiker met het klantportaal (`current_client_id()`) | Alleen rapporten met een actieve share voor de eigen klant bekijken en als PDF downloaden. Nooit ruwe antwoorden, vlaggen of de rij `wsp_assessments` (daar staat de token in) |

Klant leden en meelezers uit de Academy (`client_member`, `client_reader`) hebben geen `current_client_id()` en zien dus niets. Alles staat in RLS en in security definer functies; de pagina's controleren daarnaast zelf.

## Instellingen

Het meest specifieke niveau wint: de persoon gaat voor de vacature, de vacature gaat voor het systeem.

| Niveau | Waar | Wat | Standaard |
| --- | --- | --- | --- |
| Systeem | `wsp_settings` (één rij), Settings, Working style (admin) | Aan of uit (uit: overal verborgen, niets verstuurd); trigger fase; standaard voor nieuwe vacatures; developers automatisch uitnodigen bij start van een plaatsing; alle termijnen | **Uit**; Shortlist; aan; uit |
| Vacature | `vacancies.wsp_enabled`, vacaturepagina | Aan of uit. Aan: de vaste zin komt onder de vacaturetekst van het sollicitatieform | De systeeminstelling "standaard voor nieuwe vacatures" (kolomdefault `wsp_default_for_new_vacancies()`). Bestaande vacatures bij de migratie: uit |
| Persoon | `candidates.wsp_mode`, kandidaatpagina (ook voor developers) | Follow vacancy, Always, Never. Never blokkeert alles, ook handmatig | Follow vacancy |

Termijnen in `wsp_settings` (part 4: "alle termijnen instelbaar"): link geldig 14 dagen, herinnering na 3 dagen, hergebruik 12 maanden, toestemming vragen hooguit eens per 7 dagen per opdrachtgever, bewaren 28 dagen (kandidaten), 365 dagen (talentpool toestemming) en 28 dagen (developers). Elke wijziging van systeem-, vacature- of persoonsinstelling staat in `wsp_audit_log` (`settings_changed`, met oude en nieuwe waarde).

**Trigger fase.** De fases in de pipeline zijn tekstcodes op `applications.stage` (Sourced tot Placed); "Shortlist" is geen fase maar het shortlist-vinkje op het bord (`applications.shortlisted_at`). De standaard trigger `shortlist` betekent: het moment dat een kandidaat op de shortlist komt. Kies je een fase, dan telt het binnenkomen in die fase.

**Talentpool toestemming.** Die bestond nog niet in het portaal. Nieuw op de kandidaat: `candidates.talent_pool_consent_at`, door staff aan te zetten op de kaart ("Agreed to stay in the talent pool").

## Uitnodigen

| Hoe | Wanneer | Regels |
| --- | --- | --- |
| Automatisch, kandidaten | Een sollicitatie komt in de trigger fase (trigger `wsp_on_application` op `applications`) | Systeem aan; het profiel aan voor deze persoon na de drie niveaus; niet Never; geen actieve afname; geen afgeronde afname jonger dan 12 maanden die nog bewaard is. Bestaat die wel, dan wordt hij aan de nieuwe vacature gekoppeld (`linked`) zonder nieuwe uitnodiging. Was de persoon al eens voor deze vacature uitgenodigd of gekoppeld, dan komt er geen tweede uitnodiging (terug naar een eerdere fase en weer naar de trigger fase) |
| Automatisch, developers | Een plaatsing wordt vastgelegd (trigger `wsp_on_placement` op `placements`, naast de Academy-automatisering) | Heeft de developer al een rapport: koppelen aan de opdrachtgever en automatisch toestemming vragen (doet hij niets, dan wordt niets gedeeld). Anders alleen een uitnodiging als "developers automatisch uitnodigen" aan staat |
| Handmatig | "Send working style profile" op de kandidaat-, Academy- of plaatsingspagina, optioneel met vacature en opdrachtgever | Systeem aan en persoon niet op Never, ook als de vacature uit staat. Een nieuwe afname binnen 12 maanden kan alleen zo; oude resultaten blijven met datum zichtbaar. Er is hooguit één actieve afname per persoon |

Elke uitnodiging maakt een rij in `wsp_assessments` met een unieke link van 64 tekens, 14 dagen geldig, en een regel in het auditlog (`invited`, met wie: `system` of de staff user, en waarom: trigger fase en vacature, plaatsing of handmatig). De mail gaat via de bestaande mailflow (`sendMail`, Resend, Nordavo-layout, maillog): de database zet hem in `wsp_outbox`, de app verstuurt hem direct na de actie (`after()`) en anders binnen het uur (`wsp-mail`). Wie een Academy-account heeft krijgt ook een melding in de Academy.

Na 3 dagen niet gestart: één herinnering (`wsp-daily`, `reminded`). Verloopt de link, dan zet staff hem met "Send again" opnieuw uit: nieuwe link, weer 14 dagen, de antwoorden die er al waren blijven (`resent`).

## De vragenlijst

* Introscherm met de exacte tekst, voor developers met de zin "This is optional. Not completing it has no consequences for your role." bovenaan. Verplicht vinkje "I have read this and want to start.", knop Start.
* De placeholder "[link to privacy statement]" in de laatste zin wordt een link naar `NEXT_PUBLIC_PRIVACY_URL` op de woorden "privacy statement". Zonder die variabele staat de zin er zonder link (en zonder placeholder).
* 52 stellingen in vaste volgorde, 10 per pagina (de laatste pagina 2), de instructie bovenaan elke pagina, voortgangsbalk, 5 antwoordknoppen. Volgende kan pas als alle stellingen op de pagina beantwoord zijn.
* Elk antwoord wordt direct opgeslagen (`wsp_save_answer`). Wie stopt, komt later op dezelfde pagina terug: de eerste pagina met een open stelling.
* Tijd per pagina: de pagina meet hoe lang hij zichtbaar is (niet als het tabblad op de achtergrond staat) en stuurt dat mee met elk antwoord en bij Volgende, Terug en weggaan. Meerdere bezoeken tellen op. Op elk antwoord van die pagina staat het totaal (`page_duration_ms`).
* Na de laatste pagina: berekenen in de database (`wsp_complete`), bedankscherm, en na een paar seconden het eigen rapport. Staff krijgt een mail dat de test klaar is, met de vlaggen.
* Werkt op een telefoon: knoppen onder elkaar, de voortgang blijft boven in beeld.

## Scoring en kwaliteit

Per dimensie (10 stellingen; de controlevragen tellen niet mee): itemscore is het antwoord (normal) of 6 min het antwoord (reversed); het gemiddelde van de 10 itemscores; score = afgerond((gemiddelde − 1) / 4 × 100); band 0 tot en met 34 Lower side, 35 tot en met 65 Middle, 66 tot en met 100 Higher side. Een halve wordt naar boven afgerond (net als `round()` in Postgres). Er is geen vergelijking met andere mensen; de ruwe antwoorden blijven bewaard zodat dat later kan.

De scoring staat in SQL (`wsp_private.score_assessment`, die gebruikt het portaal) en in TypeScript (`scoreAnswers`); beide draaien de vier testgevallen uit de opdracht.

| Vlag (alleen staff) | Wanneer |
| --- | --- |
| `attention_check_failed` | CHK1 is niet 4, of CHK2 is niet 1 |
| `too_fast` | Gemiddeld minder dan 2 seconden per stelling: per pagina de tijd gedeeld door het aantal stellingen op die pagina, gemiddeld over de pagina's; pagina's langer dan 10 minuten tellen niet mee |
| `straightlining` | 12 of meer keer achter elkaar hetzelfde antwoord, over alle 52 stellingen in volgorde |
| `yes_saying` | Gemiddeld ruw antwoord over de 50 stellingen is 4,2 of hoger |

Het rapport wordt altijd gemaakt. Bij een vlag ziet staff de banner "Interpret with caution" met de reden en de knop "Send the test again". De persoon en de opdrachtgever zien nooit vlaggen, ook niet in de PDF.

## Rapport

Kop met voornaam en achternaam, rol of vacature (de laatst gekoppelde vacature; voor een opdrachtgever een vacature van die opdrachtgever; anders de huidige functie, anders Candidate of Developer), datum van afname en "Working Style Profile", rechtsboven "Download PDF". Daarna de intro voor de rol (de persoon: "About your report"; opdrachtgever en staff: "How to read this profile" met de voornaam), de blokken Openness, Conscientiousness, Extraversion, Agreeableness, Emotional stability (naam, "72 / 100" met het bandlabel, beschrijving, balk 0 tot 100 met markering en de twee sidelabels, 0, 50 en 100, de sterke kanten van beide kanten, "What this means for you" en "For the employer" voor de band van de persoon, info-icoon met de tooltip) en de voettekst.

Scores staan alleen in het rapport, de PDF en de staffweergave van een afname. Niet in kandidatenlijsten, kanbanborden, zoekresultaten, de talentpool of het overzicht, en niet in de MCP-tools; geen enkele andere functie, view of pagina leest de `wsp_*` resultaten (beide tests controleren dat). Nergens wordt op deze scores gefilterd of gesorteerd.

## Toestemming voor delen

* Alleen de persoon zelf, vanuit het eigen account: de policy "Person shares own profile" op `wsp_shares` eist `consented_by = auth.uid()`, dat de afname van de ingelogde persoon is, afgerond, en dat de opdrachtgever eraan gekoppeld is. Staff, admins, klanten en de persoonlijke link (zonder account) kunnen geen share maken.
* Onder het rapport en op "My working style profile": per gekoppelde opdrachtgever het vinkje met de exacte tekst "I agree that [client name] can view and download my Working Style Profile. I can withdraw this at any time.", de status en de datum. Het vinkje staat nooit standaard aan: er bestaat pas een share als de persoon hem zelf aanvinkt.
* Gekoppelde opdrachtgevers: via een gekoppelde vacature, een handmatige uitnodiging met opdrachtgever, een plaatsing, of "Link a client" door staff.
* Staff ziet per opdrachtgever shared, not shared of withdrawn en kan alleen "Ask for permission": mail plus melding in de Academy met een link naar de deelpagina, hooguit één verzoek per opdrachtgever per 7 dagen (`wsp_permission_requests`).
* Intrekken (vinkje uit): de opdrachtgever ziet het rapport direct niet meer (RLS en `wsp_report` kijken naar een actieve share), en de contactpersoon van de opdrachtgever (de primaire contactpersoon met een mailadres) krijgt automatisch: "[first name] has withdrawn permission to share their Working Style Profile with you. Please delete any downloaded copies."
* Kandidaten zonder account zien onder hun rapport de status per opdrachtgever en de knop om in te loggen. Hebben ze nog geen account, dan maakt Nordavo er een via de Academy (kandidaat toevoegen aan de developercourse).

## Export (PDF)

Server side met pdf-lib uit de opgeslagen resultaten en de vaste teksten (`src/lib/wsp/pdf.ts`), A4, dezelfde inhoud als het rapport met de intro van de rol van wie downloadt. Elke pagina van een PDF voor een opdrachtgever heeft onderaan het watermerk "Shared with [client name] by [full name] on [date of consent]. Confidential. Delete when no longer needed or when consent is withdrawn." Nooit ruwe antwoorden of vlaggen, ook niet voor staff. Bestandsnaam `working-style-profile_<voornaam>-<achternaam>_<yyyy-mm-dd>.pdf` (kleine letters, zonder accenten, de datum van afname). Elke download staat in het auditlog (`exported`, wie, wanneer en welke rol); een opdrachtgever zonder actieve share krijgt een 404.

## Datamodel

| Tabel | Wat |
| --- | --- |
| `wsp_settings` | Eén rij: `enabled`, `trigger_stage_id`, `default_for_new_vacancies`, `auto_invite_developers_on_placement`, de termijnen, `updated_by`, `updated_at` |
| `vacancies.wsp_enabled`, `candidates.wsp_mode`, `candidates.talent_pool_consent_at` | Vacature- en persoonsinstelling, talentpool toestemming |
| `wsp_items` | De 52 stellingen: `code`, `statement`, `dimension` (E/A/C/S/O/check), `key` (normal/reversed, leeg bij checks), `position`, `expected_answer` (checks), `instrument_version` |
| `wsp_assessments` | `person_id` (de ATS-kandidaat, ook voor developers), `person_type`, `status` (invited/started/completed/expired/deleted), `invite_token`, `invited_by` (leeg is system), `invite_reason` (trigger_stage/manual/placement_start), `invited_at`, `expires_at`, `reminder_sent_at`, `started_at`, `completed_at`, `intro_accepted_at`, `instrument_version`, `delete_after`, `deleted_at` |
| `wsp_assessment_links` | Afname met vacature en/of opdrachtgever, `linked_at`, `linked_by` |
| `wsp_answers` | `answer` 1 tot 5, `answered_at`, `page_number`, `page_duration_ms` |
| `wsp_results` | Per dimensie `mean_score`, `score_0_100`, `band` (lower/middle/higher) |
| `wsp_flags` | `flag_type`, `details` |
| `wsp_shares` | `client_id`, `consented_at`, `consented_by`, `consent_text_version`, `revoked_at`, `revoked_by` |
| `wsp_permission_requests` | `client_id`, `requested_by` (leeg is system), `requested_at` |
| `wsp_audit_log` | `actor` (leeg is system of de persoonlijke link), `actor_role` (system, admin, staff, person, person_link, client), `action` (invited, reminded, linked, viewed, shared, revoked, exported, permission_requested, deleted, resent, settings_changed), `details`, `created_at` |
| `wsp_outbox` | Mail die nog verstuurd moet worden (extra tabel, geen onderdeel van de opdracht); de inhoud wordt geleegd zodra hij verstuurd is |

"system" als user id uit de opdracht is in de database een lege kolom (`null`); het auditlog zet daarnaast `actor_role = 'system'`.

## Bewaren en verwijderen

| Wie | Verwijderd |
| --- | --- |
| Kandidaat zonder talentpool toestemming | 28 dagen nadat het laatste gekoppelde sollicitatieproces is afgesloten: afgewezen, geparkeerd, of de vacature gesloten of vervuld. Zonder gekoppelde vacature tellen alle sollicitaties van de kandidaat; zonder sollicitaties 28 dagen na afname (of na het verlopen van de link) |
| Kandidaat met talentpool toestemming | 365 dagen na afname |
| Developer (heeft een plaatsing) | 28 dagen na het einde van de laatste plaatsing; zolang er een plaatsing loopt niet. Solliciteert een oud-developer opnieuw, dan geldt ook de regel voor kandidaten (de latere datum wint) |

De dagelijkse job `wsp-daily` rekent `delete_after` opnieuw uit en verwijdert wat aan de beurt is. Alleen een bewaarde afname wordt hergebruikt. "Delete my profile" (en verwijderen door staff) doet hetzelfde meteen: actieve shares worden ingetrokken met de mail aan de opdrachtgever, daarna gaan antwoorden, resultaten, vlaggen, koppelingen, shares, verzoeken en het auditlog van die afname weg. Er blijft één auditregel `deleted` zonder inhoud (alleen wie: person, staff of retention) en een lege afnamerij met status `deleted`.

## Jobs

| Job | Wanneer | Wat |
| --- | --- | --- |
| `wsp-daily` | Dagelijks 07:00 Amsterdam | Links verlopen, één herinnering na 3 dagen, bewaartermijnen (verwijderen), daarna de mail |
| `wsp-mail` | Elk uur (:23) | Mail die nog in `wsp_outbox` staat |

Beide via `/api/jobs/<naam>` met `CRON_SECRET` en de service role (`SUPABASE_SECRET_KEY`), of met de hand: `npm run job -- wsp-daily`. Ze horen bij module `recruitment` (`job_module`).

## Omgevingsvariabelen

| Variabele | Waarvoor | Zonder |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVACY_URL` (nieuw) | De link naar de privacyverklaring in het introscherm | De zin zonder link |
| `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_FROM_RECRUITMENT` | Uitnodiging, herinnering, toestemming vragen (afzender recruitment), intrekken, klaar-mail aan staff | De mail blijft in de wachtrij (`wsp_outbox`) tot mail is ingesteld; er wordt dan niets geprobeerd en niets in het maillog gezet |
| `SUPABASE_SECRET_KEY` | Mail versturen na een actie en in de jobs | Geen mail; de rest werkt |
| `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` | De jobs en de links in de mails | Jobs alleen met de hand |
| `REPORT_EMAIL_TO` | De klaar-mail als er geen staff user bekend is (systeemuitnodiging, kandidaat zonder eigenaar) | Die mail gaat niet |

## Keuzes bij de koppeling met het portaal

* **Persoon is de ATS-kandidaat.** Developers zijn de kandidaat van hun plaatsing; het Academy-account hangt eraan via `academy_members.candidate_id`. Daarom staan `wsp_mode` en de talentpool toestemming op `candidates`, en is `person_type` developer zodra er een lopende plaatsing is of de persoon developer is in de Academy.
* **Vacaturetekst die naar buiten gaat** is het publieke sollicitatieform (`/apply/<token>`, titel en intro van het form van de vacature). Daar komt de vaste zin onder. Het functieprofiel op de vacaturepagina is intern en blijft ongewijzigd.
* **Start van een plaatsing** is het vastleggen van de plaatsing (zelfde moment als de Academy-automatisering, sectie 15 van `docs/academy.md`), niet de startdatum.
* **De generieke vragenlijst van de Academy** (bloktype `questionnaire`, sectie 12 van `docs/academy.md`) blijft een generiek lesblok en is los van dit profiel. Het Working Style Profile heeft eigen tabellen en komt niet in `academy_candidate_questionnaire_results` of `academy_candidate_learn_summary`.

## Acceptatiecriteria en tests

| Criterium | Hoe | Test |
| --- | --- | --- |
| De testgevallen voor scoring slagen | Scoring in SQL en TypeScript | `wsp.test.sql` sectie 1 en 6 (alle 3: 50 Middle, 100, 0, 3,6: 65, 3,64: 66), `wsp.test.ts` "test case: ..." |
| Halverwege stoppen en later op dezelfde pagina verder | Elk antwoord direct opgeslagen; `page` is de eerste open pagina | `wsp.test.sql` sectie 6 ("resume on page 2"), `wsp.test.ts` "continue on the first open page" |
| Goed op een mobiel scherm | Knoppen onder elkaar, sticky voortgang, kolommen worden één kolom, PDF A4 | Handmatig te controleren (geen browser in de tests) |
| Alle teksten letterlijk | `content.ts`, vergelijking met de seed | `wsp.test.ts` "52 statements ... the same as the SQL seed", "spot checks of the exact texts", "filling in names ...", mailteksten |
| Scores nergens buiten rapport, PDF en staffweergave | Eigen tabellen, geen andere functie of pagina leest ze | `wsp.test.sql` sectie 15, `wsp.test.ts` "no list, board, search ..." |
| Opdrachtgever zonder actieve share haalt geen rapport of PDF op, ook niet via een directe link | RLS op `wsp_results`, `wsp_report`, `wsp_client_reports`, 404 op de PDF-route | `wsp.test.sql` sectie 7 en 8 (zonder share, andere klant, klant lid, na intrekken) |
| Share alleen vanuit het account van de persoon; staff of API faalt | Policy "Person shares own profile" | `wsp.test.sql` sectie 8 (staff, admin, klant, andere kandidaat, zonder account, niet-gekoppelde klant) |
| Vinkje nooit standaard aan | Geen share zonder eigen insert; checkbox volgt alleen een actieve share | `wsp.test.sql` "nothing is shared by default", "asking shares nothing", `wsp.test.ts` "the share box is never ticked by default" |
| Na intrekken direct weg, mail automatisch | `revoked_at`, trigger zet de mail in de wachtrij | `wsp.test.sql` sectie 8 (withdrawing), `wsp.test.ts` withdrawal mail |
| Watermerk op elke pagina van een klant-PDF | `buildReportPdf` | `wsp.test.ts` "client PDF has the watermark on every page" |
| Elke download in het auditlog | `wsp_report(..., p_export => true)` | `wsp.test.sql` "client download logged with role", "download by link logged", "staff download logged" |
| Systeem uit: geen uitnodiging en geen knoppen | Functies weigeren; kaarten en links verborgen (`wsp_enabled()`) | `wsp.test.sql` sectie 2 |
| Vacature uit en persoon Always: automatische uitnodiging | `profile_on()` | `wsp.test.sql` sectie 4 |
| Vacature aan en persoon Never: geen uitnodiging, ook niet handmatig | `wsp_send` weigert | `wsp.test.sql` sectie 4 en 5 |
| Geen dubbele uitnodigingen binnen 12 maanden zolang bewaard | Hergebruik en koppelen | `wsp.test.sql` sectie 4 (re-entry) en 10 |
| Vacature aan toont de vaste regel in de vacaturetekst | Sollicitatieform | `wsp.test.ts` "vacancy text: the fixed sentence is added" |
| Developers krijgen de extra zin bovenaan de intro | `introFor` op `person_type` | `wsp.test.ts` "developers get the extra sentence", `wsp.test.sql` sectie 12 |

## Buiten scope (niet gebouwd)

Vergelijking met anderen (normscores, percentielen), een teamfit module of extra vragen, AI-teksten of samenvattingen, vertalingen (alles is Engels, ook de mails).

## Voor Julius om te bevestigen

1. Trigger "Shortlist" is het shortlist-vinkje op het bord, want Shortlist is geen fase.
2. De functie staat na de migratie **uit**; een admin zet hem aan in Settings, Working style. Bestaande vacatures staan uit, nieuwe volgen "standaard voor nieuwe vacatures" (standaard aan).
3. Delen kan alleen met een eigen account. Kandidaten die alleen de persoonlijke link hebben, kunnen hun rapport zien, downloaden en verwijderen, maar voor delen moet Nordavo ze een Academy-account geven.
4. Talentpool toestemming bestond nog niet; staff zet die nu op de kandidaat.
5. "Afgesloten sollicitatieproces": afgewezen, geparkeerd, of de vacature gesloten of vervuld (er is geen status "teruggetrokken"). Zonder sollicitaties: 28 dagen na afname.
6. Een link verloopt na 14 dagen, ook als de persoon al begonnen was; opnieuw versturen houdt de antwoorden. Het eigen rapport blijft via de persoonlijke link bereikbaar zolang het bewaard wordt.
7. `too_fast` is het gemiddelde over de pagina's (elke pagina telt even zwaar, ook de laatste met 2 stellingen); `straightlining` telt over alle 52 stellingen, de controlevragen inbegrepen.
8. De intrekkingsmail gaat ook als een share eindigt door verwijderen (door de persoon, staff of de bewaartermijn), omdat de opdrachtgever dan ook zijn kopieën moet weggooien.
9. Na "Delete my profile" kan een nieuwe trigger de persoon weer uitnodigen (er is niets meer om aan te koppelen); wie dat niet wil zet de persoon op Never.
10. Bij verwijderen gaat ook het auditlog van die afname weg, op één regel `deleted` na ("alles behalve een regel in het auditlog zonder inhoud").
11. Het bedankscherm ("Thank you. Your answers are saved ...") en de mails (uitnodiging, herinnering, verzoek, klaar) hebben teksten die niet in de opdracht stonden; alleen de intrekkingsmail is letterlijk voorgeschreven.
12. De tooltip staat in de PDF als een regel boven de voettekst (een PDF heeft geen hover).
13. Staff zonder module recruitment (alleen Academy) ziet de kaart op de Academy-pagina's, maar de staffweergave van een afname staat onder Candidates en vraagt module recruitment.
