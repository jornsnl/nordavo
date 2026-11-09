# Subprocessors

Externe partijen die persoonsgegevens verwerken namens Nordavo, voor het portaal, het klantportaal, Work en het GTM systeem. Dit is de lijst voor de verwerkersovereenkomst met klanten en voor het verwerkingsregister (AVG artikel 28 en 30).

Voeg een partij toe **voordat** je een nieuwe integratie in productie zet, en houd de kolommen actueel als de regio of de verwerkersovereenkomst verandert.

## Overzicht

| Partij | Doel | Persoonsgegevens | Locatie verwerking | Verwerkersovereenkomst | Sinds |
| --- | --- | --- | --- | --- | --- |
| **Resend** (Resend, Inc., San Francisco, VS) | Versturen van transactionele mail uit het portaal: uitnodigingen en herinneringen voor gesprekken, sollicitatieforms, meldingen en uitnodigingen in Work, weekrapport, foutmeldingen | Naam en mailadres van ontvangers (kandidaten, teamleden, gasten in Work, klantcontacten), inhoud van de mail, aflever en open gegevens (logs) | EU, regio eu-west-1 (Ierland), mits het domein in die regio is aangemaakt. Het bedrijf zit in de VS | [DPA van Resend](https://resend.com/legal/dpa), met standaardcontractbepalingen (SCC's) voor doorgifte naar de VS | november 2026 |

## Resend in detail

| Onderdeel | Invulling |
| --- | --- |
| Rol | Verwerker (Nordavo is verwerkingsverantwoordelijke) |
| Categorieën betrokkenen | Kandidaten, medewerkers van Nordavo, klantcontacten, gasten (freelancers) in Work |
| Categorieën gegevens | Naam, mailadres, onderwerp en inhoud van de mail (kan vacaturetitel, gespreksdatum en links bevatten), technische gegevens over aflevering |
| Geen bijzondere gegevens | Cv's, video's en beoordelingen gaan niet mee in de mail; alleen een link naar het portaal |
| Bewaartermijn bij Resend | Verstuurde mails en logs volgens de retentie van het Resend abonnement; zet de retentie zo kort als het abonnement toestaat |
| Beveiliging | Versleuteld transport (TLS), API key met alleen verzendrechten per domein, sleutel alleen als geheime omgevingsvariabele op de server |
| Kopie bij Nordavo | Elke verstuurde mail (ontvangers, onderwerp, inhoud) staat 180 dagen in het mail log in Supabase, alleen leesbaar voor beheerders |
| Waar in de code | `src/lib/notify/mail.ts`, ontwerp in `src/lib/notify/layout.ts`, inrichting in [mail.md](mail.md) |
| Ook voor Supabase Auth | Als custom SMTP in Supabase op Resend staat (zie [mail.md](mail.md)), lopen ook de uitnodigingen en inloglinks van Supabase via Resend |

## Nog aan te vullen

De volgende diensten worden ook in de code gebruikt en verwerken mogelijk persoonsgegevens. Controleer per partij de regio en of er een getekende verwerkersovereenkomst is, en verplaats ze dan naar het overzicht hierboven:

| Partij | Gebruik in het portaal |
| --- | --- |
| Supabase | Database, inloggen en opslag van bijlagen (cv's, video's) |
| Hosting van de Next.js app | Draait het portaal en de geplande jobs |
| Anthropic (Claude API) | Kwalificatie van leads, vacatures uitlezen, cv's lezen en scoren |
| Apify | Vacatures en beslissers ophalen (fallback job S1 en S3; normaal doet Claude dit met een eigen connector) |
| Prospeo | Mailadressen zoeken en verifiëren (fallback job S4; normaal via Claude) |
| Instantly | Replies ophalen (fallback job S8; normaal via Claude, dat ook de sequences klaarzet) |
| Cal.com | Inplannen van sales en sollicitatiegesprekken |
| Google (Sheets, inloggen met Google) | De oude afsprakensheet van Web Partners lezen (fallback job), inloggen in Work |
| ClickUp | Eenmalige import naar Work |
