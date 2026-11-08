# Werving: pipeline, parkeren, notities, beoordelen en toppers

Dit document hoort bij de wervingsbrief van 8 november 2026, onderdelen 2.1 tot en met 2.4, 2.12 en 2.13.
Migratie: `supabase/migrations/20261108010000_recruitment_pipeline.sql` (bouwt op de foundation migratie
`20261108000000_recruitment_foundation.sql`). SQL test: `supabase/tests/recruitment_pipeline.test.sql`.

## Voor het team

### Het bord (Vacancy, Open pipeline)

* De kolommen volgen de nieuwe fases: Sourced, Techstack check, Fill out, Video review, Technical test,
  Interview, Matched to client, Client interview, Final screening en Placed.
* **Parked** en **Rejected** staan los van de flow, rechts achter een streep. Ze zijn ingeklapt tot je ze
  nodig hebt. Elke kaart daar laat de reden zien, de fase waar hij uit kwam ("Left at Video review") en bij
  parkeren de datum om opnieuw te kijken. Met **Resume** gaat de kaart terug naar die fase.
* **Veel tegelijk verplaatsen.** Vink kaarten aan. Met het vinkje in de kolomkop selecteer je de hele
  kolom, met Shift ingedrukt selecteer je alles tussen de vorige en deze kaart. Onderin verschijnt een balk:
  Move to stage, Park, Reject, Resume en Clear.
* **Parkeren is net zo makkelijk als afwijzen.** In het menu van elke kaart (Move to) staan Park en Reject,
  en ook in de balk en in het kaartvenster. Beide openen hetzelfde venster: een reden (niet verplicht) en bij
  parkeren een optionele datum "Look again on". Slepen naar Parked of Rejected opent dat venster ook.
* Slepen van één kaart werkt zoals voorheen.
* **Zoeken, sorteren en filteren** boven het bord: op naam, titel of skill, sorteren op CV score, video
  score, test score of tijd in de pipeline, filteren op headhunted of gesolliciteerd, op bron, op shortlist en
  op toppers. Zolang er gesorteerd of gefilterd wordt staat slepen uit; Move to en de vinkjes werken wel.
* Op de kaart: ster voor een topper, Headhunted, de bron, of het form verstuurd of ingevuld is, shortlist,
  background check status, CV score (met oordeel), video score, test score en een gepland interview.
* De teller "x of 3 presented" telt iedereen die de klant gezien heeft: Matched to client of later, ook als
  die kandidaat daarna geparkeerd of afgewezen is.

### Het kaartvenster

Klik op een naam. Bovenin staan stage, topper, herkomst, bron, CV score, form en het geplande interview,
met knoppen voor shortlist, Park, Reject en Resume. Daaronder vier tabbladen:

* **Assessment**
  * Video review: score 0 tot 100 en notities. Wie en wanneer wordt bewaard.
  * Screening call: per tool de jaren ervaring (bijvoorbeeld Clay 2, n8n 2, Python 4), een
    communicatiescore en notities.
  * Interview: interviewer (iemand van het team of iemand anders op naam), datum, beoordeling 1 tot 5,
    feedback op communicatie en op het LinkedIn profiel.
  * Technical test: de uitslag (score, notities, optioneel een link) en een bestand met het resultaat. De
    test zelf gebeurt in andere software.
* **Notes**: een notitie met een soort (call, screening call, video review, interview, client feedback,
  background check, note). De fase waarin de kandidaat staat wordt automatisch vastgelegd. Notities staan
  gegroepeerd per fase.
* **Background check**: status (not started, requested, passed, failed), notities en het rapport van de
  externe partner als bestand.
* **Client and notes**: het oordeel van de klant, algemene notities en de reden van parkeren of afwijzen.

### Kandidaatpagina

* Blok **Topper and parking**:
  * **Mark as topper** met een korte reden. Wie en wanneer wordt vastgelegd. De markering blijft op de
    kandidaat staan, ook voor volgende vacatures. Met Remove mark gaat hij eraf.
  * **Park candidate** met een reden. Heeft de kandidaat actieve sollicitaties, dan kun je die in één keer
    mee parkeren (met een optionele datum om opnieuw te kijken). **Unpark** zet de status terug: In process
    als er nog een actieve sollicitatie is, anders Available. Geparkeerde kaarten haal je terug met Resume op
    het bord.
* Blok **Notes per stage**: een notitie over de kandidaat in het algemeen of over één vacature. Bij een
  vacature wordt de fase daar vastgelegd. Alle notities staan per fase gegroepeerd, met de vacature erbij.

### Kandidatenlijst

Een ster bij toppers en het filter **Toppers only** (op de telefoon een chip).

### Vacaturepagina

Blok **Park this vacancy**: parkeren met een reden (status On hold, getoond als Parked, met datum). Met
**Unpark** gaat de vacature weer open. Het bord laat een melding zien zolang de vacature geparkeerd is.

### Claude (MCP)

Met een token met schrijfrechten (Settings) kan Claude:

* `move_candidates`: kandidaten van één vacature in één keer verplaatsen naar een fase, parkeren (reden,
  optioneel `park_until`), afwijzen (reden) of terugzetten (`resume`). Op application ids, of op candidate
  ids voor die vacature. Ids die niet op die vacature staan komen terug in `not_found`.
* `mark_topper`: toppers markeren met een reden, of de markering weghalen.

De leestools `get_vacancy`, `get_candidate` en `list_candidates` geven nu ook de fase, herkomst, bron,
form status, CV, video, test en interview scores, de screening tools, shortlist, background check, topper
en de parkeer of afwijsreden met de fase die verlaten werd. `list_candidates` heeft `toppers_only`.

## Techniek

### Database

* `application_assessments` (een rij per sollicitatie, alleen staff via RLS): video review door en op,
  screening call (`screening_tools` jsonb, gecontroleerd door `valid_screening_tools()`: een array van
  maximaal 30 `{tool, years}` met years 0 tot 50), interview, technical test (`test_url` alleen http of
  https).
* Bestaande scores blijven werken: `applications.technical_score` volgt `test_score` (trigger) en
  `applications.english_score` volgt `video_score` (trigger). Het klantportaal toont die twee. Bij de
  migratie zijn bestaande technical scores als test score overgenomen en English scores als video score.
* `candidates.is_topper`, `topper_reason` (verplicht bij een topper), `topper_by`, `topper_at`. Een trigger
  vult wie en wanneer; uitzetten wist alles. `topper_by` heeft bewust geen foreign key, zodat bestaande
  `owner:profiles(...)` embeds niet dubbelzinnig worden.
* Triggers zetten `parked_at` bij kandidaten (status parked) en vacatures (status on_hold) en wissen reden
  en datum bij het terugzetten.
* Een notitie op een sollicitatie krijgt automatisch de huidige fase (`notes.stage`).
* `move_applications_as(actor, ids, stage, reason, park_until)`: alleen voor de service role (MCP). Handelt
  namens `actor`, zodat `move_applications()` controleert dat die persoon staff is en de stagegeschiedenis
  die persoon als actor heeft.
* Beveiligingsfix in de bestandspolicy voor klanten: de foundation keek met de rechten van de klant in
  `attachments`, die klanten niet mogen lezen, waardoor een background check of payslip in de map van de
  kandidaat toch te openen was. Nu kijkt `is_restricted_attachment()` (security definer) naar de soort.
  Klanten openen alleen het CV.
* Bestanden van een sollicitatie (background check rapport, test resultaat) staan in de private bucket
  `attachments` onder `application/<id>/...` en zijn alleen voor staff, via signed URLs van 60 seconden.

### Code

* Bord: `src/components/pipeline/*` (bord, kaart, kolom, filters en bulkbalk, park/reject venster,
  kaartvenster, assessment, notities, bestanden), pagina `src/app/dashboard/vacancies/[id]/pipeline/`.
* Server actions: `pipeline/actions.ts` (slepen, volgorde) en `pipeline/recruitment-actions.ts` (bulk
  verplaatsen via `move_applications`, assessment, shortlist, background check, notities, bestanden,
  toppers), `candidates/[id]/park-actions.ts`, `vacancies/[id]/park-actions.ts`.
* Pure logica (filters, sorteren, selectie, screening tools, bulk request): `src/lib/recruitment/pipeline.ts`,
  getest in `tests/pipeline.test.ts`.
* MCP: `src/lib/mcp/write-tools.ts` (`move_candidates`, `mark_topper`), `src/lib/mcp/tools.ts`.
* Tellingen: dashboard (candidates in selection, pipeline funnel) en vacaturesamenvatting tellen Parked
  apart van de flow, net als Rejected.

### Env vars en handmatige stappen

* Geen nieuwe env vars.
* Migratie draaien: `supabase db push` (of de migratie in de SQL editor), daarna eventueel
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recruitment_pipeline.test.sql`.
* Voor Claude: een MCP token met schrijfrechten aanmaken onder Settings om `move_candidates` en
  `mark_topper` te gebruiken.

### Bekende grenzen

* Klanten kunnen voor voorgedragen kandidaten de rij `applications` lezen, inclusief interne kolommen zoals
  `video_notes`, `rejection_reason` en `background_check_notes` uit de foundation (het portaal selecteert ze
  niet, maar RLS werkt per rij). Gestructureerde assessments staan daarom in een aparte tabel die klanten
  niet zien. Een aparte client view voor `applications` zou dit helemaal dichtzetten. Hetzelfde geldt voor
  `candidates.topper_reason` en `park_reason` op de rij van een voorgedragen kandidaat.
* Sorteren binnen een kolom gebeurt alleen in de weergave; de volgorde op het bord verandert niet.
