# Tweestapsverificatie met een authenticator app

Dit document beschrijft hoe tweestapsverificatie (2FA) in het portaal werkt, hoe je het aanzet, wat er bij het inloggen gebeurt en wat een beheerder doet als iemand zijn telefoon kwijt is.

## Wat is het?

Met tweestapsverificatie heb je naast je wachtwoord ook je telefoon nodig om in te loggen. Een authenticator app op je telefoon maakt elke 30 seconden een nieuwe code van 6 cijfers. Wie alleen je wachtwoord heeft (bijvoorbeeld na een datalek bij een andere site), komt er dan niet in.

Het werkt met elke app die tijdgebaseerde codes (TOTP) maakt, bijvoorbeeld:

- Google Authenticator
- Microsoft Authenticator
- 1Password
- Authy

Tweestapsverificatie is per gebruiker en staat standaard uit. Teamleden en klanten kunnen het allebei aanzetten.

## Aanzetten

1. Log in met je wachtwoord.
2. Ga naar je beveiligingsinstellingen: teamleden via Instellingen (`/dashboard/instellingen`), klanten via Beveiliging (`/portaal/beveiliging`, het schildje rechtsboven).
3. Klik bij Tweestapsverificatie op **Tweestapsverificatie aanzetten**.
4. Geef de app een naam die je herkent, bijvoorbeeld "iPhone" of "1Password", en klik op **Volgende**.
5. Open je authenticator app, kies voor een nieuw account (vaak een plusje) en scan de QR-code. Lukt scannen niet, typ dan de sleutel onder de QR-code over en kies voor een tijdgebaseerde code.
6. Vul de code van 6 cijfers in die de app nu laat zien en klik op **Bevestigen en aanzetten**.
7. De status springt op **Aan** en de app staat in de lijst, met de datum waarop je hem hebt toegevoegd.

Breek je het halverwege af, dan wordt de half toegevoegde app opgeruimd. Een vergeten poging wordt ook opgeruimd zodra je opnieuw begint.

Je kunt meer apps toevoegen (bijvoorbeeld een tweede telefoon of je wachtwoordmanager) via **Nog een app toevoegen**. Elke app in de lijst werkt dan. Met **Verwijderen** haal je een app weg; na bevestiging werken codes uit die app niet meer. Verwijder je de laatste, dan staat tweestapsverificatie weer uit.

## Inloggen

1. Vul op `/login` je e-mailadres en wachtwoord in.
2. Staat tweestapsverificatie aan, dan ga je naar `/login/verificatie`.
3. Vul de code uit je app in. Heb je meer apps, kies dan eerst welke je gebruikt (standaard de eerste).
4. Teamleden komen op het dashboard (of de pagina waar ze heen wilden), klanten in het klantportaal.

Wil je toch niet verder, klik dan op **Uitloggen**. Een verkeerde code geeft een melding; na te veel pogingen moet je even wachten (de limiet stelt Supabase Auth).

Zolang de code niet is ingevuld kom je nergens anders dan op de verificatiepagina en bij uitloggen, ook niet via een directe link.

## Passkeys

Inloggen met een passkey telt als tweestapsverificatie: je hebt je apparaat nodig en ontgrendelt het met vingerafdruk, gezicht of pincode. Na een passkey-login vraagt het portaal dus geen code. Zie [passkeys.md](./passkeys.md).

Supabase Auth kent een passkey-sessie alleen als aal1. Een tweede app toevoegen kan Supabase daarom pas als je met wachtwoord en code bent ingelogd. Een app verwijderen kan wel vanuit een passkey-sessie; de server doet dat dan met de secret key, alleen voor je eigen apps.

## Telefoon kwijt: resetten door een beheerder

Er zijn geen herstelcodes. Ben je je telefoon kwijt of heb je een nieuwe, vraag dan een beheerder om je tweestapsverificatie te resetten. Heb je een passkey, dan kun je daar ook nog mee inloggen en zelf de oude app verwijderen.

Voor beheerders:

1. Ga naar Instellingen (`/dashboard/instellingen`), naar de lijst met gebruikers.
2. In de kolom **2FA** staat per gebruiker **Aan** of **Uit**.
3. Klik bij de gebruiker op **2FA resetten** en bevestig. Alle authenticator apps van die gebruiker worden verwijderd.
4. De gebruiker logt daarna in met alleen een wachtwoord en kan meteen een nieuwe app toevoegen.

Reset alleen als je zeker weet dat het verzoek echt van die persoon komt, bijvoorbeeld via een telefoontje of in persoon, en niet alleen op basis van een mail. Je eigen 2FA reset je niet zelf; dat doet een andere beheerder (of je verwijdert de factor in het Supabase dashboard onder Authentication, Users).

De kolom en de knop werken alleen als `SUPABASE_SECRET_KEY` op de server staat. Zonder die sleutel staat er **Onbekend**.

## Hoe het werkt

Supabase Auth regelt de factoren (de apps), de QR-code, de controle van codes en het niveau van de sessie: aal1 na alleen een wachtwoord, aal2 na wachtwoord en code. Het portaal dwingt af dat een aal1 sessie van iemand met een app niet verder komt.

| Onderdeel | Waar in de code |
| --- | --- |
| Gedeelde controle (aal, passkey-cookie, factoren) | `src/lib/security/mfa.ts` |
| Afdwingen per request | `src/lib/supabase/proxy.ts` |
| Afdwingen in de Data Access Layer | `getCurrentUser()` in `src/lib/auth.ts` |
| Doorsturen na het wachtwoord | `src/app/login/actions.ts` |
| Codepagina bij het inloggen | `src/app/login/verificatie/*` |
| Aanzetten, verwijderen, resetten (server actions) | `src/app/dashboard/instellingen/mfa-actions.ts` |
| Instellingen (scherm) | `src/components/settings/security/mfa-*.tsx` |

Zo beslist het portaal of een ingelogde sessie nog een code nodig heeft (`checkSecondStep`):

1. De claim `aal` in de JWT is `aal2`: klaar.
2. De sessie is met een passkey begonnen (geldige `nordavo-passkey-session` cookie voor dit sessie-id): klaar.
3. Een geldige `nordavo-mfa-check` cookie voor dit sessie-id zegt dat de gebruiker geen app heeft: klaar.
4. Anders vraagt de server de gebruiker op bij Supabase Auth. Heeft die een geverifieerde app, dan moet de code eerst. Zo niet, dan zet de proxy de `nordavo-mfa-check` cookie voor tien minuten, zodat dit niet bij elk request opnieuw hoeft.

Waarom niet de lijst met factoren uit de sessiecookie? Die lijst is niet ondertekend, dus iemand met alleen het wachtwoord zou hem uit zijn eigen cookie kunnen halen. De `nordavo-mfa-check` cookie is ondertekend (HMAC met `PASSKEY_SESSION_SECRET`, of anders `SUPABASE_SECRET_KEY`) en hoort bij één sessie. Is geen van beide ingesteld, dan vraagt de server bij elk request Supabase Auth.

Kan Supabase Auth niet worden bereikt, dan geldt de sessie als niet geverifieerd en kom je op de verificatiepagina terecht met het advies opnieuw in te loggen.

Een sessie die nog een code nodig heeft, mag alleen naar:

- `/login/verificatie`
- `/auth/signout` en `/auth/confirm` (de landingspagina van e-maillinks; die wisselt alleen tokens en stuurt door)
- `/api/webhooks` en `/api/mcp`, die zichzelf met handtekeningen en tokens beveiligen

Alles anders stuurt de proxy naar `/login/verificatie?next=<pagina>`. `getCurrentUser()` doet dezelfde controle nog een keer, voor server actions en als tweede verdedigingslinie. `/api/jobs` accepteert ook een sessie van een teamlid en valt daarom onder de controle.

Voegt iemand op een ander apparaat een app toe, dan geldt die voor al zijn andere sessies binnen tien minuten.

## Inrichten in Supabase

Er is geen migratie nodig; Supabase Auth bewaart de factoren zelf.

1. Open het Supabase dashboard van het project.
2. Ga naar Authentication, Multi-Factor (bij sommige versies: Authentication, Sign In / Providers, Multi-Factor).
3. Zet **TOTP (App Authenticator)** aan, zowel inschrijven als verifiëren. Andere factoren (telefoon, WebAuthn) gebruikt het portaal niet.
4. Laat het maximale aantal factoren per gebruiker op de standaardwaarde (10) of hoger.
5. Zet `SUPABASE_SECRET_KEY` op de server voor de 2FA-kolom en de resetknop bij de gebruikers.

Staat TOTP uit in Supabase, dan meldt het portaal bij het aanzetten dat een beheerder het eerst moet inschakelen.
