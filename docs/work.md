# Work: de eigen takentool (vervanger van ClickUp)

Work staat op `/work` en doet wat we ClickUp in de praktijk lieten doen: opdrachten uitzetten, voortgang volgen en werk reviewen. Freelancers werken mee in afgeschermde projecten. De oorspronkelijke briefing staat in [work-briefing.md](work-briefing.md).

Het grootste probleem dat het oplost: taken bleven op Review hangen omdat de reviewer geen seintje kreeg. In Work gaat er een mail naar de reviewer op het moment dat een taak naar Review gaat, en heeft de reviewer een eigen tabblad *To review* met een teller in het menu.

De interface is Engels (team in Nederland en Bangalore, freelancers overal). Taken zelf mogen in elke taal.

## Wat zit erin

| Onderdeel | Route | Wat het doet |
| --- | --- | --- |
| My overview | `/work` | Over alle workspaces heen: *My tasks* (gegroepeerd op deadline: Overdue, Today, This week, Later, No date), *To review*, *Today and overdue*. Filters op workspace, project en status, prioriteit als gekleurde chips. Lijst of bord (*List*, *Board*). |
| Workspace | `/work/w/<slug>` | Projecten van de workspace, nieuw project |
| Project | `/work/projects/<id>` | Open taken gegroepeerd op deadline (met *Everything* ook Done en Cancelled), of een bord met een kolom per status. Filters op status en eigenaar, prioriteit als chips, nieuwe taak (teamleden kunnen meteen een record kiezen) |
| Projectinstellingen | `/work/projects/<id>/settings` | Open of afgeschermd, "guests only see their own tasks", mensen toevoegen en intrekken (met einddatum), gasten uitnodigen, archiveren |
| Taak | `/work/tasks/<id>` | Omschrijving (Markdown), statusknoppen met de reviewregels, eigenaren, reviewer, prioriteit, deadline, subtaken, bijlagen, opmerkingen met @vermeldingen, activiteitenlog, verplaatsen, dupliceren, archiveren. Voor teamleden: het gekoppelde record en de primaire contactpersoon |
| Beheer | `/work/w/<slug>/admin` | Leden en gasten, rollen, einddatum van toegang, deactiveren met overdracht van open taken, uitnodigingen, toegangslog, export |
| Prullenbak | `/work/w/<slug>/trash` | Gearchiveerde taken, 30 dagen terug te zetten |
| Quick log | `/work/log` | In één stap afgerond werk loggen als afgeronde taak |
| Search | `/work/search` | Titel, omschrijving en opmerkingen, binnen wat je mag zien |
| Settings | `/work/settings` | Naam, tijdzone (alle IANA zones, met zoeken en per regio), welke mails je krijgt, API tokens |
| Inloggen | `/work/sign-in` | Google of een inloglink per mail. Gasten kunnen de link ook op `/login` aanvragen; teamleden en klanten loggen in met wachtwoord of passkey |
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

### Gasten en freelancers zien alleen Work

Iedereen die je in Work uitnodigt, als admin, member of guest, krijgt in het portaal de rol `external`. Daarmee zie je alleen `/work`: niet het dashboard, niet de klanten, kandidaten, leads of vacatures, en geen andere workspaces. Dat staat niet alleen in de interface, maar wordt afgedwongen in de database (RLS), dus ook via een directe link of de API kom je er niet bij.

Developers en kandidaten van de Academy (portaalrol `developer` of `candidate`) hebben geen Work. Wordt een Work gast developer of kandidaat, dan worden zijn lidmaatschappen gedeactiveerd (in het toegangslog als `deactivated`) en zijn API-tokens ingetrokken; een nieuwe uitnodiging accepteren lukt niet. De database controleert de portaalrol in `work_private.role_in()` (zie `docs/academy.md`, sectie 17).

- Freelancer op één project: nodig uit als **Guest** bij dat project.
- Freelancer op de hele workspace: nodig uit als **Member**. Die ziet alle open projecten van die workspace, en verder niets.

De test [supabase/tests/work_guest_isolation.test.sql](../supabase/tests/work_guest_isolation.test.sql) zet in elke portaaltabel een rij en controleert dat een guest en een member van een workspace er geen enkele kunnen lezen, en alleen hun eigen workspace zien.

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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/work_guest_isolation.test.sql
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
   - Zet eventueel *Email OTP Expiration* (Providers > Email) op 86400, zodat de inloglink in de uitnodigingsmail een dag werkt in plaats van een uur.
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

## Inloggen met een link, tijdzones en portaaltaken

Sinds de migratie `20261108050000_custom_fields_and_extras.sql` (details in [recruitment-extras.md](recruitment-extras.md)):

- **Inloglink alleen voor gasten.** Een inloglink per mail werkt alleen voor accounts met portaalrol `external` (iedereen die alleen Work heeft). Een gast krijgt in de uitnodigingsmail een knop *Sign in and accept* die meteen inlogt en de uitnodiging opent; later vraagt hij een nieuwe link aan op `/work/sign-in` of `/login`. Teamleden en klanten krijgen geen link: zij loggen in met wachtwoord of passkey (en hun authenticator app). `/auth/confirm` logt een link sessie van een teamlid of klant direct weer uit. Inloggen met Google blijft voor iedereen werken zoals hiervoor.
- **Tijdzones.** Settings biedt alle IANA zones (`Intl.supportedValuesOf('timeZone')`), met *Popular* bovenaan, per regio gegroepeerd en met een zoekveld. De server accepteert alleen zones van die lijst; de database controleert ook dat Postgres de zone kent.
- **Portal tasks.** Dit tabblad is weg: de taken van het portaal zijn nu gewone Work taken (zie hieronder).

## Taken en Work samengevoegd (feedback Julius)

Er is nog maar één takenlijst: Work. De module Tasks van het portaal (`/dashboard/tasks`) is weg; oude links sturen door naar `/work`. Migratie `20261110000000_work_records.sql` zette elke portaaltaak om naar een Work taak (`external_source = 'portal_tasks'`, een deadline werd 17:00 Amsterdamse tijd op die dag) en zette `public.tasks` als archief in `archive.tasks`. Migratie `20261110020000_work_record_tasks.sql` voegt de functies toe die het portaal daarnaast nodig heeft.

### Taken op een record

- Een Work taak kan hangen aan een klant, lead (bedrijf), vacature, kandidaat, sollicitatie of plaatsing (`public.work_task_links`, één record per taak).
- **Op de taakpagina** ziet een teamlid met de module van dat record het record (met link), en bij een lead of klant de primaire contactpersoon: naam, functie, mailadres, telefoon en LinkedIn (bij een lead `contacts.is_primary`, bij een klant `client_contacts.is_primary`; de LinkedIn van een klantcontact vul je in op de klantpagina, blok Contacts, en staat in `client_contacts.linkedin_url`). Met *Change or remove the record* kies je een ander record (zoeken per soort record) of haal je de koppeling weg (`work_set_task_link`). Een taak zonder record krijgt daar *Link a record*.
- **Een nieuwe taak** in een project kan meteen een record krijgen (`work_create_record_task` met dat project).
- **Detailpagina's** (klant, lead, vacature, kandidaat, plaatsing): het blok *Tasks* toont de Work taken van dat record, open eerst op deadline en daarna de laatst afgeronde. Snel toevoegen maakt een Work taak in het afgeschermde project *Portal records* van de workspace Nordavo; een deadline als dag wordt 17:00 in jouw tijdzone. Afvinken zet de taak op Done als jij reviewer of admin bent, anders gaat hij naar Review bij de reviewer (de reviewregel van Work blijft gelden). Bij een lead of klant staat de primaire contactpersoon in elke open taak. De titel linkt naar de taak in Work.
- **Activiteit** van een record toont ook het log van de gekoppelde Work taken, en de oude regels van portaaltaken van voor de overgang (ook een oude prioriteit, nu met Urgent erbij).
- **Een record verwijderen** verwijdert ook zijn Work taken (trigger per tabel).
- **Zoeken** (Ctrl K in het portaal) vindt ook Work taken (`work_search`, binnen wat je mag zien).

### Doorzoekbare keuzelijsten

Elke keuzelijst die lang kan worden (klanten, bedrijven, contacten, kandidaten, vacatures, projecten, skills) is een zoekveld (`src/components/ui/search-select.tsx`): typ een deel van de naam en kies. Zo werken onder meer het klantfilter van Placements, de vacature bij een plaatsing, een interview en het rapport, de klant bij een rol of uitnodiging in Instellingen, de vacature in de talentpool, het skillfilter van Candidates, de contactpersoon bij een activiteit, een suppression en een meeting, het projectfilter van Work, het project bij uitnodigen in Work en bij *Log finished work*, en de vacature bij een job of een prompt vergelijken. Korte vaste lijsten (status, prioriteit, rol, het team) blijven gewone keuzelijsten; een filter in Work met meer dan 12 keuzes wordt vanzelf een zoekveld.

### Dashboard en plaatsingen

- *My tasks* op `/dashboard`: jouw open Work taken (waar je eigenaar van bent, alle workspaces), op deadline, met het record als chip. *Open Work* gaat naar `/work`.
- Een nieuwe plaatsing maakt twee Work taken op de plaatsing: *Client check-in* (volgende check-in) en *Guarantee period review* (5 dagen voor het einde van de garantie, hoge prioriteit), met de maker als eigenaar en reviewer.
- Een check-in vastleggen sluit de open check-in taken van die plaatsing met een deadline tot een week na de check-in (`work_close_record_tasks`). Dat mag ieder teamlid met de module Recruitment, ook als iemand anders reviewer is: het is de automatische opvolging, geen goedkeuring van werk. De volgende check-in plannen kan een nieuwe check-in taak maken.

### Prioriteit, groepering en bord

- Elke prioriteit heeft een vaste kleur, overal hetzelfde (`priorityStyles` in `src/lib/sales/labels.ts`): Urgent rood, High oranje, Normal blauw, Low grijs. Als chip in de filters, als chip en linkerrand in lijsten, op kaarten van het bord, op de taakpagina en in het takenblok van een record.
- Groepering op deadline in de tijdzone van de kijker (`src/lib/work/grouping.ts`): Overdue (deadline voorbij), Today, This week (tot en met zondag), Later, No date.
- **Bord** op My overview en de projectpagina: een kolom per status (To do, In progress, Review, Done; Cancelled alleen als er zulke taken zijn). Een kaart naar een andere kolom slepen zet de status via `work_set_status`, dus met de reviewregels: Done alleen door de reviewer of een admin, Review alleen met een reviewer, terug van Review of Done alleen met een opmerking (op de taakpagina). Weigert de database, dan springt de kaart terug en staat de melding erboven. Met de muis via het greepje, op een telefoon lang drukken, met het toetsenbord spatie en de pijltjes.

### Gasten zien geen portaaldata

Gasten en freelancers in Work zien nooit welke klant, kandidaat of lead achter een taak zit:

- `work_task_links` is in de database alleen leesbaar voor teamleden met de module van dat record (RLS); gasten lezen nul rijen.
- De interface laadt het record en de contactpersoon alleen voor teamleden met die module (`src/lib/work/records.ts`) en leest daarbij als de ingelogde gebruiker, nooit met de secret key.
- De REST API en MCP van Work (`/api/work/v1`, `/api/work/mcp`) lezen `work_task_links` niet. Alleen de MCP van het portaal (`/api/mcp`, alleen teamleden) toont het record, beperkt tot de modules van de eigenaar van het token.
- De test `work_guest_isolation.test.sql` controleert dit, en ook dat `work_close_record_tasks` en `work_api_record_tasks` gasten en teamleden zonder de module weigeren.

## Offline

Work werkt ook zonder verbinding, bijvoorbeeld in de trein. Dit is gebouwd voor de telefoon (de app op het beginscherm), maar werkt in elke browser na het eerste bezoek.

### Wat kan zonder verbinding

| Kan offline | Wacht op een verbinding |
| --- | --- |
| Mijn taken, het bord en Quick log openen (de laatste kopie) | Opmerkingen, bestanden, eigenaren, taken verplaatsen tussen projecten |
| Een taak toevoegen (de regel "Add a task") | Het formulier op de taakpagina |
| Starten, terug naar To do, naar review, klaar (actiemenu en bord) | Alle andere onderdelen van het portaal: die tonen de laatste kopie, alleen lezen |
| Prioriteit wijzigen | |

### Hoe het werkt

| Onderdeel | Waar | Wat het doet |
| --- | --- | --- |
| Service worker | `public/sw.js` | Build bestanden en iconen eerst uit de cache. App pagina's altijd vers als er verbinding is; de laatste goede kopie (nooit een redirect naar inloggen, een fout of iets wat geen HTML is) wordt bewaard met de header `x-nordavo-cached-at` en getoond zonder verbinding. Een `warm` bericht bewaart de hoofdpagina's en hun build bestanden vooraf, hoogstens één keer per 5 minuten per pagina; `clear` wist de paginacache. Oude cacheversies gaan weg bij activate |
| Lokale database | `src/lib/offline/db.ts` | IndexedDB `nordavo-offline` met `records` (laatste kopie per `task:<id>`), `meta` (aantal en tijdstip per soort, geweigerde wijzigingen), `outbox` (wachtende wijzigingen in volgorde) en `dirty` (lokaal gewijzigd, nog niet bevestigd) |
| Overlay | `src/lib/offline/overlay.ts`, `useOfflineTasks` | Lijsten en het bord leggen de dirty taken over de serverlijst; taken die hier gemaakt zijn verschijnen meteen, op de plek waar ze horen |
| Versturen | `src/lib/offline/sync.ts` | Elke wijziging gaat via de outbox, die meteen in volgorde wordt verstuurd. Offline, geen antwoord binnen 30 seconden of oudere wijzigingen die nog wachten: de wijziging wacht. Opnieuw bij het `online` event en elke 20 seconden. Geweigerd door de server: uit de outbox en gemeld. Na bevestiging blijft een taak 4 seconden gemarkeerd, zodat de pagina niet terugflitst |
| Server | `src/app/work/sync-actions.ts` | Dezelfde controles en `work_*` functies als online, dus validatie, rechten, het activiteitenlog en meldingen blijven werken. Een update stuurt alleen de gewijzigde velden: wijzigingen aan andere velden van elders blijven staan, bij hetzelfde veld wint de laatste |
| Database | `20261117000000_work_offline.sql` | `work_create_task` neemt het id dat het apparaat koos (`p_id`, idempotent: twee keer versturen geeft één taak). `work_create_task` en `work_set_status` nemen het tijdstip van de offline actie (`p_at`): geldig als het niet in de toekomst ligt en hoogstens 14 dagen oud is, anders geldt nu |
| Indicator | Bovenbalk en menu | Groen vinkje (Synced), spinner (Syncing), Offline met het aantal wachtende wijzigingen, rood voor geweigerde wijzigingen. Tikken toont wat dit apparaat bewaart, welke pagina's offline openen en wat een verbinding nodig heeft |
| Uitloggen | `PwaSupport` | Wist IndexedDB en de paginacache, na een waarschuwing als er nog wijzigingen wachten |

Bij terugkeer naar de app (focus) wordt alleen ververst wat ouder is dan 30 seconden: een geïnstalleerde app krijgt bij elke wissel een focus event.

### Testen

```bash
npm run e2e:build
npm run e2e
```

`tests/e2e/offline.spec.ts` logt in op een productiebuild, wacht tot de service worker de hoofdpagina's heeft bewaard, gaat offline, herlaadt (de pagina opent van het apparaat), maakt een taak en wijzigt taken, gaat weer online en controleert dat alles op de server staat en de indicator "Synced" toont. De database regels staan in `supabase/tests/work_offline.test.sql`.
