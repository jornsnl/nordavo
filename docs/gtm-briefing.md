# Nordavo GTM systeem: volledige bouwbriefing

Versie: 23 oktober 2026
Opdrachtgever: Julius van Bragt (Nordavo)
Bouw: in Claude Code

Dit document bevat alles wat nodig is om het GTM systeem van Nordavo te bouwen: context, doelgroep, huidige situatie, architectuur, datamodel, workflows voor sales en talent, regels, volgorde van bouwen en open vragen.


## 1. Wat Nordavo doet

Nordavo plaatst medior en senior developers en data professionals uit Bangalore in de teams van Nederlandse bedrijven. Dit is remote staffing, geen outsourcing en geen projectlevering.

* De developer werkt fulltime (of parttime) vanuit het Nordavo kantoor in Indiranagar, Bangalore.
* De developer draait als gewoon teamlid mee bij de klant: zelfde standups, tools en codebase.
* Nordavo doet recruitment, technische screening, HR, payroll, laptop en begeleiding. Het werkgeverschap loopt via een Employer of Record (Wisemonk).
* De klant heeft een Nederlands aanspreekpunt (Julius) en iemand op de grond in Bangalore (Floris).

Aanbod:
* Vanaf 2.500 euro per maand all in, meestal 3.000 tot 3.500 euro voor medior en senior, afhankelijk van rol en eisen
* Ongeveer 50% goedkoper dan een vergelijkbare Nederlandse hire
* Alleen mediors en seniors
* Start binnen 3 weken
* Opzegtermijn 1 maand, eerste maand direct opzegbaar
* Vervangingsgarantie binnen 30 dagen
* Onboarding course voor klanten en trainingen op locatie

Rollen: backend, frontend en full stack developers, data engineers, BI developers, Power BI specialisten, data analisten, data scientists, ML engineers.

Positionering: nooit zeggen dat Nordavo een "eigen team in Bangalore" heeft. Nordavo heeft of zoekt de juiste mensen voor het team van de klant.


## 2. Doel van het systeem

1. Eén plek voor alle leads en kandidaatmatches. Geen losse Sheets meer.
2. Elke week automatisch een verse stroom gekwalificeerde bedrijven met beslissers en contactgegevens.
3. Niemand wordt binnen 30 dagen twee keer benaderd, over alle kanalen heen.
4. Per afspraak is te zien welk signaal, segment en kanaal hem opleverde.
5. Julius werkt vanuit een actiegericht CRM en kan met AI praten over alle data.
6. Bij een vacature komen snel de beste kandidaten uit de talentenpool, als anoniem profiel klaar om te delen.


## 3. Doelgroep (ICP)

Segmenten:
1. `saas`: SaaS bedrijven vanaf 5 medewerkers in een passende sector. Prioriteit.
2. `productie`: grote productiebedrijven met een eigen IT team.
3. `agency_automation`: automation agencies.
4. `agency_overig`: andere agencies, mits geen kleine korte projecten.

Uitsluiten:
* Bedrijven onder 5 medewerkers (geen tijd om iemand in te werken)
* Sectoren waar plaatsing van buiten Europa niet werkt
* Kleine, korte projecten
* Rechtsvorm eenmanszaak of vof: nooit bellen (Nederlandse telemarketingregels)

No go: de developer moet direct contact hebben met de klanten van de klant. Let hier vooral op bij agencies.

Geen blokkade: vacature vraagt EU verblijf, Nederlands of vaste kantoordagen. Engels als werktaal is belangrijk maar geen eis voor een afspraak.

Koopsignaal nummer 1: openstaande developer of data vacatures.

Beslissers per bedrijf, in deze volgorde:
* Tier 1: CTO, Head of Engineering, Head of Data
* Tier 2: eigenaar, directeur
* Tier 3: recruiter, HR
Doel: 2 contacten per bedrijf.


## 4. Huidige situatie

Huidige stack:

| Tool | Gebruik | Status |
|---|---|---|
| Apify | Vacatures scrapen (LinkedIn, Indeed) en beslissers zoeken | Draait |
| Claude | Kwalificatie tegen de ICP, er is een lead qualifier skill | Draait, handmatig gestart |
| Google Drive en Sheets | Alle leadlijsten | Geen database |
| Prospeo | Mailadressen vinden en verifiëren | Draait |
| Max (externe partner) | Telefoonnummers via waterfall, werkt met CSV | Draait, handmatig |
| Instantly | Cold mail, 10 warme accounts | Draait |
| Seleqt.ai | LinkedIn outreach | Status checken |
| Web Partners | Belt prospects en boekt afspraken, betaald per afspraak | Draait |
| Cal.com | Afspraken, aparte saleslink en salesmailbox | Draait |
| n8n en Make | Automatisering | Beide in gebruik |
| OnePageCRM | Sales CRM | Gekozen, nog niet ingericht |
| Airtable | Talentenpool en sollicitanten (o.a. bases "Sollicitanten fase 2" en "Hiring"), Fillout formulieren, Make automatiseringen met Claude scoring, AVG verwijdering | Draait |

Eerder gebruikt: Clay (tabellen Dev Data Master, Magento, Legacy, Data Agencies bestaan nog), Smartlead, Meta lead ads (slechte kwaliteit), een oude Airtable sales base.

Huidige salesflow (handmatig):
1. Apify scrapet vacatures
2. Claude kwalificeert bedrijven
3. Apify zoekt beslissers in drie tiers
4. Export naar Google Sheet
5. CSV naar Max met kolommen: firstname, lastname, company, website, company linkedin, person linkedin. Hij vult telefoonnummers aan
6. Web Partners belt en zet geboekte afspraken in een Google Sheet met de reden van de call
7. Na de call zet Nordavo de afspraak op goedgekeurd of niet
8. Los daarvan lopen mailcampagnes in Instantly

Wat er misgaat:
* Lijsten raken onoverzichtelijk, niemand weet welke lijst de juiste is
* Dubbelingen tussen lijsten
* Geen overzicht wie via welk kanaal al benaderd is
* Lijsten verouderen binnen weken
* Alles loopt via Julius
* Geen meting van wat afspraken oplevert
* Te veel GTM experimenten blijven liggen
* Mailvolume moet omhoog


## 5. Architectuur

| Onderdeel | Rol |
|---|---|
| Supabase (Postgres) | Enige bron van waarheid voor alle prospectdata |
| Scripts gebouwd met Claude Code | Draaien op vast schema (Supabase cron of GitHub Actions): scrapen, ontdubbelen, scoren, verrijken, exporteren, synchroniseren |
| Claude API | Alleen voor oordeel: kwalificatie, segment, score, openingszin, vacature uitlezen, kandidaten matchen, anoniem profiel |
| OnePageCRM | Werkplek van Julius: gekwalificeerde contacten en deals met verplichte volgende actie |
| OnePageCRM MCP | Claude (claude.ai en Claude Code) kan in het CRM lezen en schrijven. Server: https://app.onepagecrm.com/mcp |
| Supabase MCP | Alleen lezen, zodat Julius vragen kan stellen over alle data |
| Airtable | Blijft de bron voor kandidaten. Supabase leest alleen via de API |
| Apify | Vacatures en beslissers |
| Prospeo | Mailadressen |
| Max | Telefoonnummers via CSV in en uit |
| Instantly | Cold mail via de API |
| Web Partners | Bellen, krijgt lijsten als Google Sheet |
| Cal.com | Afspraken, via webhook naar Supabase |

Vuistregel: alles wat elke keer exact hetzelfde moet gaan is code. Alles waar nagedacht moet worden is Claude.

Technisch:
* Secrets in environment variables
* Alle accounts op naam van Nordavo
* Code in een Git repository van Nordavo
* Elke job logt in de tabel job_runs en mailt Julius bij een fout


## 6. Datamodel

### Sales

**companies**
id, domain (uniek, genormaliseerd: lowercase, zonder www en protocol), name, legal_form, employees, sector, segment, kvk_number (optioneel), linkedin_url, icp_decision (GO, NO_GO, REVIEW), icp_score (0 tot 100), icp_reason, client_contact_risk (bool), status, source, created_at, updated_at

**contacts**
id, company_id, first_name, last_name, title, tier (1, 2, 3), linkedin_url (uniek), email, email_source, email_status, phone, phone_type (mobiel, vast), phone_source, status, onepage_id, created_at, updated_at

**signals**
id, company_id, type (vacature, lang_open, meerdere_rollen, remote_extern, freelance, funding, nieuwe_cto, overig), title, source_url, source (linkedin, indeed, overig), first_seen_at, last_seen_at, raw_json

**activities**
id, contact_id, company_id, channel (bellen, mail, linkedin, meeting), campaign_id, date, outcome, notes, next_action, next_action_date, created_by

**campaigns**
id, name, channel, signal_type, segment, message_variant, started_at

**suppression**
id, company_id of contact_id, reason (afgemeld, bezwaar, klant, lopend_gesprek, niet_bellen), scope (alle_kanalen, alleen_bellen, alleen_mail), created_at

**list_exports**
id, type (bellijst, mailcampagne, max_verrijking), filter_used, record_ids, created_at

**job_runs**
id, job_name, started_at, finished_at, status, records_in, records_out, error

### Talent (koppeling met Airtable)

**vacancies**
id, company_id, onepage_deal_id, source (klant_eigen, samen_opgesteld, gescrapet), raw_text, stack, seniority, hours, timezone_overlap, budget_min, budget_max, client_contact_required (bool), status (intake, zoeken, profielen_verstuurd, gesprekken, geplaatst, gesloten), intake_at, profiles_sent_at, first_interview_at, start_at

**matches**
id, vacancy_id, airtable_candidate_id, score (0 tot 100), reason, risks, source (eigen_pool, linkedin, naukri), status (voorgesteld, goedgekeurd, verstuurd, gesprek, aangenomen, afgewezen), approved_by, created_at

**anonymous_profiles**
id, match_id, file_url, created_at, approved_by, sent_at

Belangrijk: kandidaatgegevens blijven in Airtable. Supabase slaat alleen de Airtable ID, de score en de status op, geen persoonsgegevens van kandidaten.


## 7. Statussen

Contact status in Supabase:
nieuw, gekwalificeerd, verrijkt, op_bellijst, in_mailcampagne, bereikt, afspraak, kans, klant, verloren, uitgesloten

Pipeline in OnePageCRM:
1. Gekwalificeerd
2. Benaderd
3. Gesprek gehad
4. Afspraak gepland
5. Intake gedaan
6. Profielen verstuurd
7. Gesprekken met kandidaten
8. Gewonnen of verloren, altijd met reden

Elk contact in OnePageCRM heeft altijd een volgende actie met datum.


## 8. Harde regels

1. Bedrijf uniek op genormaliseerd domein. Persoon uniek op LinkedIn URL.
2. Komt een record dubbel binnen, dan aanvullen, nooit een tweede record maken.
3. Elk mailadres en telefoonnummer bewaart bron en datum.
4. Elke export controleert eerst suppression en recente activiteit: niet benaderd in de laatste 30 dagen via welk kanaal dan ook.
5. Eenmanszaak en vof nooit op een bellijst.
6. Een lijst is een opgeslagen filter, geen los bestand. Elke export komt in list_exports.
7. Elke job logt in job_runs. Bij een fout krijgt Julius een mail.
8. In OnePageCRM komen alleen gekwalificeerde contacten, nooit ruwe scrape data.
9. Claude twijfelt? Dan REVIEW, nooit raden. client_contact_risk ja betekent altijd NO_GO.
10. Afmeldingen gaan direct naar suppression.
11. Airtable blijft de bron voor kandidaten, geen tweede kopie in Supabase.
12. Een anoniem profiel bevat geen naam, foto, contactgegevens of herleidbare werkgevers.
13. Een profiel wordt alleen gedeeld als de kandidaat daar toestemming voor heeft gegeven.
14. Een mens keurt elk profiel goed voordat het naar een klant gaat.
15. De automatische AVG verwijdering in Airtable blijft werken.


## 9. Workflows sales

**S1. Signalen ophalen**
* Wanneer: elke maandag 06:00
* Wat: Apify scrapet Nederlandse developer en data vacatures op LinkedIn en Indeed
* Logica: match op domein. Nieuw bedrijf aanmaken of signaal toevoegen. Bestaat dezelfde vacature al, dan alleen last_seen_at bijwerken. Vacature langer dan 60 dagen open of meerdere techrollen: extra signaaltype toevoegen
* Uit: companies en signals

**S2. Kwalificatie**
* Wanneer: direct na S1
* Wat: elk bedrijf zonder icp_decision gaat naar Claude met bedrijfsdata en vacaturetekst
* Uit: JSON volgens sectie 11, opgeslagen in companies
* REVIEW: Julius kijkt zelf

**S3. Beslissers zoeken**
* Wanneer: na S2, alleen voor GO
* Wat: Apify zoekt 2 contacten per bedrijf volgens de tiers
* Uit: contacts

**S4. Mail verrijken**
* Wat: Prospeo zoekt en verifieert mailadressen
* Uit: email, email_status, email_source

**S5. Telefoon verrijken**
* Wat: CSV export voor Max met firstname, lastname, company, website, company linkedin, person linkedin
* Terug: zijn CSV importeren, matchen op LinkedIn URL
* Uit: phone, phone_type, phone_source

**S6. Bellijst maken**
* Wanneer: op verzoek of wekelijks
* Filter: GO, mobiel nummer, geen eenmanszaak of vof, niet in suppression, niet benaderd in 30 dagen
* Uit: Google Sheet voor Web Partners met bedrijf, contact, functie, telefoon, signaal en een korte reden om te bellen. Vastleggen in list_exports, status naar op_bellijst

**S7. Mailcampagne vullen**
* Filter: GO, geverifieerd mailadres, niet in suppression, niet benaderd in 30 dagen
* Eén campagne per signaaltype, zodat meetbaar is wat werkt
* Claude schrijft een korte openingszin op basis van één signaal
* Uit: leads in Instantly via de API. Vastleggen in list_exports en campaigns

**S8. Uitkomsten terug**
* Dagelijks: Instantly replies, bounces en afmeldingen naar activities. Afmelding direct naar suppression
* Dagelijks: de afsprakensheet van Web Partners importeren naar activities
* Realtime: Cal.com webhook bij een nieuwe afspraak naar activities

**S9. Naar het CRM**
* Trigger: positieve reply, geboekte afspraak, of Julius markeert handmatig
* Wat: contact en bedrijf aanmaken in OnePageCRM met volgende actie, onepage_id terugschrijven
* Dagelijks: uitkomsten uit OnePageCRM terug naar activities

**S10. Weekrapport**
* Wanneer: elke vrijdag
* Inhoud: nieuwe bedrijven, GO percentage per segment, gebeld, bereikt, gemaild, replies, afspraken, en afspraken per signaal, segment en kanaal. Plus doorlooptijd per open vacature (talentkant)
* Uit: mail naar Julius


## 10. Workflows talent

Het proces van afspraak tot plaatsing:
1. Afspraak: klant wil verder na het salesgesprek
2. Intake: samen een vacature opstellen, of de klant heeft er al één
3. Vaste eisen: Claude zet de vacature om in stack, niveau, uren, overlap, budget en klantcontact
4. Eerst matchen in de eigen talentenpool in Airtable
5. Te weinig match: zoeken op LinkedIn en Naukri
6. Nieuwe kandidaten komen via Fillout in Airtable, altijd in de pool
7. Screening door recruiter en technical recruiter
8. Claude scoort kandidaten op de eisen en geeft een top 3 met reden
9. Anoniem profiel automatisch in Nordavo opmaak
10. Goedkeuring door Floris of de recruiter
11. Profielen naar de klant, gekoppeld aan de deal in OnePageCRM
12. Klant spreekt de kandidaten
13. Plaatsing: start binnen 3 weken, onboarding course
14. Niet gekozen kandidaten blijven in de pool voor de volgende vacature

**T1. Vacature uitlezen**
* Trigger: nieuwe vacature bij een deal (tekst geplakt, bestand of link)
* Wat: Claude zet de tekst om naar de velden van vacancies (zie sectie 11)
* Uit: vacancies, status intake

**T2. Matchen in eigen pool**
* Wat: kandidaten uit Airtable ophalen, Claude scoort elke kandidaat tegen de eisen
* Uit: top 3 in matches met score, reden en risico's, status voorgesteld

**T3. Zoekopdracht buiten de pool**
* Trigger: minder dan 3 matches met score 70 of hoger
* Wat: Claude maakt zoektermen en booleans voor LinkedIn en Naukri op basis van de eisen
* Uit: zoekopdracht voor de recruiter. Nieuwe kandidaten gaan via Fillout in Airtable en daarna opnieuw door T2

**T4. Anoniem profiel**
* Trigger: match op goedgekeurd door recruiter
* Wat: Claude maakt een profiel in Nordavo opmaak met skills, jaren ervaring, type projecten en de Nordavo beoordeling. Geen naam, foto, contact of herleidbare werkgevers
* Uit: PDF, opgeslagen in anonymous_profiles

**T5. Goedkeuring en versturen**
* Wat: Floris of de recruiter keurt het profiel. Daarna koppelen aan de deal in OnePageCRM
* Uit: status verstuurd, sent_at gevuld, volgende actie in OnePageCRM

**T6. Doorlooptijd bijhouden**
* Wat: per vacature de data intake, profielen verstuurd, eerste gesprek en start
* Uit: in het weekrapport, met waarschuwing als een vacature richting 3 weken loopt

**T7. Matches in sales gebruiken (later)**
* Wat: bij een gescrapete vacature van een prospect alvast matchen tegen de pool
* Uit: bellijst en mail kunnen "twee passende profielen" noemen


## 11. Claude: input en output

**Kwalificatie bedrijf (S2)**
Input: bedrijfsnaam, website, omvang, sector, rechtsvorm, vacaturetitel en vacaturetekst.
Output JSON:
* decision: GO, NO_GO of REVIEW
* segment: saas, productie, agency_automation, agency_overig
* score: 0 tot 100, opgebouwd uit ICP fit (40), bewijs van capaciteitsbehoefte (30), actualiteit signaal (20), kwaliteit onderbouwing (10)
* reason: maximaal twee zinnen
* client_contact_risk: true of false
* red_flags: lijst
* opening_line: één zin, Nederlands, op basis van één signaal

Basis: de bestaande Nordavo lead qualifier skill.

**Vacature uitlezen (T1)**
Output JSON:
* stack: lijst
* seniority: medior of senior
* hours: aantal per week
* timezone_overlap: tekst
* budget_min, budget_max: getallen of leeg
* client_contact_required: true of false
* must_haves: lijst
* nice_to_haves: lijst
* unclear: wat nog nagevraagd moet worden

**Kandidaat matchen (T2)**
Output JSON per kandidaat:
* score: 0 tot 100
* reason: maximaal twee zinnen
* risks: lijst
* missing: welke must haves ontbreken


## 12. Praten met AI

* OnePageCRM MCP koppelen in Claude (claude.ai en Claude Code) met lees en schrijfrechten
* Supabase MCP koppelen met alleen leesrechten, zodat Julius vragen kan stellen zoals: "welke SaaS bedrijven hadden deze maand meer dan drie vacatures" of "welk signaal leverde de meeste afspraken op"
* Schrijven in Supabase alleen via de scripts, niet via chat, zodat de data schoon blijft


## 13. Migratie

1. Alle bestaande leadlijsten uit Google Drive en Sheets verzamelen
2. Importeren, domeinen normaliseren, ontdubbelen
3. Bron per record vastleggen (welke Sheet)
4. Contacten die al gebeld of gemaild zijn als activity vastleggen
5. Daarna zijn de Sheets alleen nog archief


## 14. Volgorde van bouwen

**Versie 1: sales**
* Week 1: Supabase schema (inclusief de talenttabellen, zodat later niets omgebouwd hoeft te worden), migratie van alle Sheets, ontdubbeling
* Week 2: S1, S2, S3. Maandag komen automatisch nieuwe gekwalificeerde bedrijven met beslissers binnen
* Week 3: S4, S5, S6, OnePageCRM inrichten met MCP. Bellijst ronde 2 komt uit het systeem
* Week 4: S7, S8, S9, S10. Alle kanalen gekoppeld, weekrapport loopt

**Versie 2: talent**
* T1 tot en met T6
* T7 als laatste, zodra de matching betrouwbaar is


## 15. Versie 1 is af als

* Alle oude lijsten staan ontdubbeld in Supabase
* De maandagflow draait zonder handwerk
* Bellijsten en mailcampagnes komen uit filters
* Niemand wordt binnen 30 dagen twee keer benaderd
* Julius werkt vanuit OnePageCRM en kan via Claude vragen stellen over alle data
* Per afspraak is herleidbaar welk signaal, segment en kanaal hem opleverde

**Versie 2 is af als**

* Elke vacature staat in vaste eisen
* Per vacature is binnen een dag een top 3 uit de pool beschikbaar
* Een anoniem profiel is met één klik te maken en wordt pas na goedkeuring verstuurd
* De doorlooptijd per vacature is zichtbaar


## 16. Toekomstige ideeën (na versie 2)

Signalen:
* Vacature noemt remote of extern team
* Vacature langer dan 60 dagen open of repost
* 3 of meer techrollen open
* Freelance developer opdrachten
* Gewonnen aanbestedingen (TenderNed)
* Funding rondes
* Nieuwe CTO of Head of Engineering
* Productlanceringen, grote contracten, overnames

Tests en volume:
* Testcampagnes: lang open, meerdere techrollen, Magento, remote of extern team
* Eén signaal per campagne, evalueren na 150 mails. Onder 3% reply herschrijven of stoppen, boven 5% opschalen
* Tiers: tier 1 handmatig, tier 2 half automatisch, tier 3 alleen verzamelen
* 3 tot 5 extra maildomeinen plus warmup

Bronnen:
* Publieke ATS feeds: Recruitee, Homerun, Teamtailor, Greenhouse, Lever
* TheirStack testen als vacaturebron

Niches:
* Magento en legacy software
* WMS en ecommerce software
* Data en BI agencies met capaciteitstekort

Kanalen:
* LinkedIn outreach koppelen
* Direct mail of kaartjes naar 25 tot 50 topaccounts
* Partners: softwarebureaus en fractional CTO's
* Leaduitwisseling met complementaire bedrijven
* LinkedIn Ads, pas als outbound vastloopt
* Leersegment bellen: zorg, onderwijs, energie

Content en inzicht:
* Bedrijfsvideo inzetten in outreach en op de site
* Pers: het Bangalore verhaal
* Module 1 van de klantcourse als lead magnet
* LinkedIn content van Julius
* Klantinterviews: pijn, triggers en bezwaren in hun eigen woorden


## 17. Te regelen voor de start

1. Nieuw OnePageCRM account met MCP toegang (de oude trial is verlopen)
2. Supabase project voor Nordavo
3. API keys: Apify, Prospeo, Instantly, Anthropic, Cal.com, Airtable
4. Toegang tot alle oude leadsheets in Drive
5. Afspraak met Max over vaste CSV kolommen
6. Git repository op naam van Nordavo


## 18. Open vragen

Sales:
1. Wat is precies een gekwalificeerde afspraak? Bepaalt status, rapportage en betaling van Web Partners
2. Is Seleqt nog actief?
3. Werkt Web Partners straks in OnePageCRM of houden ze een Sheet?
4. Hoeveel bedrijven per week willen we verwerken?

Talent:
5. Staan CV's als PDF in Airtable of als ingevulde velden?
6. Is er een vaste opmaak voor een Nordavo profiel?
7. Wie keurt profielen goed: Floris of de recruiter?
8. Vraagt het Fillout formulier toestemming om een anoniem profiel te delen met klanten?
9. Welke toegang hebben we tot Naukri en LinkedIn Recruiter?
10. Op welk moment in het proces vragen we om payslips?

Beheer:
11. Wie beheert het systeem na oplevering?
