# Werving in het portaal

Het hele wervingsproces staat nu in één systeem: van sollicitant tot plaatsing. Airtable en de losse sheets zijn niet meer nodig. Dit document is het overzicht. Per onderdeel staat de uitleg in een eigen document:

| Onderdeel | Document | Briefing |
| --- | --- | --- |
| Pipeline, parkeren, notities per fase, beoordelen, toppers, Claude verplaatst kandidaten | [recruitment-pipeline.md](recruitment-pipeline.md) | 2.1 t/m 2.4, 2.12, 2.13 |
| Sollicitatieform per vacature, mail naar kandidaten, herinneringen, CTC en uurtarief, payslip | [recruitment-forms.md](recruitment-forms.md) | 2.8, 2.9, 2.6.4, 3 |
| Import, veel CV's tegelijk, techstack check, CV tegen JD scoren, ranglijst, talentpool AI | [recruitment-screening.md](recruitment-screening.md) | 2.6, 2.7, 2.11, 2.15, 2.18 |
| Wie wat ziet, interviews plannen, hiring report | [recruitment-planning.md](recruitment-planning.md) | 2.5, 2.14, 2.16 |
| Eigen velden, tijdzones, inloggen met link voor gasten, portaaltaken in My overview | [recruitment-extras.md](recruitment-extras.md) | 2.10, feedback 9, 11, 12 |

## De fases

Sourced, Techstack check, Fill out, Video review, Technical test, Interview, Matched to client, Client interview, Final screening, Placed. Los van de flow: Parked en Rejected. Een geparkeerde of afgewezen kandidaat onthoudt de fase waar hij uit kwam en kan met Resume terug.

Bestaande kandidaten zijn omgezet: Screening werd Techstack check, English interview werd Interview, Presented werd Matched to client en Final interview werd Client interview.

De klant ziet een kandidaat vanaf Matched to client. De belofte van 3 kandidaten in 3 weken telt vanaf die fase.

Automatisch naar de volgende fase:

* form verstuurd: van Sourced of Techstack check naar Fill out;
* form ingevuld: van Fill out naar Video review;
* techstack check: geslaagd naar Fill out, niet geslaagd naar Rejected (pas na bevestiging);
* interview geboekt in Cal.com: naar Interview of Client interview.

## Academy in het ATS

De Academy gebruikt dezelfde kandidaat als het ATS. Op de kandidaat staat een kaart Academy (voortgang, modules en lessen met data, kennischecks, opdrachten met AI-voorstel en eindscore, kijkpercentage, laatste activiteit, certificaat), met knoppen om de kandidaat aan de developercourse toe te voegen, modules open te zetten en topkandidaat aan of uit te zetten. `/dashboard/candidates/academy` is de talentpool met deze kolommen: sorteren, filteren en in bulk toevoegen of markeren (ook een hele vacature). De kandidatenlijst heeft een kolom Academy. Het is achtergrond: niemand wordt automatisch afgewezen.

Een plaatsing vastleggen start de Academy: de developer krijgt de hele developercourse, de contactpersoon van de klant een account met de klantcourse, en de plaatsingspagina een tijdlijn. De kaart Academy op de plaatsing laat zien wat er gebeurde. Alles staat in [academy.md](academy.md), sectie 15.

## Working Style Profile

Kandidaten kunnen automatisch (bij de trigger fase, standaard het shortlist-vinkje) of met de hand een korte Big Five vragenlijst krijgen. Instellingen op systeem, vacature en kandidaat; de vaste zin komt onder de vacaturetekst van het sollicitatieform als het aan staat. Scores staan alleen in het rapport en de staffweergave, nooit op het bord, in lijsten of de talentpool. Een klant ziet een rapport alleen als de kandidaat het zelf deelt. Alles in [working-style-profile.md](working-style-profile.md).

## Agenda

Menu Recruitment, *Agenda* (`/dashboard/agenda`, module Recruitment): één agenda met alle data die het portaal al kent. Er wordt niets dubbel ingevoerd; elk item komt uit een veld van zijn record en opent dat record.

- **Weergaven:** Day, Week, Month, List (31 dagen vanaf de gekozen dag) en *All roles*: alle vacatures en plaatsingen met start, einde en duur.
- **My agenda of Team:** *My agenda* toont wat bij jou hoort (eigenaar van de vacature of kandidaat, Nordavo contact van de plaatsing, interviewer).
- **Filters per soort:** Vacancies, Placements, Candidates, Interviews, Holidays. Alles staat in de URL (`?view=month&date=2026-12-01&scope=mine&kinds=vacancies,interviews`), dus deelbaar.
- **Vacatures (open en on hold):** open sinds (kleur naar dagen open: groen onder 14, oranje 14 tot 21, rood erna), intake, profielen gestuurd, eerste interview, de deadline voor de top 3 tot 5 (`presentation_deadline`, anders opening plus drie weken, opgeschoven met de dagen on hold) met resterende dagen en aantal voorgesteld, gewenste start en start.
- **Plaatsingen:** start bij de klant met looptijd, laatste werkdag bij opzegging, einde, einde garantie, einde proeftijd en volgende check-in (rood als die voorbij is).
- **Kandidaten:** beschikbaarheid, als daar een datum in staat (`2026-12-01`, `1-12-2026` of `1 December 2026`); interviews en klantinterviews uit de planning, in Nederlandse tijd.
- **Feestdagen:** Nederland en Karnataka, alleen dagen die vrij zijn en alleen als er op die dag een plaatsing loopt (klant dicht of developer vrij). Uit de tabel `academy_holidays` (door Nordavo gecontroleerd); staat het jaar daar niet in, dan de berekende dagen.

Code: de datumlogica is puur en getest in [src/lib/recruitment/agenda.ts](../src/lib/recruitment/agenda.ts) (`tests/agenda.test.ts`), het laden in `agenda-data.ts`, de pagina in `src/components/agenda/agenda-view.tsx`.

## Wat de klant ziet

Klanten lezen niets meer rechtstreeks uit de tabellen. Het klantportaal haalt alles op via vaste databasefuncties (`portal_*`). Die geven alleen terug wat het portaal toont: naam, titel, locatie, ervaring, skills, samenvatting, video, scores en het eigen oordeel.

Contactgegevens, CV tekst, notities, redenen voor parkeren of afwijzen, beoordelingen, salaris, payslips, background checks en eigen velden komen nooit bij een klant, ook niet via de API. Een klant opent alleen het CV.

Het klantportaal is voor klantgebruikers zonder Academy-rol of met Academy-rol `client_admin`. Klant leden en meelezers uit de Academy (`client_member`, `client_reader`) krijgen niets uit de `portal_*` functies en openen geen cv's: `current_client_id()` is voor hen null (`docs/academy.md`, sectie 17).

## Wie wat ziet

Een beheerder zet per teamlid de onderdelen aan: Sales, Recruitment, Clients en Report. Zo ziet Judith geen sales. Dit wordt in de database afgedwongen, ook voor alle nieuwe wervingstabellen.

Bestaande teamleden houden alles tot een beheerder het aanpast.

## Feedback ronde 3: vacatures, kandidaten en klanten

* **Kandidaatpagina in tabs.** Overview, Selection, Matching, Contract en Activity, via `?tab=` zodat een tab te delen is. Bovenaan staat altijd de status, de vacature waar de kandidaat in zit (de verste in de flow, met de fase) en de volgende stap (een gepland interview, anders wat bij de fase hoort). Welke blokken op welke tab staan volgt de paginaindeling uit Settings, Fields.
* **Video intro.** Op de tab Overview speelt de link af (Loom, YouTube, Vimeo, Google Drive). Een kopie van het bestand kan in het portaal (bijlage van soort video, tot 200 MB), zodat de video blijft als de link verdwijnt. In de pipeline staat bij Video review een link ernaartoe.
* **Notice period** is een keuze: immediately, 15, 30, 45, 60 of 90+ dagen. Bestaande tekst is omgezet waar dat kon (weken tellen 7 dagen, maanden 30, naar boven afgerond); wat niet te lezen was blijft staan en is in het formulier te kiezen als "As written before". Een trigger zet nieuwe waarden uit forms, imports en MCP in dezelfde vorm.
* **Current en expected CTC** (INR per jaar, optioneel) op het kandidaatformulier, los van de bedragen per vacature.
* **Dubbelcheck.** Bij een nieuwe kandidaat waarschuwt het formulier bij dezelfde naam, email, telefoon of LinkedIn; opslaan kan pas na "This is someone else". Bulk import vanaf de kandidatenlijst (`/dashboard/candidates/import`): CSV of Excel, template downloaden, eerst duplicaten controleren (rijen met dezelfde contactgegevens werken de bestaande kandidaat bij, rijen met alleen dezelfde naam worden standaard overgeslagen) en veel cv's tegelijk, gekoppeld op email, telefoon, LinkedIn of een unieke naam.
* **Seniority** is voor vacatures en kandidaten dezelfde lijst: Intern, Fresher, Junior, Medior, Senior, Lead, Manager, Senior manager, Freelance.
* **Klantvacature uploaden** (PDF of Word) op New vacancy, het bewerkformulier en bij Job profile op de vacature. Het bestand blijft bij de vacature (bijlage van soort job_description). De tekst gaat in de lege velden: met de Claude sleutel vult Claude het job profile in Markdown en de vaste eisen; zonder sleutel krijgt het job profile eenvoudige opmaak en leest Claude de eisen via claude-requests. Het job profile toont Markdown (kopjes, opsommingen, vet), veilig: nooit als HTML.
* **Deadline top 3 tot 5 presenteren** (`presentation_deadline`): in het formulier, de tijdlijn en Details. Op Overview telt een verlopen of bijna verlopen deadline mee in het signaal.
* **Starttijd in India.** Het formulier vraagt de gewenste starttijd in IST en toont de NL tijd voor winter en zomer (12:30 IST is 08:00 in de winter en 09:00 in de zomer). Het oude vrije veld heet nu Time zone notes.
* **On hold** (was Parked): verplichte reden en startdatum, ook via het formulier. Elke periode staat in `vacancy_holds`; days open, lead time en de flow deadline tellen die dagen niet mee. Resume zet de klok weer aan en legt de datum vast. Bij het op hold zetten kan het bedrijf ook op Parked in de salespipeline, met een datum om weer contact op te nemen.
* **Vacaturelijst.** Kolommen zijn sorteerbaar (klik op de titel). De knop Filter is weg: status, klant en fase gelden meteen, zoeken met Enter. Nieuwe kolom Flow deadline.
* **Klant pas Active met eigenaar en contactpersoon.** De server weigert Active zonder eigenaar of zonder contactpersoon (een nieuwe klant begint dus als Lead), en de laatste contactpersoon van een actieve klant is niet te verwijderen. Stad en branche geven alleen een waarschuwing op de klantpagina.
* **Klanttarieven in Sales.** Op de leadpagina staat de kaart Client rates: het budget per maand van de vacatures en het maandtarief van de plaatsingen, met wat er nu per maand loopt. Zonder Recruitment rechten blijft de kaart leeg.
* **Eigen velden.** De vacaturevelden notice_period en linkedin_profile (kandidaatgegevens) zijn verwijderd. Settings, Fields waarschuwt als een nieuw veld dezelfde naam heeft als een vast veld of een veld van een ander soort record.

### Notitie: overzicht lopende vacatures met einddatum flow

Getoetst of een apart overzicht zinvol is naast Overview en de vacaturelijst. Conclusie: niet nu. Overview toont al de vacatures die aandacht nodig hebben (dagen open, gepresenteerd, nu ook de presentatiedeadline) en de vacaturelijst bevat alle lopende vacatures. Wat ontbrak was de einddatum van de flow; die staat nu als sorteerbare kolom Flow deadline in de lijst (de presentatiedeadline, anders geopend plus drie weken, opgeschoven met de dagen on hold). Sorteren op die kolom geeft precies het gevraagde overzicht. De planning per dag (interviews, deadlines) komt in de recruitment agenda. Komt er na gebruik toch behoefte aan een tijdlijnweergave, dan kan die op dezelfde gegevens.

## Live zetten

1. **Migraties draaien, in volgorde.** In `supabase/migrations`, via `supabase db push` of per bestand in de SQL editor. Nieuw zijn:
   * `20261108000000_recruitment_foundation.sql`
   * `20261108010000_recruitment_pipeline.sql`
   * `20261108020000_recruitment_forms.sql`
   * `20261108030000_recruitment_screening.sql`
   * `20261108040000_recruitment_planning.sql`
   * `20261108050000_custom_fields_and_extras.sql`
   * `20261108090000_recruitment_integration.sql`
   * De Academy-migraties (zie [academy.md](academy.md)), voor de koppeling `20261113300000_academy_ats_core.sql`, `20261113310000_academy_ats_read.sql` en `20261113320000_academy_ats_manage.sql`
   * Working Style Profile: `20261116000000_wsp_core.sql` en `20261116010000_wsp_flow.sql` (daarna in Settings, Working style aanzetten)
   * Feedback ronde 3: `20261123100000_recruitment_round3.sql` (seniority, notice period, on hold periodes, deadline en starttijd, CTC, bijlagen, dubbelcheck op naam, opruimen eigen velden)

   Draai eerst de oudere `20261107000000_bootstrap_nordavo_admin.sql` als dat nog niet gebeurd is.
2. **Omgevingsvariabelen** (zie `.env.example`):

   | Variabele | Nodig voor |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | CV's lezen en scoren, techstack check met AI, talentpool AI, matching |
   | `RESEND_API_KEY` | Alle mail: forms, herinneringen, interviewuitnodigingen |
   | `MAIL_FROM_RECRUITMENT` | Afzender voor kandidaten, op een eigen domein dat in Resend geverifieerd is (niet het cold mail domein) |
   | `FORMS_DEFAULT_CC` | Optioneel: standaard in CC bij het versturen, bijvoorbeeld Floris |
   | `SUPABASE_SECRET_KEY` | Het publieke form en de jobs |
   | `CRON_SECRET` | De geplande jobs |
   | `CALCOM_WEBHOOK_SECRET` | Interviews plannen |
   | `NEXT_PUBLIC_SITE_URL` | De links in de mails |

   Zonder sleutels werkt het portaal gewoon. De onderdelen die een sleutel nodig hebben laten dan zien wat er ontbreekt.
3. **Wisselkoers.** Een beheerder vult de eerste INR per EUR koers in op `/dashboard/exchange-rate`. Tot die tijd staan bedragen alleen in roepies.
4. **Cal.com.** Elke interviewer zet zijn Cal.com link in Instellingen, Interviews. Maak een webhook naar `/api/webhooks/calcom` voor BOOKING_CREATED, BOOKING_RESCHEDULED en BOOKING_CANCELLED, met hetzelfde geheim als `CALCOM_WEBHOOK_SECRET`.
5. **Geplande jobs.** De workflows in `.github/workflows` draaien de herinneringen (forms dagelijks, interviews ieder uur) en de Academy-koppeling (`academy-ats-jobs.yml`). Ze hebben de secrets `CRON_SECRET` en `NEXT_PUBLIC_SITE_URL` nodig. CV scoren kan ook gepland: `npm run job -- screening-score`.
6. **Supabase e-mail** voor inloggen met een link (gasten): zie [recruitment-extras.md](recruitment-extras.md).
7. **Rechten per teamlid.** Een beheerder zet in Instellingen, Users per persoon de onderdelen aan, bijvoorbeeld Judith: Recruitment, Clients en Report.

## Testen

* `npm test` draait de unit tests.
* De SQL tests in `supabase/tests` spelen de rechten na met echte RLS. Draai ze tegen een database met alle migraties, bijvoorbeeld een lokale Supabase na `supabase db reset`:

  ```bash
  for f in supabase/tests/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
  ```
