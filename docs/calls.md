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

* bovenaan het bedrijf, de prio, de route, het nummer om te bellen (mobiel van het contact, anders het algemene nummer van het bedrijf) als belknop, en de contactpersoon met het aantal pogingen en de laatste poging. Bij elk contact staat het algemene nummer van het bedrijf er als terugval onder (`callNumbers` in `src/lib/sales/call-brief.ts`);
* bij de prio wat het niveau betekent (de uitleg uit Settings, Sales lists, Prio) en een regel waarom: de reden van het bedrijf (`prio_reason`), anders het sterkste signaal. De echte red flags staan erbij als ze meetellen. Wat P1, P2 en P3 betekenen bepaalt Julius zelf in de uitleg van de prio lijst;
* een uitklapbare **spiekbrief** (USPs, prijsindicatie, starterfee, trade-off, dagen voor afspraken). De tekst staat in `sales_call_cheatsheet` en is te bewerken onder Settings, Sales lists, blok *Call cheat sheet* (admin). Zolang niets is opgeslagen toont het scherm de conceptteksten uit `src/lib/sales/cheatsheet.ts`; wat niet bekend is staat als [placeholder] tussen blokhaken;
* daaronder de openingszin, de signalen, de vacatures (titel, rolgroep, hoeveel dagen open, link naar de bron), red flags, bezwaar met antwoord, de vraag voor het gesprek, de andere contacten van het bedrijf, wat het bedrijf doet en de tijdlijn.

**Openingszin.** De opgeslagen zin kan een tijd bevatten ("al 22 dagen", "sinds vorige week") die veroudert. Bij het tonen worden de dagen opnieuw geteld vanaf de vacature waar de zin over gaat (titel in de zin, anders de enige of oudste), met dezelfde datum als het blok Vacancies (`currentOpeningLine`). Is die vacature niet meer open, dan blijft de zin staan met de melding dat hij over een gesloten vacature gaat. Ook de Sheet gebruikt dit.

**Signalen.** Eén vaste plek met per signaal de soort, de datum en de bron, het sterkste bovenaan. Een signaal is een rij in `signals` (`type`, `posted_at` of `first_seen_at`, `source_url`). De soorten en hun sterkte zijn de keuzelijst **Signal types** (Settings, Sales lists): de volgorde is de sterkte, de eerste is de sterkste. Ingebouwd: funding, nieuwe CTO, employee growth (medewerkersgroei), meerdere rollen, vacature lang open, nieuwe vacature, remote of extern, freelance en overig. Een nieuwe soort is een extra optie in die lijst en daarna rijen met die waarde als `type` (MCP `upsert_companies`/`update_signals` accepteren elke waarde `a-z0-9_`); er is geen migratie of code nodig. Nieuwe vacature en lang open worden uit de vacatures afgeleid (meer dan 60 dagen) als er geen eigen rij van is. Prio en openingszin gaan uit van het sterkste signaal (`buildSignals` in `src/lib/sales/signals.ts`).

**Red flags, wat ze doen, bezwaar en vraag.** `companies.red_flags` bevat losse stukjes ("Label: tekst", en zinnen die op de komma's zijn geknipt). `parseRedFlags` plakt ze weer tot hele zinnen en sorteert ze: echte red flags, wat het bedrijf doet, bezwaar met het antwoord (Waarom lastiger met Hoe oplossen), de vraag voor in het gesprek en feiten (medewerkersaantal). Regels als *Toelichting check*, *Zekerheid LinkedIn match* en *Staat al op bellijst* zijn importinformatie en worden niet getoond. Een zin die was afgekapt met "…" eindigt op de laatste hele zin. De opgeslagen data blijft zoals hij was. *What they do* toont de omschrijving zonder regels als *BELLIJST ...*, *Bronnen: ...* en *Prio (leadlijst): ...*; blijft er niets over, dan de omschrijving uit de flags.

**Tijdlijn.** Alleen contactmomenten (Activities met type contact, reply of meeting): belpogingen met uitkomst en notitie, mails, LinkedIn, afspraken en wie het deed (teamlid of externe beller). Veldwijzigingen en geopende contacten staan er niet in (die blijven in Activities op de leadpagina). Bovenaan staat wanneer er voor het laatst contact was en door wie, of dat er nog nooit contact was (`buildContactTimeline` in `src/lib/sales/timeline.ts`).

**Contacten aanpassen.** Op het belscherm kun je van elk contact van het bedrijf de naam, functie, het mobiele nummer en de mail aanpassen, het nummer als fout markeren (de belknop valt dan terug op het algemene nummer; een nieuw nummer haalt de markering weg) en een contact toevoegen. Dit gaat via `editTeamContact`/`editCallerContact` enzovoort (`src/lib/sales/call-contacts.ts`) en drie functies uit `20261124300000_call_screen_contacts.sql`: `sales_caller_update_contact`, `sales_caller_mark_phone` en `sales_caller_add_contact`. Een beller mag dit alleen bij een bedrijf waarvan hij een contact vasthoudt, alleen deze velden, en het staat met zijn `caller_id` in Activities (wijzigingen via het wijzigingslogboek, de markering en een nieuw contact als eigen regel). Een nieuw contact krijgt rol Extra, status New (Enrich zonder nummer) en gaat naar de beller, zoals een doorverwijzing.

Bij openen houdt het scherm het contact vast (`sales_claim_contact`): andere bellers zien het 30 minuten niet. Lukt dat niet omdat iemand anders het net opende, dan gaat het scherm door naar het volgende contact.

De uitkomstknoppen zijn die van de Excel: No answer, Call back, Reached: interested, Meeting planned, Reached: not interested, Referred, Wrong person en Wrong number. Alleen **No answer** slaat met één tik op (met de notitie erboven). Elke andere knop opent eerst een klein venster (`src/components/calls/outcome-dialog.tsx`, ook te gebruiken in de Sheet) en pas na **Save** wordt het gesprek opgeslagen en opent het volgende contact:

| Uitkomst | Het venster vraagt |
| --- | --- |
| Call back | datum en tijd (verplicht), met wie, notitie |
| Reached: interested | waar de interesse in zit, de volgende stap (info mailen, terugbellen, afspraak) en wanneer (verplicht), de eigenaar (alleen team), notitie |
| Meeting planned | waar de afspraak over gaat (verplicht, wordt de reden in het afsprakenregister), met wie (alleen bij meer dan één Cal.com link), notitie; Save slaat het gesprek nog niet op maar opent de agenda in het belscherm, zie [Meeting planned en Cal.com](#meeting-planned-en-calcom) |
| Reached: not interested | een of meer redenen uit de lijst en/of eigen woorden (minstens één), en of we later nog eens terug mogen met een datum |
| Referred | naam (verplicht), functie, telefoon en mail |
| Wrong person | werkt hier niet meer of verkeerde functie, en wie het wel is (als bekend, wordt een nieuw contact) |
| Wrong number | het juiste nummer, als bekend |

Elke knop roept `sales_log_call` aan, dat alle belregels toepast (pogingen en laatste poging, de regel in Activities, drie keer geen gehoor wordt Not reached en de andere contacten gaan naar Enrich, een verkeerd nummer gaat naar Enrich tenzij het juiste nummer bekend is, een doorverwijzing wordt een nieuw contact bij hetzelfde bedrijf, een afspraak wordt een geplande afspraak met de fee van de beller en de pipeline gaat naar Meeting planned, interesse zet de pipeline op Interested en legt de volgende stap en eigenaar bij het bedrijf, belstappen van sequences zijn klaar). Het venster en de server controleren dezelfde regels (`outcomeProblem` in `src/lib/sales/call-outcome.ts`).

**Wie komt hierna.** No answer, Wrong number en Wrong person gelden de persoon: het volgende contact van hetzelfde bedrijf volgt. Call back, Interested, Meeting planned en Not interested gelden het bedrijf: de andere contacten van dat bedrijf worden in deze sessie overgeslagen en het volgende bedrijf volgt. Na Referred is het doorverwezen contact het eerstvolgende (ook als het niet in de lijst staat, zolang het gebeld mag worden). Zie `preferEntries` in `queue.ts`.

**Ongedaan maken.** Na het opslaan staat 10 seconden een melding onderin het scherm met **Undo**. De melding zweeft over de pagina, dus de knoppen verschuiven niet. Het gesprek wordt meteen echt opgeslagen (het contact is dan vrijgegeven, de wachtrij klopt); Undo roept `sales_undo_call` aan, dat alles terugzet wat het gesprek veranderde (contact, andere contacten, bedrijf, sequences, campagnes, nieuw contact, geplande afspraak) en de regels uit Activities haalt, en houdt het contact opnieuw vast voor de beller. Het mag alleen door degene die het gesprek logde, binnen een minuut en zolang niemand het contact sindsdien aanraakte. Een boeking die al in Cal.com is gedaan wordt niet geannuleerd. De snapshot staat in `call_undo` (alleen de functies komen erbij).

### Not interested en afwijzingen

Not interested vraagt minstens één reden (de lijst **Rejection reasons** onder Settings, Sales lists: eigen redenen toevoegen, hernoemen, verbergen) of eigen woorden. Wat er gebeurt:

* de reden(en) en de eigen woorden staan in `call_rejections` (en in het gesprek in Activities);
* zonder datum: het bedrijf gaat naar **lost** (lost reason = de redenen en de eigen woorden) en bucket no go;
* met een datum (verplicht bij de reden *Wrong moment*, optioneel bij "later nog eens"): het bedrijf wordt **geparkeerd** tot die datum (pipeline stage parked, bucket parked) en het contact wacht tot dan;
* in beide gevallen: sequences van het bedrijf pauzeren, lopende campagneleden gaan op stopped (Claude haalt ze in Instantly en Seleqt weg) en het bedrijf komt niet meer in de wachtrij tot de datum. Een bedrijf dat al in de pipeline zit (een andere fase dan lost of parked) blijft ongemoeid; de afwijzing staat dan alleen bij het contact.

Op **Call results** staat het blok **Rejections per reason**: per reden het aantal, het aandeel en per beller, voor de gekozen maand en eventueel één beller. Een klik op een reden toont de bedrijven; zonder gekozen reden staan de eigen woorden van de bellers eronder, om veelvoorkomende antwoorden later als vaste reden toe te voegen. **Latest calls** is te filteren op uitkomst, beller en periode.

**Next contact** laat het huidige contact los en opent het volgende in de volgorde van de wachtrij. **Stop** laat het contact ook los.

### Bellijst als sheet

Naast het belscherm staat elke bellijst ook als spreadsheet waarin je kunt werken: **Sheet** op `/dashboard/calls?list=<id>&view=sheet` (en *Call sheet* op Call lists), voor externe bellers **Sheet** op `/caller/call?view=sheet`. Het team ziet alle bedrijven van de lijst met *Can call now* bij wie in de wachtrij staat; een beller ziet alleen zijn eigen wachtrij.

* **Eén rij per bedrijf**, uitklapbaar naar alle contactpersonen (ook die niet te bellen zijn) met eigen nummer, status, pogingen, laatste uitkomst en terugbelmoment. Kolommen: bedrijf, telefoon van het eerste te bellen contact (belknop), laatste uitkomst, pogingen (alle contacten samen), terugbelmoment (de eerste), laatste notitie, wie het laatst belde, notitieveld, openingszin (zoals hij vandaag klopt), open rollen, aantal vacatures, dagen open (de oudste), links, red flags en of er nu gebeld kan worden.
* **Uitkomsten per contact**: alle knoppen van het belscherm (labels en volgorde uit Instellingen, Sales lists). No answer slaat direct op, met de notitie uit de rij; de rest opent hetzelfde vervolgvenster als op het belscherm (`OutcomeDialog`, hier als zijpaneel). Opslaan gaat via `sales_log_call` (`recordCall` in `call-session.ts`, dezelfde functie als het belscherm) en opent geen volgend contact: de sheet blijft staan. Na opslaan staat er een toast met Undo (`sales_undo_call`, 10 seconden). Meeting planned opent de Cal.com link zoals op het belscherm.
* **Notitieveld per rij**: wat je typt gaat mee met de eerstvolgende uitkomst van dat bedrijf (als beginwaarde van de notitie in het venster, bij No answer direct) en wordt daarna leeggemaakt. Het is dus geen losse notitie zonder uitkomst.
* **Vasthouden**: een rij uitklappen houdt het eerste te bellen contact vast (`sales_claim_contact`), een uitkomst kiezen of op een nummer klikken houdt dat contact vast. Inklappen of de pagina verlaten laat los; na een uitkomst laat de database dat contact los. Is het contact net door iemand anders geopend, dan staat dat bij de rij.
* **Contacten aanpassen**: bewerken, nummer fout markeren en toevoegen in de rij, met dezelfde acties als het belscherm (`call-contacts.ts`). Daarna wordt de rij opnieuw geladen.
* **Geschiedenis** per rij uitklapbaar: de contactmomenten (bellen, mail, LinkedIn, afspraken) zoals de tijdlijn op het belscherm (`loadCompanyTimeline`). Een beller ziet de geschiedenis van bedrijven die hij vasthoudt of zelf belde.
* **Filters**: *Can call now*, *Call back today* (terugbeldatum vandaag of eerder), *No answer, 1 or 2 times* (een contact dat 1 of 2 keer is gebeld en waarvan de laatste uitkomst No answer is) en *Interested, no next step* (laatste uitkomst Reached: interested en geen volgende stap op het bedrijf). Daarnaast zoeken op bedrijf, contact, rol of notitie.
* *Copy for Excel* kopieert de zichtbare rijen, per contact een regel, met erbij laatste uitkomst, pogingen, terugbellen, laatste notitie en wie het laatst belde.

Code: `src/lib/sales/call-sheet.ts` (rijen, filters, Excel), `call-sheet-data.ts` (laden), `call-sheet-actions.ts` (server acties), `src/components/calls/call-sheet.tsx`.

### Meeting planned en Cal.com

Een afspraak telt pas als de boeking in Cal.com er is (migratie `20261125100000_meeting_booking_flow.sql`). De stappen:

1. **Save** in het venster van Meeting planned roept `sales_start_booking` aan: er komt een afspraak met status **Awaiting booking** (de reden, de beller, met wie), zonder datum. Er wordt niets in Activities gezet, de pipeline verandert niet en de tellers in Overview, het rapport en bij de bellers tellen hem niet mee. Het contact blijft open op het belscherm (de blokkade van 30 minuten wordt ververst).
2. De agenda opent in een venster op het belscherm (`BookingModal`, een iframe met een link "open in een nieuw tabblad" als de browser het blokkeert). De link is vooraf ingevuld met naam, mailadres, **Bedrijfsnaam** en **Welke rol zoek je?** (de titels van de open vacatures van het bedrijf; de namen van de Cal.com vragen staan per link in Instellingen). Is het mailadres onbekend, dan staat het veld leeg en vult de beller het tijdens het gesprek in; het mailadres van het contact staat al op het belscherm. De link draagt ook `metadata[contact_id]`, `metadata[company_id]`, `metadata[caller_id]` en `metadata[meeting_id]` mee.
3. Het belscherm vraagt elke 4 seconden of de boeking binnen is (`bookingState`). Zodra de afspraak **Planned** is, logt de database het gesprek (`sales_finish_booking`, aangeroepen door de trigger `meetings_after_change`: poging, Reached, de regel in Activities, pipeline naar Meeting planned, belstap klaar) en opent het scherm het volgende bedrijf. Kiest de beller in plaats daarvan een andere uitkomst, of drukt hij op **Not booked**, dan vervalt de afspraak (`sales_cancel_booking`, stil: geen regel in Activities) en blijft het lead gewoon open. Sluit hij het scherm of gaat hij naar het volgende contact, dan blijft de afspraak op Awaiting booking staan en kan de boeking er nog steeds op landen.
4. Is de boeking na een uur nog niet binnen, dan krijgt de beller een melding bovenaan Overview (`/caller`) en staat de afspraak in Mijn afspraken met de status Awaiting booking en de datum waarop hij wachtte.
5. Een beller of teamlid die de agenda met de knop **Agenda** opent en daar al boekt zonder uitkomst te kiezen, krijgt de afspraak als gewone Planned afspraak (de webhook maakt hem); kiest hij daarna Meeting planned, dan vult `sales_start_booking` die afspraak in (laatste 3 uur, zelfde contact) en logt het gesprek meteen.

**De agenda altijd bereikbaar.** Op het belscherm staat bij Stop en Next contact de knop **Agenda**, ook tijdens het gesprek. Hij opent dezelfde agenda zonder dat er een uitkomst wordt opgeslagen. Op de Sheet opent de agenda na Save.

**De Cal.com link instellen.** Instellingen, tab General, blok **Sales meetings** (alleen admin, tabel `sales_booking_links`): een of meer links met een naam (bijvoorbeeld Julius en Floris). Bij meer dan één link kiest de beller in het venster van Meeting planned met wie de afspraak is (`meetings.with_label`, zichtbaar in Meetings) en kan hij in de agenda wisselen. De migratie zet de link `https://cal.com/nordavo-support-jwoop2/kennismaking` er als eerste in. Staat er niets, dan is `NEXT_PUBLIC_CALCOM_SALES_URL` de enige link; de interviewlink van een teamlid is nooit een saleslink. Zonder link werkt de knop Agenda niet; Meeting planned maakt dan wel de afspraak in Awaiting booking, die de beller via Cal.com zelf moet laten boeken.

De hoofdroute voor boekingen is de Cal.com taak van Claude (`claude-calcom`, [claude-jobs.md](claude-jobs.md)): die haalt elk uur de boekingen op en maakt de afspraak met `create_meeting`. De webhook `/api/webhooks/calcom` (`src/lib/integrations/calcom.ts`) blijft als inkomende extra ingang en maakt bij een boeking de afspraak in het register via `sales_save_meeting`, met de booking uid als extern id (`meetings.external_id` is uniek). De taak gebruikt dezelfde uid: wie als tweede komt, vindt de afspraak al en maakt geen dubbele (`already_known`). Dezelfde boeking twee keer via de webhook is ook geen dubbele afspraak. Een boeking vult eerst de afspraak in die wacht op boeking (zelfde bedrijf en contact, laatste 14 dagen): die krijgt de uid, de datum en tijd, de bron Cal.com en de beller, en wordt Planned. Verzetten zet de afspraak op de nieuwe uid en tijd, annuleren zet hem op Cancelled. In de tijdlijn komt een notitie over de boeking; de afspraak zelf telt mee in het rapport, zodat niets dubbel telt. Sollicitatiegesprekken gaan eerst en blijven werken zoals in [recruitment-planning.md](recruitment-planning.md).

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
* Een beller verandert alleen de uitkomst, de terugbeldatum, naar wie hij doorverwezen is en de notitie (afgedwongen in `sales_log_call`), en alleen voor een contact dat hij vasthoudt. Daarnaast mag hij de naam, functie, het mobiele nummer en de mail van de contacten van dat bedrijf aanpassen, een nummer als fout markeren en een contact toevoegen (`sales_caller_update_contact`, `sales_caller_mark_phone`, `sales_caller_add_contact`); verder niets.
* Alles wat een beller doet staat in Activities met zijn `caller_id`: elk geopend contact (type view) en elke uitkomst. Dat gebeurt in de database, niet in de browser.

## Overzichten

* **Per beller** (Instellingen, Callers, voor de admin; en op `/caller` voor de beller zelf): gebeld, bereikt, afspraken en goedgekeurd, per maand en in totaal. Gebeld telt de belregels met `caller_id` in Activities; bereikt telt Reached: interested, Meeting planned, Reached: not interested, Referred en Wrong person; afspraken en goedgekeurd komen uit het register (zonder geannuleerde).
* **Week, maand of totaal** (`/caller` en Instellingen, Callers): kies een periode (de week loopt van maandag tot en met zondag, Amsterdamse tijd). Per periode: gebeld, bereikt, terugbellen, geïnteresseerd, afspraken gepland, gehouden en goedgekeurd, het percentage bereikt en het percentage bereikte gesprekken dat een afspraak werd. Gehouden telt Held, Approved en Rejected. De admin ziet alle bellers naast elkaar.
* **Weekdoel**: `callers.weekly_call_goal` (standaard 100 belpogingen per week), door de admin in te stellen bij Edit van een beller. De beller ziet op `/caller` hoe ver hij is; de admin ziet het per beller in de kolom This week.
* **Vandaag terugbellen** (`/caller`): de laatste uitkomst Call back per contact die nog wacht en vandaag of eerder is, verlopen bovenaan, met een belknop. Een latere uitkomst beëindigt het terugbelmoment. Het terugbelmoment is een datum (`contacts.callback_at` is een date); een tijdstip bestaat nog niet.
* **Your calls klikbaar**: een regel opent `/caller/contact/[id]` (alleen een contact dat die beller gebeld heeft). Daar een notitie toevoegen (`caller_add_call_note`) en een uitkomst corrigeren met verplichte reden (`caller_correct_call`; de reden, de oude en de nieuwe uitkomst komen als notitie in Activities). Meeting planned, Referred en Call back kan de beller niet corrigeren (gevolgen voor afspraak, nieuwe contact of datum): dat doet het team. Een correctie past alleen de uitkomst van de poging aan, niet de status van het contact. Filters op uitkomst en periode.
* **My meetings** (`/caller`): de afspraken van de beller met bedrijf, contact, datum en tijd, reden, fee en status.
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

**No show afhandelen.** Bij een Planned afspraak en bij een No show staat de knop **Move** (bij No show: **Called, new time**). Het venster legt vast dat je gebeld hebt (bereikt, geen gehoor of voicemail, met notitie) en geeft dezelfde afspraak de nieuwe datum en tijd; de status gaat terug naar Planned. De afspraak blijft dezelfde met zijn geschiedenis: de no show, het telefoontje en de nieuwe tijd staan in Activities bij de afspraak (`rescheduleMeeting` in `src/app/dashboard/meetings/actions.ts`). Verzetten in Cal.com zelf werkt ook: de webhook en de Claude taak zetten een Cancelled of No show afspraak terug op Planned met de nieuwe tijd.

Statussen: Awaiting booking, Planned, Held, Approved, Rejected, No show en Cancelled. Awaiting booking telt nergens mee. Elke statuswijziging komt in Activities en een gehouden of goedgekeurde afspraak zet de pipeline op Meeting held.

## Testen

* `tests/queue.test.ts`: de regels en de volgorde van de wachtrij en de verdeling over bellers.
* `tests/caller-stats.test.ts`: de tellingen per beller, de fees per maand, maandgrenzen in Amsterdamse tijd en de uitnodigingsmail.
* `tests/sales-flow.test.ts`: de sheet, de click to call link, de webhook, de resultaten per beller, triage, bezetting, keuzelijsten, eigen kolommen en campagnes.
* `tests/call-brief.test.ts`: red flags opschonen, de openingszin van vandaag, de prio regel, signalen, de tijdlijn met contactmomenten, de Sheet, de spiekbrief en het controleren van een contactwijziging.
* `tests/calcom.test.ts`: de Cal.com koppeling, ook de afspraak in het register en de vooraf ingevulde saleslink.
* `tests/call-outcome.test.ts`: wat elk venster vraagt, persoon of bedrijf, de reden-lijst en de telling van afwijzingen.
* `supabase/tests/sales_crm.test.sql` en `supabase/tests/calls.test.sql`: de belregels, de rol in de sessie, pauzeren en stoppen, wie afspraken goedkeurt, Not interested (lost, geparkeerd, reden-lijst) en ongedaan maken.
