# Nordavo Portal

Het interne portaal van [Nordavo](https://nordavo.nl): de brug tussen Nederlandse groeibedrijven en Indiaas tech talent. Het team beheert hier klanten, vacatures, kandidaten en plaatsingen. Klanten volgen in hun eigen portaal de kandidaten die Nordavo voor ze selecteert.

## Wat zit erin

| Onderdeel | Route | Wat het doet |
| --- | --- | --- |
| Overzicht | `/dashboard` | Kerncijfers, vacatures die aandacht nodig hebben (belofte: 3 kandidaten in 3 weken), komende check-ins en garanties, pipeline, mijn taken, recente activiteit |
| Taken | `/dashboard/taken` | Lijst (te laat, vandaag, deze week) en kanbanbord, te koppelen aan elk record |
| Klanten | `/dashboard/klanten` | Bedrijven, contactpersonen, hun vacatures en plaatsingen |
| Vacatures | `/dashboard/vacatures` | Functieprofielen met dagen open en pipeline-samenvatting |
| Pipeline | `/dashboard/vacatures/[id]/pipeline` | Kanbanbord per vacature: sourcing tot plaatsing, slepen met muis of toetsenbord |
| Kandidaten | `/dashboard/kandidaten` | Profielen, skills, cv-upload, video-intro, sollicitaties |
| Plaatsingen | `/dashboard/plaatsingen` | Startdatum, tarief, 30 dagen garantie, check-ins, opzegtermijn van een maand |
| Instellingen | `/dashboard/instellingen` | Profiel, wachtwoord, gebruikers en rollen, uitnodigen |
| Klantportaal | `/portaal` | Voor klanten: eigen vacatures, voorgestelde kandidaten met cv, akkoord of afwijzen met feedback, plaatsingen |
| Zoeken | Ctrl+K / Cmd+K | Klanten, vacatures, kandidaten en plaatsingen |

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
- Rollen staan in `profiles.role`: `admin` en `member` (het Nordavo team) zien alles; `client` is een contactpersoon van een klant en ziet via `/portaal` alleen het eigen bedrijf, de kandidaten die aan hen zijn voorgesteld en de eigen plaatsingen. Dit is afgedwongen met RLS; klanten geven feedback alleen via de functie `client_review_application`.
- Zet in Supabase (Authentication > Emails) de templates op:
  - Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/wachtwoord`
  - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/wachtwoord`
- Zet onder Authentication > URL Configuration de Site URL op het productiedomein en voeg `http://localhost:3000/**` toe aan de Redirect URLs.

## Een module toevoegen

1. Voeg tabellen toe via een nieuwe migratie in `supabase/migrations`, zet RLS aan en werk `src/lib/database.types.ts` bij (of genereer met `npx supabase gen types typescript`).
2. Zet queries in `src/lib/data/<module>.ts`; elke functie begint met `requireStaff()`.
3. Voeg een item toe aan `src/components/dashboard/nav-items.ts` en maak de route in `src/app/dashboard/<module>/`.
4. Lees data in componenten binnen `<Suspense>` (Cache Components) en zet mutaties in server actions met zod-validatie.

## Huisstijl

Kleuren en fonts staan als tokens in `src/app/globals.css`: nachtblauw (`brand-*`) als hoofdkleur en saffraan (`accent-*`) als accent, met Plus Jakarta Sans voor koppen en Inter voor tekst. Pas deze tokens aan om de huisstijl bij te stellen; de componenten gebruiken alleen de tokens.

## Schrijfstijl

Nederlands, je en jij, kort en concreet. Noem feiten en cijfers in plaats van superlatieven ("3 kandidaten binnen 3 weken"), en zeg eerlijk wat er nog niet is ("Deze module bouwen we binnenkort").
