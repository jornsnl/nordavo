# Werving: wie wat ziet, gesprekken plannen en het wervingsrapport

Dit document hoort bij de wervingsbriefing van 8 november 2026, secties 2.5 (wie wat ziet), 2.14 (interviews plannen, als proef), 2.16 (rapportage) en 2.6.4.3 (headhunted tegenover gesolliciteerd in het rapport).

| Onderdeel | Waar |
| --- | --- |
| Migratie | `supabase/migrations/20261108040000_recruitment_planning.sql` |
| SQL test | `supabase/tests/recruitment_planning.test.sql` |
| Modules (puur) | `src/lib/modules.ts` |
| Paginabewaking | `requireModule()` en `hasModule()` in `src/lib/auth.ts`, `ModuleGate` in de `layout.tsx` per route, `IfModule` voor losse blokken |
| MCP | `src/lib/mcp/module-scope.ts` |
| Gesprekken | `src/lib/recruitment/interviews.ts`, `src/components/interviews/*`, `src/lib/integrations/calcom-interviews.ts`, job `src/jobs/interview-reminders.ts` |
| Rapport | `src/lib/recruitment/report.ts` (puur), `src/lib/recruitment/report-data.ts`, `src/components/report/recruitment-report.tsx`, CSV in `src/app/dashboard/report/recruitment-csv/route.ts` |
| Unit tests | `tests/recruitment-report.test.ts`, `tests/recruitment-planning.test.ts` |

## 1. Wie wat ziet (2.5)

Een admin bepaalt per teamlid welke modules die ziet, onder Settings, Users. Er zijn vier modules:

| Module | Wat |
| --- | --- |
| Sales | GTM: leads (companies), contacts, signals, lists, campaigns, activities, suppressions, list exports en de GTM jobs |
| Recruitment | Vacancies, candidates, applications (pipeline), placements met check-ins, matches, anonieme profielen, de fasehistorie en de interviews |
| Clients | Klantbedrijven en hun contactpersonen |
| Report | De rapportpagina. Elk blok daarop vraagt daarnaast zijn eigen module: het salesdeel Sales, het wervingsdeel Recruitment |

Regels:

* Admins zien altijd alles. Klantaccounts en Work only accounts hebben geen modules (ze komen ook niet langs `is_staff()`).
* Bestaande en nieuwe teamleden krijgen alle vier de modules. Er verandert dus niets tot een admin iemand beperkt. Bij een uitnodiging kies je de modules meteen (standaard alles aangevinkt).
* Iedereen in het team ziet Overview, Tasks, Work, Import, Jobs (alleen de jobs van zijn modules) en Settings.
* Voorbeeld: Judith krijgt Recruitment (en eventueel Clients en Report). Ze ziet dan geen leads, contacts, campagnes of salesnotities, niet in het menu en ook niet in de database.

### Afdwingen in de database

* `profiles.modules text[]`, alleen te wijzigen door een admin via `public.admin_set_profile_modules(user, modules)`. De kolom zit niet in de column grant van `profiles`, dus een lid kan zijn eigen modules niet aanpassen.
* `public.has_module(text)`: admin altijd, member als de module in zijn lijst staat, anders false.
* De RLS policies van de GTM tabellen (companies, contacts, signals, campaigns, activities, suppression, list_exports) gebruiken `has_module('sales')` in plaats van `is_staff()`. De views `call_list_candidates`, `mail_list_candidates` en `appointment_attribution` zijn security invoker en volgen daarmee vanzelf.
* Vacancies, candidates, applications, placements, placement_checkins, matches, anonymous_profiles, application_stage_events en interviews gebruiken `has_module('recruitment')`.
* Notes, tasks, attachments en het activity log hangen aan een record (`entity_type`). Ze volgen de module van dat record via `public.can_access_entity(entity_type)`: company is Sales, client is Clients, vacancy, candidate, application en placement zijn Recruitment. Een taak zonder record, of een taak die je zelf maakte of die aan jou is toegewezen, blijft zichtbaar. Bestanden in de bucket `attachments` volgen dezelfde regel via de eerste map van het pad.
* `job_runs`: `public.can_see_job(job_name)`. Jobs `s<nummer>-...` en `max-...` zijn Sales, `work-...` en `clickup-...` zijn voor het hele team, de rest (t2-match, interview-reminders en de andere wervingsjobs) is Recruitment. Een job starten vanuit het portaal of via de API met een sessie controleert hetzelfde.

### Klanten: waarom niet alleen de module Clients

Een recruiter moet zien voor welke klant een vacature is (vacature, plaatsing, klantgesprek), en sales zet een lead om in een klant. Daarom:

| Actie op `clients` | Wie |
| --- | --- |
| Lezen | Clients, Recruitment of Sales |
| Toevoegen | Clients of Sales (lead omzetten naar klant) |
| Wijzigen en verwijderen | Clients |

`client_contacts` lezen: Clients of Recruitment (voor klantgesprekken). Beheren: Clients. Wie alleen Recruitment heeft, ziet dus de klantnaam bij een vacature, maar niet de klantpagina's in het menu en kan klanten niet aanpassen. Een vacature die bij een GTM prospect hoort (`company_id` zonder `client_id`) toont voor iemand zonder Sales geen bedrijfsnaam, omdat companies Sales is.

### MCP server

De MCP server (`/api/mcp`) leest met de secret key, dus RLS geldt daar niet. `scopeDbToModules` in `src/lib/mcp/module-scope.ts` doet dezelfde verdeling in code: een tabel van een module die de eigenaar van het token mist, geeft een duidelijke foutmelding; notes, tasks, attachments en het activity log worden gefilterd op de recordtypes die hij mag zien. De modules worden bij elk verzoek uit het profiel gelezen, dus een wijziging in Settings werkt meteen. Nieuwe tabellen moeten in `tableModules` in dat bestand. Embedded joins in een select worden niet gefilterd; het enige dat daardoor zichtbaar kan worden is een bedrijfsnaam naast een vacature.

## 2. Gesprekken plannen (2.14, proef)

### Hoe het werkt

1. Elke interviewer (Judith, Floris of een andere technical recruiter) zet zijn eigen Cal.com boekingslink in Settings, onder Interviews, bijvoorbeeld `https://cal.com/judith/interview`. Alleen teamleden met de module Recruitment zien dat blok.
2. Op de kandidaatpagina staat het blok Interviews met de knop Plan interview. Je kiest de vacature (als de kandidaat in meer pipelines zit), de interviewer en het type: Interview, English interview of Client interview.
3. Het portaal maakt een interview aan met status `invited` en mailt de kandidaat via Resend de link van de interviewer, vooraf ingevuld met naam, mail en `metadata[interview_id]` en `metadata[application_id]` (plus `utm_content` met het interview id).
4. De kandidaat kiest zelf een tijd uit de beschikbaarheid van de interviewer in Cal.com. Cal.com zet het gesprek in beide agenda's.
5. De webhook van Cal.com komt binnen op `/api/webhooks/calcom`. Eerst kijkt `public.interview_from_booking()` of de boeking bij een interview hoort: via het interview id in de metadata, via de Cal.com uid (verzetten en annuleren) of via het mailadres van een kandidaat met een openstaande uitnodiging. Zo ja, dan krijgt het interview tijd en status (`scheduled`, `rescheduled`, `cancelled`), wordt `applications.interview_at` bijgewerkt en schuift de kandidaat via `move_applications` door naar Interview (of Client interview bij een klantgesprek). Alleen vooruit: een kandidaat die al verder is, of geparkeerd of afgewezen, blijft staan. In de fasehistorie staat de interviewer als degene die de kandidaat verplaatste. Hoort de boeking niet bij een interview, dan gaat hij zoals altijd naar de salesflow.
6. Elk uur mailt de job `interview-reminders` ongeveer 24 uur vooraf de kandidaat (tijd in India) en de interviewer (in zijn eigen tijdzone), één keer per afspraak. Na verzetten gaat de herinnering opnieuw.
7. Na het gesprek vult de interviewer op de kandidaatpagina de feedback in: gehouden of no show, beoordeling (1 tot 5), communicatie (1 tot 5) en notities.
8. In de pipeline staat `interview_at` op de kaart (gebouwd door de pipeline). Op de kandidaatpagina staan alle interviews met status, tijd en feedback.

Een uitnodiging zonder boeking kun je intrekken. Een geboekt gesprek annuleer je in Cal.com, dan horen kandidaat en agenda het ook; de webhook zet het interview daarna op cancelled.

### Zonder Cal.com of Resend

* Zonder boekingslink: Plan interview legt uit dat de interviewer eerst zijn link in Settings zet.
* Zonder `RESEND_API_KEY` of `MAIL_FROM`: het interview wordt wel aangemaakt en je krijgt de vooraf ingevulde link om te kopiëren en zelf te sturen. Het blok Interviews toont een melding. De herinneringsjob verstuurt niets en markeert niets, zodat de herinnering alsnog gaat zodra mail werkt.
* Zonder `CALCOM_WEBHOOK_SECRET`: de webhook weigert alles (401) en het blok Interviews meldt dat boekingen niet terugkomen.

### Inrichten

1. Migratie `20261108040000_recruitment_planning.sql` uitvoeren, vóór het deployen van de code (de app leest `profiles.modules`).
2. Cal.com: elke interviewer maakt een event type (bijvoorbeeld "Interview", 30 of 45 minuten) met zijn beschikbaarheid en een videolink als locatie. Zet onder Settings, Developer, Webhooks een webhook naar `https://<domein>/api/webhooks/calcom` voor `BOOKING_CREATED`, `BOOKING_RESCHEDULED` en `BOOKING_CANCELLED`, met als geheim de waarde van `CALCOM_WEBHOOK_SECRET`. Dat is dezelfde webhook als voor sales; heeft een interviewer een eigen Cal.com account, dan zet je hem daar ook, met hetzelfde geheim. In een Cal.com team volstaat één webhook op teamniveau.
3. Resend: `RESEND_API_KEY` en `MAIL_FROM` (bestaan al voor de jobs). De uitnodigingen gaan van `MAIL_FROM` naar het mailadres van de kandidaat.
4. Herinneringen: de workflow `.github/workflows/recruitment-planning.yml` roept elk uur `POST /api/jobs/interview-reminders` aan met `CRON_SECRET` (secrets `CRON_SECRET` en `NEXT_PUBLIC_SITE_URL`, bestaan al). Handmatig: `npm run job -- interview-reminders` of `--hours=36` voor een ruimer venster.
5. Iedere interviewer zet zijn link in Settings, Interviews.

Aanname over Cal.com: boekingsvelden uit de link (`metadata[...]`) komen terug in `payload.metadata` van de webhook, en bij verzetten is `payload.uid` de nieuwe boeking en `rescheduleUid` de oude. Mocht de metadata niet meekomen, dan vindt de webhook het interview nog via het mailadres van de kandidaat met een openstaande uitnodiging, en daarna via de uid.

## 3. Wervingsrapport (2.16 en 2.6.4.3)

Op `/dashboard/report` staat onder het salesdeel het blok Recruitment (alleen met de module Recruitment). Het salesdeel blijft zoals het was en is alleen zichtbaar met de module Sales.

* Periode: laatste 30 dagen, 90 dagen (standaard), 12 maanden of alles (`?rperiod=`). Het rapport telt de sollicitaties die in de periode binnenkwamen en volgt hoe ver die kwamen.
* Vacature: alle vacatures of één (`?vacancy=`). Vacatures van de talentpool tellen nooit mee.
* Totalen: sollicitanten, gesolliciteerd, headhunted, in proces, geparkeerd, afgewezen, geplaatst.
* Funnel op bereikte fase: sollicitanten, form ingevuld (`form_completed_at`), video review, technical test, interview, gekoppeld aan klant, geplaatst, met de conversie ten opzichte van de stap ervoor. Bereikt betekent: de verste fase in de historie (`application_stage_events`), de huidige fase of de fase die een geparkeerde of afgewezen kaart verliet. Een overgeslagen fase telt als gepasseerd. Form ingevuld telt alleen het form zelf, dus die stap kan lager zijn dan video review.
* Gesolliciteerd tegenover headhunted (2.6.4.3), elk met een eigen funnel en het aandeel van de groep per stap.
* Per bron (LinkedIn, Naukri, Manatal enzovoort).
* Geparkeerd en afgewezen met de vijf meest gegeven redenen.
* Tijd per fase (gemiddeld en mediaan in dagen) uit de historie; de huidige fase telt tot nu.
* Verdeling van de CV score, als die er is.
* Per vacature: dagen open, sollicitanten, headhunted, form ingevuld, interview, gekoppeld, geplaatst. Klik op een vacature om het hele blok voor die vacature te zien.
* CSV: de knop Download CSV geeft hetzelfde rapport als bestand (`/dashboard/report/recruitment-csv`, met dezelfde filters), geschikt voor Excel.

Het dashboard (Overview) toont kandidaten per fase op de nieuwe fases, met geparkeerd en afgewezen apart. De blokken over vacatures, plaatsingen en de pipeline staan daar alleen voor wie Recruitment heeft.

## Omgevingsvariabelen

Geen nieuwe. Gebruikt: `CALCOM_WEBHOOK_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` (link in de herinnering aan de interviewer), `SUPABASE_SECRET_KEY` (webhook en job).
