# Claude Code koppelen (MCP)

Nordavo heeft een eigen MCP server op `/api/mcp`. Daarmee kan [Claude Code](https://code.claude.com) met jouw rechten klanten, vacatures, pipelines, kandidaten, plaatsingen, taken, notities, het activiteitenlog en het sales CRM (bedrijven, contacten, meetings, bellijsten, sequences, replies en cijfers) opzoeken, en met een schrijftoken ook taken en notities aanmaken en alle sales acties doen die de geplande taken van Claude nodig hebben ([claude-jobs.md](./claude-jobs.md)).

- **Transport:** Streamable HTTP, stateless, JSON antwoorden. `POST /api/mcp` voor JSON-RPC; `GET` en `DELETE` geven `405` (geen SSE stream, geen sessies).
- **Authenticatie:** een persoonlijk token in de header `Authorization: Bearer nrd_...`. Zonder of met een ongeldig, verlopen of ingetrokken token: `401` met `WWW-Authenticate: Bearer`.
- **Wie:** alleen het Nordavo team (rol `admin` of `member`). Klantaccounts kunnen geen token aanmaken, en een token stopt met werken zodra de eigenaar geen teamlid meer is.

## Instellen (voor gebruikers)

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
| `list_tasks` | Work taken die de eigenaar van het token mag openen, op deadline, met eigenaren, reviewer, project, het gekoppelde record (`linked`: type, id, naam, link) en een link naar de taak in Work. Filters `mine` (eigenaar), `status` (`open` is `todo`, `in_progress` of `review`; verder `todo`, `in_progress`, `review`, `done`, `cancelled`, `all`), `due` (`overdue`, `today`, `week`, `none`) en een gekoppeld record (`entity_type` met `entity_id`). `due_at` is UTC, `due_date` de dag in Europe/Amsterdam. `has_more` zegt of er een volgende pagina is |
| `get_activity` | Activiteitenlog van één record (inclusief pipeline en het log van de gekoppelde Work taken) of van het hele portaal; met `entity_type` `task` het log van één Work taak |
| `talent_pool_top` | De beste kandidaten uit de talentpool voor een profiel in vrije tekst of een vacature, met reden, skills, projectervaring en woonplaats (zie [recruitment-screening.md](./recruitment-screening.md)) |

### Sales lezen (elk token, eigenaar met de module Sales)

| Tool | Wat het doet |
| --- | --- |
| `list_companies` | Bedrijven met leadstatus, fase, prio, categorie, ICP, eigenaar, partner en volgende actie. Filters: `lead_status`, `pipeline_stage`, `in_pipeline`, `prio`, `category`, `icp`, `text`, `has_phone`, `owner_id`, `partner_id` |
| `get_company` | Eén bedrijf met alle velden van het CRM, contacten (rol, status, primair), signalen (role group, datum online), de laatste activities, meetings, sequences en notities |
| `list_contacts` | Contacten met rol, status, primair, telefoon, mail, pogingen en terugbeldatum. Filters op status, rol, bedrijf, leadstatus van het bedrijf, `has_phone` en tekst |
| `list_meetings` | Het meetingregister met status, datum, beller, tarief en Cal.com uid |
| `list_call_lists` | Bellijsten met voor welke bellers ze open staan, tot wanneer en in welke volgorde, plus de bellers |
| `list_sequences` / `get_sequence` | Sequences met stappen, goedgekeurde teksten, concepten en inschrijvingen met hun taken |
| `list_sequence_tasks` | Open stappen van lopende sequences met de goedgekeurde tekst, het bedrijf en het contact, om ze in Instantly en Seleqt klaar te zetten |
| `list_replies_to_review` | Replies die op Julius wachten, met de tekst en het voorstel van Claude |
| `sales_stats` | Cijfers: bedrijven per leadstatus en fase, en per periode calls, bereikt, mails, replies, meetings, fees en per beller (zie [sales.md](./sales.md)) |
| `list_job_runs` | Runs van de jobs en van de geplande taken van Claude (`triggered_by` `claude`) |

### Schrijven (alleen tokens met *Lezen en schrijven*)

| Tool | Wat het doet |
| --- | --- |
| `create_task` | Work taak aanmaken in het afgeschermde project *Portal records*, optioneel gekoppeld aan een record (`entity_type`: `client`, `company` (lead), `vacancy`, `candidate`, `application` of `placement`, met `entity_id`). Prioriteit `low`, `normal`, `high` of `urgent`; `due_date` wordt 17:00 Amsterdamse tijd. De eigenaar van het token wordt reviewer en, zonder `assignee_id`, ook eigenaar |
| `update_task_status` | Status van een Work taak zetten: `todo`, `in_progress`, `review` of `done`. De reviewregels van Work gelden: Done alleen door de reviewer of een admin, Review alleen met een reviewer, terug van Review of Done alleen met `comment` |
| `add_note` | Notitie toevoegen aan een klant, vacature, kandidaat, sollicitatie, plaatsing of GTM bedrijf |

### Sales schrijven (tokens met *Lezen en schrijven*, eigenaar met de module Sales)

| Tool | Wat het doet |
| --- | --- |
| `update_companies` | Leadstatus, fase (Lost met reden), prio, categorie, eigenaar, partner, volgende actie, pin en handmatige volgorde van een of meer bedrijven |
| `update_contacts` | Status, rol, primair, functie, telefoon, mail, LinkedIn, terugbeldatum, beller en notitie van een of meer contacten |
| `log_activity` | Een contactmoment of reply, bijvoorbeeld uit Instantly of Seleqt, met `external_id` tegen dubbelen. Met `review` en een `suggestion` wacht een reply op Julius |
| `create_meeting` | Een meeting, bijvoorbeeld een Cal.com boeking, met de booking uid als `external_id` |
| `open_list_for_callers` / `close_list_for_callers` | Een bellijst open of dicht zetten voor bellers, met einddatum en volgorde. Alleen als de eigenaar van het token admin is |
| `upsert_companies` | Nieuwe bedrijven met vacatures en beslissers uit Apify of Prospeo. Ontdubbeld op genormaliseerd domein, daarna op de LinkedIn pagina; bekende bedrijven worden aangevuld, nooit overschreven |
| `set_icp_verdict` | ICP-oordeel, score, reden, prio, categorie en openingszin; de leadstatus volgt (Ready, Review of No go) |
| `draft_sequence_text` | Een concept voor een stap van een sequence, via `sales_draft_step` en dus in Activities op de sequence met bron `claude`; Julius keurt goed in het portaal |
| `start_sequence` | Een actieve sequence starten voor een of meer bedrijven |
| `update_sequence_tasks` | Mail en LinkedIn stappen afvinken als klaargezet in Instantly of Seleqt, of overslaan |
| `pause_company` | Een bedrijf overal pauzeren na een reply: sequences op pauze, open belstappen vervallen |
| `log_job_run` | Het begin en einde van een run van een geplande taak loggen (`claude-...`), zichtbaar op Beheer, Jobs |

Schrijftools worden voor een leestoken niet eens aangeboden (ze staan niet in `tools/list`), en elke schrijftool controleert de rechten nog een keer. Er is bewust niets om te verwijderen; `close_list_for_callers` haalt alleen de toegang van bellers tot een lijst weg.

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
