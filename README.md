# Nordavo Portal

Het interne portaal van [Nordavo](https://nordavo.nl): de brug tussen Nederlandse groeibedrijven en Indiaas tech talent. Deze repository bevat de basis waarop we de backend en de modules (klanten, vacatures, kandidaten, plaatsingen) verder uitbouwen.

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
3. Voer de migraties uit in `supabase/migrations` (via de Supabase CLI met `supabase db push`, of plak de SQL in de SQL editor).
4. Maak een gebruiker aan via Supabase (Authentication > Users > Invite user). Er is bewust geen publieke registratie.
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
    auth/signout/          Uitloggen (POST)
    dashboard/             Dashboard met sidebar, één map per module
  components/
    brand/                 Logo
    dashboard/             App shell, sidebar, navigatie, page header, empty state
  lib/
    auth.ts                getCurrentUser(): de enige plek die de sessie leest
    supabase/              Supabase clients voor browser, server en proxy
supabase/migrations/       SQL migraties (profiles tabel met RLS)
```

## Authenticatie

- `src/proxy.ts` draait op elke request, ververst de sessie en stuurt niet ingelogde bezoekers naar `/login?next=...`.
- `getCurrentUser()` in `src/lib/auth.ts` is de Data Access Layer. Gebruik deze in Server Components binnen een `<Suspense>` boundary (verplicht met Cache Components) en controleer de gebruiker opnieuw in elke Server Action of Route Handler.
- Rechten op data regel je in de database met Row Level Security, niet alleen in de UI.
- Voor uitnodigingen: zet in Supabase de e-mail template "Invite user" op
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/dashboard`.

## Een module toevoegen

1. Voeg een item toe aan `src/components/dashboard/nav-items.ts`.
2. Maak de route aan in `src/app/dashboard/<module>/page.tsx` met `PageHeader`.
3. Voeg tabellen toe via een nieuwe migratie in `supabase/migrations` en zet RLS aan.

## Huisstijl

Kleuren en fonts staan als tokens in `src/app/globals.css`: nachtblauw (`brand-*`) als hoofdkleur en saffraan (`accent-*`) als accent, met Plus Jakarta Sans voor koppen en Inter voor tekst. Pas deze tokens aan om de huisstijl bij te stellen; de componenten gebruiken alleen de tokens.

## Schrijfstijl

Nederlands, je en jij, kort en concreet. Noem feiten en cijfers in plaats van superlatieven ("3 kandidaten binnen 3 weken"), en zeg eerlijk wat er nog niet is ("Deze module bouwen we binnenkort").
