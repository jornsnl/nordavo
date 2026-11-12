# Bellen, bellers en afspraken

Dit document beschrijft het belscherm (vervangt bellen vanuit Excel), de externe bellers, de bellijsten en het afsprakenregister (vervangt de afsprakensheet). Het datamodel staat in de migraties `20261110010000_sales_crm.sql` en `20261110030000_calls_callers_meetings.sql`.

## Rollen

| Rol | Wie | Wat |
| --- | --- | --- |
| Admin | Julius | Alles: bellers beheren, lijsten openzetten, afspraken goed- of afkeuren en de fee aanpassen |
| Internal user | Teamleden met de module Sales | Bellen, afspraken toevoegen en op gehouden of no show zetten |
| External caller | Bellers van een bureau, bijvoorbeeld Webpartners | Alleen hun eigen bellijst, het belscherm en hun eigen overzicht op `/caller` |

## De belwachtrij

De wachtrij staat in `src/lib/sales/queue.ts`. Een externe beller krijgt, in deze volgorde:

1. contacten die direct aan hem zijn toegewezen (`assigned_caller_id`, met `assigned_until` leeg of vandaag of later);
2. belstappen van sequences die vandaag of eerder vallen (`sequence_tasks` met kanaal call en status open), alleen voor contacten die hij ook mag bellen;
3. de bellijsten die voor hem openstaan (`call_list_callers`, `open_until` leeg of vandaag of later), in zijn volgorde (`position`). Binnen een lijst geldt de volgorde van de opgeslagen weergave, precies zoals de tabel Contacts hem laat zien.

Een teamlid belt een gekozen bellijst, of **Sequence calls due today**.

Niet in de wachtrij komen:

* contacten met status Not interested, Do not contact of Not reached;
* contacten die aan een andere beller zijn toegewezen (voor het team: aan welke beller dan ook);
* contacten die iemand anders minder dan 30 minuten geleden heeft geopend;
* contacten met een terugbeldatum na vandaag;
* contacten die vandaag al gebeld zijn, behalve als de terugbeldatum vandaag is;
* bedrijven met leadstatus No go of Do not contact, en bedrijven in de pipeline (een fase die niet Lost is);
* contacten die uitgesloten zijn voor bellen (`public.is_suppressed` met kanaal bellen: op contact, bedrijf of mailadres, scope alle kanalen of alleen bellen);
* contacten zonder eigen nummer bij een bedrijf zonder algemeen nummer.

Elk contact staat maar één keer in de wachtrij.

## Het belscherm

Teamleden bellen op `/dashboard/calls`, externe bellers op `/caller/call`. Het is hetzelfde scherm (`src/components/calls/call-screen.tsx`):

* bovenaan het bedrijf, de prio, de route, het nummer om te bellen (mobiel van het contact, anders het algemene nummer van het bedrijf) als belknop, en de contactpersoon met het aantal pogingen en de laatste poging;
* daaronder de openingszin, de vacatures (titel, rolgroep, hoeveel dagen open, link naar de bron), red flags, de andere contacten van het bedrijf, wat het bedrijf doet en de tijdlijn met alles wat er met het bedrijf gebeurde, nieuwste eerst (wijzigingen kort op één regel).

Bij openen houdt het scherm het contact vast (`sales_claim_contact`): andere bellers zien het 30 minuten niet. Lukt dat niet omdat iemand anders het net opende, dan gaat het scherm door naar het volgende contact.

De uitkomstknoppen zijn die van de Excel: No answer, Call back (met datum), Reached: interested, Meeting planned, Reached: not interested, Referred (met naam en eventueel functie en nummer), Wrong person en Wrong number, met een optionele notitie. Elke knop roept `sales_log_call` aan, dat alle belregels toepast (pogingen en laatste poging, de regel in Activities, drie keer geen gehoor wordt Not reached en de andere contacten gaan naar Enrich, een verkeerd nummer gaat naar Enrich, een doorverwijzing wordt een nieuw contact bij hetzelfde bedrijf, een afspraak wordt een geplande afspraak met de fee van de beller en de pipeline gaat naar Meeting planned, interesse zet de pipeline op Interested, belstappen van sequences zijn klaar). Daarna opent het volgende contact.

**Next contact** laat het huidige contact los en opent het volgende in de volgorde van de wachtrij. **Stop** laat het contact ook los.

### Bellijst als sheet

Naast het belscherm staat elke bellijst ook als spreadsheet: **Sheet** op `/dashboard/calls?list=<id>&view=sheet` (en *Call sheet* op Call lists), voor externe bellers **Sheet** op `/caller/call?view=sheet`. Per contact één rij: bedrijf, contact en functie, telefoon (belknop), openingszin, open rollen, aantal vacatures, dagen open (de oudste), links (vacatures, website, LinkedIn), red flags en de status met pogingen. Het team ziet alle contacten van de lijst met *Can call now* bij wie in de wachtrij staat; een beller ziet alleen zijn eigen wachtrij. *Copy for Excel* kopieert de rijen. De uitkomst log je op het belscherm, dat het contact voor je vasthoudt. Code: `src/lib/sales/call-sheet.ts`, `src/components/calls/call-sheet.tsx`.

### Meeting planned en Cal.com

Meeting planned opent de Cal.com saleslink in een nieuw tabblad, met naam, mail en een notitie (bedrijf en de ingevulde notitie) al ingevuld. De link draagt ook `metadata[contact_id]`, `metadata[company_id]` en `metadata[caller_id]` mee.

* `NEXT_PUBLIC_CALCOM_SALES_URL`: de saleslink (https). Zet hem in de omgevingsvariabelen en deploy opnieuw.
* Zonder die variabele gebruikt een teamlid zijn eigen boekingslink uit Instellingen (blok Interviews, voor wie de module Recruitment heeft). Externe bellers hebben dan geen link: de afspraak komt wel in het register, plan de tijd dan zelf in.

De hoofdroute voor boekingen is de Cal.com taak van Claude (`claude-calcom`, [claude-jobs.md](claude-jobs.md)): die haalt elk uur de boekingen op en maakt de afspraak met `create_meeting`. De webhook `/api/webhooks/calcom` (`src/lib/integrations/calcom.ts`) blijft als inkomende extra ingang en maakt bij een boeking de afspraak in het register via `sales_save_meeting`, met de booking uid als extern id (`meetings.external_id` is uniek). De taak gebruikt dezelfde uid: wie als tweede komt, vindt de afspraak al en maakt geen dubbele (`already_known`). Dezelfde boeking twee keer via de webhook is ook geen dubbele afspraak. Een boeking vanaf het belscherm vult de geplande afspraak in die Meeting planned al maakte (zelfde contact, laatste 14 dagen). Verzetten zet de afspraak op de nieuwe uid en tijd, annuleren zet hem op Cancelled. In de tijdlijn komt een notitie over de boeking; de afspraak zelf telt mee in het rapport, zodat niets dubbel telt. Sollicitatiegesprekken gaan eerst en blijven werken zoals in [recruitment-planning.md](recruitment-planning.md).

## Bellijsten

Een bellijst is een opgeslagen weergave van de tabel Contacts met de markering bellijst. Op `/dashboard/call-lists`:

* alle bellijsten met het aantal contacten en hoeveel er nu te bellen zijn, voor wie ze openstaan en tot wanneer;
* **Open in table** opent de weergave in Contacts, **Start calling** opent het belscherm voor die lijst;
* **Open for callers** (admin): kies een of meer bellers en een einddatum; uitgevinkte bellers raken de lijst kwijt;
* **Per caller** (admin): de volgorde waarin een beller zijn lijsten afwerkt, met slepen of de pijltjes, sluiten met het kruisje, en het aantal toegewezen contacten met **Take back**. Bellers kunnen de volgorde zelf niet veranderen;
* andere opgeslagen weergaven van Contacts kun je hier als bellijst markeren.

Losse contacten of hele bedrijven zet je open met de component `AssignCallersDialog` (`src/components/calls/assign-callers-dialog.tsx`) en de server actions `assignContactsToCallers`, `assignCompaniesToCallers` en `unassignContacts` in `src/app/dashboard/call-lists/actions.ts`. Bij meer bellers gaat het om de beurt per bedrijf: alle contacten van een bedrijf gaan naar dezelfde beller. Een contact hoort bij hooguit een beller. Alleen admins zetten iets open voor bellers (RLS op `call_list_callers`); teamleden kunnen elke lijst zelf bellen.

## Externe bellers

### Toevoegen

Instellingen, tab **Callers** (`/dashboard/settings/callers`, alleen admin): vul naam, mail, telefoon, partij en fee per goedgekeurde afspraak in en klik op **Add and invite**.

* Het portaal maakt een account met rol caller (of gebruikt een bestaand account van een Work gast), koppelt het aan de beller en stuurt een uitnodiging in de huisstijl (categorie Caller invitation in het mail log). Een adres van een teamlid of klant kan geen beller worden.
* De link in de mail opent **Set password**; daarna komt de beller op `/caller/security` en zet hij verplicht een authenticator app aan. Tot die tijd werkt geen andere pagina.
* **Resend invite** stuurt een nieuwe link.
* Hiervoor is `SUPABASE_SECRET_KEY` nodig.

### Fee, pauzeren en stoppen

* **Edit**: naam, telefoon, partij en fee. Een nieuwe fee geldt voor afspraken die vanaf dan gepland worden; de fee van een enkele afspraak pas je aan op de pagina Meetings.
* **Pause**: de beller kan direct niet meer bellen (`current_caller_id` kijkt bij elk verzoek naar de status) en wordt overal uitgelogd: het account wordt geblokkeerd in Supabase Auth, zodat er geen nieuwe sessie of verversing meer kan. Wat hij open had komt vrij. Toegewezen contacten en lijsten blijven bij hem.
* **Resume**: de blokkade gaat eraf, de beller kan weer inloggen.
* **Stop**: zoals pauzeren, en zijn toegewezen contacten en lijsten gaan terug naar het team. Afspraken en fees blijven in het overzicht.

Een gepauzeerde of gestopte beller die toch nog een pagina opent, gaat naar `/login?error=caller_inactive` met een duidelijke melding.

### Wat een beller ziet en mag

Een beller heeft een eigen omgeving op `/caller` zonder portaalmenu: zijn overzicht, het belscherm en Beveiliging.

* De proxy (`src/lib/supabase/proxy.ts`) stuurt een beller bij elke andere pagina terug naar `/caller` en weigert elke API route (behalve de webhooks, die geen sessie gebruiken). Daarmee is er voor bellers nergens een export. De rol staat in de sessie (`app_metadata.portal_role`, door de database gelijk gehouden met `profiles.role`), dus dit kost geen extra query. De pagina's controleren de rol daarnaast zelf (`requireStaff`, `requireCaller`).
* Bellers hebben geen directe toegang tot tabellen (RLS). Het portaal werkt voor hen met de geheime sleutel, na `requireCaller()` (actieve beller, authenticator app), en geeft hun profiel mee als `p_actor` aan de salesfuncties. De wachtrij is altijd die van de beller zelf.
* Een beller verandert alleen de uitkomst, de terugbeldatum, naar wie hij doorverwezen is en de notitie (afgedwongen in `sales_log_call`), en alleen voor een contact dat hij vasthoudt.
* Alles wat een beller doet staat in Activities met zijn `caller_id`: elk geopend contact (type view) en elke uitkomst. Dat gebeurt in de database, niet in de browser.

## Overzichten

* **Per beller** (Instellingen, Callers, voor de admin; en op `/caller` voor de beller zelf): gebeld, bereikt, afspraken en goedgekeurd, per maand en in totaal. Gebeld telt de belregels met `caller_id` in Activities; bereikt telt Reached: interested, Meeting planned, Reached: not interested, Referred en Wrong person; afspraken en goedgekeurd komen uit het register (zonder geannuleerde).
* **Maandoverzicht**: per beller de goedgekeurde afspraken en het totaal aan fees, op de pagina Meetings (tab **Month overview**) en op `/caller` (laatste zes maanden). Een afspraak telt in de maand waarin hij plaatsvindt, of waarin hij gepland is als er nog geen tijd is.

## Resultaten per beller

**Calls, Results per caller** (`/dashboard/calls/stats`): per externe beller en per teamlid, per maand of in totaal, hoeveel er gebeld is, hoeveel bereikt (met percentage), elke uitkomst apart, afspraken en goedgekeurd, plus de laatste calls (met opname als het belsysteem die stuurde). Een beller ziet op `/caller` zijn eigen laatste calls met uitkomst en de tellingen per uitkomst. Elke poging staat meteen bij de lead (Activities met `caller_id`). De rijen van het belsysteem zelf tellen niet mee, alleen de uitkomst op het belscherm (`summarizeCallResults` in `src/lib/sales/caller-stats.ts`).

## Bellen via je eigen belsysteem (Dubline)

**Click to call.** Iedereen kiest zelf hoe de belknop belt (Settings, blok *Calling*; een beller op `/caller`): leeg is een `tel:` link (de telefoon of softphone van het apparaat), anders de click to call link van het eigen belsysteem met `{number}` (+31612345678), `{digits}` (31612345678) of `{local}` (0612345678), bijvoorbeeld `https://.../call?number={number}`. Een https link opent in een nieuw tabblad. Opgeslagen in `profiles.dial_template`.

**Gesprek en opname bij de lead.** Het belsysteem stuurt na elk gesprek een webhook:

* `POST /api/webhooks/calls` met `Authorization: Bearer <CALLS_WEBHOOK_SECRET>` (of header `X-Webhook-Secret`, of `?secret=` als het systeem geen headers kan zetten).
* JSON met een id (`id`, `call_id` of `uuid`), het nummer van de lead (`to` bij uitgaand, `from` bij inkomend, of `number`), `direction`, `started_at`, `duration`, `recording_url` (https), `status` (`answered`, `missed`, ...) en `agent_email` (mailadres van de beller in het portaal). Ook in een `data` object.
* Het nummer wordt op cijfers gematcht (`sales_phone_key`: +31 6, 06 en 0031 6 zijn hetzelfde) met het mobiel van een contact, anders het algemene nummer van een bedrijf. Het gesprek komt in Activities (kanaal bellen, bron `telephony`, met `recording_url` en `duration_seconds`) bij die lead, met de beller als `agent_email` een bekend account is. Hetzelfde id twee keer is één regel; een latere levering vult de opname aan. Geen match: 200 met `ignored`.
* Zet `CALLS_WEBHOOK_SECRET` in de omgevingsvariabelen. Zonder geheim weigert de route alles (401).

Dubline: zet in de beheeromgeving een webhook bij *gesprek beëindigd* naar de URL hierboven en kies de velden zoals boven; de exacte veldnamen van Dubline zijn niet getest, de route accepteert de gangbare namen (`src/lib/sales/telephony.ts`, `parseCallEvent`).

## Afsprakenregister

Op `/dashboard/meetings` staan alle afspraken, van het belscherm, Cal.com en met de hand: datum, bedrijf en contact, beller, reden van het gesprek, status en fee.

* Filters: maand (pijltjes), beller en status.
* **Add meeting**: zoek een bedrijf, kies contact, beller, datum, tijd en de reden. Dit gaat via `sales_save_meeting`, dus de tijdlijn en de pipeline volgen.
* **Held**, **No show** en **Cancel** kan elk teamlid zetten.
* **Approve** en **Reject** (na het gesprek) en **Fee** zijn voor de admin. De database dwingt dat af met de trigger `meetings_guard`. Een goedgekeurde afspraak levert de beller de fee op; goedkeuren legt vast wie en wanneer.

Statussen: Planned, Held, Approved, Rejected, No show en Cancelled. Elke statuswijziging komt in Activities en een gehouden of goedgekeurde afspraak zet de pipeline op Meeting held.

## Testen

* `tests/queue.test.ts`: de regels en de volgorde van de wachtrij en de verdeling over bellers.
* `tests/caller-stats.test.ts`: de tellingen per beller, de fees per maand, maandgrenzen in Amsterdamse tijd en de uitnodigingsmail.
* `tests/sales-flow.test.ts`: de sheet, de click to call link, de webhook, de resultaten per beller, triage, bezetting, keuzelijsten, eigen kolommen en campagnes.
* `tests/calcom.test.ts`: de Cal.com koppeling, ook de afspraak in het register en de vooraf ingevulde saleslink.
* `supabase/tests/sales_crm.test.sql` en `supabase/tests/calls.test.sql`: de belregels, de rol in de sessie, pauzeren en stoppen, en wie afspraken goedkeurt.
