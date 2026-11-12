# Claude Code koppelen (MCP)

Nordavo heeft een eigen MCP server op `/api/mcp`. Daarmee kan [Claude Code](https://code.claude.com) met jouw rechten klanten, vacatures, pipelines, kandidaten, plaatsingen, taken, notities, het activiteitenlog en het sales CRM (bedrijven, contacten, meetings, bellijsten, sequences, replies en cijfers) opzoeken, en met een schrijftoken ook taken en notities aanmaken en alle sales acties doen die de geplande taken van Claude nodig hebben ([claude-jobs.md](./claude-jobs.md)).

- **Transport:** Streamable HTTP, stateless, JSON antwoorden. `POST /api/mcp` voor JSON-RPC; `GET` en `DELETE` geven `405` (geen SSE stream, geen sessies).
- **Authenticatie:** OAuth 2.1 (aanbevolen, zie hieronder) of een persoonlijk token in de header `Authorization: Bearer nrd_...`. Zonder of met een ongeldig, verlopen of ingetrokken token: `401` met `WWW-Authenticate: Bearer resource_metadata="..."`, zodat Claude zelf de OAuth login kan starten.
- **Wie:** alleen het Nordavo team (rol `admin` of `member`). Klantaccounts kunnen geen token aanmaken, en een token stopt met werken zodra de eigenaar geen teamlid meer is.

## Koppelen met OAuth (aanbevolen)

Geen token kopiëren: je logt in bij Nordavo en kiest op een toestemmingspagina *Lezen* of *Lezen en schrijven*.

- **Claude.ai of Claude Desktop:** Instellingen, Connectors, *Add custom connector*, URL `https://<jouw-portaal>/api/mcp`. Laat de OAuth client velden leeg.
- **Claude Code:**
  ```bash
  claude mcp add --transport http --scope user nordavo https://<jouw-portaal>/api/mcp
  ```
  Start daarna `claude`, typ `/mcp`, kies `nordavo` en *Authenticate*.

De browser opent `/oauth/authorize` in het portaal (eerst inloggen als dat nodig is, ook met de tweede stap). Na *Allow access* ga je terug naar de app. De koppeling staat onder Instellingen, *Connected apps*, en is daar los te koppelen.

**Hoe het werkt** (`src/lib/mcp/oauth.ts`, migratie `20261119000000_mcp_oauth.sql`):

| Endpoint | Wat |
| --- | --- |
| `GET /.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728: de MCP server en zijn authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `POST /api/oauth/register` | Dynamic client registration (RFC 7591), alleen public clients (`token_endpoint_auth_method: none`) |
| `/oauth/authorize` | Toestemmingspagina; alleen `response_type=code` met PKCE `S256` |
| `POST /api/oauth/token` | `authorization_code` en `refresh_token` |
| `POST /api/oauth/revoke` | RFC 7009, beëindigt de hele koppeling |

- Redirect URIs: `https`, `http` alleen op localhost (poort mag per login verschillen) en private-use schemes zoals `com.example.app:/cb`.
- Codes zijn 10 minuten geldig en werken één keer. Access tokens (`nrda_...`) een uur, refresh tokens (`nrdr_...`) 90 dagen en ze roteren bij elk gebruik.
- Alleen SHA-256 hashes worden opgeslagen, in `oauth_codes` en `oauth_grants` (één rij per koppeling). Gebruikers lezen en intrekken alleen hun eigen koppelingen; de hashes zijn niet leesbaar via RLS.
- Een token stopt met werken zodra de eigenaar geen teamlid meer is, net als persoonlijke tokens. De rechten (`read` of `write`) kiest de gebruiker op de toestemmingspagina; `scope=write` van de app zet alleen de voorkeuze.

## Instellen met een persoonlijk token

Dezelfde stappen staan in het portaal onder **Instellingen, Claude Code koppelen (MCP)**.

1. **Installeer Claude Code**, zie [code.claude.com/docs](https://code.claude.com/docs/en/setup), bijvoorbeeld:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. **Maak een token aan** onder Instellingen. Geef het een naam (bijvoorbeeld je laptop), kies de rechten (*Lezen* of *Lezen en schrijven*) en de geldigheid (30, 90 of 365 dagen, of nooit). Het token wordt maar één keer getoond; kopieer het meteen.
3. **Koppel Nordavo** in je terminal:
   ```bash
   claude mcp add --transport http nordavo https://<jouw-portaal>/api/mcp --header "Authorization: Bearer nrd_..."
   ```
   Met `--scope user` (na `--transport http`) werkt de koppeling in al je projecten; zonder geldt ze alleen voor de huidige map. Na het aanmaken toont het portaal dit commando kant-en-klaar met je token erin.
4. **Controleer** in Claude Code met `/mcp`: `nordavo` staat erbij als connected, met de tools. Buiten Claude Code kan het met `claude mcp list`.
5. **In een repository, zonder het token te committen:** zet een `.mcp.json` in de root en lees het token uit een omgevingsvariabele:
   ```json
   {
     "mcpServers": {
       "nordavo": {
         "type": "http",
         "url": "https://<jouw-portaal>/api/mcp",
         "headers": { "Authorization": "Bearer ${NORDAVO_MCP_TOKEN}" }
       }
     }
   }
   ```
   Zet daarna `export NORDAVO_MCP_TOKEN=nrd_...` in je shellprofiel. Iedereen in het team gebruikt zo zijn eigen token.

**Voorbeeldvragen**

- Welke vacatures staan langer dan 3 weken open en hebben nog geen 3 voorgestelde kandidaten?
- Geef me de pipeline van de vacature Senior React Developer bij Acme.
- Zoek beschikbare kandidaten met Python en minstens 5 jaar ervaring.
- Welke van mijn taken zijn te laat of moeten deze week af?
- Wat is er de afgelopen week gebeurd bij klant Acme?
- Hoeveel calls, bereikt en meetings hadden we deze week, en per beller?
- Welke bedrijven staan op Ready met prio 1 en een telefoonnummer?
- Maak een taak voor mij om vrijdag de check-in met Priya te plannen *(schrijfrechten)*.
- Zet Acme in de pipeline op Lost met als reden "zelf aangenomen" *(schrijfrechten)*.

**Veilig gebruiken**

- Een token geeft toegang met jouw rechten: wie het heeft, ziet wat jij ziet.
- Deel je token nooit, ook niet met collega's, en zet het nooit in code, een repository of een chat.
- Kwijt of gelekt? Trek het meteen in onder Instellingen (*Intrekken*) en maak een nieuw.
- Kies *Lezen*, tenzij schrijven echt nodig is, en een zo kort mogelijke geldigheid.

## Tools

Lijsten geven standaard 25 en maximaal 100 rijen, met `offset` om te bladeren. Resultaten zijn compacte JSON met ids en links naar het portaal. Datums zijn `YYYY-MM-DD` in Europe/Amsterdam.

### Lezen (elk token)

| Tool | Wat het doet |
| --- | --- |
| `whoami` | Eigenaar van het token, rol, rechten (`read`/`write`) en de datum van vandaag |
| `search` | Zoeken op naam of titel in klanten, vacatures, kandidaten, plaatsingen (op kandidaatnaam), GTM bedrijven en GTM contacten |
| `list_clients` / `get_client` | Klanten; detail met contactpersonen, vacatures, plaatsingen en laatste notities |
| `list_vacancies` / `get_vacancy` | Vacatures (standaard open en on hold) met dagen open en pipeline-omvang; detail met profiel en pipeline per fase, scores en klantbeslissing |
| `list_candidates` / `get_candidate` | Kandidaten (zoeken op naam, functie en skills); detail met skills, sollicitaties, plaatsingen en notities |
| `list_placements` | Plaatsingen (standaard actief en opgezegd) met tarief, garantie en volgende check-in |
| `list_custom_fields` | De eigen velden per soort record (kandidaat, vacature, klant, plaatsing, sollicitatie, bedrijf, contact): sleutel, naam, type, opties, hulptekst en het blok op de pagina. De `get_*` en `list_*` tools van kandidaten, vacatures, klanten en plaatsingen (en de pipelinekaarten in `get_vacancy`) geven de waarden als `custom_fields` |
| `list_tasks` | Work taken die de eigenaar van het token mag openen, op deadline, met eigenaren, reviewer, workspace, project, type, labels, startdatum, schatting, het gekoppelde record (`linked`: type, id, naam, link) en een link naar de taak in Work. Filters `mine` (eigenaar), `status` (`open` is `todo`, `in_progress` of `review`; verder `todo`, `in_progress`, `review`, `done`, `cancelled`, `all`), `due` (`overdue`, `today`, `week`, `none`), `workspace_id`, `project_id` (of `inbox`) en een gekoppeld record (`entity_type` met `entity_id`). `due_at` is UTC, `due_date` de dag in Europe/Amsterdam. `has_more` zegt of er een volgende pagina is |
| `list_work_projects` | De workspaces en projecten waar de eigenaar taken in kan zetten: eerst de inbox, dan de privé workspaces, dan de gedeelde (Nordavo, KG), met het aantal open taken |
| `get_activity` | Activiteitenlog van één record (inclusief pipeline en het log van de gekoppelde Work taken) of van het hele portaal; met `entity_type` `task` het log van één Work taak |
| `talent_pool_top` | De beste kandidaten uit de talentpool voor een profiel in vrije tekst of een vacature, met reden, skills, projectervaring en woonplaats (zie [recruitment-screening.md](./recruitment-screening.md)) |

### Sales lezen (elk token, eigenaar met de module Sales)

| Tool | Wat het doet |
| --- | --- |
| `list_companies` | Bedrijven met leadstatus, fase, prio, categorie, ICP, eigenaar, partner en volgende actie. Filters: `lead_status`, `pipeline_stage`, `in_pipeline`, `prio`, `category`, `icp`, `text`, `has_phone`, `owner_id`, `partner_id` |
| `get_company` | Eén bedrijf met alle velden van het CRM (ook openingszin, red flags, algemeen nummer), contacten (rol main, backup of extra, tier, status, LinkedIn link en member id), vacatures en signalen (link, tekst, `online_since`, `days_open`, gesloten), `possible_duplicates`, de laatste activities, meetings, sequences en notities |
| `list_contacts` | Contacten met rol, tier, status, primair, telefoon, mail, LinkedIn link en member id, pogingen en terugbeldatum. Filters op status, rol, bedrijf, leadstatus van het bedrijf, `has_phone`, tekst en `linkedin_broken` (Apify links die vroeger in kleine letters zijn opgeslagen) |
| `list_meetings` | Het meetingregister met status, datum, beller, tarief en Cal.com uid |
| `list_call_lists` | Bellijsten met voor welke bellers ze open staan, tot wanneer en in welke volgorde, plus de bellers |
| `list_sequences` / `get_sequence` | Sequences met stappen, goedgekeurde teksten, concepten en inschrijvingen met hun taken |
| `list_sequence_tasks` | Open stappen van lopende sequences met de goedgekeurde tekst, het bedrijf en het contact, om ze in Instantly en Seleqt klaar te zetten |
| `list_replies_to_review` | Replies die op Julius wachten, met de tekst en het voorstel van Claude |
| `sales_stats` | Cijfers: bedrijven per leadstatus en fase, en per periode calls, bereikt, mails, replies, meetings, fees en per beller (zie [sales.md](./sales.md)) |
| `list_job_runs` | Runs van de jobs en van de geplande taken van Claude (`triggered_by` `claude`) |
| `list_campaigns` / `get_campaign` | Lopende campagnes in Instantly (mail) en Seleqt (LinkedIn) met hun leads, status per lead en wie replyde |
| `get_occupancy` | Per bedrijf de bucket, of het vrij is, en in welke campagne, bellijst of sequence het zit of zat (kanaal, sinds, tot, reply) |
| `list_incoming` | Binnengekomen: per bucket hoeveel, per bronlijst hoeveel nog zonder bestemming, en de leads zelf |
| `list_followed_companies` | Gevolgde bedrijven met eigenaar en bekende vacatures, voor de taak `claude-followed` |

### Schrijven (alleen tokens met *Lezen en schrijven*)

| Tool | Wat het doet |
| --- | --- |
| `create_task` | Work taak aanmaken in een gekozen project (`project_id`, ook een privé workspace, of `inbox`). Zonder project: met een record (`entity_type`: `client`, `company` (lead), `vacancy`, `candidate`, `application` of `placement`, met `entity_id`) in het afgeschermde project *Portal records*, anders in de inbox van de eigenaar van het token. Prioriteit `low`, `normal`, `high` of `urgent`; `due_date` wordt 17:00 Amsterdamse tijd (of een exacte `due_at`). Ook eigenaren (`assignee_ids`), reviewer, type, labels, startdatum en schatting. Standaard is de eigenaar van het token reviewer en eigenaar |
| `update_task` | Een bestaande taak aanpassen: titel, omschrijving, deadline, eigenaren (vervangt ze), reviewer, prioriteit, type, labels, startdatum, schatting, en verplaatsen naar een ander project (`project_id`; uit de inbox of een privé workspace ook naar een andere workspace). Gaat via `work_update_task`, `work_set_assignees` en `work_move_task`, dus met de rechten en het takenlog van Work |
| `update_task_status` | Status van een Work taak zetten: `todo`, `in_progress`, `review` of `done`. De reviewregels van Work gelden: Done alleen door de reviewer of een admin, Review alleen met een reviewer, terug van Review of Done alleen met `comment` |
| `add_task_comment` | Een reactie op een taak, met @vermeldingen (`mention_ids`), via `work_add_comment` |
| `add_note` | Notitie toevoegen aan een klant, vacature, kandidaat, sollicitatie, plaatsing of GTM bedrijf |
| `set_custom_fields` | Eigen velden van één record invullen of wissen (`null`), op sleutel of exacte naam, met dezelfde controle als het portaal (type, opties, gearchiveerd). Module Recruitment |

### Sales schrijven (tokens met *Lezen en schrijven*, eigenaar met de module Sales)

| Tool | Wat het doet |
| --- | --- |
| `update_companies` | Openingszin, red flags, algemeen nummer, wat ze doen, LinkedIn pagina, leadstatus, fase (Lost met reden), prio, categorie, eigenaar, partner, volgende actie, pin en handmatige volgorde van een of meer bedrijven |
| `update_contacts` | Status, rol (`main`, `backup`, `extra`), tier, primair, functie, telefoon, mail, LinkedIn (precies zoals gegeven, met https://), LinkedIn member id, terugbeldatum, beller en notitie van een of meer contacten |
| `update_signals` | Vacatures corrigeren: datum online (`posted_at`), link, tekst, titel, role group of offline (`closed`) |
| `merge_companies` / `merge_contacts` | Twee dubbele bedrijven of contacten samenvoegen zonder iets te verliezen (zie [sales.md](./sales.md#dubbelen-samenvoegen)) |
| `log_activity` | Een contactmoment of reply, bijvoorbeeld uit Instantly of Seleqt, met `external_id` tegen dubbelen. Met `review` en een `suggestion` wacht een reply op Julius |
| `create_meeting` | Een meeting, bijvoorbeeld een Cal.com boeking, met de booking uid als `external_id` |
| `update_meeting` | Na het gesprek: status (`held`, `approved`, `rejected`, `no_show`, `cancelled`, of terug naar `planned`) met een reden of notitie, en de fee. Goedkeuren, afkeuren en de fee alleen als de eigenaar admin is, net als in het portaal. Het bedrijf gaat mee naar de juiste fase (`meetings_after_change`), de notitie staat op de meeting en op de activity van de statuswijziging, met bron `claude` (`sales_update_meeting`) |
| `add_company` | Eén bedrijf dat niet uit Apify of Prospeo komt, met de herkomst (`origin`: `inbound`, `linkedin`, `partner`, `network`), een `source_note`, eventueel de `partner_id`, en `opening_line`, `red_flags` en `general_phone` als eigen velden. Ontdubbeld zoals `upsert_companies`; contacten kunnen mee. Het antwoord noemt `possible_duplicates` |
| `add_contact` | Een contact aan een bestaand bedrijf: naam, functie, tier, mail, telefoon, LinkedIn, LinkedIn member id, rol (`main`, `backup`, `extra`) en hoofdcontactpersoon. Dezelfde LinkedIn link (in welke schrijfwijze ook) of hetzelfde member id (overal), of hetzelfde mailadres of dezelfde naam bij dit bedrijf, is dezelfde persoon: die wordt aangevuld, nooit overschreven |
| `open_list_for_callers` / `close_list_for_callers` | Een bellijst open of dicht zetten voor bellers, met einddatum en volgorde. Alleen als de eigenaar van het token admin is |
| `upsert_companies` | Nieuwe bedrijven met vacatures (elk met eigen link, `posted_at` en tekst) en beslissers (rol, tier) uit Apify of Prospeo. Ontdubbeld op genormaliseerd domein (ook de domeinen van samengevoegde bedrijven), daarna op de LinkedIn pagina; bekende bedrijven worden aangevuld, nooit overschreven. Een bedrijf zonder website en LinkedIn, of een vacature met een link die geen webadres is, staat met de reden in `results` (`error`, `signals_failed`); de rest wordt opgeslagen |
| `set_icp_verdict` | ICP-oordeel, score, reden, prio, categorie en openingszin; de leadstatus volgt (Ready, Review of No go) |
| `draft_sequence_text` | Een concept voor een stap van een sequence, via `sales_draft_step` en dus in Activities op de sequence met bron `claude`; Julius keurt goed in het portaal |
| `start_sequence` | Een actieve sequence starten voor een of meer bedrijven |
| `update_sequence_tasks` | Mail en LinkedIn stappen afvinken als klaargezet in Instantly of Seleqt, of overslaan |
| `pause_company` | Een bedrijf overal pauzeren na een reply: sequences op pauze, open belstappen vervallen |
| `upsert_campaign` | Een campagne van Instantly of Seleqt aanmaken of bijwerken op `external_id`: naam, kanaal, status. Klaar zetten (`finished`) maakt leads zonder reply weer vrij |
| `register_campaign_members` | Wie in een campagne zit en wie replyde (op contact, bedrijf of mailadres). Een lead in een andere lopende campagne wordt geweigerd en genoemd, tenzij `force` |
| `triage_leads` | Leads naar één bestemming: `find_number`, `call` (bellijst of beller), `mail_campaign`, `linkedin_campaign`, `parked` (datum), `no_go` (reden), `incoming`, `free` |
| `follow_company` | Een bedrijf volgen of ontvolgen voor nieuwe dev en data vacatures |
| `log_job_run` | Het begin en einde van een run van een geplande taak loggen (`claude-...`), zichtbaar op Beheer, Jobs. Ook voor een eigenaar met alleen Recruitment, dan alleen `claude-match` en `claude-screening` |

### Matchen en screenen (eigenaar met de module Recruitment)

Het portaal roept hiervoor geen Claude API aan (geen `ANTHROPIC_API_KEY` nodig): Claude doet het oordeel zelf in de geplande taken `claude-match` en `claude-screening` ([claude-jobs.md](./claude-jobs.md)). Het portaal doet wat elke keer hetzelfde moet: de voorselectie, namen en contactgegevens weglaten, de must have grens, het verdict en de fase.

| Tool | Wat het doet |
| --- | --- |
| `list_match_requests` | Vacatures waarvoor iemand *Ask Claude to match* indrukte (lezen) |
| `get_match_pool` | De vaste eisen en de voorgeselecteerde kandidaten zonder naam, contact of werkgevers, met de instructies (lezen) |
| `save_matches` | Scores opslaan: top 3 plus alles boven `keep_above`, fase naar zoeken, verzoek gewist. Geeft `search_brief_input` terug bij minder dan 3 sterke matches |
| `save_search_brief` | De zoekopdracht buiten de pool (T3) op de vacature, Bangalore eerst |
| `list_applications_to_score` | Sollicitaties zonder score of met een verzoek om opnieuw te scoren, met de CV tekst zonder naam en contact, de vacaturetekst, de eisen en de actieve promptversie (lezen) |
| `get_cv_file` | De PDF van een CV waarvan de tekst nog pending is, met de leesinstructies (lezen) |
| `save_cv_text` | De gelezen CV tekst opslaan en lege velden van de kandidaat aanvullen |
| `save_cv_score` | Een CV score opslaan per eis (met bewijs), met de must have grens en het verdict van het portaal |

### Verzoeken om een oordeel (eigenaar met Recruitment of Academy)

| Tool | Wat het doet |
| --- | --- |
| `list_ai_requests` | Open verzoeken van het portaal ([claude-jobs.md](./claude-jobs.md), taak 8): per verzoek wat er moet gebeuren, de instructies, de invoer, bijgevoegde PDF's en het JSON schema van het antwoord (lezen) |
| `complete_ai_request` | Een verzoek beantwoorden. Het portaal controleert het antwoord en past het toe; weigert het, dan blijft het verzoek open met de reden. Met `give_up_reason` sluit Claude een verzoek dat niet kan |

Schrijftools worden voor een leestoken niet eens aangeboden (ze staan niet in `tools/list`), en elke schrijftool controleert de rechten nog een keer. Er is bewust niets om te verwijderen; `close_list_for_callers` haalt alleen de toegang van bellers tot een lijst weg.

### Content (elk token; schrijven met *Lezen en schrijven*)

Lezen: `content_list_workspaces`, `content_list_posts` (ook `archived`), `content_get_post`, `content_list_media`, `content_list_ideas`.

| Tool | Wat het doet |
| --- | --- |
| `content_create_post` | Post met alle tekstvelden (titel, hook, body, slotvraag, eerste reactie), format, hoek, thema, doelgroep, taal, prioriteit, geplande datum, tijdslot, serie en notities, in elke status. Een post die al live stond (Airtable) krijgt `published` met `linkedin_url` en `published_at`. De tussenstappen van de flow worden vanzelf gezet, de regels blijven gelden |
| `content_update_post` | Elk veld en de status van een post |
| `content_archive_post` | Archiveren (of terugzetten met `archived: false`); verwijderen kan niet |
| `content_set_post_media` | Media van een post in deze volgorde (vervangt de keuze) |
| `content_add_media` | Een foto, video of PDF in de bibliotheek van een workspace of het bedrijf, vanaf een link: Google Drive (gedeeld met het service account) of een publieke https link, hoogstens 20 MB, met beschrijving en tags |
| `content_describe_media` | Beschrijving en tags van een bestand direct schrijven |
| `content_record_results` | Bereik, likes, reacties en reposts, zo vaak als je wilt (`content_measurements`); met `slot` `48h` of `7d` ook de vaste meting. Met `linkedin_url` (en `published_at`) wordt een goedgekeurde post Published |
| `content_add_idea`, `content_ideas_to_post` | Een idee toevoegen; ideeën omzetten naar een post |
| `content_suggest_*` | Blijven bestaan voor als Claude iets juist wil voorleggen |

Alles wat Claude in Content wijzigt, staat in het activiteitenlog van Content (`content_activity`) met bron `claude` en de naam van de eigenaar van het token, en in de versies en het statuslog als *Claude (voor Julius)*.

### Wat Claude per module mag (admin)

Onder Instellingen, *Connect Claude (MCP)*, *What Claude may do per module* kiest een admin per module: **Read only** (geen schrijftools), **Drafts and suggestions** (alleen tools die een concept of suggestie maken, zoals `draft_sequence_text`, `content_suggest_*` en `content_add_idea`) of **Full write**. Tabel `mcp_module_access` (migratie `20261121020000_mcp_claude_rights.sql`); een module zonder regel is *Drafts and suggestions*. Work, Sales, Recruitment, Notes, Content en Academy staan na de migratie op Full write, dus er verandert niets tot een admin het aanpast. Tools die niet mogen, staan niet in `tools/list` (`gateTools` in `src/lib/mcp/module-access.ts`); het token kan nooit meer dan de eigenaar zelf. Niet afgeschermd: `log_job_run` (boekhouding van de geplande taken) en `complete_ai_request` (een verzoek dat iemand in het portaal klaarzette; het portaal controleert het antwoord).

**Regel voor nieuwe modules.** Elke nieuwe module komt meteen met MCP tools om te lezen, als concept aan te maken en te suggereren. Zet elke schrijftool in `WRITE_TOOLS` in `src/lib/mcp/module-access.ts` met de module en de soort (`suggest` of `write`); de test in `tests/mcp.test.ts` faalt anders. Welke schrijfrechten Claude krijgt, bepaalt de admin in Instellingen.

**Sales en Activities.** De sales tools schrijven met de secret key en `p_actor` = de eigenaar van het token, via de functies van de database (`sales_update`, `sales_log_activity`, `sales_save_meeting`, `sales_start_sequence`, `sales_pause`). Die controleren dat de eigenaar de module Sales heeft, en elke wijziging komt in Activities op naam van de eigenaar met bron `claude` (of de bron van de data, zoals `instantly` bij een reply). Bedrijven en contacten worden alleen via `sales_update` gewijzigd. Een eigenaar zonder de module Sales krijgt de sales tools niet.

## Hoe het werkt

- `src/app/api/mcp/route.ts` maakt per request een nieuwe `McpServer` en een stateless `WebStandardStreamableHTTPServerTransport`. De route roept `connection()` aan, dus hij draait altijd op request-tijd (Cache Components).
- `src/lib/mcp/tokens.ts` maakt tokens (`nrd_` plus 32 willekeurige bytes, base64url), slaat alleen de SHA-256 hash op en controleert tokens met de secret key: ingetrokken, verlopen en niet-teamleden worden geweigerd. `last_used_at` wordt hooguit eens per vijf minuten bijgewerkt.
- `src/lib/mcp/tools.ts` en `write-tools.ts` bevatten de tools; `src/lib/mcp/sales-tools.ts` de tools van het sales CRM. Ze lezen met de admin client, maar selecteren alleen portaaldata die een teamlid onder RLS ook ziet. Tokens, hashes, passkeys en WebAuthn data zijn nooit bereikbaar via een tool.
- **Wie deed wat:** schrijfacties zetten `author_id` (notities) op de eigenaar van het token. Taken gaan via de Work functies (`work_create_record_task`, `work_set_status`) met `p_actor` = de eigenaar van het token, dus dezelfde rechten, reviewregels en hetzelfde takenlog als in de app. Lezen gaat via `work_api_record_tasks` met de rechten van de eigenaar; gekoppelde records worden beperkt tot zijn modules.
- Tokens beheren gebeurt met de eigen sessie van de gebruiker (RLS): aanmaken mag alleen voor jezelf, intrekken zet `revoked_at`. Maximaal 20 actieve tokens per gebruiker.

## Inrichten (voor beheerders)

1. **Migratie:** voer `supabase/migrations/20261026000000_security.sql` uit (tabel `mcp_tokens` met RLS), bijvoorbeeld met `supabase db push`.
2. **Omgevingsvariabelen:**
   - `SUPABASE_SECRET_KEY`: verplicht. Zonder deze key geeft `/api/mcp` een `503` en is het formulier in Instellingen uitgeschakeld.
   - `NEXT_PUBLIC_SITE_URL`: de publieke URL van het portaal (bijvoorbeeld `https://portal.nordavo.nl`). Deze komt in het commando en in de links die de tools teruggeven. Standaard `http://localhost:3000`.
3. `/api/mcp` staat als publiek pad in de proxy (`src/lib/supabase/proxy.ts`), omdat de route zichzelf met het token authenticeert.

## Testen

Unit tests (tokens, header parsing, `tools/list` voor lees- en schrijftokens en per module, en de invoercontrole van de sales tools, zonder database; `tests/mcp.test.ts` en `tests/mcp-sales.test.ts`):

```bash
npm test
```

Met de [MCP Inspector](https://github.com/modelcontextprotocol/inspector) tegen een draaiende app:

```bash
npm run dev
npx @modelcontextprotocol/inspector
```

Kies in de Inspector transport **Streamable HTTP**, URL `http://localhost:3000/api/mcp`, en zet onder Authentication de header `Authorization` op `Bearer nrd_...` (of vul het token in als bearer token). Gebruik de standaard proxy-verbinding van de Inspector: de route stuurt geen CORS headers, dus een directe verbinding vanuit de browser werkt niet. Daarna kun je onder *Tools* `whoami` en de andere tools uitproberen.

Snel met curl:

```bash
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer nrd_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
