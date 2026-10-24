# Passkeys: inloggen zonder wachtwoord

Dit document beschrijft hoe passkeys in het portaal werken, hoe je er een toevoegt of intrekt en wat er op de server moet zijn ingesteld.

## Wat is een passkey?

Een passkey is een digitale sleutel die op je apparaat blijft. Je logt ermee in met je vingerafdruk, je gezicht of de pincode van je apparaat, zonder wachtwoord. De passkey hoort bij het domein van het portaal, dus een nepsite kan hem niet gebruiken: passkeys zijn phishingbestendig.

Er zijn twee soorten:

| Soort | Waar hij staat | In de lijst |
| --- | --- | --- |
| Gesynchroniseerd | In iCloud Keychain, Google Password Manager of 1Password. Werkt op al je apparaten met hetzelfde account | Gesynchroniseerd |
| Gebonden aan één apparaat | Op één laptop, telefoon of beveiligingssleutel (bijvoorbeeld een YubiKey) | Op één apparaat |

## Een passkey toevoegen

1. Log in met je wachtwoord.
2. Ga naar je beveiligingsinstellingen: teamleden via Instellingen (`/dashboard/instellingen`), klanten via Beveiliging (`/portaal/beveiliging`).
3. Vul bij Passkeys een naam in die je herkent, bijvoorbeeld "MacBook" of "iPhone".
4. Klik op **Passkey toevoegen**.
5. Je browser of wachtwoordmanager vraagt om je vingerafdruk, gezicht of pincode. Bevestig.
6. De passkey staat nu in de lijst, met de datum waarop je hem hebt toegevoegd.

Een apparaat dat al een passkey voor je account heeft, wordt niet nog een keer aangeboden. Wil je op meer apparaten inloggen zonder gesynchroniseerde passkey, voeg dan per apparaat een passkey toe.

## Een passkey hernoemen of intrekken

1. Ga naar dezelfde plek als hierboven.
2. Klik bij de passkey op **Hernoemen** om de naam aan te passen, of op **Intrekken** om hem te verwijderen.
3. Bij intrekken vraagt het portaal om bevestiging. Daarna kun je met die passkey niet meer inloggen.

Op het apparaat of in je wachtwoordmanager blijft de passkey zelf bestaan. Die kun je daar verwijderen; het portaal accepteert hem in elk geval niet meer. Trek een passkey altijd in als je een apparaat kwijt bent of wegdoet.

## Inloggen met een passkey

1. Ga naar `/login`.
2. Klik onder het wachtwoordformulier op **Inloggen met passkey**. Je hoeft geen e-mailadres in te vullen.
3. Kies je passkey en bevestig met je vingerafdruk, gezicht of pincode.
4. Teamleden komen op het dashboard (of de pagina waar ze heen wilden), klanten in het klantportaal.

Lukt het niet, dan toont het portaal een algemene melding en kun je gewoon met je wachtwoord inloggen. Het portaal vertelt nooit of een account of passkey bestaat. Annuleer je de vraag van je browser, dan gebeurt er niets.

## Passkeys en tweestapsverificatie

Inloggen met een passkey telt als tweestapsverificatie: je hebt het apparaat nodig (bezit) en je ontgrendelt het met je vingerafdruk, gezicht of pincode (iets wat je bent of weet). Heb je tweestapsverificatie met een authenticator app aan staan, dan vraagt het portaal na een passkey-login dus geen code meer.

Technisch: Supabase Auth kent zo'n sessie alleen als aal1. Na een geslaagde passkey-login zet de server een ondertekende, httpOnly cookie (`nordavo-passkey-session`) die aan het sessie-id van die ene Supabase sessie vastzit. De proxy en `getCurrentUser` accepteren die cookie in plaats van een code uit de authenticator app. Bij uitloggen wordt de cookie verwijderd, en voor een andere sessie is hij waardeloos. Zie `src/lib/security/passkey-session.ts`.

## Hoe het werkt

| Onderdeel | Waar in de code |
| --- | --- |
| Tabellen `passkeys` en `webauthn_challenges` | `supabase/migrations/20261026000000_security.sql` |
| Relying party en challenges | `src/lib/security/webauthn.ts` |
| Passkeys beheren (server actions) | `src/app/dashboard/instellingen/passkey-actions.ts` |
| Passkeys beheren (scherm) | `src/components/settings/security/passkey-*.tsx` |
| Inloggen met passkey | `src/app/login/passkey-sign-in.tsx`, `src/app/login/passkey-actions.ts` |
| Passkey-sessie cookie | `src/lib/security/passkey-session.ts` |

Bij het inloggen:

1. De server maakt een challenge, bewaart die in `webauthn_challenges` (vijf minuten geldig) en zet het id in een korte, httpOnly cookie voor deze browser.
2. De browser laat de passkey de challenge ondertekenen.
3. De server haalt de challenge op en verwijdert hem meteen (eenmalig te gebruiken), zoekt de passkey op, controleert handtekening, origin, rpID, gebruikersverificatie en de teller, en werkt teller en laatst gebruikt bij.
4. De server maakt met de secret key een eenmalige magic link token voor de eigenaar en wisselt die direct in voor een Supabase sessie. Er gaat geen e-mail de deur uit.
5. De passkey-sessie cookie wordt gezet en de gebruiker gaat door naar het portaal.

## Inrichten

### Migratie

Draai `supabase/migrations/20261026000000_security.sql` in de SQL editor van Supabase (of met `supabase db push`). Die maakt de tabellen `passkeys` en `webauthn_challenges`, met RLS zodat gebruikers alleen hun eigen passkeys zien, hernoemen en verwijderen.

### Omgevingsvariabelen

| Variabele | Verplicht | Uitleg |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Ja | Nodig om challenges op te slaan, de passkey bij het inloggen op te zoeken en de sessie aan te maken. Zonder deze sleutel toont het portaal een melding in plaats van het formulier |
| `WEBAUTHN_RP_ID` | Nee | Het domein waar passkeys bij horen, zonder `https://` en zonder poort, bijvoorbeeld `portaal.nordavo.nl`. Standaard de hostnaam van `NEXT_PUBLIC_SITE_URL` |
| `WEBAUTHN_ORIGIN` | Nee | De volledige origin waarop het portaal draait, bijvoorbeeld `https://portaal.nordavo.nl`. Standaard de origin van `NEXT_PUBLIC_SITE_URL` |
| `PASSKEY_SESSION_SECRET` | Nee | Sleutel om de passkey-sessie cookie te ondertekenen. Standaard `SUPABASE_SECRET_KEY`. Stel een eigen lange, willekeurige waarde in als je die sleutels los van elkaar wilt kunnen vervangen |

Let op: passkeys horen bij het rpID. Verander je het domein van het portaal, dan werken bestaande passkeys niet meer en moeten gebruikers ze opnieuw toevoegen. Vervang je `PASSKEY_SESSION_SECRET` (of `SUPABASE_SECRET_KEY` als die de fallback is), dan tellen lopende passkey-sessies niet meer als tweestapsverificatie tot de volgende passkey-login.

### Lokaal ontwikkelen

Op `http://localhost:3000` werkt het zonder extra instellingen: browsers staan passkeys toe op `localhost`, ook zonder https. Met de standaard `NEXT_PUBLIC_SITE_URL` zijn rpID `localhost` en origin `http://localhost:3000`. Draai je op een andere poort of een ander adres, zet dan `NEXT_PUBLIC_SITE_URL` (of `WEBAUTHN_ORIGIN`) op dat adres. Een IP-adres zoals `127.0.0.1` werkt niet als rpID; gebruik `localhost`.

Passkeys die je lokaal maakt, horen bij `localhost` en werken niet in productie.
