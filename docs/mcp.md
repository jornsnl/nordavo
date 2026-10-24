# Claude Code koppelen (MCP)

Nordavo heeft een eigen MCP server op `/api/mcp`. Daarmee kan [Claude Code](https://code.claude.com) met jouw rechten klanten, vacatures, pipelines, kandidaten, plaatsingen, taken, notities, het activiteitenlog en GTM bedrijven opzoeken, en met een schrijftoken ook taken en notities aanmaken.

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
- Maak een taak voor mij om vrijdag de check-in met Priya te plannen *(schrijfrechten)*.

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
| `get_company` | GTM bedrijf met ICP kwalificatie, contacten en signalen |
| `list_tasks` | Taken; filters `mine`, `status` (`open`, `todo`, `in_progress`, `done`, `all`), `due` (`overdue`, `today`, `week`, `none`) en een gekoppeld record |
| `get_activity` | Activiteitenlog van één record (inclusief pipeline en gekoppelde taken) of van het hele portaal |

### Schrijven (alleen tokens met *Lezen en schrijven*)

| Tool | Wat het doet |
| --- | --- |
| `create_task` | Taak aanmaken, optioneel gekoppeld aan een record; standaard toegewezen aan de eigenaar van het token |
| `update_task_status` | Status van een taak zetten: `todo`, `in_progress` of `done` |
| `add_note` | Notitie toevoegen aan een klant, vacature, kandidaat, sollicitatie, plaatsing of GTM bedrijf |

Schrijftools worden voor een leestoken niet eens aangeboden (ze staan niet in `tools/list`), en elke schrijftool controleert de rechten nog een keer. Er is bewust niets om te verwijderen.

## Hoe het werkt

- `src/app/api/mcp/route.ts` maakt per request een nieuwe `McpServer` en een stateless `WebStandardStreamableHTTPServerTransport`. De route roept `connection()` aan, dus hij draait altijd op request-tijd (Cache Components).
- `src/lib/mcp/tokens.ts` maakt tokens (`nrd_` plus 32 willekeurige bytes, base64url), slaat alleen de SHA-256 hash op en controleert tokens met de secret key: ingetrokken, verlopen en niet-teamleden worden geweigerd. `last_used_at` wordt hooguit eens per vijf minuten bijgewerkt.
- `src/lib/mcp/tools.ts` en `write-tools.ts` bevatten de tools. Ze lezen met de admin client, maar selecteren alleen portaaldata die een teamlid onder RLS ook ziet. Tokens, hashes, passkeys en WebAuthn data zijn nooit bereikbaar via een tool.
- **Wie deed wat:** schrijfacties zetten `created_by`, `assignee_id` (standaard) en `author_id` op de eigenaar van het token. Omdat de secret key geen `auth.uid()` heeft, schrijft de activiteitentrigger eerst geen actor; de MCP server zet daarna `actor_id` op de eigenaar voor de regels die net door die actie zijn ontstaan.
- Tokens beheren gebeurt met de eigen sessie van de gebruiker (RLS): aanmaken mag alleen voor jezelf, intrekken zet `revoked_at`. Maximaal 20 actieve tokens per gebruiker.

## Inrichten (voor beheerders)

1. **Migratie:** voer `supabase/migrations/20261026000000_security.sql` uit (tabel `mcp_tokens` met RLS), bijvoorbeeld met `supabase db push`.
2. **Omgevingsvariabelen:**
   - `SUPABASE_SECRET_KEY`: verplicht. Zonder deze key geeft `/api/mcp` een `503` en is het formulier in Instellingen uitgeschakeld.
   - `NEXT_PUBLIC_SITE_URL`: de publieke URL van het portaal (bijvoorbeeld `https://portaal.nordavo.nl`). Deze komt in het commando en in de links die de tools teruggeven. Standaard `http://localhost:3000`.
3. `/api/mcp` staat als publiek pad in de proxy (`src/lib/supabase/proxy.ts`), omdat de route zichzelf met het token authenticeert.

## Testen

Unit tests (tokens, header parsing en `tools/list` voor lees- en schrijftokens, zonder database):

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
