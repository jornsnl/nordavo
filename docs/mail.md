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

## Mail van Supabase (inloggen en uitnodigen)

Twee soorten mail komen niet uit het portaal maar van Supabase Auth: de uitnodiging uit Instellingen (`inviteUserByEmail`) en de inloglink in Work als die via Supabase gaat. Die gebruiken standaard de mailserver van Supabase, die maar een paar mails per uur toestaat en niet vanaf jullie domein verstuurt. Zet ze ook via Resend:

1. Supabase dashboard, Authentication, Emails, SMTP Settings, **Enable custom SMTP**.
2. Host `smtp.resend.com`, poort `465`, gebruikersnaam `resend`, wachtwoord: een (aparte) Resend API key. Afzender: hetzelfde adres als `MAIL_FROM`.
3. Pas onder Email Templates eventueel de teksten aan. Die templates staan in Supabase en gebruiken nog niet het ontwerp uit dit document.

## Zonder sleutel

Zonder `RESEND_API_KEY` wordt niets verstuurd en komt er een regel `[mail] not sent` in de logs. Jobs falen daar niet op (behalve het weekrapport, dat dan bewust als fout in Jobs staat), en bij een gespreksuitnodiging krijg je de boekingslink in het portaal om zelf te versturen.

## Privacy

Resend verwerkt namen, mailadressen en de inhoud van de mails namens Nordavo. Het staat daarom in [subprocessors.md](subprocessors.md).
