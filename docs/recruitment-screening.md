# Werving: kandidaten binnenhalen en screenen

Dit document beschrijft het deel "screening" uit de wervingsbriefing van 8 november 2026: kandidaten inladen (2.6.1, 2.18), veel CV's tegelijk uploaden (2.6.2), aantallen per bron (2.6.3), de techstack check (2.7), CV's scoren en ranken tegen de JD (2.11) en de talentpool vraag aan AI (2.15).

## In het kort

| Onderdeel | Waar in het portaal | Waar in de code |
| --- | --- | --- |
| CSV import in een vacature | Vacature, kaart *Applicants and screening*, **Import candidates** (ook vanaf de pipeline) | `src/lib/screening/candidate-csv.ts`, `src/lib/screening/import.ts`, `src/components/screening/candidate-import-wizard.tsx` |
| Veel CV's uploaden | Vacature, **Upload CVs** | `src/lib/screening/cv-read.ts`, `docx.ts`, `pdf-text.ts`, `cv-text.ts`, `src/components/screening/cv-upload.tsx` |
| CV lezen bij een kandidaat | Kandidaat, kaart *CV screening*, **Read CV** | `readStoredCv` in `src/lib/screening/cv-read.ts` |
| Aantallen per bron en herkomst | Vacature, kaart *Applicants and screening* | `getSourceCounts` in `src/lib/data/screening.ts` |
| Techstack check | Vacature, **Techstack check** | `src/lib/screening/techstack.ts`, `techstack-run.ts`, `src/components/screening/techstack-panel.tsx` |
| CV scoren en ranglijst | Vacature, **CV ranking** (ook vanaf de pipeline en de kandidaat) | `src/lib/screening/scoring.ts`, `score-run.ts`, `src/app/dashboard/vacancies/[id]/ranking` |
| Prompts verbeteren | **CV ranking**, *Prompt versions* (`/dashboard/settings/screening-prompts`) | `src/lib/ai/prompts/screening.ts`, tabel `screening_prompts` |
| Job voor alle CV's | Jobs, `screening-score` | `src/jobs/screening-score.ts` |
| Talentpool vraag | Kandidaten, **Talent pool** (`/dashboard/candidates/talent-pool`) en MCP tool `talent_pool_top` | `src/lib/screening/talent-search.ts`, `src/lib/mcp/tools.ts` |
| Database en rechten | | `supabase/migrations/20261108030000_recruitment_screening.sql`, test `supabase/tests/recruitment_screening.test.sql` |

Alle server acties draaien met de sessie van de gebruiker, dus de RLS in de database bepaalt wat mag. Alles uit dit deel is alleen voor het team (`is_staff()`); prompts bewerken en activeren alleen voor admins (`is_admin()`). Klanten zien niets van scores, checks, eisen of prompts, ook niet bij een voorgedragen kandidaat.

## Kandidaten inladen (CSV)

1. Open de vacature en kies **Import candidates**.
2. Kies een CSV: een export uit LinkedIn, Naukri of Manatal, of een bestaande hiring sheet uit Google Sheets of Excel (Bestand, Downloaden, CSV).
3. Het soort export wordt herkend aan de kolomnamen (bijvoorbeeld `Email ID`, `Phone No` en `Key Skills` is Naukri). Daarbij hoort een voorstel voor de kolommen en een standaard bron. Je kunt het soort export, de bron, de herkomst (*Applied* of *Headhunted*) en elke kolom zelf aanpassen.
4. De preview toont de eerste tien rijen zoals ze worden opgeslagen, met rijen die worden overgeslagen en dubbele rijen in het bestand.
5. **Import** verwerkt het bestand in blokken van 200 rijen. Het rapport telt nieuwe kandidaten, bestaande kandidaten die aan de vacature zijn toegevoegd, en overgeslagen rijen met de reden (geen naam, dubbel in het bestand, al in deze vacature).

Ontdubbelen gebeurt op e-mail (zonder hoofdletters), LinkedIn URL (genormaliseerd) en telefoon (de laatste 10 cijfers, dus `+91 98450 12345` is `09845012345`). Een bestaande kandidaat wordt niet overschreven: alleen lege velden worden aangevuld. Elke kandidaat komt in de fase *Sourced*, met bron en herkomst op de kandidaat (als die nog geen bron had) en op de sollicitatie. De database functie `screening_find_candidates` doet het opzoeken, met RLS.

Oude sheets met de Claude rapporten (2.18): exporteer de sheet als CSV en importeer per vacature. Losse rapporten uit Drive horen bij de kandidaat als bijlage; de scores maak je opnieuw met de CV ranking, zodat ze dezelfde eisen en hetzelfde schema volgen.

## Veel CV's uploaden

Kies **Upload CVs** op de vacature, kies bron en herkomst en sleep de bestanden erin (PDF of DOCX, maximaal 10 MB per bestand, 300 per keer). De browser stuurt ze één voor één naar de server. Per CV:

1. De tekst wordt gelezen. DOCX in code (de zip en de XML, zonder extra pakket; kopteksten eerst, daar staan vaak de contactgegevens). PDF eerst in code; lukt dat niet goed (PDF's met ingesloten fonts geven onleesbare tekst), dan leest Claude de PDF als document.
2. Naam, e-mail, telefoon, woonplaats, functie, jaren ervaring, skills en werkgevers komen van Claude (Haiku, lage effort). Zonder Claude worden e-mail, telefoon, LinkedIn en een naam in de tekst herkend, of de naam uit de bestandsnaam.
3. Is er een kandidaat met dezelfde e-mail, telefoon of LinkedIn, dan krijgt die het CV en worden alleen lege velden aangevuld. Anders komt er een nieuwe kandidaat.
4. Het bestand gaat naar de private bucket `attachments` onder `candidate/<id>/...`, als bijlage van soort `cv`, en wordt het CV van de kandidaat (`cv_path`). De tekst gaat in `cv_text`.
5. De kandidaat komt in de vacature als *Sourced*.

Zonder `ANTHROPIC_API_KEY` werken DOCX en eenvoudige PDF's gewoon. Andere PDF's worden opgeslagen met *Text pending* (`candidates.cv_text_status = 'pending'`). Zodra de sleutel er is, leest de scoring job ze vanzelf, of klik op de kandidaat **Read CV**. Een oud `.doc` bestand kan niet gelezen worden: sla het op als PDF of DOCX.

**Read CV** op de kandidaat leest het geüploade CV opnieuw in `cv_text` (de matching las tot nu toe alleen geplakte tekst).

**CV's uit het sollicitatieformulier** (feedback Julius, 11 november 2026): bij kandidaten uit LinkedIn en Naukri komt het CV pas binnen via het formulier. Direct na het insturen (na het antwoord aan de kandidaat, met `after()`) wordt het CV op dezelfde manier gelezen (`readFormCv` in `src/lib/screening/cv-read.ts`): DOCX en eenvoudige PDF's in code, andere PDF's door Claude (met `ANTHROPIC_API_KEY` direct, anders als verzoek voor `claude-requests`). De job `cv-read` (elk uur, [.github/workflows/cv-jobs.yml](../.github/workflows/cv-jobs.yml), of `npm run job -- cv-read --limit=100`) haalt de CV's in die al een bestand maar nog geen tekst hebben, oudste eerst.

De tekst wordt zo compact mogelijk opgeslagen, zonder inhoud te verliezen (`compactCvText`): spaties en tabs samengevoegd, regels getrimd, hoogstens één lege regel achter elkaar en paginanummers weg. Zo kosten scoren en matchen zo min mogelijk tokens.

## Aantallen per bron

De kaart *Applicants and screening* op de vacature toont het aantal sollicitanten per bron en per herkomst (gesolliciteerd of headhunted), met hoeveel er nog actief zijn. Het rapport per fase (hoe ver elke groep komt) hoort bij de rapportage.

## Techstack check

Kies **Techstack check** op de vacature. Hier staan alle kandidaten in *Sourced* en *Techstack check*.

* **Regels:** de stack en must haves van de vacature, plus een lijst *Excluded profiles* (bijvoorbeeld `Frontend only`, `QA`, `Mobile`) en hoeveel stack skills nodig zijn (leeg: ongeveer de helft van de stack, maximaal 3).
* **Check:** eerst een vaste trefwoordenpas in code op skills, functietitel en CV tekst (met aliassen, zodat `Node` en `Node.js` hetzelfde zijn). Uitkomst per kandidaat: *pass*, *fail* of *unclear* met de reden. Een uitgesloten profiel zonder stack valt af; met wat stack is het *unclear*. Wie geen skills of CV heeft is *unclear*. Optioneel kijkt Claude (Haiku, lage effort) naar de *unclear* gevallen. Het resultaat staat per sollicitatie in `techstack_checks`. De check verplaatst niemand.
* **Review moves:** een bevestigscherm toont hoeveel kandidaten naar *Fill out* gaan en hoeveel naar *Rejected* met welke reden (`Techstack mismatch: ...`). Pas na bevestigen verplaatst `public.move_applications` ze, dus de historie en de status van de kandidaat blijven kloppen. *Unclear* wordt nooit afgewezen; die kun je van *Sourced* naar *Techstack check* zetten voor een mens. Een afgewezen kandidaat haal je terug met *Resume* op de pipeline.

## CV scoren en ranken

Kies **CV ranking** op de vacature.

* **Eisen:** per vacature drie lijsten. *Must have* mag niet ontbreken. *Alternative possible* mag met een alternatief (na een dubbele punt: `BigQuery: Snowflake, Redshift`). *Nice to have* telt mee maar is nooit een reden om af te wijzen. Zolang je niets opslaat, gebruikt de score de must haves (must have), de stack (alternative possible) en de nice to haves van de vacature. Opslaan zet ze in `vacancy_requirements`.
* **Score:** per CV een matchpercentage van 0 tot 100, per eis *met*, *alternative* of *missing* met bewijs uit het CV, en een korte samenvatting. De uitkomst gaat altijd door vaste code: een must have die alleen via een alternatief is gehaald telt als ontbrekend, een ontbrekende must have zet de score op maximaal 49, en het oordeel volgt uit de score (70 of hoger *fit*, 50 tot 69 *maybe*, anders *no fit*). Elke score staat in `cv_scores` met model, promptversie, effort, tokens en kosten; een trigger zet `cv_score`, `cv_verdict` en `cv_scored_at` op de sollicitatie.
* **Ranglijst:** gesorteerd op matchpercentage, met filter op *Fits*, *Maybe*, *Does not fit* en *Not scored*. Ontbrekende must haves staan in het rood. Per kandidaat kun je opnieuw scoren; op de kandidaat zie je de score per vacature.
* **Wat Claude ziet:** de vacature en de CV tekst zonder naam, e-mail en telefoon. Werkgevers blijven staan, die zijn relevant voor het oordeel.

### Geen daglimiet, wel kostenbewust

* Eén klik scoort maximaal 60 CV's (een server actie mag 5 minuten duren). Voor alles: de job `screening-score` op de Jobs pagina of `npm run job -- screening-score [--vacancy=<id>] [--limit=500] [--model=claude-haiku-5-5] [--bulk=true] [--concurrency=4]`, of `POST /api/jobs/screening-score` met `CRON_SECRET`. Zonder vacature scoort de job alle ongescoorde sollicitaties van alle vacatures (niet afgewezen of geplaatst), met maximaal 4 tegelijk.
* **Model per vacature of per run:** `claude-haiku-5-5` (goedkoopst, voor een eerste ronde over veel CV's), `claude-sonnet-5-5` of `claude-opus-5-5` (standaard). Per vacature in te stellen bij de eisen, per run in de knop of met `--model`. Richtprijzen per miljoen tokens: Haiku 5.5 $0.10 in / $0.50 uit, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20.
* **Prompt caching:** de instructies en de vacature (functie, eisen, JD) staan vooraan in een gecachet blok; per CV betaal je alleen het CV en het antwoord volledig. Het eerste CV van een vacature wordt alleen gescoord zodat de cache er staat voordat de rest parallel gaat.
* **Effort:** *Bulk pass* gebruikt lage effort; Haiku altijd laag.
* De prompts pagina toont de kosten van de laatste 30 dagen per model (admins).

### Prompts verbeteren

Op *Prompt versions* (`/dashboard/settings/screening-prompts`):

1. Een admin schrijft een nieuwe versie van de instructies (begint met de actieve tekst). Het antwoordformaat wordt altijd door de code toegevoegd, dat kan niet stuk.
2. **Re-score sample:** kies een vacature met gescoorde CV's en een steekproef (standaard 10). Die CV's worden met die versie opnieuw gescoord als vergelijking (`purpose = 'compare'`); de echte score van de sollicitatie blijft staan.
3. De tabel *Comparisons* zet de huidige score naast de nieuwe, met het gemiddelde verschil en het aantal veranderde oordelen. Kijk vooral naar de veranderde oordelen.
4. **Activate** maakt de versie actief voor nieuwe scores. Zonder actieve versie gelden de ingebouwde instructies (versie 0). Elke score bewaart het versienummer.

## Talentpool vraag

Kandidaten, **Talent pool**: beschrijf een profiel in eigen woorden ("senior data engineer, Python en dbt, Snowflake is een plus") of kies een vacature. Daarna:

1. `t2_candidate_pool` en de T2 voorselectie (stack en senioriteit) beperken de pool. Geplaatste, niet beschikbare en junior kandidaten doen niet mee; bij een vacature ook niemand die al in de pipeline staat.
2. Claude rangschikt de 20 beste met de T2 matchprompt (alleen geanonimiseerde velden) en geeft de top 5 met reden, risico's en ontbrekende must haves.
3. Per kandidaat zie je skills, projectervaring (projecttypes en sectoren), woonplaats, senioriteit, beschikbaarheid en Engels. Een salariswens staat er nog niet bij: die kolom bestaat nog niet op de kandidaat (komt met het formulier, 2.8) en is dan in `hitOf` in `talent-search.ts` toe te voegen.
4. **Create anonymous profile** voor een gekozen vacature: de kandidaat wordt een goedgekeurde match en het bestaande anonieme profiel (T4, met de anonimiteitscheck en de PDF) wordt gemaakt. Goedkeuren en versturen gaat daarna zoals altijd op de vacature, met de toestemmingsregels van T5.

Zonder Claude rangschikt alleen de trefwoordenpas en zegt de pagina dat.

Via MCP stelt Claude dezelfde vraag met de leestool `talent_pool_top` (`profile` of `vacancy_id`, `limit` tot 10).

## Database

Migratie `20261108030000_recruitment_screening.sql`:

* `vacancies`: `excluded_profiles`, `techstack_min_hits`, `screening_model`.
* `candidates`: `cv_text_status` (`pending`, `read`, `failed`), `cv_read_at`, `has_cv_text` (gegenereerd, zodat lijsten de tekst niet hoeven te laden). Indexen op `lower(email)` en de genormaliseerde LinkedIn.
* `vacancy_requirements`: eisen per vacature met soort en alternatieven.
* `techstack_checks`: uitkomst per sollicitatie.
* `screening_prompts`: versies (nummer door de database), één actieve, `activate_screening_prompt(id)` alleen voor admins.
* `cv_scores`: elke score met breakdown, model, promptversie, tokens en kosten; trigger naar de sollicitatie.
* `screening_find_candidates(emails, phone_keys, linkedins)`: opzoeken van dubbelen, security invoker (RLS).

RLS: team leest en schrijft eisen, checks en scores; team leest prompts, admins schrijven ze (de actieve versie kan niet weg); klanten en anonieme gebruikers zien niets.

## Instellen

* `ANTHROPIC_API_KEY`: nodig voor scoren, PDF's met ingesloten fonts, velden uit CV's en de talentpool rangschikking. Zonder sleutel werken import, DOCX, eenvoudige PDF's, de techstack trefwoordenpas en de talentpool op trefwoorden; de rest zegt duidelijk dat Claude ontbreekt.
* `SUPABASE_SECRET_KEY` en `CRON_SECRET`: al aanwezig voor de jobs. Wil je dagelijks scoren, plan `screening-score` in de bestaande scheduler (bijvoorbeeld `.github/workflows/gtm-jobs.yml`).
* Geen nieuwe omgevingsvariabelen. Migratie toepassen met `supabase db push`.

## Niet gebouwd

* Het funnelrapport per bron en per herkomst (hoe ver elke groep komt) hoort bij de rapportage (2.16); de stage history (`application_stage_events`) met `source` en `origin` op de sollicitatie is de bron.
* Een eigen formulierlink voor headhunted kandidaten (2.6.4.2) hoort bij het formulier.
* Excel (`.xlsx`) direct inlezen: sla de sheet op als CSV.
* Oude `.doc` bestanden lezen.
