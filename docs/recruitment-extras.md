# Recruitment extras: eigen velden en drie kleine verbeteringen

Dit document hoort bij de recruitmentbriefing van 8 november 2026, sectie 2.10 ("flexibiliteit zoals in Airtable"), plus drie punten uit eerdere feedback over Work (punten 9, 11 en 12). Migratie: [20261108050000_custom_fields_and_extras.sql](../supabase/migrations/20261108050000_custom_fields_and_extras.sql). Test: [custom_fields.test.sql](../supabase/tests/custom_fields.test.sql).

## 1. Eigen velden (custom fields)

Wat Judith nu in losse sheets en kolommen in Airtable bijhoudt, kan het team zelf als extra veld toevoegen aan:

- **Kandidaten** (bijvoorbeeld opzegtermijn, salarisverwachting, tier, tools)
- **Vacatures** (bijvoorbeeld budget per maand, startdatum klant)
- **Sollicitaties**, dus de kaart van een kandidaat in de pipeline van één vacature (bijvoorbeeld een notitie voor het hiring report)

Dit zijn de algemene velden die voor alle vacatures gelden. Vragen die per vacature verschillen horen bij het sollicitatieformulier (de form builder van een andere bouwer); die worden per vacature kolommen.

### Soorten velden

| Type | Wat je invult | Controle |
| --- | --- | --- |
| Text | Eén regel | Maximaal 500 tekens |
| Long text | Meerdere regels | Maximaal 10.000 tekens |
| Number | Getal, met punt of komma | Een echt getal |
| Date | Datum | Een bestaande dag (YYYY-MM-DD) |
| Yes/no | Ja, nee of niet ingevuld | Alleen ja of nee |
| Single choice | Eén van de opties | Moet een van de opties zijn |
| Multiple choice | Een of meer opties | Alleen opties, elk één keer |
| Link | Webadres | Begint met http:// of https:// (zonder wordt https:// ervoor gezet) |

Leeg laten mag altijd; een leeg veld wordt weggehaald.

### Waar je ze beheert

- **Settings > Fields** (`/dashboard/settings#custom-fields`): alle velden per soort record. Toevoegen, naam, hulptekst en opties wijzigen, volgorde (pijltjes), "Show as a column on the candidates list", archiveren en terugzetten.
- **Direct op de pagina**: op de kandidaatpagina, de vacaturepagina en in de pipelinekaart staat een blok *Custom fields* met **Edit** en **+ Add field**. Een veld dat je daar toevoegt, geldt meteen voor alle records van die soort.

### Wie mag wat

| Actie | Admin | Member (team) | Klant | Work gast |
| --- | --- | --- | --- | --- |
| Velden zien en waarden invullen | ja | ja | nee | nee |
| Veld toevoegen, naam, opties, volgorde, kolom in lijst | ja | ja | nee | nee |
| Veld archiveren of terugzetten | ja | nee | nee | nee |
| Veld verwijderen | nee, alleen archiveren | nee | nee | nee |

Gekozen: het hele team mag velden toevoegen, omdat "+ Add field" vanaf de kandidaatpagina anders weinig zin heeft. Archiveren is voor admins, omdat een gearchiveerd veld bij iedereen verdwijnt.

Vaste regels, afgedwongen in de database:

- **Sleutel en soort record liggen vast.** De sleutel (bijvoorbeeld `notice_period`) wordt gemaakt uit de naam. De naam zelf mag je later wijzigen.
- **Het type ligt vast**, behalve Text en Long text, die mag je omwisselen. Wil je een ander type: archiveer het veld en maak een nieuw.
- **Archiveren in plaats van verwijderen.** Een gearchiveerd veld is weg van de pagina's en neemt geen nieuwe waarden aan; opgeslagen waarden blijven bewaard en komen terug als een admin het veld terugzet.
- **Opties weghalen** mag. Records die die optie al hebben, houden hem; hij staat er dan bij als "(removed option)" tot iemand het veld aanpast. Een optie hernoemen is dus: nieuwe optie toevoegen, oude weghalen, records bijwerken.

### Kolommen, filter en sorteren in de kandidatenlijst

Zet bij een kandidaatveld **Show as a column on the candidates list** aan. Dan:

- staat het veld als kolom in `/dashboard/candidates` (op de telefoon als regel onder de kandidaat);
- klik je op de kolomkop om te sorteren: oplopend, aflopend, weer uit. Lege waarden staan altijd onderaan. Keuzevelden sorteren in de volgorde van de opties;
- verschijnt boven de lijst een filterrij. Keuze en ja/nee: kies een waarde, *Filled in* of *Empty*. Getal en datum: een waarde of `>=20`, `<=2027-01-01` (ook `>` en `<`). Tekst: een deel van de waarde.

De filters staan in de URL (`cf_<sleutel>=...`, sorteren met `sort=cf_<sleutel>&dir=desc`), dus een gefilterde lijst kun je delen.

### Hoe het technisch zit

- Definities in de tabel `public.custom_field_definitions` (entity, key, label, field_type, options, help_text, position, show_in_list, archived_at).
- Waarden in een `jsonb` kolom `custom_fields` op `candidates`, `vacancies` en `applications`, per sleutel.
- De trigger `check_custom_fields` controleert elke nieuwe of gewijzigde waarde met `validate_custom_fields()` tegen de definitie (type, opties, gearchiveerd). Waarden die niet veranderen worden niet opnieuw gecontroleerd, zodat een later gearchiveerd veld of weggehaalde optie een andere wijziging nooit blokkeert.
- `set_custom_field(entity, id, key, value)` wijzigt één waarde zonder de andere te overschrijven. Draait als de gebruiker zelf: row level security bepaalt welke records je mag wijzigen.
- De app controleert hetzelfde vooraf ([src/lib/custom-fields/index.ts](../src/lib/custom-fields/index.ts)), zodat je een nette foutmelding bij het veld krijgt.
- Componenten: [src/components/custom-fields](../src/components/custom-fields). Op de pagina's staat telkens één regel: `<CustomFieldsCard entity="candidate" recordId={id} />`, `<CustomFieldsCard entity="vacancy" ... />`, `<CustomFieldsPanel entity="application" recordId={card.id} />` in de pipelinekaart en `<CustomFieldsSettings />` in Settings.

**Let op, klanten.** Klanten zien de definities niet en kunnen niets wijzigen. De waarden staan wel op de rij zelf, net als alle andere kolommen van een kandidaat. Een klant die een voorgestelde kandidaat mag zien, kan via de API dus ook diens custom fields lezen (het klantportaal toont ze niet). Van kandidaten en sollicitaties die een klant niet mag zien, ziet hij niets, ook geen custom fields; dat test `custom_fields.test.sql`. Zet dus geen gegevens in een custom field die een klant van een voorgestelde kandidaat nooit mag kunnen zien. Moet dat later wel, dan is de volgende stap een aparte tabel voor interne waarden met eigen RLS.

## 2. Work: alle tijdzones (feedback punt 12)

In Work, Settings kon je uit acht tijdzones kiezen. Nu staat de hele IANA lijst erin (`Intl.supportedValuesOf('timeZone')`, ruim 400 zones):

- eerst een groep *Popular* (Amsterdam, Kolkata, Londen, Dubai, Singapore, New York, Los Angeles, UTC), daarna gegroepeerd per regio (Africa, America, Asia, Europe, ...);
- elke zone met zijn huidige afwijking, bijvoorbeeld "Kolkata (UTC+05:30)";
- een zoekveld dat filtert op stad, regio of afwijking ("+05:30").

De server accepteert alleen een zone van precies dezelfde lijst ([src/lib/work/time-zones.ts](../src/lib/work/time-zones.ts), `isListedTimeZone`). Oude namen zoals `Asia/Calcutta` worden opgeslagen als de huidige naam (`Asia/Kolkata`). De database controleert daarnaast dat Postgres de zone kent (trigger op `profiles.time_zone`), zodat de dagelijkse Work job nooit stukloopt op een onbekende zone.

## 3. Work gasten loggen in met een link (feedback punt 11)

Gasten en freelancers in Work hebben geen wachtwoord nodig:

- **In de uitnodigingsmail** staat voor een gast een knop **Sign in and accept**: een eenmalige inloglink die meteen de uitnodiging opent. Is die verlopen, dan opent de gast de uitnodiging en kiest *Email me a sign-in link*.
- **Later** vraagt de gast een link aan op `/work/sign-in`, of op de gewone inlogpagina `/login` onder **Invited to Work as a guest? Email me a sign-in link**.

Voor het team en klanten verandert niets: wachtwoord, passkey en de authenticator app blijven zoals ze waren, en een inloglink is voor hen bewust niet mogelijk. Dat is op drie plekken geregeld ([src/lib/security/sign-in-link.ts](../src/lib/security/sign-in-link.ts)):

1. Er wordt alleen een link gemaakt of gemaild voor een account met portaalrol `external` (alleen Work). Voor teamleden en klanten gaat er niets de deur uit; het scherm zegt hetzelfde als bij een onbekend adres, met de tip om het wachtwoord of de passkey te gebruiken.
2. `/auth/confirm` logt een sessie uit een inloglink (type `email` of `magiclink`) van een teamlid of klant direct weer uit en stuurt naar `/login` met de melding "Sign-in links are for Work guests". Dat vangt ook een link die Supabase zelf mailt als de secret key ontbreekt.
3. Heeft iemand toch een authenticator app, dan vraagt de proxy na een link nog steeds om de code (`checkSecondStep` in [src/lib/security/mfa.ts](../src/lib/security/mfa.ts) werkt op elke aal1 sessie). Niets aan de MFA regels is veranderd.

Uitnodigingen (type `invite`) en wachtwoordherstel (type `recovery`) gaan niet door deze regel.

### Handmatig in Supabase

- **Authentication > Email Templates > Magic Link.** Alleen nodig als Resend nog niet is ingesteld (dan mailt Supabase de link zelf). Zet de link op:

  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/work
  ```

  Met `RESEND_API_KEY`, `MAIL_FROM` en `SUPABASE_SECRET_KEY` maakt de app de link zelf (Engelse mail, met de juiste bestemming, bijvoorbeeld de uitnodiging) en wordt dit template niet gebruikt.
- **Authentication > Providers > Email > Email OTP Expiration.** Standaard 3600 seconden (een uur). De link in de uitnodigingsmail werkt zo lang. Zet hem op 86400 (een dag, het maximum) als gasten de uitnodiging vaak pas later openen. Daarna kunnen ze altijd een nieuwe link vragen.
- **URL Configuration > Redirect URLs** moet `https://<domein>/auth/confirm` bevatten (stond al in de Work setup).

## 4. Eén plek om te kijken (feedback punt 9)

In Work, **My overview** (`/work`) staat voor teamleden een extra tabblad **Portal tasks**: de open taken uit de module Tasks van het portaal (`public.tasks`) die aan jou zijn toegewezen, met een teller. Per taak de titel, het record waar hij bij hoort (kandidaat, vacature, klant, ...), status, prioriteit en deadline, met een link naar dat record. Alleen lezen: afvinken en wijzigen doe je in het portaal (link *Open Tasks in the portal*).

Gasten en freelancers zien dit tabblad nooit: de app toont het alleen aan admins en members, en `public.tasks` is in de database alleen voor het team leesbaar (RLS), dus ook een met de hand getypte `?tab=portal` geeft een gast niets.

## Omgevingsvariabelen

Geen nieuwe. Gebruikt worden de bestaande `SUPABASE_SECRET_KEY` (inloglinks maken), `RESEND_API_KEY` en `MAIL_FROM` (uitnodiging en inloglink mailen) en `NEXT_PUBLIC_SITE_URL` (de link zelf). Zonder Resend valt de inloglink terug op Supabase's eigen mail (template hierboven); zonder secret key wordt er geen account en geen link in de uitnodiging gemaakt.

## Tests

- `tests/custom-fields.test.ts`: controle per type, formulierwaarden, sleutels, opties, filter en sorteren.
- `tests/work-time-zones.test.ts`: volledige lijst, servercontrole, oude namen, groepen en labels.
- `tests/sign-in-link.test.ts`: wie een inloglink mag gebruiken.
- `supabase/tests/custom_fields.test.sql`: type en optiecontrole in de database, alleen het team, archiveren alleen voor admins, klanten zien geen definities en geen waarden van kandidaten die ze niet mogen zien, gasten zien niets, en de tijdzonecontrole.

## Niet gebouwd

- Custom fields in de MCP tools en in de export of het rapport. De waarden staan in `custom_fields`, dus dat kan later met een paar regels.
- Kolommen met filter voor vacatures en sollicitaties (alleen de kandidatenlijst, zoals gevraagd).
- Een apart, voor klanten afgeschermd soort veld (zie *Let op, klanten*).
