# Sales CRM

Dit document beschrijft het sales CRM van het portaal (feedback Julius, "leads, outreach en pipeline"): wie wat doet, welke statussen er zijn, hoe de pipeline loopt, wat er in Activities komt, welke regels de database afdwingt en wat Claude doet. Voor de oudere GTM jobs (signalen, kwalificatie, verrijking) zie [gtm.md](./gtm.md); voor de MCP server zie [mcp.md](./mcp.md); voor de geplande taken van Claude zie [claude-jobs.md](./claude-jobs.md).

## In het kort

- **Het bedrijf is de eenheid.** Bellen, mailen en LinkedIn hangen aan hetzelfde bedrijf. Een bedrijf heeft een leadstatus zolang het benaderd wordt en een pipelinefase zodra het interesse toont.
- **Alles wat er gebeurt staat in Activities** (`public.activities`): elk contactmoment, elke reply, elke meeting, elke wijziging van een veld, met wie het deed en waar het vandaan kwam. De tijdlijn, de wachtrijen, het bord, de meetings en het rapport lezen allemaal hieruit.
- **Eén schrijfpad.** Wijzigingen aan bedrijven en contacten gaan door `sales_update()` (tabel, bord, MCP en import). Alleen toegestane kolommen, elke wijziging gelogd.
- **Sequences vervangen Campagnes.** Een sequence is een reeks stappen over mail, LinkedIn en bellen. Claude schrijft concepten, Julius keurt goed; alleen goedgekeurde tekst wordt gebruikt.
- **Claude werkt via de MCP** met de rechten van de eigenaar van het token. Wat Claude doet staat in Activities met bron `claude`, en elke geplande taak staat op de Jobs pagina.

## Rollen

| Rol | Wat | Hoe |
| --- | --- | --- |
| Admin | Alles, ook bellers beheren en bellijsten openzetten voor bellers | `profiles.role = 'admin'` |
| Teamlid met de module Sales | Leads, contacten, pipeline, sequences, partners, meetings, rapport | `profiles.role = 'member'` en `sales` in `modules` (Instellingen, Gebruikers) |
| Externe beller | Alleen de eigen bellijst, het belscherm en het eigen overzicht, met authenticator app | `profiles.role = 'caller'` plus een actieve rij in `callers`. Gepauzeerd of gestopt is meteen geen toegang meer |
| Claude | Alles wat de eigenaar van het token mag, via de MCP | Persoonlijk token (`nrd_...`), lezen of lezen en schrijven |

Bellers hebben geen directe toegang tot tabellen: de app bedient ze via de functies met de secret key nadat hun wachtrij is gecontroleerd. Teamleden zonder de module Sales zien geen sales data (RLS met `has_module('sales')`).

## Leadstatus van een bedrijf

| Status | Betekenis |
| --- | --- |
| New | Net binnen (Apify, Prospeo, import, handmatig) |
| Review | Wacht op het ICP-oordeel |
| Ready | GO en klaar om te benaderen |
| Enrich | Geen nummer, gaat naar Max (zie Verrijken) |
| In sequence | Wordt benaderd |
| Cooled down | Benaderd zonder resultaat |
| No go | Past niet |
| Do not contact | Nooit benaderen |

Een sequence starten zet het bedrijf op In sequence. Een geslaagd gesprek of een meeting op het belscherm doet dat ook. Na drie keer geen gehoor bij een contact gaan de andere contacten naar Enrich, en als er dan geen contact met een nummer over is gaat het bedrijf naar Enrich.

## Pipeline

De pipeline is voor warme leads: bedrijven waarmee contact is geweest en die opvolging nodig hebben. De negen fases, in deze volgorde:

1. **Contact**: contact in twee richtingen, nog geen duidelijke interesse ("stuur maar info", "bel over een maand terug").
2. **Interested**: een positieve reply (geaccepteerd) of "bereikt: geïnteresseerd" op het belscherm.
3. **Meeting planned**: een meeting in het register, een Cal.com boeking of "meeting gepland" op het belscherm.
4. **Meeting held**: de meeting is gehouden of goedgekeurd.
5. **Vacancy drafted**: de vacature is samen met de klant opgesteld, of de klant leverde er zelf een aan. Volgt vanzelf zodra er een vacature voor het bedrijf is.
6. **Agreed + starter fee paid**: met de hand, de portal ziet geen betalingen. Zet het veld **Send profiles on** (`profiles_due_on`) op drie weken later; het bord laat zien of dat gehaald wordt.
7. **Profiles sent**: er zijn kandidaten voorgesteld.
8. **Candidate interviews**: een klantgesprek met een kandidaat.
9. **Won**: de klant koos een kandidaat (een plaatsing). Het bedrijf wordt klant; de onboarding loopt verder bij Placements.

Vanuit elke fase:

- **Lost**: altijd met een reden (`companies_lost_needs_reason`).
- **Parked**: altijd met een datum om opnieuw contact op te nemen (`parked_until`, `companies_parked_needs_date`). Die datum wordt de volgende actie, zodat een klant die "nu even niet" zegt niet kwijtraakt.

Op het bord staan Lost en Parked apart naast de fases. Elke kaart en de tabel tonen de open vacatures van het bedrijf: hoeveel, welke rollen (met link) en hoe lang ze al openstaan.

In de pipeline zetten:

- Op de leadpagina met één klik: **Add at Contact** of **Add at Interested**.
- Op de pipelinepagina met **Add company**, voor één of meer bedrijven tegelijk.
- Bij een reply in Replies via het veld Pipeline stage.
- Vanzelf bij interesse: "bereikt: geïnteresseerd", een geboekte meeting of een positieve reply.

Regels:

- Fases 2 tot en met 4 komen uit Activities en Meetings, fases 5, 7, 8 en 9 uit de recruitmentdata (triggers op vacatures, sollicitaties, interviews en plaatsingen).
- De automatische regels zetten een bedrijf alleen vooruit, nooit terug. Een bedrijf op Lost of Parked komt weer binnen als er iets nieuws gebeurt.
- Handmatig kan elke fase, ook terug.
- De oude fase Intake done heet nu Vacancy drafted (migratie `20261122000000_pipeline_stages.sql`).
- OnePageCRM is vervangen door deze pipeline; de sync (S9) is weg.

## Contacten

- **Rol**: Main, Extra of Reserve. Per bedrijf is er hooguit één primaire contactpersoon (`is_primary`); die krijgt een sequence als er geen contact is gekozen.
- **Status**: New, Qualified, Enrich, Enriched, In outreach, Reached, Not reached, Not interested, Do not contact. Statussen gaan alleen vooruit (`shouldPromoteStatus`); Do not contact verandert nooit meer.
- **Pogingen**: elk belresultaat telt een poging. Na drie keer geen gehoor is het contact Not reached.
- **Terugbellen**: een datum (`callback_at`); het contact staat dan die dag weer in de wachtrij.
- **Toegewezen beller**: een contact kan aan één beller hangen tot een datum.
- **Route**: hoe je het contact het beste bereikt, uit een vaste lijst: Mobile, Main number, Via reception, LinkedIn of Mail. In de tabel is het een keuzelijst; plakken uit Excel zet "Bellen", "06", "Receptie" of "e-mail" om naar de juiste route.

## Activities

Elke rij heeft een type, een kanaal en een bron.

| Veld | Waarden |
| --- | --- |
| Type | `contact` (bellen, mail, LinkedIn), `reply`, `meeting`, `change` (een veld gewijzigd, met oude en nieuwe waarde), `note`, `view` (een beller opende een contact), `system` |
| Kanaal | `bellen`, `mail`, `linkedin`, `meeting`, `system` |
| Bron | `handmatig`, `instantly`, `seleqt`, `calcom`, `claude`, `apify`, `prospeo`, `bcc` (mail met je BCC adres, zie [mail.md](./mail.md#bcc-logging-inkomende-mail)), `import`, `system` en de oude `webpartners`, `onepage` |
| Richting | `inbound` of `outbound` |

- **Geen dubbelen.** Iets uit een ander systeem heeft een `external_id`; dezelfde id twee keer wordt één keer opgeslagen. Claude kan dus veilig twee keer ophalen.
- **Wie en waarvandaan.** `created_by` is de persoon (bij Claude de eigenaar van het token), `source` de herkomst.
- **Partners en bellers.** Een contactmoment met een partner heeft `partner_id`; alles wat een beller doet heeft `caller_id`.
- **Sequences.** Een concepttekst die Claude voor een stap schrijft (`draft_sequence_text`, via `sales_draft_step`) is een `change` op de sequence zelf (`sequence_id`, veld `draft_body`), want een stap hoort bij geen bedrijf.
- **Volgorde.** Rijen slepen in de tabel is één `change` per keer slepen (veld `manual_position`, op de gesleepte rij, met oude en nieuwe positie). De eerste keer slepen nummert alle rijen van de weergave; ook dat is één rij in Activities.

## Regels die de database afdwingt

| Regel | Waar |
| --- | --- |
| Elke wijziging van een bedrijf of contact is een `change` in Activities met actor en bron, voor elke kolom die `sales_update()` mag schrijven (behalve `last_attempt_at`, dat bij elke call meeloopt en al een call in Activities is) | Trigger `sales_log_changes` |
| Rijen slepen is één activity per keer, niet één per rij | `sales_set_positions()` |
| Route is een keuzelijst: Mobile, Main number, Via reception, LinkedIn, Mail | `contacts_route_check` |
| Een concept voor een sequence stap komt in Activities op de sequence | `sales_draft_step()` |
| Alleen toegestane kolommen wijzigen, alleen met de module Sales | `sales_update()`, `sales_actor()` |
| Een reply op welk kanaal ook pauzeert het bedrijf: sequences op pauze, open belstappen vervallen | Trigger op `activities`, `sales_pause_company()` |
| Een positieve reply, interesse of meeting zet het bedrijf in de pipeline | Trigger op `activities`, `sales_advance_stage()` |
| Een reply die op review wacht telt pas mee na acceptatie | `review_status = 'pending'` wordt overgeslagen in de trigger |
| Fases 4 tot en met 7 uit recruitment; Won maakt het bedrijf klant | `sales_sync_recruitment_stage()`, `companies_track_stage()` |
| Een sequence start alleen als hij actief is en elke mail en LinkedIn stap een goedgekeurde tekst heeft | `sales_start_sequence()` |
| Zelf een tekst schrijven of wijzigen telt als goedgekeurd door jou | Trigger `sequence_steps_track_approval` |
| Een inschrijving zonder open stappen is klaar | Trigger `sequence_tasks_finish_enrollment` |
| Afmelden zet het contact in suppression en op Do not contact | Trigger op `activities` |
| Benaderbaar is wie niet in suppression staat | `is_contactable()` |

**De 30-dagenregel is vervallen.** Die blokkeerde contact via meerdere kanalen binnen een week, en dat is juist de bedoeling van een sequence. Alleen suppression telt nog.

## Tabel en bord

Leads, Contacts, Pipeline en de bellijsten zijn één spreadsheettabel (`src/components/sales/data-grid.tsx`) met een bord ernaast.

- **Keuzelijsten** voor leadstatus, pipelinefase, contactstatus, tier, rol, route, prio, categorie en ICP. Een waarde buiten de lijst wordt geweigerd, ook bij plakken.
- **Lost vraagt een reden**, overal: slepen op het bord, een cel in de tabel, plakken of de bulkbalk. De tabel opent dan dezelfde dialoog als het bord en slaat fase en reden samen op. Ongedaan maken zet beide terug.
- **Alles in Activities**: elke cel, elke bulkwijziging, vastzetten en slepen (zie Activities).

## Excel-import van de bellijst

Pagina: **Beheer, Import**, blok *Call list (Excel)*. Leest `Nordavo_bellijst_4.xlsx` in de browser (de tabs Bellen, Vacatures, Overige contacten en Nog verrijken) en schrijft zonder dubbelen. Opnieuw importeren maakt niets dubbel en overschrijft niets wat het team veranderde; het vult alleen lege velden.

- **Kolommen herkennen.** Kopjes worden ruim herkend: hoofdletters, leestekens en spaties tellen niet mee, en een kopje met een extra woord ("Telefoon (mobiel)", "Datum laatste poging", "Status oud") telt ook. Ook een tab met een extra woord ("Bellen (340)") wordt gevonden.
- **Controleer de koppeling.** Voor je importeert toont het blok per tab welke kolom waarnaartoe gaat, welke kolommen worden overgeslagen en welke velden niet gevonden zijn. Leg die naast het echte bestand voordat je op Import drukt; een kolom die je mist, hernoem je in Excel naar een van de bekende namen (`src/lib/sales/call-list-import.ts`).
- **LinkedIn.** Een link gaat waar hij naartoe wijst, in welke kolom hij ook staat: `/company/` naar het bedrijf, `/in/` naar de persoon. Een link van geen van beide soorten blijft bij het bedrijf als hij in de bedrijfskolom stond, en vervalt in de persoonskolom.
- **Route.** Wordt een van de vaste routes. Wat er niet op lijkt, komt als "Route: ..." in de notitie van de beller, zodat niets verloren gaat.
- **Belgeschiedenis.** De oude status, pogingen en laatste poging worden de contactstatus én een call in de tijdlijn: type `contact`, kanaal `bellen`, bron `import`, op de datum van de laatste poging (zonder datum op het moment van importeren, met "date of the call unknown" in de notitie). De uitkomst komt uit de oude status: Geen gehoor en Niet bereikt worden No answer, Terugbellen Call back, Afspraak Meeting planned, Interesse Reached: interested, Geen interesse Reached: not interested, Doorverwezen Referred, Verkeerde persoon Wrong person, Verkeerd nummer Wrong number, Bereikt de oude `bereikt`. Een status die niets over een call zegt (Nieuw, Enrich, Niet benaderen) geeft alleen een call als er pogingen of een laatste poging zijn, zonder uitkomst. De external id is `import:call:<contact>:<uitkomst>:<datum>`: dezelfde regel twee keer importeren is één call; een nieuwer bestand met een nieuwere poging voegt die toe. Let op: zo'n call telt mee voor de pipeline, dus een oude status Afspraak of Interesse zet het bedrijf in de pipeline.

## Sequences

Pagina: **Sales, Sequences** (`/dashboard/sequences`).

1. **Maak een sequence** met een naam en een omschrijving. Claude leest de omschrijving als het concepten schrijft.
2. **Voeg stappen toe**: kanaal (mail, LinkedIn of bellen), dag (0 is de start), bij mail een onderwerp, en de tekst. De volgorde pas je aan met de pijltjes.
3. **Teksten**: per stap staat links de goedgekeurde tekst (die wordt gebruikt) en rechts het concept. Claude schrijft concepten met `draft_sequence_text` (via `sales_draft_step`, dus met een regel in Activities met bron `claude`); met **Approve** wordt het concept de tekst, met **Reject** verdwijnt het. Zelf een tekst schrijven of aanpassen telt als goedgekeurd door jou. Belstappen hoeven geen goedkeuring.
4. **Activeer** de sequence. Een concept sequence of een archief sequence kan niet starten.
5. **Start voor bedrijven**: zoek bedrijven op naam of domein (zonder zoekterm zie je de bedrijven op Ready), kies een startdatum en start. Elke stap wordt een taak op zijn dag (`sequence_tasks`), het bedrijf gaat naar In sequence en het contact naar In outreach. Bedrijven op No go of Do not contact worden geweigerd.
6. **Ingeschreven bedrijven**: status, stappen en de volgende stap. **Pause** laat de open belstappen vervallen, **Resume** zet stappen vanaf vandaag weer open, **Stop** beëindigt alles.

Wie doet de stappen?

- **Mail** en **LinkedIn**: Claude zet ze klaar in Instantly en Seleqt (`list_sequence_tasks`, daarna `update_sequence_tasks`). Een klaargezette stap staat in Activities als uitgaand contact.
- **Bellen**: de belstap staat op zijn dag in de belwachtrij; een belresultaat sluit hem.

Na een reply pauzeert het bedrijf automatisch. Claude pauzeert het daarnaast in Instantly en Seleqt.

## Bellen en bellijsten

Een bellijst is een opgeslagen weergave van de Contacten tabel (`sales_views` met `is_call_list`). Een admin zet een lijst open voor bellers tot een datum en in een volgorde (`call_list_callers`), in het portaal of via Claude (`open_list_for_callers`). Op het belscherm houdt een beller een contact 30 minuten vast, zodat twee bellers niet dezelfde bellen. De knoppen zijn die van de oude Excel: geen gehoor, terugbellen, bereikt met of zonder interesse, meeting gepland, doorverwezen, verkeerde persoon, verkeerd nummer.

## Meetings

Het register (`public.meetings`) vervangt de meetingsheet: gepland, gehouden, goedgekeurd, afgekeurd, no show of geannuleerd. Een meeting van een beller krijgt standaard het tarief van die beller; goedkeuren legt vast wie en wanneer. Een Cal.com boeking met dezelfde uid is één meeting, en vult een geplande meeting van het belscherm van de laatste 14 dagen aan in plaats van een tweede te maken.

## Partners

Pagina: **Sales, Partners** (`/dashboard/partners`). Partners zijn mensen die leads aanbrengen. Per partner: naam, bedrijf, mail, telefoon, LinkedIn, notities, status en eigenaar, het laatste contactmoment, de contactmomenten zelf en de leads die van deze partner kwamen (`companies.partner_id`) met hun leadstatus en fase. Een contactmoment loggen maakt een activity met `partner_id` (type contact) en werkt het laatste contactmoment bij. Een lead koppel je aan een partner met de server action `setCompanyPartner` (via `sales_update`, dus gelogd).

## Replies to review

Pagina: **Leads, Replies** (`/dashboard/leads/replies`). Claude haalt replies op uit Instantly en Seleqt. Is een reply duidelijk, dan logt Claude hem meteen. Twijfelt Claude, dan krijgt de reply `review_status = 'pending'` en een voorstel (`suggestion`): een classificatie, de uitkomst (positief, neutraal, negatief, afgemeld) en eventueel een leadstatus, fase of contactstatus met een korte reden. Julius kiest:

- **Accept**: het voorstel wordt toegepast (`sales_decide_reply`).
- **Other outcome**: accepteren met een andere uitkomst, leadstatus of fase.
- **Reject**: er verandert niets aan het bedrijf.

Het aantal openstaande replies staat op het Overzicht en komt uit `pendingReplyCount()` (`src/lib/sales/replies.ts`). Het bedrijf is al gepauzeerd zodra de reply binnenkomt, ook als hij nog op review wacht.

## Verrijken (Enrich)

Pagina: **Contacts, Enrich** (`/dashboard/contacts/enrich`). Contacten zonder nummer gaan naar Max: iedereen met status Enrich en de contacten van bedrijven met leadstatus Enrich. Max matcht op de LinkedIn URL van de persoon, dus contacten zonder LinkedIn worden apart geteld. Suppressed contacten en eenmanszaken of vof's gaan niet mee. De export staat in de exportgeschiedenis (`list_exports`, type `max_verrijking`). De import van Max vult alleen lege nummers, met Max als bron, en zet het contact op Enriched; een bedrijf op Enrich dat zo een nummer krijgt gaat terug naar Ready.

## Claude

Claude werkt via de MCP server van het portaal ([mcp.md](./mcp.md)) met de rechten van de eigenaar van het token. Het portaal heeft zelf geen koppeling met Instantly, Seleqt, Cal.com, Apify en Prospeo voor deze taken: Claude haalt de data daar op met zijn eigen connectors en schrijft het via de MCP in het portaal. De oude portaaljobs S1 tot S4 en S8 zijn fallbacks: op geen schema, alleen met de hand ([claude-jobs.md](./claude-jobs.md#fallback-jobs)). De Cal.com webhook blijft als inkomende extra ingang; de Cal.com taak van Claude is de hoofdroute en beide schrijven dezelfde afspraak (booking uid).

- **Lezen**: bedrijven, contacten, meetings, bellijsten, sequences met hun taken, replies om te reviewen, cijfers (`sales_stats`) en job runs.
- **Schrijven** (alleen met een schrijftoken en de module Sales): status, fase, prio, eigenaar, partner, volgende actie, pin en volgorde via `sales_update`; activities en replies; meetings; nieuwe bedrijven en vacatures; ICP-oordeel; concepten voor sequences; sequences starten en stappen afvinken; een bedrijf pauzeren; bellijsten openzetten (alleen als de eigenaar admin is); job runs loggen.
- **Altijd zichtbaar**: alles staat in Activities met bron `claude` (of de bron van de data, zoals `instantly` voor een reply) en met de eigenaar van het token als persoon. Elke geplande taak start en eindigt een job run met `triggered_by = 'claude'`; die staan op **Beheer, Jobs** onder *Claude's scheduled tasks*.
- **Grenzen**: Claude verwijdert niets, wijzigt nooit een goedgekeurde tekst (alleen concepten) en omzeilt `sales_update` niet.

De prompts van de geplande taken staan in [claude-jobs.md](./claude-jobs.md).

## Cijfers

De cijfers op het Overzicht, op **Report** en in het weekrapport (S10) komen uit `src/lib/sales/stats.ts`.

| Cijfer | Definitie |
| --- | --- |
| Calls | Activities op kanaal `bellen`, type `contact`, zonder het oude "op bellijst gezet" (`verstuurd`) |
| Reached | Calls met `reached_interested`, `meeting_planned`, `reached_not_interested`, `referred`, `wrong_person`, plus de oude `bereikt`, `terugbellen`, `afspraak` en `niet_geinteresseerd` |
| Mails | Uitgaande contacten op kanaal `mail` (Instantly logt `verstuurd`) |
| LinkedIn | Uitgaande contacten op kanaal `linkedin` |
| Replies | Type `reply` of een reply-uitkomst; positief telt pas na acceptatie |
| Meetings planned | Meetings geboekt in de periode |
| Held, approved, rejected, no show | Uit het register; goedgekeurd en afgekeurd op de datum van het besluit |
| Fees | Tarieven van de in de periode goedgekeurde meetings |
| Pipeline | Bedrijven per fase nu, plus in de periode de pipeline in, gewonnen en verloren |
| Per beller | Calls, bereikt, meetings en goedgekeurd per externe beller en per teamlid |

De recruitmentonderdelen van het rapport (doorlooptijd, hiring report) zijn ongewijzigd.

## Wat is verdwenen

| Weg | Waarom | In de plaats |
| --- | --- | --- |
| Pagina Lists | Bellijsten zijn opgeslagen weergaven, mailcampagnes zijn sequences | Call lists, Sequences, Contacts Enrich (Max) |
| Pagina Campaigns | Sequences vervangen campagnes | Sequences |
| S6 bellijst naar een Google Sheet voor Web Partners | Bellers werken in het portaal op het belscherm | Call lists en het belscherm |
| S7 mailcampagnes in Instantly met openingszinnen | Sequences met goedgekeurde teksten; Claude zet de stappen klaar | Sequences en de taak *claude-sequences* |
| S9 OnePageCRM sync en de OnePageCRM koppeling | De pipeline zit in het portaal. Ook het profiel versturen schrijft niets meer naar OnePageCRM; het veld *Deal in OnePageCRM* is van het vacatureformulier af (een oude waarde staat nog op de vacature) | Pipeline |
| S1 tot S4 en S8 op een schema | Claude's geplande taken doen dit werk | Fallback jobs, alleen met de hand |
| 30-dagenregel | Blokkeerde contact via meerdere kanalen | Alleen suppression |

De exportgeschiedenis (`list_exports`) blijft bestaan en staat op Contacts, Enrich. De oude routes `/dashboard/lists` en `/dashboard/campaigns` sturen door naar Call lists en Sequences. De koppelingen met Apify, Prospeo, Instantly en Google Sheets in `src/lib/integrations` zijn er alleen nog voor de fallback jobs. Van Google Sheets is alleen het lezen van de oude afsprakensheet over (`s8-webpartners-import`); `onepage.ts` is weg.

## Code

| Onderdeel | Waar |
| --- | --- |
| Datamodel en regels | `supabase/migrations/20261110010000_sales_crm.sql`, `20261110040000_sales_sequences_claude.sql`, `20261111000000_sales_gaps.sql` (route, logboek, slepen, concepten) |
| Tests van de regels | `supabase/tests/sales_crm.test.sql`, `supabase/tests/sales_sequences.test.sql`, `supabase/tests/sales_gaps.test.sql` |
| Excel-import | `src/lib/sales/call-list-import.ts`, `src/app/dashboard/import/call-list-actions.ts`, `src/components/import/call-list-import.tsx`, `tests/call-list-import.test.ts` |
| Types en labels | `src/lib/sales/database.ts`, `src/lib/sales/labels.ts` |
| Rijen van de tabellen | `src/lib/sales/data.ts`, `src/lib/sales/rows.ts`, `src/lib/sales/grid.ts` |
| Cijfers | `src/lib/sales/stats.ts`, `src/lib/gtm/report.ts` |
| Replies to review | `src/lib/sales/replies.ts`, `src/app/dashboard/leads/replies` |
| Sequences | `src/lib/data/sequences.ts`, `src/app/dashboard/sequences`, `src/components/sequences` |
| Partners | `src/lib/data/partners.ts`, `src/app/dashboard/partners`, `src/components/partners` |
| Verrijken | `src/lib/gtm/max.ts`, `src/lib/data/enrich.ts`, `src/app/dashboard/contacts/enrich` |
| MCP | `src/lib/mcp/sales-tools.ts` |
| Overzicht | `src/components/overview/sales-overview.tsx` |
| Jobs van Claude | `src/components/jobs/claude-runs.tsx`, `listClaudeRuns` in `src/lib/data/jobs.ts` |
