# Codebase kaart

Waar dingen leven, hoe modules van elkaar afhangen en hoe je een AI agent gericht op één stuk zet. Gemeten op 17 november 2026 (ongeveer 185k regels TypeScript, 78 migraties). Werk deze kaart bij als er een module bijkomt of verhuist.

## Stack in één zin

Next.js 16 (App Router, `src/proxy.ts` in plaats van middleware) met React 19, Supabase (Postgres met RLS, auth, storage), Tailwind 4, Zod, Anthropic SDK en een eigen MCP server. Lees `AGENTS.md`: deze Next.js wijkt af van wat een model uit zijn training kent.

## De vier lagen

```
src/app/         routes, pagina's en server actions (actions.ts per route)
src/components/  UI per domein, plus components/ui (gedeelde bouwstenen)
src/lib/         domeinlogica, datatoegang, integraties, AI, MCP
src/jobs/        achtergrondtaken, gestart via GitHub Actions of /api/jobs/<naam>
supabase/        migrations/ (schema en RLS) en tests/ (SQL tests per domein)
tests/           node tests per feature (npm test) en tests/e2e (Playwright)
docs/            functionele docs per module
```

De regel die meestal klopt: `app` roept `lib` aan, `components` tonen wat `app` ophaalt, `lib` weet niets van UI. Uitzonderingen staan onder Hotspots.

## Fundament (raakt alles, wijzig voorzichtig)

| Bestand | Rol |
| --- | --- |
| `src/lib/supabase/server.ts` | Client per request voor Server Components en actions (met RLS) |
| `src/lib/supabase/admin.ts` | Service role client, omzeilt RLS. Alleen na `requireAdmin()` |
| `src/lib/supabase/client.ts` | Browser client |
| `src/lib/supabase/proxy.ts` + `src/proxy.ts` | Sessie verversen en routeren per rol |
| `src/lib/auth.ts` | Wie is ingelogd, rol en modules, `require*` guards |
| `src/lib/modules.ts` | Welke rol welke module ziet (sales, recruitment, clients, report, academy). De database dwingt hetzelfde af via `has_module()` in RLS |
| `src/lib/database.types.ts` | Gegenereerde Supabase types. Na elke migratie opnieuw genereren |
| `src/lib/env.ts` | Alle env variabelen, zie `.env.example` |
| `src/lib/notify/`, `src/lib/mail/` | Meldingen en mail, gedeeld door alle modules |
| `src/components/ui/` | Knoppen, velden, kaarten. Wordt door elk domein gebruikt |

## Modules

Grootte is regels code, ongeveer. "Hangt af van" noemt alleen andere domeinmodules, niet het fundament.

| Module | Routes | Logica | UI | Docs | Hangt af van |
| --- | --- | --- | --- | --- | --- |
| **Sales / GTM** (~22k) | `app/dashboard/{leads,contacts,pipeline,calls,call-lists,meetings,sequences,partners,inbox,suppressions,import}`, `app/caller` | `lib/sales`, `lib/gtm` | `components/{sales,leads,calls,sequences,partners,enrich,import,suppression,campaigns}` | `sales.md`, `gtm.md`, `calls.md`, `gtm-briefing.md` | custom-fields, work (taken bij leads), talent |
| **Recruitment** (~20k) | `app/dashboard/{vacancies,candidates,placements,clients,forms,agenda,report}`, `app/apply` | `lib/recruitment`, `lib/screening`, `lib/talent`, `lib/forms` | `components/{pipeline,vacancies,candidates,placements,clients,screening,talent,interviews,forms,agenda,report}` | `recruitment*.md` | ai, academy (feestdagen), wsp |
| **Work** (~13k) | `app/work`, `app/api/work` | `lib/work` | `components/{work,tasks,entity}` | `work.md`, `work-briefing.md` | data, mcp, notify. Wordt gebruikt door sales, content en de recordpagina's |
| **Content** (~14k) | `app/content` | `lib/content` | `components/content` | `content.md` | integrations (Google Drive), mcp. Verder vrij geïsoleerd |
| **Academy** (~26k) | `app/academy`, `app/dashboard/academy`, `app/api/academy` | `lib/academy` | `components/academy` | `academy.md` | ai, talent, gtm. Let op: `lib/auth` en de proxy lezen `lib/academy/routing` |
| **Working Style Profile** (~3.5k) | `app/working-style`, plus pagina's in academy en portal | `lib/wsp` | `components/wsp` | `working-style-profile.md` | talent. Goed geïsoleerd |
| **Klantportaal** (~1.3k) | `app/portal` | `lib/data/portal.ts` | `components/portal` | README | recruitment data |
| **MCP / Claude** (~8.6k) | `app/api/mcp`, `app/api/oauth`, `app/oauth`, `app/.well-known` | `lib/mcp` (tools per domein in `*-tools.ts`), `lib/ai` (Claude calls, queue, prompts) | `components/settings` | `mcp.md`, `claude-jobs.md` | bijna alle domeinmodules, het is de buitendeur |
| **Security** | `app/login`, `app/auth`, `app/dashboard/settings` | `lib/security`, `lib/auth.ts` | `components/settings/security` | `mfa.md`, `passkeys.md` | fundament |
| **Jobs** | `app/api/jobs/[name]`, `.github/workflows/*-jobs.yml` | `src/jobs/registry.ts` is de index | `components/jobs` | `claude-jobs.md` | per job zijn eigen domein |
| **Gedeelde datalaag** | | `lib/data/*` (een bestand per entiteit: candidates, companies, vacancies, ...) | | | wordt door bijna alle UI gebruikt |

## Losse koppelingen die je moet kennen

Dit zijn de plekken waar een wijziging in module A stilletjes module B raakt.

1. **Recordpagina's delen Work.** `components/entity/*` (notities, taken, bijlagen op klant, lead, vacature, kandidaat) importeert uit `components/work` en `app/work/record-actions`. Wijzig je Work taken, test dan ook een klant of kandidaatpagina.
2. **Login loopt via Academy.** `lib/supabase/proxy.ts` en `lib/auth.ts` gebruiken `lib/academy/routing` om te bepalen waar iemand na inloggen landt. Een wijziging daar raakt elke gebruiker.
3. **`lib/ai/tasks.ts` kent Academy, screening en talent.** De AI queue is gedeeld; een nieuw soort AI verzoek komt hier binnen.
4. **`lib/mcp` importeert bijna alles.** Wie een datafunctie in sales, recruitment, work of content hernoemt, breekt mogelijk een MCP tool. Draai `tests/mcp*.test.ts`.
5. **`lib/data` is breed.** Het haalt ook uit `lib/sales`, `lib/recruitment`, `lib/work`. Behandel het als gedeeld terrein.
6. **Kringen:** `lib/sales` en `lib/gtm` importeren elkaar, net als `lib/recruitment` en `lib/screening`, en `lib/ai` met `lib/academy`, `lib/screening` en `lib/talent`. Zie ze als één blok als je een agent erop zet.

## Hotspots en opruimkandidaten

Klein, maar ze maken scopen lastiger. Geen haast, wel meenemen als je er toch zit.

* `lib/work/quick-add.ts` importeert een type uit `components/work/quick-add-task`. Type hoort in `lib`.
* `lib/data/search.ts` haalt `navSections` uit `components/dashboard/nav-items`.
* `lib/data/stats.ts` haalt `addDays` uit `components/placements/dates`. Hoort in `lib/format.ts`.
* `lib/recruitment/agenda.ts` haalt feestdagen uit `lib/academy/placement/holidays`. Een gedeelde `lib/holidays.ts` haalt Academy uit recruitment.
* `app/dashboard/academy` (4.9k), `app/dashboard/vacancies` (4.3k) en `app/dashboard/settings` (3.2k) zijn de zwaarste routes; een agent die daar zonder richting rondkijkt, verbrandt de meeste tokens.

## Een agent scopen: kopieer en vul in

Geef bij elke opdracht één module en de mappen die erbij horen. Voorbeeld:

```
Werk alleen in de Content module.
Lees eerst docs/content.md en docs/architecture.md.
Scope: src/app/content, src/components/content, src/lib/content,
supabase/migrations/*content*, tests/*content*.
Buiten scope niets wijzigen. Moet je toch iets buiten scope aanraken
(fundament, lib/mcp, components/ui), stop dan en zeg waarom.
Opdracht: ...
```

Snelle scopes per module:

| Werk aan | Geef deze paden |
| --- | --- |
| Leads, contacts, bellen | `src/lib/sales src/lib/gtm src/components/{sales,leads,calls} src/app/dashboard/{leads,contacts,calls,call-lists} src/app/caller` |
| Vacature pipeline | `src/lib/recruitment src/components/{pipeline,vacancies} src/app/dashboard/vacancies` |
| CV screening en matching | `src/lib/{screening,talent,ai} src/components/{screening,talent} src/jobs/{screening-score,t2-match,cv-read}.ts` |
| Work taken | `src/lib/work src/components/{work,tasks,entity} src/app/work` |
| Content | `src/lib/content src/components/content src/app/content` |
| Academy | `src/lib/academy src/components/academy src/app/academy src/app/dashboard/academy` |
| Working Style | `src/lib/wsp src/components/wsp src/app/working-style` |
| Klantportaal | `src/app/portal src/components/portal src/lib/data/portal.ts` |
| MCP tool toevoegen | `src/lib/mcp` (het juiste `*-tools.ts`) plus de `lib` functie die de tool aanroept, `docs/mcp.md` |
| Nieuwe job | `src/jobs` (registreren in `registry.ts`), een workflow in `.github/workflows`, `docs/claude-jobs.md` |
| Database wijziging | nieuwe migratie in `supabase/migrations`, SQL test in `supabase/tests`, daarna `database.types.ts` bijwerken |

## Controleren na een wijziging

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run lint
```

Alleen de tests van je module draaien kan ook, bijvoorbeeld `npx tsx --conditions=react-server --test tests/work*.test.ts`.
