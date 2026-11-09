# GTM systeem: werking en beheer

Dit document beschrijft hoe het GTM systeem uit [de briefing](./gtm-briefing.md) in deze repository is gebouwd, hoe je het inricht en hoe je het beheert.

## In het kort

Supabase is de enige bron van waarheid voor alle prospectdata. Geplande jobs halen signalen op, kwalificeren, verrijken en synchroniseren. Claude doet het oordeel (kwalificatie, segment, score, openingszin, vacature uitlezen, kandidaten matchen en anonieme profielen) en, via de MCP van het portaal, de geplande taken met Instantly, Seleqt, Cal.com, Apify en Prospeo ([claude-jobs.md](./claude-jobs.md)). Julius werkt in het sales CRM van het portaal: leads, contacten, de pipeline, sequences, bellijsten, meetings en partners ([sales.md](./sales.md)). OnePageCRM is vervangen door de pipeline in het portaal.

| Onderdeel | Waar in de code |
| --- | --- |
| Datamodel en harde regels | `supabase/migrations/20261025000000_gtm.sql` |
| Normaliseren en ontdubbelen | `src/lib/gtm/normalize.ts`, `src/lib/gtm/upsert.ts` |
| Jobs (S1 tot en met S10, T2) | `src/jobs/*.ts`, register in `src/jobs/registry.ts` |
| Job framework (job_runs, foutmail) | `src/lib/gtm/jobs.ts` |
| Claude prompts en schema's | `src/lib/ai/prompts/*.ts`, aanroep via `src/lib/ai/claude.ts` |
| Koppelingen | `src/lib/integrations/*.ts` |
| Sales CRM (statussen, pipeline, activities, sequences) | `supabase/migrations/20261110010000_sales_crm.sql`, `src/lib/sales/*`, zie [sales.md](./sales.md) |
| Exports (Max) en exportgeschiedenis | `src/lib/gtm/lists.ts`, `src/lib/gtm/max.ts` |
| Rapportage | `src/lib/gtm/report.ts` |
| Talent (matchen, profielen) | `src/lib/talent/*` |
| Planning | `.github/workflows/gtm-jobs.yml` |

## Portaal

| Pagina | Wat je er doet |
| --- | --- |
| Sales, Leads | Alle bedrijven met ICP-besluit, score en signalen. Via Review beoordeelt Julius de twijfelgevallen (REVIEW) |
| Sales, Contacten | Alle beslissers met tier, mail- en telefoonstatus en bron |
| Sales, Contacten, Enrich | Max-export van contacten zonder nummer (status Enrich) en de import van Max, met de exportgeschiedenis |
| Sales, Leads, Replies | Replies waar Claude aan twijfelde, met zijn voorstel: accepteren, andere uitkomst of afwijzen |
| Sales, Pipeline | De acht fases van Interested tot Won en Lost |
| Sales, Calls en Call lists | Het belscherm en de bellijsten (opgeslagen weergaven) voor het team en externe bellers |
| Sales, Meetings | Het meetingregister met goedkeuren en tarieven |
| Sales, Sequences | Stappen over mail, LinkedIn en bellen; concepten van Claude goedkeuren; starten voor bedrijven. Vervangt Campagnes |
| Sales, Partners | Partners die leads aanbrengen, met contactmomenten en hun leads |
| Sales, Rapport | Het weekrapport: calls, bereikt, mails, replies, meetings, pipeline en per beller, plus afspraken per signaal, segment en kanaal, en doorlooptijd per vacature |
| Werving, Vacatures | Vacature uitlezen (T1), matchen in de pool (T2), zoekopdracht (T3), anoniem profiel (T4), goedkeuren en versturen (T5), doorlooptijd (T6) |
| Beheer, Import | Oude leadlijsten (CSV uit Sheets) importeren met ontdubbeling en bron |
| Beheer, Uitsluitingen | Afmeldingen, bezwaren en niet-bellen |
| Beheer, Jobs | Status van elke job, logboek en handmatig starten, plus de runs van de geplande taken van Claude |

## Harde regels en waar ze zijn afgedwongen

| Regel | Afgedwongen in |
| --- | --- |
| 1, 2: uniek domein en LinkedIn, aanvullen in plaats van dubbel | Unieke kolommen met normalisatie-triggers in de database, `upsertCompany` / `upsertContact` |
| 3: bron en datum bij mail en telefoon | `email_source`, `email_found_at`, `phone_source`, `phone_found_at`, gevuld door `upsertContact` |
| 4: niet in suppression | Functie `is_contactable` en de views `call_list_candidates` / `mail_list_candidates`. De 30-dagenregel is vervallen: die blokkeerde contact via meerdere kanalen binnen een week, en dat doet een sequence juist |
| 5: eenmanszaak en vof nooit bellen | View `call_list_candidates` en `isExcludedFromCalling` als tweede controle |
| 6: lijst is een opgeslagen filter, export in list_exports | Bellijsten zijn opgeslagen weergaven (`sales_views`); de Max-export staat in `list_exports` (`src/lib/gtm/max.ts`) |
| 7: job_runs en foutmail | `runJob` in `src/lib/gtm/jobs.ts` |
| 8: alleen bedrijven met interesse in de pipeline | Vervangt de regel voor OnePageCRM: de triggers op `activities` en `meetings` zetten een bedrijf pas in de pipeline bij interesse of een meeting ([sales.md](./sales.md)) |
| 9: twijfel is REVIEW, klantcontactrisico is NO_GO | Prompt van S2; trigger op `companies` zet NO_GO bij `client_contact_risk` |
| 10: afmelding direct naar suppression | Trigger op `activities` |
| 11: één bron voor kandidaten | Kandidaten staan alleen in het portaal (`candidates`). T2 matcht op die tabel (`t2_candidate_pool` plus `src/lib/talent/pool.ts`); `matches.candidate_id` verwijst naar `candidates.id`. De vroegere Airtable-koppeling is verwijderd (feedback punt 8) |
| 12: anoniem profiel zonder herleidbare gegevens | Prompt van T4 plus een controle in code op naam, contactgegevens en werkgevers |
| 13, 14: toestemming en menselijke goedkeuring | Check-constraint op `anonymous_profiles`: `sent_at` kan alleen met goedkeuring en toestemming |
| 15: AVG-verwijdering | Verwijder de kandidaat in het portaal; matches en anonieme profielen gaan mee (`on delete cascade`) |

## Inrichten

1. **Migraties.** Voer alle bestanden in `supabase/migrations` in volgorde uit.
2. **Omgevingsvariabelen.** Zie `.env.example`. De app (bijvoorbeeld op Vercel) heeft ze nodig voor de knoppen in het portaal. GitHub Actions heeft ze nodig voor de geplande jobs: zet geheimen onder Settings, Secrets and variables, Actions, en vul de niet-geheime waarden (actor-id's, mailadressen) in als variables.
3. **Apify.** Kies de actors voor LinkedIn-vacatures, Indeed-vacatures en het zoeken van personen, en zet hun id's in `APIFY_LINKEDIN_JOBS_ACTOR`, `APIFY_INDEED_JOBS_ACTOR` en `APIFY_PEOPLE_ACTOR`. De mapping per actor staat in `src/lib/integrations/apify.ts`. Draai de eerste keer klein: `npm run job -- s1-signals --limit=20`.
4. **Google service account.** Maak een service account met de Sheets API en de Drive API aan, en zet de JSON-sleutel op één regel in `GOOGLE_SERVICE_ACCOUNT_JSON`. Deel de afsprakensheet van Web Partners met het mailadres van het service account.
5. **Cal.com.** Maak een webhook naar `https://<domein>/api/webhooks/calcom` voor `BOOKING_CREATED`, `BOOKING_RESCHEDULED` en `BOOKING_CANCELLED`, met een geheim dat je ook in `CALCOM_WEBHOOK_SECRET` zet.
6. **Claude.** Maak een MCP token met schrijfrechten aan en richt de geplande taken in volgens [claude-jobs.md](./claude-jobs.md). OnePageCRM is niet meer nodig: de pipeline zit in het portaal.
7. **Mail.** Maak een Resend-account aan, verifieer het afzenderdomein en zet `RESEND_API_KEY`, `MAIL_FROM` en `REPORT_EMAIL_TO`.
8. **Externe scheduler (optioneel).** In plaats van GitHub Actions kan elke scheduler `POST /api/jobs/<naam>` aanroepen met `Authorization: Bearer <CRON_SECRET>`. Voor lange jobs is de command line (`npm run job -- maandag`) beter dan een serverless functie.

## Planning

| Wanneer (Amsterdam) | Reeks | Jobs |
| --- | --- | --- |
| Maandag 06:00 | `maandag` | S1 signalen, S2 kwalificatie, S3 beslissers, S4 mailadressen. Stopt bij de eerste fout |
| Elke dag 07:00 | `dagelijks` | S8 Instantly, S8 Web Partners |
| Vrijdag 16:00 | `vrijdag` | S10 weekrapport |
| Op verzoek | | Max-export en -import (Contacten, Enrich), T2 matchen (vanuit het portaal of `npm run job`) |
| Op het schema van Claude | | Cal.com, replies, sequences, instroom en ICP-oordeel, zie [claude-jobs.md](./claude-jobs.md) |

S6 (bellijst naar een Google Sheet voor Web Partners), S7 (mailcampagnes in Instantly) en S9 (OnePageCRM) zijn verwijderd: bellers werken op het belscherm met bellijsten in het portaal, sequences vervangen de campagnes en de pipeline vervangt OnePageCRM.

Handmatig draaien kan via Beheer, Jobs, via GitHub (Actions, GTM jobs, Run workflow) of lokaal:

```bash
npm run job -- --help
npm run job -- s2-qualify --limit=10
npm run job -- t2-match --vacancy=<uuid>
```

## Praten met AI (sectie 12)

- **Supabase MCP, alleen lezen.** Koppel de Supabase MCP in claude.ai of Claude Code met de optie read only (bijvoorbeeld `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true`). Schrijven gebeurt alleen via de jobs en het portaal, zodat de data schoon blijft. De rol `gtm_readonly` in de migratie heeft alleen leesrechten, voor wie liever direct met Postgres verbindt.
- **Nordavo MCP.** Voor vragen en acties met de regels van het portaal (wie mag wat, alles gelogd in Activities) gebruik je de MCP van het portaal zelf ([mcp.md](./mcp.md)). De OnePageCRM MCP is niet meer nodig.
- Handige views voor vragen: `appointment_attribution` (welk signaal, segment en kanaal leverde een afspraak op), `call_list_candidates` en `mail_list_candidates` (wie is nu benaderbaar).

## Migratie van de oude Sheets (sectie 13)

1. Exporteer elke leadlijst uit Google Drive als CSV.
2. Importeer per bestand via Beheer, Import. Geef als bron de naam van de sheet op, bijvoorbeeld "Sheet: Dev Data Master".
3. Kolommen met een datum van laatst bellen of mailen worden een activiteit, zodat de geschiedenis in de tijdlijn staat.
4. Een bestand dubbel importeren maakt geen dubbele records of activiteiten.
5. Daarna zijn de Sheets alleen nog archief.

## Open vragen uit de briefing

Deze punten zijn in de code als aanname vastgelegd en moeten nog worden bevestigd:

1. **Wat is een gekwalificeerde afspraak?** Nu: een afspraak telt mee zodra hij geboekt is; `afspraak_goedgekeurd` / `afspraak_afgekeurd` leggen de beoordeling na de call vast.
2. **Seleqt.** Het portaal is niet zelf gekoppeld; Claude haalt de LinkedIn replies op en zet LinkedIn stappen klaar via zijn eigen connector ([claude-jobs.md](./claude-jobs.md)).
3. **Web Partners.** Bellers werken in het portaal op het belscherm; de afsprakensheet (S8) kan nog worden ingelezen zolang die in gebruik is.
4. **Volume per week.** Elke job heeft een `--limit`; begin klein en schaal op.
5. **CV-tekst.** De matching leest de velden van de kandidaat en het veld CV text; een geüpload cv-bestand wordt niet uitgelezen. Plak de tekst van het cv bij de kandidaat.
6. **Opmaak van een Nordavo profiel.** Er is een eerste opmaak in Nordavo-stijl; pas die aan in `src/lib/talent`.
7. **Wie keurt profielen goed?** Elke teamgebruiker kan goedkeuren; wie het deed wordt vastgelegd.
8. **Toestemming.** De kandidaat heeft een veld voor toestemming om een anoniem profiel te delen (onbekend, ja, nee). Is het onbekend, dan bevestigt een teamlid het per profiel; "nee" blokkeert versturen.
9. **Naukri en LinkedIn Recruiter.** T3 maakt zoekopdrachten om te kopiëren; er is geen directe koppeling.
10. **Payslips.** Niet in het systeem.
11. **Beheer na oplevering.** Nog te beslissen.
