# Werving: sollicitatieform, kandidaatmail en salaris

Dit document beschrijft het sollicitatieform per vacature uit de wervingsbriefing van 8 november 2026 (secties 2.8, 2.9, 2.6.4 en de voorbeelden in sectie 3): hoe je het gebruikt, hoe het gebouwd is en wat je moet inrichten.

## In het kort

Elke vacature krijgt een eigen form dat je in het portaal bewerkt, ongeveer zoals in de Airtable editor. Kandidaten vullen het in zonder account via een link. De antwoorden komen direct in het systeem: de kandidaat wordt gevonden of aangemaakt (op mail, anders op telefoon), komt in de pipeline van de vacature, en bekende vragen vullen de velden van de kandidaat (naam, mail, telefoon, LinkedIn, video, huidige werkgever, jaren ervaring, opzegtermijn, verhuizen). Alle kandidaten blijven in een tabel, ook als het form per vacature anders is. Elke vraag is een kolom in het overzicht Responses, met filteren en sorteren.

| Onderdeel | Waar in de code |
| --- | --- |
| Datamodel, rechten, publieke inzending | `supabase/migrations/20261108020000_recruitment_forms.sql` |
| SQL test (RLS met rollen) | `supabase/tests/recruitment_forms.test.sql` |
| Vraagtypes, blokken, validatie van het form | `src/lib/forms/schema.ts` |
| Antwoorden valideren en op de kandidaat zetten | `src/lib/forms/answers.ts` |
| Omrekenen INR en EUR | `src/lib/forms/compensation.ts` |
| Sjablonen fulltime en freelance | `src/lib/forms/templates.ts` |
| Herinneringen (regels), mailteksten | `src/lib/forms/reminders.ts`, `src/lib/forms/mail-content.ts` |
| Responses filteren en sorteren | `src/lib/forms/responses.ts` |
| Publiek form | `src/app/apply/[token]/` |
| Editor, versturen, responses | `src/app/dashboard/vacancies/[id]/form/`, `.../responses/` |
| Salaris en payslip | `src/components/forms/compensation-*.tsx` |
| Wisselkoers | `src/app/dashboard/exchange-rate/` |
| Herinneringsjob | `src/jobs/forms-reminders.ts`, planning in `.github/workflows/forms-jobs.yml` |
| Unit tests | `tests/forms.test.ts` |

## Gebruik

### Form maken en bewerken

Op de vacaturepagina staat de kaart **Application form**. Kies **Create form** en begin met:

* **Fulltime role**: gebaseerd op het PHP & Laravel form uit de briefing. Gegevens, hoe je ons vond, technische achtergrond, CV en video, en huidige en verwachte CTC per jaar, opzegtermijn en verhuizen naar Bengaluru.
* **Freelance role**: gebaseerd op het Freelance GTM Engineer form. Vijf blokken, tools, eigen scrapers, Europese data, een projectvoorbeeld, uurtarief in INR met de budgetcheck (₹500 tot ₹1.000 per uur) en CV en video.
* **Copy from another vacancy**: neemt het form van een eerdere vacature over (met nieuwe ids, zodat antwoorden van twee vacatures nooit door elkaar lopen).

In de editor:

* **Add group** maakt een nieuw blok met titel en uitleg. Blokken en vragen versleep je met het handvat, of met de pijltjes.
* De **+** tussen twee vragen voegt daar een vraag in.
* Per vraag: tekst, uitleg of instructie (links mogen), verplicht, breedte (twee vragen op halve breedte staan naast elkaar), type en waar het antwoord heen gaat bij de kandidaat (**Saves to candidate**).
* Types: korte tekst, lange tekst, mail, telefoon, link, getal, een keuze, meerdere keuzes, ja/nee, bestand (CV), huidige CTC, verwachte CTC en uurtarief. De keuzes bewerk je als lijst, een per regel.
* **Check question** bij een ja/nee vraag: het verwachte antwoord. Een ander antwoord wordt rood in Responses (bijvoorbeeld de budgetcheck).
* Titel, introductie (met links: `[tekst](https://...)`), headerafbeelding en logo staan bovenaan. Zonder headerafbeelding toont het form een band in Nordavo blauw.
* **Save draft** bewaart, **Publish** zet een nieuwe versie live. Tot je publiceert zien kandidaten de vorige versie. **Close form** sluit het form; de links tonen dan dat het gesloten is.
* **Preview** toont de bewaarde versie zoals een kandidaat hem ziet.

Elke gepubliceerde versie blijft bewaard. Een antwoord onthoudt op welke versie het gegeven is, dus als je later een vraag weghaalt blijft het oude antwoord zichtbaar (in Responses met "no longer in the form").

### Links

* **General link**: voor vacaturebanken en posts. Nieuwe sollicitanten komen in Sourced, zodat de techstack check nog gebeurt. Bekende kandidaten (zelfde mail of telefoon) krijgen alleen lege velden aangevuld, omdat iedereen elk mailadres kan intypen.
* **Headhunted link**: voor mensen die we zelf benaderen. Wie via deze link invult, krijgt origin en source headhunted (2.6.4).
* **Personal link**: per sollicitatie, gemaakt bij het versturen. Zo weten we precies wie invulde; de gegevens van die kandidaat worden bijgewerkt met wat hij invult, en zijn naam en mail staan al ingevuld.

Is een link te ver verspreid, maak dan met het pijltje een nieuwe. De oude werkt dan meteen niet meer.

### Versturen en bijhouden (2.9)

**Send & track** (ook via **Send form** bovenaan de pipeline):

1. Vink kandidaten aan, vul eventueel een CC in (bijvoorbeeld Floris) en een deadline.
2. **Send form** stuurt **een mail per kandidaat** met zijn eigen link. Nooit BCC. Antwoorden gaan naar wie verstuurde (reply-to).
3. Kandidaten in Sourced of Techstack check gaan naar Fill out (via `move_applications`).
4. Het overzicht laat per kandidaat zien: niet verstuurd, wacht, deadline voorbij, herinnerd, ingevuld.
5. Een ingevuld form zet de kandidaat van Fill out naar Video review.

De pipeline kan naar deze pagina linken met geselecteerde kandidaten: `/dashboard/vacancies/<id>/form/tracking?applications=<id>,<id>`.

**Zonder RESEND_API_KEY** wordt niets gemaild. Het portaal zegt dat duidelijk; de knop heet dan "Mark as sent and show links" en toont de persoonlijke links om te kopiëren. "Only make links" maakt alleen de links, zonder iets als verstuurd te markeren.

**Herinneringen**: de job `forms-reminders` draait elke ochtend om 09:00. Wie na de deadline nog niet heeft ingevuld, krijgt een herinnering met zijn link (CC zoals de eerste mail). Per form stel je in hoe vaak (standaard een keer, maximaal drie) en hoeveel dagen ertussen. Geen herinnering als de kandidaat al verder is in de pipeline, geparkeerd of afgewezen is, of geen mailadres heeft. Zonder mail telt de job alleen wie een herinnering zou krijgen.

### Responses

**Responses** toont alle antwoorden: elke vraag is een kolom. Onder elke kop staat een filter (tekst bevat, keuze, ja/nee, of voor getallen `>=5`, `<=10`, `3-6`). Klik op een kop om te sorteren. CTC staat er per jaar, per maand en per maand in euro; uurtarieven in INR en EUR. Het CV opent via een korte, ondertekende link.

### Salaris en tarief (2.8)

* **Fulltime**: huidige en verwachte CTC per jaar in INR uit het form. Overal getoond als per jaar INR, per maand INR (jaar gedeeld door 12) en per maand EUR. Kandidaten mogen `1200000`, `12,00,000` of `12 LPA` typen.
* **Freelance**: uurtarief in INR, ook getoond in EUR per uur.
* **Gevraagd en uitonderhandeld** hebben elk hun eigen plek. Het gevraagde bedrag komt uit het form, het uitonderhandelde bedrag vul je zelf in (Edit in de kaart Compensation). Bij het opslaan van een uitonderhandeld bedrag wordt de koers van dat moment erbij bewaard, zodat het eurobedrag later niet verschuift.
* **Payslip**: zet de datum waarop je de payslip hebt opgevraagd en upload hem als je hem hebt (attachment soort payslip).
* De kaart staat op de kandidaatpagina en in het detailvenster van een kaart in de pipeline.
* **Wisselkoers**: `/dashboard/exchange-rate` (link in de kaart Compensation). Admins voeren een nieuwe koers in met zijn datum; iedereen in het team ziet hem. Zonder koers toont het portaal alleen roepies.

Salaris, payslips, antwoorden, forms en links zijn alleen voor het team. Klanten zien hier niets van, ook niet van voorgedragen kandidaten (afgedwongen met RLS en getest in de SQL test).

## Techniek

### Tabellen

| Tabel | Wat |
| --- | --- |
| `recruitment_forms` | Een form per vacature: concept (`blocks` jsonb), titel, intro, soort rol, afbeeldingen, laatste versie, status, tokens voor de algemene en headhunted link, herinneringsinstellingen |
| `recruitment_form_versions` | Elke gepubliceerde versie, onveranderlijk (alleen `publish_recruitment_form()` schrijft) |
| `form_invites` | Persoonlijke link per sollicitatie: token, verzonden, CC, deadline, herinneringen, ingevuld |
| `form_responses` | Antwoorden per sollicitatie (jsonb op vraag-id) met formversie en via welke link |
| `application_compensation` | Gevraagd en uitonderhandeld per sollicitatie, met de bewaarde koers en payslip opgevraagd |
| `exchange_rates` | INR per EUR met datum; de nieuwste geldt |
| `form_submission_attempts` | Inzendingen per gehasht IP, voor de limiet (alleen service role) |

Nieuwe kolommen op `candidates`: `current_company`, `notice_period`, `willing_to_relocate`. De vaste kolommen `form_sent_at`, `form_completed_at` en `form_reminded_at` op `applications` worden bijgehouden.

### Publiek form en veiligheid

* `/apply/<token>` staat in de publieke paden van de proxy. De pagina leest met de service role alleen de gepubliceerde versie van dat ene form (en bij een persoonlijke link naam, mail en telefoon van die ene kandidaat om in te vullen).
* De inzending is een server action: strikte validatie met zod per vraagtype, honeypotveld, minimale invultijd en maximaal vijf inzendingen per IP per tien minuten. Daarna een database-functie `submit_recruitment_form` (alleen service role) die in een transactie de kandidaat vindt of maakt, de sollicitatie maakt of bijwerkt, de antwoorden en het gevraagde salaris opslaat en de fase doorzet. Het CV gaat naar de private bucket `attachments` onder `candidate/<id>/...` (PDF, DOC, DOCX, maximaal 10 MB) en `attach_form_cv` legt het vast als attachment van soort `cv`.
* Headerafbeelding en logo staan privé in dezelfde bucket onder `vacancy/<id>/...`; het publieke form krijgt signed URLs van een uur.
* Automatisch doorzetten na het invullen gebeurt met `forms_advance_application()` in plaats van `move_applications()`: die laatste is alleen voor ingelogd team en de service role heeft geen gebruiker. Het is dezelfde update van `stage` en `position`, dus geschiedenis en kandidaatstatus lopen via dezelfde triggers.
* **Gerepareerd**: de opslagregel voor klanten uit de foundation migratie keek in `public.attachments` of een bestand een CV is, maar klanten mogen die tabel niet lezen. Daardoor kon een klant een payslip van een voorgedragen kandidaat openen. De regel gebruikt nu `storage_attachment_kind()` (security definer). De SQL test controleert het.

### Mail

`sendMail` in `src/lib/notify/mail.ts` heeft er optioneel `cc`, `replyTo` en `from` bij; bestaande aanroepen werken als voorheen. Mail aan kandidaten gaat van `MAIL_FROM_RECRUITMENT` (valt terug op `MAIL_FROM`), zodat het niet het domein van de cold mail deelt.

## Inrichten

1. Migratie draaien: `supabase/migrations/20261108020000_recruitment_forms.sql`.
2. Omgevingsvariabelen (ook in `.env.example`):
   * `SUPABASE_SECRET_KEY`: nodig voor het publieke form en de job.
   * `NEXT_PUBLIC_SITE_URL`: de links in de mails, bijvoorbeeld `https://portal.nordavo.nl`.
   * `RESEND_API_KEY` en `MAIL_FROM_RECRUITMENT`, bijvoorbeeld `Nordavo Talent <talent@nordavo.nl>`. Verifieer dat domein in Resend, los van het cold mail domein.
   * `FORMS_DEFAULT_CC` (optioneel): standaard CC bij versturen, bijvoorbeeld `floris@nordavo.nl`.
   * `CRON_SECRET`: voor de herinneringsjob via `POST /api/jobs/forms-reminders`.
3. Een admin zet de eerste wisselkoers op `/dashboard/exchange-rate`.
4. GitHub: de workflow `forms-jobs.yml` gebruikt de secrets `CRON_SECRET` en `NEXT_PUBLIC_SITE_URL`. Handmatig: `npm run job -- forms-reminders --dry-run=1`.

## Nog niet gebouwd

* Een selectie in de pipeline zelf met een knop "Send form": de pipeline is van een andere bouwer. De pagina Send & track neemt een selectie over via `?applications=`, en `sendFormAction` kan direct worden aangeroepen.
* Export van Responses naar CSV.
* Antwoorden achteraf bewerken door het team (ze zijn alleen te lezen en te verwijderen).
