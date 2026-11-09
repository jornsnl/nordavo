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

## Wat de klant ziet

Klanten lezen niets meer rechtstreeks uit de tabellen. Het klantportaal haalt alles op via vaste databasefuncties (`portal_*`). Die geven alleen terug wat het portaal toont: naam, titel, locatie, ervaring, skills, samenvatting, video, scores en het eigen oordeel.

Contactgegevens, CV tekst, notities, redenen voor parkeren of afwijzen, beoordelingen, salaris, payslips, background checks en eigen velden komen nooit bij een klant, ook niet via de API. Een klant opent alleen het CV.

Het klantportaal is voor klantgebruikers zonder Academy-rol of met Academy-rol `client_admin`. Klant leden en meelezers uit de Academy (`client_member`, `client_reader`) krijgen niets uit de `portal_*` functies en openen geen cv's: `current_client_id()` is voor hen null (`docs/academy.md`, sectie 17).

## Wie wat ziet

Een beheerder zet per teamlid de onderdelen aan: Sales, Recruitment, Clients en Report. Zo ziet Judith geen sales. Dit wordt in de database afgedwongen, ook voor alle nieuwe wervingstabellen.

Bestaande teamleden houden alles tot een beheerder het aanpast.

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
