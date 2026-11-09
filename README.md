# Nordavo Portal

Het interne portaal van [Nordavo](https://nordavo.nl): de brug tussen Nederlandse groeibedrijven en Indiaas tech talent. Het team beheert hier klanten, vacatures, kandidaten en plaatsingen. Klanten volgen in hun eigen portaal de kandidaten die Nordavo voor ze selecteert.

## Wat zit erin

| Onderdeel | Route | Wat het doet |
| --- | --- | --- |
| Overzicht | `/dashboard` | Kerncijfers, salescijfers van deze week en de pipeline, vacatures die aandacht nodig hebben (belofte: 3 kandidaten in 3 weken), komende check-ins en garanties, mijn taken uit Work, recente activiteit |
| Leads | `/dashboard/leads` | Elk bedrijf met leadstatus, in een tabel die werkt als een spreadsheet of als bord. Plus Replies to review (voorstellen van Claude) en de ICP review. Zie [docs/sales.md](docs/sales.md) |
| Contacts | `/dashboard/contacts` | Alle contactpersonen met rol, status en beller, als tabel of bord. Een opgeslagen weergave kan een bellijst zijn. Verrijking voor Max onder Enrich |
| Pipeline | `/dashboard/pipeline` | Bedrijven die interesse toonden, in 8 fases, als bord of tabel; fase 4 tot en met 7 volgen uit de werving |
| Calls en Call lists | `/dashboard/calls`, `/dashboard/call-lists` | Belscherm met alle info en de uitkomstknoppen; bellijsten openzetten voor bellers. Externe bellers werken op `/caller`. Zie [docs/calls.md](docs/calls.md) |
| Meetings | `/dashboard/meetings` | Afsprakenregister met goedkeuren, vergoedingen en maandoverzicht per beller |
| Sequences en Partners | `/dashboard/sequences`, `/dashboard/partners` | Stappen over mail, LinkedIn en bellen met concepten van Claude; partners die leads aanbrengen |
| Klanten | `/dashboard/clients` | Bedrijven, contactpersonen, hun vacatures en plaatsingen |
| Vacatures | `/dashboard/vacancies` | Functieprofielen met dagen open en pipeline-samenvatting |
| Pipeline | `/dashboard/vacancies/[id]/pipeline` | Kanbanbord per vacature: sourcing tot plaatsing, slepen met muis of toetsenbord |
| Kandidaten | `/dashboard/candidates` | Profielen, skills, cv-upload, video-intro, sollicitaties |
| Plaatsingen | `/dashboard/placements` | Startdatum, tarief, 30 dagen garantie, check-ins, opzegtermijn van een maand |
| Instellingen | `/dashboard/settings` | Bellers (admin), profiel, wachtwoord, tweestapsverificatie, passkeys, Claude Code koppelen (MCP), mail controleren, testmail versturen en mail log van alle verzonden mail ([docs/mail.md](docs/mail.md)), gebruikers en rollen, uitnodigen |
| Klantportaal | `/portal` | Voor klanten: eigen vacatures, voorgestelde kandidaten met cv, akkoord of afwijzen met feedback, plaatsingen, beveiliging (`/portal/security`) |
| Werving | `/dashboard/vacancies/[id]/...` | Het hele wervingsproces: nieuwe fases, parkeren, sollicitatieform per vacature, import en CV upload, AI screening, beoordelen, toppers, interviews plannen, hiring report. Zie [docs/recruitment.md](docs/recruitment.md) |
| Work | `/work` | De enige takentool (Tasks is erin opgegaan): workspaces (Nordavo, KG), projecten, taken met review, koppeling aan klant, lead, vacature, kandidaat of plaatsing, indeling op datum en bord, gasten (freelancers), meldingen per mail, API. Engels. Zie [docs/work.md](docs/work.md) |
| Academy | `/academy`, `/dashboard/academy` | Nordavo Academy: klantcourse (NL) en developercourse (EN) met modules, herbruikbare lessen en lesblokken, afrondregels en modules die op volgorde, na vereiste modules of na de startdatum opengaan. Beheer-editor met slepen, publiceren en dupliceren; mensen per stuk of in bulk toevoegen met een uitnodiging. Rollen klantbeheerder, klant lid, meelezer, developer en kandidaat. Zie [docs/academy.md](docs/academy.md) |
| App op beginscherm | iPhone, iPad, Android | Zet het portaal op het beginscherm: opent schermvullend met eigen icoon en startscherm. Op iOS: Safari, Deel, Zet op beginscherm (het portaal legt dit zelf eenmalig uit). Zonder verbinding verschijnt een offline pagina; er wordt geen portaaldata op het toestel bewaard. Startschermen opnieuw maken: `python3 scripts/generate-splash.py` |
| MCP server | `/api/mcp` | Claude Code leest (en met schrijfrechten wijzigt) portaaldata met een persoonlijke token |
| Zoeken | Ctrl+K / Cmd+K | Klanten, vacatures, kandidaten en plaatsingen |

Daarnaast draait het **GTM systeem** (signalen, kwalificatie met Claude, Instantly en Web Partners syncs, weekrapport en talentmatching). Werking, inrichting en planning staan in [docs/gtm.md](docs/gtm.md); de oorspronkelijke briefing in [docs/gtm-briefing.md](docs/gtm-briefing.md). Het sales CRM staat in [docs/sales.md](docs/sales.md), de geplande taken van Claude in [docs/claude-jobs.md](docs/claude-jobs.md).

Op elke detailpagina staan taken, notities, bijlagen en een activiteitenlog. Het activiteitenlog wordt door database-triggers gevuld, dus elke wijziging komt erin.

## Stack

| Onderdeel | Keuze |
| --- | --- |
| Framework | Next.js 16 (App Router, Cache Components, `src/proxy.ts`) |
| Taal | TypeScript |
| Styling | Tailwind CSS v4, design tokens in `src/app/globals.css` |
| Database en auth | Supabase (Postgres) via `@supabase/ssr` |
| Iconen | lucide-react |

## Aan de slag

1. Installeer de dependencies:
   ```bash
   npm install
   ```
2. Kopieer de omgevingsvariabelen en vul ze in met de waarden uit het Supabase dashboard (Project Settings > API):
   ```bash
   cp .env.example .env.local
   ```
   Zet `SUPABASE_SECRET_KEY` alleen als je vanuit Instellingen gebruikers wilt uitnodigen. Deze key blijft op de server.
3. Voer de migraties uit in `supabase/migrations`, in volgorde (via de Supabase CLI met `supabase db push`, of plak de SQL per bestand in de SQL editor). Ze maken ook de private storage bucket `attachments` aan.
4. Maak de eerste gebruiker aan via Supabase (Authentication > Users > Add user, met Auto Confirm) en maak die beheerder:
   ```sql
   update public.profiles set role = 'admin', full_name = 'Voornaam Achternaam'
   where id = (select id from auth.users where email = 'jij@voorbeeld.nl');
   ```
   Nieuwe accounts krijgen de rol `external` (alleen Work). Wie je via het Supabase dashboard toevoegt, geef je daarna in Instellingen de juiste rol.
   Er is bewust geen publieke registratie. Volgende gebruikers nodig je uit via Instellingen.
5. Start de app:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). Je wordt naar `/login` gestuurd.

## Scripts

| Script | Doel |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Productiebuild |
| `npm run start` | Productiebuild draaien |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route types genereren en TypeScript controleren |
| `npm test` | Unit tests (Node test runner) |
| `npm run job -- <naam>` | Een GTM job of reeks draaien, `--help` toont ze allemaal |

## Structuur

```
src/
  proxy.ts                 Ververst de Supabase sessie en beschermt routes
  app/
    login/                 Inlogscherm, formulier en server action
    auth/confirm/          Landingspunt voor links uit auth e-mails (uitnodiging, reset)
    auth/wachtwoord/       Wachtwoord instellen na uitnodiging of reset
    auth/signout/          Uitloggen (POST)
    dashboard/             Intern portaal met sidebar, één map per module
    portaal/               Klantportaal
  components/
    ui/                    Gedeelde bouwstenen: Button, Field, Select, Badge, Card, Table, Modal
    entity/                Taken, notities, bijlagen en activiteit per record
    <module>/              Componenten per module (clients, vacancies, pipeline, ...)
  lib/
    auth.ts                getCurrentUser, requireStaff, requireAdmin, requireClient
    data/                  Alle Supabase queries per module (server-only)
    database.types.ts      Types van het datamodel
    labels.ts              Nederlandse labels voor statussen en fases
    supabase/              Supabase clients voor browser, server, proxy en admin
supabase/migrations/       SQL migraties met RLS
```

## Authenticatie

- `src/proxy.ts` draait op elke request, ververst de sessie en stuurt niet ingelogde bezoekers naar `/login?next=...`.
- `getCurrentUser()` in `src/lib/auth.ts` is de Data Access Layer. Gebruik deze in Server Components binnen een `<Suspense>` boundary (verplicht met Cache Components) en controleer de gebruiker opnieuw in elke Server Action of Route Handler.
- Rechten op data regel je in de database met Row Level Security, niet alleen in de UI.
- Rollen staan in `profiles.role`: `admin` en `member` (het Nordavo team) zien alles; `external` gebruikt alleen Work (`/work`) en is de standaard voor elk nieuw account; `client` is een contactpersoon van een klant en ziet via `/portal` alleen het eigen bedrijf, de kandidaten die aan hen zijn voorgesteld en de eigen plaatsingen. `developer` en `candidate` gebruiken alleen de Academy (`/academy`); klanten zien daarnaast ook de Academy. Wie in de Academy wat ziet staat in [docs/academy.md](docs/academy.md). Dit is afgedwongen met RLS; klanten geven feedback alleen via de functie `client_review_application`.
- Zet in Supabase (Authentication > Emails) de templates op:
  - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/password`
  - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/password`
- Zet onder Authentication > URL Configuration de Site URL op het productiedomein en voeg `http://localhost:3000/**` toe aan de Redirect URLs.

### Tweestapsverificatie, passkeys en MCP

| Onderdeel | Wat het doet | Uitleg |
| --- | --- | --- |
| Tweestapsverificatie | Code uit een authenticator app na het wachtwoord, in te stellen via het profiel. De proxy en `getCurrentUser()` laten een sessie zonder tweede stap niet verder dan `/login/verify`. | [docs/mfa.md](docs/mfa.md) |
| Passkeys | Inloggen met vingerafdruk, gezicht of pincode. Toevoegen, hernoemen en intrekken via het profiel. Een passkey telt ook als tweede stap. | [docs/passkeys.md](docs/passkeys.md) |
| MCP server | Claude Code koppelen aan het portaal met een persoonlijke token (lezen, of lezen en schrijven). Tokens maak en trek je in via het profiel. | [docs/mcp.md](docs/mcp.md) |

Hiervoor is de migratie `20261026000000_security.sql` nodig en moet `SUPABASE_SECRET_KEY` op de server staan.

## Een module toevoegen

1. Voeg tabellen toe via een nieuwe migratie in `supabase/migrations`, zet RLS aan en werk `src/lib/database.types.ts` bij (of genereer met `npx supabase gen types typescript`).
2. Zet queries in `src/lib/data/<module>.ts`; elke functie begint met `requireStaff()`.
3. Voeg een item toe aan `src/components/dashboard/nav-items.ts` en maak de route in `src/app/dashboard/<module>/`.
4. Lees data in componenten binnen `<Suspense>` (Cache Components) en zet mutaties in server actions met zod-validatie.

## Huisstijl

Kleuren en fonts staan als tokens in `src/app/globals.css`: nachtblauw (`brand-*`) als hoofdkleur en saffraan (`accent-*`) als accent, met Plus Jakarta Sans voor koppen en Inter voor tekst. Pas deze tokens aan om de huisstijl bij te stellen; de componenten gebruiken alleen de tokens.

## Schrijfstijl

Nederlands, je en jij, kort en concreet. Noem feiten en cijfers in plaats van superlatieven ("3 kandidaten binnen 3 weken"), en zeg eerlijk wat er nog niet is ("Deze module bouwen we binnenkort").
