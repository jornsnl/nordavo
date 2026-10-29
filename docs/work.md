# Work: de eigen takentool (vervanger van ClickUp)

Work staat op `/work` en doet wat we ClickUp in de praktijk lieten doen: opdrachten uitzetten, voortgang volgen en werk reviewen. Freelancers werken mee in afgeschermde projecten. De oorspronkelijke briefing staat in [work-briefing.md](work-briefing.md).

Het grootste probleem dat het oplost: taken bleven op Review hangen omdat de reviewer geen seintje kreeg. In Work gaat er een mail naar de reviewer op het moment dat een taak naar Review gaat, en heeft de reviewer een eigen tabblad *To review* met een teller in het menu.

De interface is Engels (team in Nederland en Bangalore, freelancers overal). Taken zelf mogen in elke taal.

## Wat zit erin

| Onderdeel | Route | Wat het doet |
| --- | --- | --- |
| My overview | `/work` | Over alle workspaces heen: *My tasks* (gegroepeerd per workspace en project, op deadline), *To review*, *Today and overdue*. Filters op workspace, project, status en prioriteit. |
| Workspace | `/work/w/<slug>` | Projecten van de workspace, nieuw project |
| Project | `/work/projects/<id>` | Taken per status, filters op status, eigenaar en prioriteit, nieuwe taak |
| Projectinstellingen | `/work/projects/<id>/settings` | Open of afgeschermd, "guests only see their own tasks", mensen toevoegen en intrekken (met einddatum), gasten uitnodigen, archiveren |
| Taak | `/work/tasks/<id>` | Omschrijving (Markdown), statusknoppen met de reviewregels, eigenaren, reviewer, prioriteit, deadline, subtaken, bijlagen, opmerkingen met @vermeldingen, activiteitenlog, verplaatsen, dupliceren, archiveren |
| Beheer | `/work/w/<slug>/admin` | Leden en gasten, rollen, einddatum van toegang, deactiveren met overdracht van open taken, uitnodigingen, toegangslog, export |
| Prullenbak | `/work/w/<slug>/trash` | Gearchiveerde taken, 30 dagen terug te zetten |
| Quick log | `/work/log` | In één stap afgerond werk loggen als afgeronde taak |
| Search | `/work/search` | Titel, omschrijving en opmerkingen, binnen wat je mag zien |
| Settings | `/work/settings` | Naam, tijdzone, welke mails je krijgt, API tokens |
| Inloggen | `/work/sign-in` | Google of een inloglink per mail |
| Uitnodiging | `/work/invite/<token>` | Landt na inloggen direct in de juiste workspace of het juiste project |
| API | `/api/work/v1` en `/api/work/mcp` | REST en MCP voor Claude en automatiseringen, met de rechten van de gebruiker |

## Structuur en rollen

Workspace → Project → Taak → Subtaak (één niveau).

| Rol (per workspace) | Ziet |
| --- | --- |
| Admin | Alles in de workspace, ook afgeschermde projecten en de prullenbak |
| Member | Alle open projecten en de afgeschermde projecten waar hij in zit |
| Guest | Alleen de projecten waar hij expliciet in zit. Weet niet welke andere projecten bestaan. Met de projectoptie *guests only see their own tasks* alleen de taken waar hij eigenaar, reviewer of maker van is. |

Eén persoon kan in meerdere workspaces zitten met verschillende rollen, bijvoorbeeld member bij Nordavo en guest bij KG. Mijn overzicht toont dan de taken uit beide.

| Actie | Admin | Member | Guest |
| --- | --- | --- | --- |
| Leden en instellingen beheren | ja | nee | nee |
| Project aanmaken | ja | ja | nee |
| Mensen aan project toevoegen | ja | ja, bij projecten waar hij in zit | nee |
| Gast uitnodigen | ja | ja, in projecten waar hij in zit | nee |
| Taken en subtaken maken | ja | ja | ja, binnen zijn projecten |
| Status, opmerkingen, bijlagen | ja | ja | ja, binnen zijn projecten |
| Naar Done zetten | ja | als reviewer | als reviewer |
| Archiveren | ja | eigen taken | nee |
| Andere mensen zien | ja | ja | alleen mensen in zijn projecten (en admins) |
| Exporteren | ja | nee | nee |

Een workspace aanmaken kan alleen een beheerder van het Nordavo portaal (`profiles.role = 'admin'`), via **New workspace** in de sidebar. Die wordt de eerste admin.

### Statussen en review

To do, In progress, Review, Done, en optioneel Cancelled.

- Naar Review: de reviewer krijgt direct een mail. De reviewer is standaard de maker van de taak.
- Naar Done: alleen de reviewer of een admin. Dat geldt ook via de API.
- Terug uit Review (of Done heropenen): alleen met een opmerking erbij. De eigenaren krijgen een mail.
- Cancelled: de maker, de reviewer of een admin.

## Hoe de rechten zijn afgedwongen

Alles staat in de database ([20261029000000_work.sql](../supabase/migrations/20261029000000_work.sql)), niet alleen in de interface:

- **Lezen** gaat via row level security. De regels staan één keer in het schema `work_private` (`can_view_project`, `can_view_task`, `can_see_user`); de policies roepen ze aan met `auth.uid()`.
- **Schrijven** gaat alleen via de `work_*` functies (security definer), zoals `work_create_task`, `work_set_status`, `work_add_comment`. Ingelogde gebruikers hebben geen insert, update of delete recht op de tabellen zelf, dus die regels zijn niet te omzeilen.
- **Bestanden** staan in de private bucket `work` onder `task/<taak id>/` en volgen de rechten van hun taak. Downloaden kan alleen via `/work/files/<id>`, dat een link maakt die 60 seconden werkt, en alleen voor wie de taak mag openen.
- **De API** draait met de secret key, maar elke lees- en schrijfactie gaat door dezelfde regels voor de eigenaar van het token (`work_api_*` en `p_actor`). `p_actor` doet niets voor een gewone ingelogde gebruiker.
- **Nieuwe accounts** krijgen de rol `external`: alleen Work, geen toegang tot het Nordavo portaal. Een account met inlog via Google van iemand die niet is uitgenodigd ziet dus niets.

De acceptatiecriteria van fase 1 staan als test in [supabase/tests/work_rls.test.sql](../supabase/tests/work_rls.test.sql): de reviewflow van Floris en Judith, een freelancer in één afgeschermd project, iemand in Nordavo en KG, en een gast die via de API of een directe link niets buiten zijn projecten kan openen. Draai de test tegen een database met alle migraties, bijvoorbeeld lokaal na `supabase db reset`:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_rls.test.sql
```

## Inrichten

1. **Supabase in de EU.** Maak het project aan in een EU regio (Frankfurt, `eu-central-1`) op een account van Nordavo, en host de app ook in de EU (bij Vercel de functieregio `fra1`). Code in de repository van Nordavo.
2. **Migratie** `20261029000000_work.sql` uitvoeren (`supabase db push`). Die maakt ook de bucket `work` aan.
3. **Omgevingsvariabelen:** `SUPABASE_SECRET_KEY` (uitnodigen, inloglinks, API, meldingen), `RESEND_API_KEY` en `MAIL_FROM` (alle mails), `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET` (het uurlijkse vangnet voor meldingen). Voor de import: `CLICKUP_API_TOKEN` en eventueel `CLICKUP_IMPORT_MAP`.
4. **Supabase Auth:**
   - Zet onder Authentication > Sign In / Providers **Google** aan (client id en secret uit Google Cloud, met als redirect URI de callback die Supabase toont).
   - Zet **Allow new users to sign up** uit. Uitnodigingen maken het account zelf aan; daarna werken Google en de inloglink voor dat adres.
   - Voeg onder URL Configuration `https://<domein>/auth/callback` en `https://<domein>/auth/confirm` toe aan de Redirect URLs.
   - Alleen als Resend nog niet is ingesteld valt de inloglink terug op Supabase's eigen mail. Zet dan het template *Magic Link* op `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/work`.
5. **Workspaces:** log in als portaalbeheerder, open `/work`, maak **Nordavo** en **KG** aan en nodig de anderen uit via Manage (Floris en Judith als member bij Nordavo, Sabine bij KG).
6. **Geplande jobs:** [.github/workflows/work-jobs.yml](../.github/workflows/work-jobs.yml). `work-daily` om 07:00 (deadlines morgen en verlopen, gasten van wie de toegang binnen 3 dagen afloopt, verlopen toegang in het log, dagelijks overzicht per mail, prullenbak ouder dan 30 dagen legen). `work-notify` elk uur als vangnet voor directe mails; dat roept alleen de draaiende app aan via `POST /api/jobs/work-notify`.

## Meldingen

Mails gaan via Resend. Een wijziging zet een melding klaar in `work_notifications`; de app verstuurt directe meldingen meteen na de wijziging, de job vangt op wat bleef liggen.

| Melding | Standaard |
| --- | --- |
| Taak naar Review (naar de reviewer) | direct |
| Vermelding in een opmerking | direct |
| Taak aan je toegewezen | dagelijks overzicht |
| Nieuwe opmerking op je taak | dagelijks overzicht |
| Taak teruggezet door de reviewer | dagelijks overzicht |
| Deadline morgen of verlopen | dagelijks overzicht |
| Toegevoegd aan een project, of toegang vervalt binnenkort | dagelijks overzicht |

Iedereen kiest per soort zelf: direct, in het dagelijkse overzicht, of uit (Settings). Een mail noemt de taak, het project en wie wat deed, met een link. De tekst van opmerkingen en bijlagen staat er bewust nooit in, omdat die kandidaatgegevens kunnen bevatten. Wie de taak niet meer mag openen, krijgt er ook geen mail meer over.

"Deadline morgen" rekent met de tijdzone van de ontvanger. Deadlines staan in UTC in de database en worden getoond in de tijdzone uit Settings.

## API en Claude

Maak een token aan onder Settings (lezen, of lezen en schrijven; `wrk_...`). Het token werkt in elke workspace waar je in zit, met precies jouw rechten.

REST, met `Authorization: Bearer wrk_...`:

| Methode | Pad | Wat |
| --- | --- | --- |
| GET | `/api/work/v1/me` | Wie ben ik, mijn workspaces en rollen |
| GET | `/api/work/v1/projects?workspace=` | Projecten die ik mag zien |
| GET | `/api/work/v1/tasks?assignee=me&status=&project=&reviewer=me` | Taken |
| POST | `/api/work/v1/tasks` | Taak maken (`project_id`, `title`, en optioneel de rest) |
| GET | `/api/work/v1/tasks/<id>` | Taak met subtaken, opmerkingen en bestanden |
| PATCH | `/api/work/v1/tasks/<id>` | Velden wijzigen, `assignee_ids` vervangt de eigenaren |
| POST | `/api/work/v1/tasks/<id>/status` | `{ "status": "review" }`, terugzetten met `comment` |
| GET/POST | `/api/work/v1/tasks/<id>/comments` | Opmerkingen lezen en plaatsen |

`GET /api/work/v1` geeft dezelfde lijst. Deadlines zijn ISO 8601 in UTC.

Claude Code via MCP:

```bash
claude mcp add --transport http work https://<domein>/api/work/mcp --header "Authorization: Bearer wrk_..."
```

Tools: `whoami`, `list_projects`, `list_tasks`, `get_task`, en met een schrijftoken `create_task`, `update_task`, `set_status`, `add_comment`.

## Migratie uit ClickUp

Eenmalig, met de job `clickup-import`. Die neemt alle open taken en taken op review mee, met omschrijving, subtaken, opmerkingen en bijlagen. Afgeronde taken blijven in ClickUp.

1. Maak eerst de workspaces aan en laat iedereen de uitnodiging accepteren: eigenaren, makers en schrijvers van opmerkingen worden op e-mailadres gekoppeld. Wie niet gevonden wordt, staat met naam in de tekst.
2. Zet `CLICKUP_API_TOKEN` (ClickUp > Settings > Apps > API Token). Een ClickUp workspace wordt gekoppeld aan de Work workspace met dezelfde naam; wijkt die af, zet dan `CLICKUP_IMPORT_MAP`, bijvoorbeeld `{"9012345":"nordavo","9012346":"kg"}`.
3. Proef eerst: `npm run job -- clickup-import --dry-run=true` (telt alleen).
4. Importeer: `npm run job -- clickup-import`. Elke ClickUp lijst wordt een project (open; met `--private=true` afgeschermd). Opnieuw draaien slaat over wat al is geïmporteerd.

Overgang: twee weken parallel draaien, daarna ClickUp alleen nog lezen. Nieuwe taken vanaf de importdag in Work.

## Privacy, backups en export

- Bijlagen alleen via links die 60 seconden werken, voor wie het project mag openen.
- **Export** per workspace als JSON (alles: projecten, taken, eigenaren, opmerkingen, bijlagen als metadata, activiteit, toegangslog) of CSV (één regel per taak), onder Manage. Alleen voor admins.
- **Toegangslog**: wie wanneer werd uitgenodigd, toegang kreeg, verloor of deactiveerde, en wanneer toegang vanzelf verliep.
- **Backups**: Supabase maakt op een betaald plan dagelijks een backup van de database (Pro: 7 dagen bewaard; met Point in Time Recovery fijner). Bestanden in Storage zitten daar **niet** in. Zet daarvoor een dagelijkse kopie van de bucket `work` naar een tweede opslag in de EU op (bijvoorbeeld met `rclone` via de S3 koppeling van Supabase Storage). Dat staat nog niet in deze repository.

## Status per fase

Fase 1 is gebouwd: workspaces, rollen met gasten, open en afgeschermde projecten, taken met subtaken, statussen met review, opmerkingen, bijlagen, Mijn overzicht, projectweergave, mailmeldingen, inloggen met Google of mail, uitnodigen en de ClickUp import.

Van fase 2 is ook al gebouwd: toegang met einddatum, quick log, dupliceren, dagelijks overzicht, meldingsinstellingen, zoeken, API (REST en MCP) en export. Mobiel werkt met een tabbalk en menu zoals de rest van het portaal.

Nog niet: meldingen in Slack, de dagelijkse kopie van bestanden (zie hierboven) en het alleen-lezen zetten van ClickUp na de overgang (een instelling in ClickUp zelf).
