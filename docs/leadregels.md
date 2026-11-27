# Leadregels in het portaal (20 november 2026)

De regels staan in het Google Doc *01 Leadregels*. Dit document zegt per onderdeel hoe het portaal ze toepast en waar dat in de code zit.

| Onderdeel | Waar |
| --- | --- |
| Database, triggers en de dagelijkse run | `supabase/migrations/20261126000000_leadregels.sql`, test `supabase/tests/leadregels.test.sql` |
| Score, segment en signalen (dezelfde regels in TypeScript) | `src/lib/sales/score.ts`, `src/lib/sales/score-data.ts`, test `tests/leadregels.test.ts` |
| MCP tools | `src/lib/mcp/sales-tools.ts`, `src/lib/mcp/leadregels-tools.ts` |
| Leadpagina | `src/app/dashboard/leads/[id]/page.tsx`, `src/components/leads/icp-card.tsx` |
| Leadlijst | `src/lib/sales/rows.ts`, `src/components/sales/grid-kinds.ts` |
| Belscherm | `src/lib/sales/call-outcome.ts`, `src/components/calls/outcome-dialog.tsx`, `src/lib/sales/queue.ts` |
| Instellingen | Settings, Sales lists: *Signal points* en *Approach per score group* |

## 1. ICP

- `icp_decision` is leeg (nog niet beoordeeld), `GO` of `NO_GO`. REVIEW bestaat niet meer; bestaande REVIEW werd leeg en leadstatus Review werd New.
- Een NO_GO heeft altijd een reden (`companies_no_go_needs_reason`). De reden staat in de leadlijst als kolom *No go reason* en als tooltip op de ICP cel, en op de leadpagina in de kaart *ICP and score*.
- Gesprekspunten (`talking_points`) en rode vlaggen (`red_flags`) zijn twee lijsten met hele zinnen. Oude red flags (losse stukjes van voor 20 november) worden bij het tonen weer tot zinnen geplakt; bezwaren en vragen daaruit staan bij de gesprekspunten tot iemand de kaart opslaat.
- De tab *ICP to judge* op Leads is de wachtrij van bedrijven zonder oordeel: GO met segment, of No go met reden.

## 2. Segment

- `segment` is `A` (SaaS en software met een eigen product) of `B` (elk ander ICP bedrijf met een eigen IT of data team, plus software en automation agencies), alleen bij GO (`companies_segment_needs_go`). Bij NO_GO of leeg valt het segment weg.
- Filterbaar en sorteerbaar in de leadlijst, aan te passen op de leadpagina en via `set_icp_verdict` en `update_companies`.
- Category blijft bestaan: segment zegt wat voor bedrijf, category wat voor vacature.
- Bij de migratie had één bedrijf een oud segment (`saas`, werd A). De andere GO bedrijven hebben nog geen segment en dus nog geen score: laat Claude ze beoordelen met `set_icp_verdict`.

## 3. Score

- `icp_score` (in het scherm *Score*) is de basis van het segment (A 50, B 30) plus de punten van de actieve signalen, elke soort één keer, maximaal 100 en nooit onder 0. De database rekent hem uit (`sales_score_parts`) en zet hem bij elke wijziging van segment of ICP, bij elk signaal dat bijkomt, verandert of verdwijnt, en bij een wijziging in de puntentabel. Met de hand zetten kan niet: de waarde wordt teruggezet.
- De dagelijkse run rekent alles opnieuw, omdat signalen aflopen en vacatures evergreen worden.
- Leadlijst: kolom *Score*, standaard van hoog naar laag; filter *Score group* (90 tot 100, 80 tot 89, 60 tot 79, 50 tot 59, onder 50).
- Leadpagina: de opbouw, bijvoorbeeld "A 50 + actieve dev of data vacature 30 + meerdere vacatures tegelijk 10 = 90".

## 4. Signalen

- Elk signaal (`signals`) heeft soort, datum (`posted_at`, anders eerst gezien), bron (`source_url`), geldig tot (`valid_until`) en punten uit de puntentabel `sales_signal_points`.
- Actief vanaf de start: actieve dev of data vacature (+30), meerdere vacatures tegelijk (+10, afgeleid: twee of meer), team in India of eerder uitbesteed (+10, soort `india_outsourced`).
- In de tabel maar uit: funding, groei 20%, nieuwe CTO, vacature 60 dagen open (afgeleid), via recruiter, stack past, overname of nieuw product, interactie met Nordavo, ontslagen of hiring freeze (-15). Aan te zetten onder Settings, Sales lists, *Signal points*.
- Een signaal zonder `valid_until` krijgt de standaard dagen van zijn soort (funding een jaar, nieuwe CTO een half jaar). Een vacature telt zolang hij open is.
- Evergreen: een vacature die langer dan 180 dagen openstaat, of een titel als open sollicitatie, talent pool of always hiring. Die krijgt het label *Evergreen* en telt niet mee.
- Een vacature die offline gaat (`closed_at`) loopt af.
- Een dev of data vacature: een dev of data titel, of een rolgroep die geen sales, service of projecten is (`sales_is_dev_data_vacancy`).
- MCP: `add_signals` en `list_signals` (Claude en de wekelijkse scrape), `update_signals` om te corrigeren.

## 5. Prio

- Prio staat niet meer in de leadlijst, de filters, het bord, Incoming, de leadpagina en het belscherm. De score bepaalt de volgorde. De waarden blijven in de database.
- Settings, Sales lists, *Approach per score group*: per scoregroep een aanpak (`sales_score_groups.approach`), nog leeg tot het besluit valt. De leadpagina toont hem naast de score.

## 6. Leadstatus en cooling down

| Overgang | Hoe |
| --- | --- |
| Route afgelopen zonder reactie | Een campagnelid of sequence die eindigt zonder reply zet een bedrijf op In sequence naar Cooled down, met `recontact_from` = vandaag + 7 (`sales_route_ended`) |
| Cooled down zonder nieuw signaal | De dagelijkse run zet het na de week op Ready |
| Cooled down met een nieuwe vacature of ander actief signaal | Direct Ready (trigger op `signals`) |
| Nee / geen interesse | `recontact_from` = vandaag + 3 maanden. Daarna Ready, met als volgende actie en notitie dat een ander kanaal de voorkeur heeft. Een nieuw signaal eerder: een taak voor persoonlijke opvolging, niet terug in een campagne |
| Nu niet | Terug naar Ready op de datum (standaard + 3 maanden), met een taak voor persoonlijke opvolging |
| Do not contact | Definitief, ook bij nieuwe signalen. Alleen een admin kan het terugzetten (de database weigert anderen) |
| Positieve reactie (mail, LinkedIn of gesprek) | Pipeline Interested (of verder) en uit alle routes: campagneleden en sequences stoppen (`sales_exit_routes`) |
| Negatieve reply | Nee / geen interesse met het kanaal van de reply |
| Afmelden | Do not contact voor het hele bedrijf |

De taken voor persoonlijke opvolging gaan naar de eigenaar van het bedrijf, anders naar wie de status het laatst zette. Elke status heeft in het portaal een tooltip met de uitleg uit deel 5.

De dagelijkse run is `sales_daily_tick()`, met pg_cron elke nacht om 04:15 UTC (`sales-daily-tick`).

## 7. Belscherm

| Knop | Wat er gebeurt |
| --- | --- |
| Not interested: person | Alleen dit contact wordt geblokkeerd (Not interested); het volgende contact van het bedrijf verschijnt |
| No interest: company | Het hele bedrijf naar Nee / geen interesse, kanaal bellen |
| Not now | Met datum (standaard + 3 maanden): het bedrijf naar Nu niet |
| Angry or unsubscribe | Het bedrijf naar Do not contact, met een uitsluiting voor alle kanalen |

Bij alle vier is een korte notitie verplicht. Twijfel tussen persoon en bedrijf: kies bedrijf (staat in het venster). Bij de bedrijfsuitkomsten stoppen sequences en campagnes en gaat de bucket naar Parked tot de datum (Do not contact: No go). Ongedaan maken zet ook de datum, het kanaal en de uitsluiting terug.

De oude knop *Reached: not interested* is verborgen; oude gesprekken houden hun label.

Geen gehoor: zolang contact 1 minder dan twee pogingen heeft (en een nummer, en niet geblokkeerd is) staan de andere contacten van dat bedrijf niet in de wachtrij (`waitingForContactOne`).

## 8. Tiers en contact 1 en 2

- Tier 1 technisch (CTO, head of engineering, data of IT, tech lead), tier 2 eigenaar of directie (CEO, founder, directeur), tier 3 HR of recruitment. De tooltip staat bij elke tier; de tier volgt uit de functie als die leeg is (`contact_tier_for_title`).
- Contact 1 is rol `main`, contact 2 rol `reserve`, de rest extra.
- Standaardvolgorde (`sales_default_contact_order`): bij een data vacature eerst de head of data of BI; onder ongeveer 30 FTE eerst tier 2, daarboven eerst tier 1; tier 3 alleen als tier 1 en tier 2 ontbreken. Contacten die niet meer mogen (not interested, do not contact, vertrokken, verkeerde persoon) doen niet mee.
- Nieuwe bedrijven volgen de standaard vanzelf. Kies je contact 1 of 2 met de hand, dan blijft dat staan (`contact_order_manual`). *Use default order* op de leadpagina (of `apply_contact_order`) zet de standaard terug. Bestaande bedrijven met contacten hielden bij de migratie hun huidige volgorde.

## 9. Uitsluitcheck

`check_outreach` (MCP) en `sales_check_outreach()` (database): per domein of mailadres ja of nee met de redenen. Mailadressen worden eerst op het contact gezocht, dan op het domein; een gratis maildomein (gmail, hotmail) zoekt alleen op het contact. Een domein dat niet in het portaal staat, mag.

Een bedrijf op een bellijst (bucket call) mag niet gemaild of via LinkedIn benaderd worden: de reden is `bellijst <beller of lijst>`, voor het domein en voor de mailadressen van de contacten (`20261127000000_sales_call_list_shield.sql`, test `supabase/tests/call_list_shield.test.sql`). Triage slaat zo'n bedrijf over bij mail_campaign en linkedin_campaign, tenzij force. Eerst vrijgeven (triage naar free) en dan pas in een campagne.

**Bezetting.** De view `sales_company_occupation` geeft per bedrijf `occupied_by` (call, mail_campaign, linkedin_campaign, sequence of leeg), `occupied_label` (beller, bellijst, campagne of sequence), `occupied_since` en `free`. Vrij is: bucket incoming of free en nergens in. Pipeline, parked en no go zijn niet bezet maar ook niet vrij. `list_companies` en `get_company` geven deze velden mee; `list_companies` filtert met `free` (in de database via `sales_is_free(companies)`). In de leadlijst staat de kolom *Occupied by* standaard aan en zet de knop *Only free* het filter op de kolom *Free*.

## 10. Campagnes

- Een bedrijf met een lid in een lopende campagne (status Active) staat op In sequence; bij de migratie zijn de bestaande gezet.
- De campagnepagina toont per lid het bedrijf, de stand van het bedrijf nu, het contact en de status. De leadpagina heeft het blok *Campaigns* met alle campagnes waar het bedrijf in zat.
- De status volgt Instantly en Seleqt via de taak `claude-campaigns` (zie [claude-jobs.md](./claude-jobs.md)): Instantly 0 draft, 1 en 4 active, 2 en negatief paused, 3 finished; Seleqt DRAFT, ACTIVE, PAUSED, ARCHIVED (finished).
