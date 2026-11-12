# Mail via Resend

Alle mail die het portaal zelf verstuurt gaat via [Resend](https://resend.com): de mails van het Working Style Profile (uitnodiging, herinnering, toestemming vragen, intrekken, klaar; [working-style-profile.md](working-style-profile.md)), uitnodigingen en herinneringen voor gesprekken, het sollicitatieform en de herinnering daarvan, meldingen en uitnodigingen in Work, het weekrapport en foutmeldingen van jobs. De code staat in `src/lib/notify/mail.ts`.

## Huisstijl

Elke mail gebruikt hetzelfde ontwerp uit `src/lib/notify/layout.ts`: een nachtblauwe kop met het kompaslogo en een saffraan lijn, een witte kaart met de inhoud en een rustige voettekst. `sendMail` zet elk HTML fragment automatisch in dit ontwerp; een mail die al een volledig document is (zoals het weekrapport, dat de kop met titel gebruikt) gaat ongewijzigd mee.

Bouwstenen voor nieuwe mails:

| Functie | Wat het doet |
| --- | --- |
| `mailButton(url, label)` | Knop die ook in Outlook goed blijft (blauw, of saffraan met `{ tone: "accent" }`) |
| `mailLinkFallback(url)` | De regel "Or open this link" onder een knop |
| `mailNotice(html)` | Saffraan kader voor een waarschuwing |
| `renderMailLayout({ body, eyebrow, title, preheader, footerNote })` | Het hele document, voor een mail met een eigen titel in de kop |

Het logo is `public/email/logo-mark.png` en wordt geladen vanaf `NEXT_PUBLIC_SITE_URL`. Staat die niet op een `https://` adres (lokaal), dan valt de kop terug op een logo in tekst, zodat er nooit een kapot plaatje in een inbox staat.

## Inrichten

1. **Domein verifiëren in Resend** (Domains, Add domain). Doe dit voor elk afzenderdomein: dat van `MAIL_FROM` en, als het anders is, dat van `MAIL_FROM_RECRUITMENT`. Zet de DNS records die Resend geeft bij je DNS beheerder:
   * de **DKIM** record (TXT op `resend._domainkey`),
   * de **SPF** records op het subdomein `send` (MX en TXT), voor de bounces,
   * een **DMARC** record als die er nog niet is, bijvoorbeeld `v=DMARC1; p=none; rua=mailto:dmarc@nordavo.nl` op `_dmarc`.
   Kies bij het toevoegen de regio **eu-west-1 (Ierland)**, zodat mail vanuit de EU wordt verstuurd. Wacht tot het domein op Verified staat; tot dan weigert Resend mail vanaf dat domein.
2. **API key maken** (API Keys, Create API key) met de rechten **Sending access**, beperkt tot het domein. Meer is niet nodig.
3. **Omgevingsvariabelen zetten** bij de hosting (en lokaal in `.env.local`):

   | Variabele | Verplicht | Voorbeeld |
   | --- | --- | --- |
   | `RESEND_API_KEY` | ja | `re_...` (geheim) |
   | `MAIL_FROM` | ja | `Nordavo <systeem@nordavo.nl>` |
   | `REPORT_EMAIL_TO` | ja, voor weekrapport en foutmeldingen | `julius@nordavo.nl` |
   | `MAIL_FROM_RECRUITMENT` | nee, valt terug op `MAIL_FROM` | `Nordavo Talent <talent@nordavo.nl>` |
   | `FORMS_DEFAULT_CC` | nee | `floris@nordavo.nl` |
   | `NEXT_PUBLIC_SITE_URL` | ja, voor links en het logo | `https://portaal.nordavo.nl` |

   Het adres in `MAIL_FROM` en `MAIL_FROM_RECRUITMENT` moet op een geverifieerd domein staan. Het hoeft geen echte mailbox te zijn, maar antwoorden komen daar wel aan; mails aan kandidaten zetten de verstuurder als reply-to.
4. **Opnieuw deployen**, zodat de nieuwe variabelen geladen worden.
5. **Testen**: ga als beheerder naar Instellingen (`/dashboard/settings`), blok **Email**. Daar zie je welke variabelen goed staan. Vul een adres in, kies de afzender en klik op **Send test mail**. Gaat het mis, dan staat de reden van Resend in de melding (bijvoorbeeld een domein dat nog niet geverifieerd is). Test elke afzender een keer.

## Mail log

Elke mail die het portaal verstuurt of probeert te versturen komt in de tabel `public.mail_log` (migratie `20261109000000_mail_log.sql`). Beheerders zien die in Instellingen, tab **Mail log** (`/dashboard/settings/mail-log`):

* per mail: tijd, ontvangers, afzender, onderwerp, soort mail en status (Sent, Failed of Not sent omdat de configuratie ontbreekt), met de foutmelding van Resend als het misging;
* filteren op soort en status, en zoeken op onderwerp of een exact mailadres;
* klik op een mail voor de details, het Resend id, een voorbeeld van de mail zoals hij verstuurd is en de platte tekst versie.

Het log wordt geschreven met `SUPABASE_SECRET_KEY`; zonder die sleutel gaat de mail gewoon, maar komt hij niet in het log. Alleen beheerders kunnen het log lezen (RLS) en niemand kan het via de app wijzigen. Regels ouder dan 180 dagen worden opgeruimd zodra er nieuwe mail gelogd wordt. Geef bij een nieuwe mail een `category` mee aan `sendMail` (zie `src/lib/notify/categories.ts`), anders komt hij onder Other.

## BCC logging (inkomende mail)

Mail die je uit je eigen mailbox aan een lead of klant stuurt, komt in Activities als je je eigen BCC adres meestuurt.

### Hoe het werkt

- **Eigen adres.** Elke gebruiker met de module Sales heeft een uniek, niet te raden adres `<token>@<MAIL_BCC_DOMAIN>` (24 tekens, 96 bits willekeur). Je vindt het in Instellingen (`/dashboard/settings`), blok **BCC logging**, met **Copy** en **Replace**. Replace geeft meteen een nieuw adres; mail naar het oude adres wordt vanaf dan genegeerd. Het adres wordt gemaakt de eerste keer dat je het blok opent (`mail_bcc_token()`, tabel `mail_bcc_addresses`).
- **Alleen je eigen mail.** De afzender moet gelijk zijn aan het mailadres van de eigenaar van het BCC adres (hoofdletters tellen niet). Andere mail wordt genegeerd en gelogd als *Not from you*.
- **Koppelen.** Ontvangers in To en Cc worden gekoppeld aan een contact met precies dat mailadres (hoofdletters tellen niet). Adressen van Nordavo (`MAIL_COMPANY_DOMAINS` en hun subdomeinen), het BCC domein en de afzender tellen niet mee.
- **Eén activity per bedrijf.** Gaat een mail naar mensen van drie bedrijven, dan komen er drie activities: elk op het bedrijf en het eerste contact van dat bedrijf in de mail. Een activity heeft kanaal `mail`, type `contact`, richting `outbound`, uitkomst `verstuurd`, bron `bcc`, de datum van de mail, de verstuurder als persoon en in de notitie onderwerp, To, Cc en bijlagen. Alle gegevens staan ook in de kolom `activities.mail` (onderwerp, afzender, To, Cc, Message-ID, namen van bijlagen, gekoppelde contacten).
- **Wat gelezen wordt.** Afzender, To, Cc, onderwerp, datum, Message-ID en de namen van bijlagen. De tekst en de bijlagen zelf worden niet opgeslagen.
- **Geen dubbelen.** Per gebruiker wordt een Message-ID één keer verwerkt (status *Duplicate* daarna) en `external_id` van de activity is `bcc:<message-id>:<bedrijf>`. Een mail zonder Message-ID krijgt een vaste hash van afzender, datum, onderwerp en ontvangers.
- **Log.** Elke inkomende mail komt in `public.mail_inbound_log` met een status: `logged`, `no_match` (geen bekend contact), `duplicate`, `sender_mismatch`, `unknown_address`, `no_address`, `invalid` of `failed`. Je ziet je eigen laatste mails onder het blok BCC logging; beheerders zien daar alle mail. Regels ouder dan 180 dagen worden opgeruimd.

De code: `src/lib/mail/bcc.ts` (parsen, token, afzender, ontvangers, groeperen; tests in `tests/bcc-mail.test.ts`), `src/lib/mail/bcc-inbound.ts` (database) en `src/app/api/webhooks/inbound-mail/route.ts`. Migratie `20261123500000_mail_bcc_logging.sql`.

### Inrichten

We gebruiken al Resend, dus de voorkeur is **Resend Inbound**. Postmark Inbound of een Cloudflare Email Worker werken ook.

1. **Subdomein kiezen**, bijvoorbeeld `log.nordavo.nl`. Gebruik een apart subdomein, zodat de MX van de gewone mail van `nordavo.nl` niet verandert.
2. **DNS (MX) voor het subdomein**, bij je DNS beheerder:
   - Resend: Domains, het domein `log.nordavo.nl` toevoegen en *Receiving* aanzetten; zet de MX record die Resend daar toont op `log`.
   - Postmark: Servers, Inbound stream, *Inbound domain forwarding*: MX `log` naar `inbound.postmarkapp.com`, prioriteit 10, en vul `log.nordavo.nl` in als inbound domain.
   - Cloudflare: Email, Email Routing op `log.nordavo.nl` (Cloudflare zet de MX records), met een catch all regel naar een Email Worker.
3. **Webhook bij de provider** naar `https://<portaal>/api/webhooks/inbound-mail`:
   - Resend: Webhooks, *Add endpoint*, event `email.received`. Zet het signing secret (`whsec_...`) in `RESEND_INBOUND_WEBHOOK_SECRET`; of zet `?secret=<INBOUND_MAIL_SECRET>` achter de URL.
   - Postmark: Inbound stream, Settings, Webhook URL met Basic auth: `https://inbound:<INBOUND_MAIL_SECRET>@<portaal>/api/webhooks/inbound-mail`. Let op: Postmark stuurt bijlagen mee in de JSON; een request groter dan de limiet van de hosting (Vercel 4,5 MB) komt niet aan. Resend stuurt alleen de namen van bijlagen.
   - Cloudflare Email Worker: lees de mail met `postal-mime` en POST JSON met de header `X-Inbound-Secret`:
     `{ "from": message.from, "envelope": { "to": message.to }, "to": ..., "cc": ..., "subject": ..., "date": ..., "message_id": ..., "attachments": [{ "filename": ... }] }`.
   Andere vormen die gelezen worden: zie het commentaar boven in `src/lib/mail/bcc.ts`.
4. **Omgevingsvariabelen** bij de hosting (en lokaal in `.env.local`), daarna opnieuw deployen:

   | Variabele | Verplicht | Voorbeeld |
   | --- | --- | --- |
   | `MAIL_BCC_DOMAIN` | ja | `log.nordavo.nl` |
   | `INBOUND_MAIL_SECRET` | ja (of de Resend variabele) | lange willekeurige tekst (geheim), bijvoorbeeld `openssl rand -hex 32` |
   | `RESEND_INBOUND_WEBHOOK_SECRET` | nee | `whsec_...` (geheim), het signing secret van de Resend webhook |
   | `MAIL_COMPANY_DOMAINS` | nee | `nordavo.nl, nordavo.com`; leeg is `nordavo.nl` plus het domein van `MAIL_FROM` |
   | `SUPABASE_SECRET_KEY` | ja | de webhook schrijft met de service role |

5. **Testen**: open Instellingen, kopieer je BCC adres en stuur een mail aan een bestaand contact met dat adres in BCC. Onder *Recent mail* zie je de status; bij *Logged* staat de mail in de tijdlijn van het bedrijf.

Antwoorden van de webhook: 200 voor verwerkte en genegeerde mail (de provider probeert niet opnieuw), 401 zonder of met een fout geheim, 503 zonder `MAIL_BCC_DOMAIN`, 500 als schrijven mislukt (de provider probeert opnieuw; de Message-ID voorkomt dubbelen).

## Mail van Supabase (inloggen en uitnodigen)

Twee soorten mail komen niet uit het portaal maar van Supabase Auth: de uitnodiging uit Instellingen (`inviteUserByEmail`) en de inloglink in Work als die via Supabase gaat. Die gebruiken standaard de mailserver van Supabase, die maar een paar mails per uur toestaat en niet vanaf jullie domein verstuurt. Zet ze ook via Resend:

1. Supabase dashboard, Authentication, Emails, SMTP Settings, **Enable custom SMTP**.
2. Host `smtp.resend.com`, poort `465`, gebruikersnaam `resend`, wachtwoord: een (aparte) Resend API key. Afzender: hetzelfde adres als `MAIL_FROM`.
3. Pas onder Email Templates eventueel de teksten aan. Die templates staan in Supabase en gebruiken nog niet het ontwerp uit dit document.

## Zonder sleutel

Zonder `RESEND_API_KEY` wordt niets verstuurd en komt er een regel `[mail] not sent` in de logs. Jobs falen daar niet op (behalve het weekrapport, dat dan bewust als fout in Jobs staat), en bij een gespreksuitnodiging krijg je de boekingslink in het portaal om zelf te versturen.

## Privacy

Resend verwerkt namen, mailadressen en de inhoud van de mails namens Nordavo. Het staat daarom in [subprocessors.md](subprocessors.md). Bij BCC logging ontvangt de inbound provider de hele mail; het portaal bewaart alleen afzender, ontvangers, onderwerp, datum, Message-ID en de namen van bijlagen. Gebruik je Postmark of Cloudflare in plaats van Resend, zet die dan ook in de lijst.
