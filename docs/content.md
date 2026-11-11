# Content: LinkedIn posts van idee tot meting

Content staat op `/content`, naast Work. Het vervangt de Airtable van Julius, waar losse ideeën en echte posts door elkaar stonden, niemand wist welk tekstveld definitief was, feedback in de posttekst stond, goedkeuren een los vinkje was en resultaten nooit werden ingevuld.

In Content is een idee iets anders dan een post, en gaat elke post door één flow die pas eindigt als hij live staat en gemeten is. Elke medewerker heeft een eigen workspace (Julius, Floris, later anderen). Inloggen, gebruikers en accounts zijn dezelfde als in het portaal en Work.

**Ronde twee (feedback Julius, 11 november 2026, migratie [20261121010000_content_reviewer_claude.sql](../supabase/migrations/20261121010000_content_reviewer_claude.sql)):** de reviewer (Sabine) past de tekst direct aan, keurt zelf goed, kan na goedkeuring nog kleine dingen verbeteren zonder dat de post terugvalt, ziet de ideeën en werkt ze uit tot post. Claude mag binnen Content alles zelf, en alles wat iemand wijzigt staat in een activiteitenlog met de bron (persoon of Claude). Posts kunnen worden gearchiveerd. Sabine nodig je uit met de rol *Content only (reviewer)* onder Instellingen, Invite user: een account met alleen Content en een eigen Work inbox, geen sales, kandidaten of klanten.

De interface is Engels, net als Work. Posts zelf mogen Nederlands of Engels zijn. De oorspronkelijke brief staat als feedbacktaak in Athmium; de punten onder "Done when" staan als test in [supabase/tests/content.test.sql](../supabase/tests/content.test.sql).

## Wat zit erin

| Onderdeel | Route | Wat het doet |
| --- | --- | --- |
| Overzicht | `/content` | Je workspaces met buffer en ritme. Voor admins alle workspaces naast elkaar: ritme, buffer en resultaten |
| Idee vastleggen | `/content/capture` | Eén invoerveld, ook op de telefoon (tab *Capture*), met optioneel een tag, link of foto |
| My to do | `/content/review` | Voor de reviewer in één scherm over alle gekoppelde workspaces: in review, klaar om in te plannen, geen URL op de geplande datum, resultaten die nodig zijn, beeldbriefs |
| Workspace | `/content/w/<slug>` | Buffermeter, deze week op schema of niet, waarschuwing voor morgen, snel een idee toevoegen |
| Ideas | `/content/w/<slug>/ideas` | Inbox, Shortlist en Archive; shortlisten, samenvoegen, archiveren, *Turn into post* |
| Posts | `/content/w/<slug>/posts` | Alle posts met status, datum en tijdslot; tab *Archived* voor gearchiveerde posts |
| Post | `/content/w/<slug>/posts/<id>` | Editor met alle velden, LinkedIn preview (mobiel en desktop, met de *see more* afkap), tekenteller, suggesties, opmerkingen op een stuk tekst, statusknoppen, media, beeldsuggesties en beeldbrief, publiceerpaneel, resultaten, archiveren, statusgeschiedenis en activiteitenlog (met een label *Claude* voor wat Claude deed) |
| Versies | `/content/w/<slug>/posts/<id>/versions` | Volledige versiegeschiedenis met vergelijken en terugzetten |
| Calendar | `/content/w/<slug>/calendar` | Week en maand, een post slepen naar een andere dag |
| Media | `/content/w/<slug>/media` en `/content/library` | Mediabibliotheek van de workspace en de gedeelde bedrijfsbibliotheek, met Google Drive sync, filters en *Used in* |
| Sources en Series | `/content/w/<slug>/sources`, `/content/w/<slug>/series` | Bronnen (Reddit, X, nieuws, eigen ervaring) met screenshot; series met voortgang |
| Results | `/content/w/<slug>/results` | Snel invoeren van alle open metingen, dashboard met gemiddelden per hoek, doelgroep, format, thema, tijdslot en serie |
| Reviewer count | `/content/reviewer-count` | Per maand en per workspace het aantal posts dat de reviewer reviewde en publiceerde, als CSV voor haar factuur |
| Settings (workspace) | `/content/w/<slug>/settings` | Algemeen, modules, keuzelijsten, extra velden, statussen en flow, mensen, Google Drive |
| Notifications | `/content/notifications` | Meldingen in de app, ongelezen eerst |
| Settings (persoonlijk) | `/content/settings` | Per melding: in de app, per mail, of allebei |
| Search | `/content/search` | Ideeën en posts op titel, tekst en tags, vanuit één zoekbalk (ook in het menu) |
| Nieuwe workspace | `/content/new` | Alleen portaalbeheerders |

Content staat in het menu van Work en van het portaal. Wie niet is ingelogd gaat naar `/work/sign-in`, zodat een freelance reviewer met een inloglink kan werken.

## Rollen en rechten

| Rol | Wie | Wat |
| --- | --- | --- |
| Admin | Portaalbeheerder (`profiles.role = 'admin'`), bijvoorbeeld Julius | Ziet en beheert alle workspaces, maakt workspaces, beheert mensen, heeft het overzicht van alle workspaces |
| Author | Eigenaar van de workspace | Schrijft en keurt de eigen posts goed, beheert de instellingen van de workspace |
| Reviewer | Bijvoorbeeld Sabine, aan meerdere workspaces gekoppeld | Past tekst en velden direct aan (of stelt voor, met de schakelaar), keurt goed, kiest media, plant in, publiceert en vult resultaten in. Ziet posts vanaf de eerste keer *In review* en de posts die ze zelf begon, en alle ideeën van de workspace; maakt van een idee een post. Met *Admin approval required* keurt alleen een admin goed |
| Viewer | | Alleen lezen |

- Ideeën zijn standaard privé voor de author (en admins en de reviewer).
- Per workspace staat de instelling *Admin approval required* voor nieuwe medewerkers: dan keurt alleen een admin goed.
- Klanten, bellers, developers en kandidaten hebben geen Content. Teamleden en Work accounts (`external`, zoals een freelance reviewer) wel, als ze in een workspace zitten.

Hoe het is afgedwongen staat in [20261120000000_content.sql](../supabase/migrations/20261120000000_content.sql):

- **Lezen** gaat via row level security, met de regels één keer in het schema `content_private`.
- **Schrijven** gaat ook via RLS (per rol), en de triggers op `content_posts` dwingen de statusflow en de veldregels af voor iedereen, ook voor admins en de API. Een post die de reviewer maakt, is van de eigenaar van de workspace.
- **Bestanden** staan in de private bucket `content` en gaan alleen via korte ondertekende links, voor wie de rij mag zien.
- **Claude** schrijft via de `content_api_*` functies als de eigenaar van het token, met bron `claude`.

## Statusflow

Draft → In review → Changes requested → Approved → Scheduled → Published → Measured, plus Parked en Rejected vanuit elke status.

| Regel | Waar |
| --- | --- |
| De author, de reviewer of een admin zet een post op Approved; met *Admin approval required* alleen een admin | trigger |
| Scheduled vraagt Approved, een datum, een tijdslot, en gekozen media als het format dat nodig heeft | trigger |
| Published vraagt goedkeuring en een LinkedIn URL | trigger |
| Measured vraagt de resultaten na 7 dagen | trigger |
| Wijzigt iemand anders dan de author of de reviewer de tekst na Approved, dan gaat de post terug naar Changes requested. De reviewer valt alleen terug als een admin moet goedkeuren | trigger |
| Elke statuswijziging wordt gelogd: wie, wanneer, van, naar, en of het Claude was | `content_status_log` (kolom `source`) |
| Elke wijziging van een post, idee, gekozen media, bestand of resultaat staat in het activiteitenlog, met wie en de bron | `content_activity` |
| Archiveren haalt een post uit de lijsten, de kalender en de controles; verwijderen kan niet | `archived_at` |

Labels, volgorde, wie welke status mag zetten, extra statussen en welke status op welke volgt (de flow) staan in Settings, Statuses and flow. De regels hierboven blijven op de ingebouwde statussen gelden. Admins zijn niet aan de flow gebonden, wel aan de regels.

## Editor en review

- Eén tekst per post (hook, body, slotvraag en eerste reactie), met volledige versiegeschiedenis en vergelijken.
- De reviewer bewerkt de tekst direct; elke opslag is een versie op haar naam, dus onder *Versions* zie je achteraf precies wat ze veranderde (vergelijken en terugzetten). Wie liever voorstelt, zet de schakelaar op *Suggest changes*: die wijzigingen worden losse suggesties die de author per stuk of allemaal tegelijk accepteert of afwijst.
- Opmerkingen op een geselecteerd stuk tekst, met antwoorden en afhandelen. Feedback staat nooit in de tekst zelf.
- LinkedIn preview voor mobiel en desktop met de *see more* afkap (ongeveer 140 en 210 tekens of 3 regels), en een tekenteller tegen de limiet van 3000.

## Meldingen

In de app en per mail; iedereen kiest per soort onder Settings. Een mail noemt de post, de workspace en een link, nooit de tekst zelf.

| Melding | Voor | Wanneer |
| --- | --- | --- |
| Post in review | reviewer | direct |
| Goedgekeurd, klaar om in te plannen | reviewer | direct |
| Geen URL op de geplande datum | reviewer | elk uur, vanaf 18:00 op de dag zelf |
| Resultaten nodig (48 uur en 7 dagen) | reviewer | elk uur |
| Beeldbrief (er is een beeld nodig) | reviewer | direct |
| Changes requested | author | direct |
| Suggesties klaar | author | direct, één per versie |
| Beeldsuggesties klaar | author | direct, één per dag |
| Morgen gepland en nog niet goedgekeurd | author | elk uur, één per dag. Het belangrijkste signaal van het systeem |
| Buffer onder doel | author | één per week |
| Week onder het ritmedoel (deze en volgende week) | author | één per week |
| Volgende idee na publiceren | author | na publiceren |
| Nieuwe opmerking | iedereen in de draad | direct |
| Maandagochtend overzicht: wat gaat deze week live en wat ontbreekt nog | iedereen | maandag 07:00, alleen per mail |

Directe mails gaan meteen na de wijziging uit (`sendContentMailSoon()` in [src/lib/content/notify.ts](../src/lib/content/notify.ts)); de job `content-notify` vangt op wat bleef liggen.

## Modulair

- **Modules** per workspace aan of uit: ideas, series, media library, image suggestions, sources, results, reviewer count. Data blijft staan als een module uit staat.
- **Extra velden** per workspace op posts, ideeën en mediabestanden: tekst, getal, datum, enkele keuze, meerdere keuzes, link, bestand (uit de mediabibliotheek) en relatie (post, idee, serie of bron). Het type ligt vast zodra het veld bestaat.
- **Keuzelijsten** (kanaal, taal, doelgroep, thema, hoek, format, prioriteit, tijdslot, bronplatform): toevoegen, hernoemen, volgorde wijzigen en archiveren. Archiveren houdt de geschiedenis: oude posts houden hun waarde en label. Bij een format staat of het media nodig heeft, bij een tijdslot de tijd en de dagen.
- **Interne events**: de kern schrijft elk nieuw idee, elke nieuwe post, statuswijziging en publicatie in `content_events` (en meldt het met `pg_notify` op het kanaal `content_events`). Een nieuwe module haakt in met `registerContentEventHandler(kind, handler)` in [src/lib/content/events.ts](../src/lib/content/events.ts), zonder de kern te wijzigen. De job `content-notify` draait de handlers. Ingebouwd: na publiceren een melding *What is the next idea?* voor de author.
- **Kanalen** zijn een lijst: een bedrijfspagina of een ander platform past later in hetzelfde model.

## Publiceren en resultaten

Er is bewust geen LinkedIn koppeling. De reviewer plant zelf in of post zelf in LinkedIn:

1. Goedgekeurde posts staan in *Ready to schedule* met datum en tijdslot.
2. Het publiceerpaneel heeft *Copy text* (precies zoals op LinkedIn, met de regeleinden), *Download media* (de gekozen media in de juiste volgorde) en *Copy first comment*, plus een korte checklist.
3. Na inplannen in LinkedIn zet de reviewer de post op Scheduled; staat hij live, dan plakt ze de URL en gaat hij naar Published.
4. Na 48 uur en na 7 dagen vult ze vertoningen, likes, reacties en reposts in, op één scherm voor alle open metingen. Per workspace geldt een succesdrempel (Julius: minstens 20 likes plus reacties): groen of rood per post. Claude kan daarnaast zo vaak als nodig een meting vastleggen (`content_measurements`), zodat je ziet hoe een post zich ontwikkelt.

## Google Drive

De mediabibliotheek importeert en synchroniseert een map in Google Drive, bijvoorbeeld de map van de fotoshoot met de submappen Day 1 en Day 2.

1. Zet `GOOGLE_SERVICE_ACCOUNT_JSON` (het JSON bestand van een Google Cloud service account, op één regel) op de server en in de GitHub secrets. Het is dezelfde variabele als voor Google Sheets.
2. Zet in Google Cloud de **Google Drive API** aan voor het project van dat service account.
3. Deel de map in Drive met het `client_email` adres uit dat JSON bestand (lezen is genoeg).
4. Voeg de map toe onder Settings, Google Drive (of in de bedrijfsbibliotheek), met de id uit de URL van de map. *Sync now* importeert meteen; de job `content-drive-sync` doet het elke ochtend.

## Claude

Julius' eigen Claude werkt via de bestaande MCP server (`/api/mcp`, zie [mcp.md](mcp.md)) met de rechten die het token van de eigenaar in Content heeft. Binnen Content mag Claude alles zelf (feedback Julius): posts aanmaken (ook al gepubliceerde, uit Airtable), alle velden en de status aanpassen, archiveren, media kiezen en in volgorde zetten, foto's in de bibliotheek zetten (ook vanaf een Google Drive link), resultaten vastleggen en ideeën toevoegen en lezen. De suggesties blijven bestaan voor als Claude iets juist wil voorleggen. Hoe ver Claude mag schrijven stelt een admin in per module (Instellingen, *What Claude may do per module*; Content staat op Full write).

Alles wat Claude wijzigt staat in het activiteitenlog van de post met het label *Claude*, en in de versies en het statuslog als *Claude (voor Julius)*, los van wat Sabine of Julius zelf deden.

| Tool | Wat |
| --- | --- |
| `content_list_workspaces`, `content_list_posts`, `content_get_post`, `content_list_media`, `content_list_ideas` | Lezen |
| `content_create_post`, `content_update_post`, `content_archive_post` | Posts met alle velden en de status |
| `content_set_post_media`, `content_add_media`, `content_describe_media` | Media op een post en in de bibliotheek |
| `content_record_results` | Link, publicatiedatum, bereik, likes, reacties en reposts, meerdere keren per post |
| `content_add_idea`, `content_ideas_to_post` | Ideeën |
| `content_suggest_media_description`, `content_suggest_images`, `content_suggest_image_brief`, `content_suggest_text` | Suggesties die een persoon beoordeelt |

## Jobs

[.github/workflows/content-jobs.yml](../.github/workflows/content-jobs.yml):

| Job | Wanneer | Wat |
| --- | --- | --- |
| `content-notify` | elk uur | `content_run_checks` (morgen niet goedgekeurd, geen URL, resultaten nodig, buffer, ritme), event handlers, mails die nog klaarstaan. Roept alleen de draaiende app aan via `POST /api/jobs/content-notify` |
| `content-weekly` | maandag 07:00 | Overzicht per persoon van wat deze week live gaat en wat nog ontbreekt |
| `content-drive-sync` | dagelijks 06:00 | Nieuwe bestanden uit de gekoppelde Drive mappen |

Nodig: `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET` en voor Drive `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Inrichten

1. Migratie `20261120000000_content.sql` uitvoeren (`supabase db push`). Die maakt ook de bucket `content` aan.
2. Log in als portaalbeheerder, open `/content/new` en maak een workspace per medewerker met die medewerker als eigenaar. Elke nieuwe workspace krijgt de standaardstatussen, de flow en de keuzelijsten uit de brief.
3. Voeg onder Settings, People de reviewer toe (een freelancer nodig je eerst uit in Work, zodat er een account is).
4. Zet eventueel *Admin approval required* aan voor nieuwe medewerkers.

## Testen

De regels van de brief staan als test in de database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/content.test.sql
```

| Done when (brief) | In de test |
| --- | --- |
| Een idee wordt nooit een post tot je het omzet | `an idea is not a post`, `post starts as draft`, `idea converted` |
| Sabine ziet in één scherm wat ze moet doen | reviewer ziet posts vanaf In review (`reviewer sees post in review`) en krijgt meldingen |
| Geen live post zonder goedkeuring van de author, geen Published zonder URL | `reviewer approves`, `schedule without approval`, `publish without url` |
| In één oogopslag hoeveel posts klaarstaan en of de week op schema is | `content_run_checks` (buffer en ritme), en de unit tests in `tests/content.test.ts` |
| Floris heeft een eigen workspace en ziet de ideeën van Julius niet | `floris cannot see julius ideas` |
| Een veld, keuze of module toevoegen zonder developer | Settings; de RLS policies voor author en admin |

De pure regels (statusovergangen, diff voor suggesties, LinkedIn afkap, ritme, resultaten) staan in `tests/content.test.ts`, de hulpfuncties van de MCP tools in `tests/content-mcp.test.ts`.

## Wat er (nog) niet is

- Geen LinkedIn koppeling: bewust, de reviewer plaatst zelf.
- Media worden niet automatisch bijgesneden naar 4:5 of vierkant; *Download media* geeft de bestanden zoals ze zijn, in de juiste volgorde.
- Resultaten worden met de hand ingevuld, niet uit LinkedIn gehaald.
