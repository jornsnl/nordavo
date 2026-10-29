# Briefing: eigen takentool ter vervanging van ClickUp

Opdrachtgever: Julius van Bragt (Nordavo), via het feedbackformulier, 29 oktober 2026.
Wat er gebouwd is en hoe het werkt: [work.md](work.md).

## 1. Achtergrond en doel

We vervangen ClickUp door een eigen, lichte takentool. We gebruiken ClickUp in de praktijk alleen om opdrachten uit te zetten, voortgang te volgen en werk te reviewen. De nieuwe tool doet precies dat, maar beter, en ondersteunt werken met freelancers in afgeschermde projecten.

Grootste probleem nu: taken blijven op review hangen omdat de reviewer geen seintje krijgt. Dat moet deze tool oplossen.

## 2. Hoe we nu werken

- Een opdrachtgever maakt een taak met doel, stappen en "done when", soms met een bijlage.
- De taak wordt toegewezen aan één of meer mensen, met prioriteit en deadline.
- Grotere opdrachten krijgen subtaken. Per vacature maken we vrijwel dezelfde set subtaken aan.
- De uitvoerder zet voortgang in de opmerkingen.
- Klaar betekent: naar Review, waarna de opdrachtgever goedkeurt of terugzet.
- Teamleden loggen ook los afgerond werk als afgeronde taak.

## 3. Structuur

Workspace → Project → Taak → Subtaak

- Workspace: een organisatie, bijvoorbeeld Nordavo of KG. Volledig gescheiden van andere workspaces.
- Project: een groep taken binnen een workspace, bijvoorbeeld "Hiring", "Vacature Magento" of een klus voor een freelancer.
- Taak en subtaak: één niveau subtaken is genoeg.

## 4. Gebruikers, rollen en rechten

Rollen per workspace:

- Beheerder: beheert leden, projecten en instellingen. Ziet alle projecten.
- Lid: vast teamlid. Ziet alle open projecten en de afgeschermde projecten waar hij aan is toegevoegd.
- Gast: freelancer of externe. Ziet alleen de projecten waar hij expliciet aan is toegevoegd. Weet niet welke andere projecten er bestaan.

Zichtbaarheid per project:

- Open: zichtbaar voor alle leden van de workspace.
- Afgeschermd: alleen zichtbaar voor beheerders en de mensen die aan het project zijn toegevoegd.

Optie per project: gasten zien alleen de taken die aan hen zijn toegewezen, in plaats van het hele project.

| Actie | Beheerder | Lid | Gast |
| --- | --- | --- | --- |
| Leden en instellingen beheren | ja | nee | nee |
| Project aanmaken | ja | ja | nee |
| Mensen aan project toevoegen | ja | ja, bij eigen projecten | nee |
| Taken en subtaken maken | ja | ja | ja, binnen zijn projecten |
| Status wijzigen, opmerkingen, bijlagen | ja | ja | ja, binnen zijn projecten |
| Taak goedkeuren op Review | ja | als reviewer | als reviewer |
| Taken archiveren | ja | eigen taken | nee |
| Andere gebruikers zien | ja | ja | alleen mensen in zijn projecten |
| Exporteren | ja | nee | nee |

Freelancers specifiek:

- Toegang met een einddatum. Na die datum vervalt de toegang automatisch.
- Toegang per project direct intrekbaar, zonder dat het account weg hoeft.
- Eén persoon kan in meerdere workspaces zitten met verschillende rollen, bijvoorbeeld lid bij Nordavo en gast bij KG.

Alle rechten afdwingen in de database, niet alleen in de interface. Bij Supabase via row level security. Bestanden vallen onder dezelfde rechten.

## 5. Taken

Velden: titel, omschrijving (opmaak en links), project, status, prioriteit (laag, normaal, hoog, urgent), deadline met tijdstip, maker, reviewer (standaard de maker), eigenaren (meerdere mogelijk), subtaken, bijlagen, opmerkingen met vermeldingen.

Acties:

- Taak verplaatsen naar een ander project binnen dezelfde workspace.
- Taak dupliceren inclusief subtaken.
- Archiveren in plaats van verwijderen, met een prullenbak van 30 dagen.
- Zoeken op titel, omschrijving en opmerkingen, binnen wat je mag zien.
- Activiteitenlog per taak: wie wat wanneer veranderde.

## 6. Statussen en review

To do, Bezig, Review, Afgerond. Optioneel Geannuleerd.

- Naar Review zetten stuurt direct een melding naar de reviewer.
- Alleen de reviewer of een beheerder kan naar Afgerond zetten.
- Terugzetten naar Bezig kan alleen met een opmerking erbij.

## 7. Schermen

Mijn overzicht (belangrijkste scherm): één persoonlijk overzicht over alle workspaces en projecten heen waar iemand toegang toe heeft.

- Tabblad Mijn taken: alles waar ik eigenaar van ben, gesorteerd op deadline en gegroepeerd per workspace en project.
- Tabblad Te reviewen: alle taken op Review waar ik reviewer van ben.
- Tabblad Vandaag en verlopen: wat vandaag af moet en wat te laat is.
- Filteren op workspace, project, status en prioriteit.
- Elke taak toont duidelijk bij welke workspace en welk project hij hoort.

Overige schermen:

- Projectweergave: alle taken in een project, filteren op status, eigenaar en prioriteit.
- Taakdetail: omschrijving, subtaken, bijlagen, opmerkingen, activiteit.
- Snel loggen: in één stap een afgeronde taak toevoegen als werklog.
- Beheer: leden, gasten, rollen, projecten en toegang per workspace.

## 8. Meldingen

Per mail, later eventueel Slack. Bij:

- Taak aan je toegewezen.
- Nieuwe opmerking op je taak of een vermelding.
- Taak naar Review (naar de reviewer).
- Taak teruggezet door de reviewer.
- Deadline morgen of verlopen.
- Toegevoegd aan een project, of toegang vervalt binnenkort (voor gasten).

Elke gebruiker kiest zelf welke meldingen hij krijgt. Standaard: directe meldingen voor review en vermeldingen, de rest in één dagelijks overzicht.

## 9. Accounts en inloggen

- Inloggen met Google of een magic link per mail.
- Uitnodigen via mail, met een link die direct in het juiste project of de juiste workspace landt.
- Account deactiveren bij vertrek, met overdracht van open taken.

## 10. Tijdzones en taal

- Team zit in Nederland en Bangalore, freelancers mogelijk elders. Deadlines opslaan in UTC en tonen in de tijdzone van de gebruiker.
- Interface in het Engels. Taken zelf mogen in elke taal.

## 11. Privacy, beveiliging en data

- Hosting in de EU.
- Bijlagen en opmerkingen bevatten kandidaatgegevens. Bijlagen alleen via tijdelijke links en alleen voor wie toegang heeft tot het project.
- Dagelijkse backup van database en bestanden.
- Export per workspace naar CSV of JSON.
- Log van wie wanneer toegang kreeg of verloor.

## 12. API

Vanaf dag één een API voor taken, opmerkingen en statussen, met dezelfde rechten als de gebruiker. Zodat Claude en automatiseringen ermee kunnen werken zoals nu met ClickUp.

## 13. Migratie en overgang

- Eenmalige import uit ClickUp van alle open taken en taken op Review, inclusief omschrijving, subtaken, opmerkingen en bijlagen.
- Huidige ClickUp workspaces: Nordavo (Julius, Floris, Judith) en KG (Julius, Sabine).
- Twee weken parallel draaien, daarna ClickUp alleen nog lezen.

## 14. Buiten scope

Tags, custom fields, checklists, time tracking, docs, dashboards, Gantt, automations, rechten per taak.

## 15. Fasering

Fase 1: workspaces, rollen inclusief gasten, open en afgeschermde projecten, taken met subtaken, statussen met review, opmerkingen, bijlagen, Mijn overzicht, projectweergave, mailmeldingen, inloggen en uitnodigen, import uit ClickUp.

Fase 2: toegang met einddatum, snel loggen, dupliceren, dagelijks overzicht, meldingsinstellingen, zoeken, API, export, Slack, mobiele optimalisatie.

## 16. Acceptatiecriteria fase 1

- Floris zet een opdracht uit, Judith pakt hem op en zet hem op Review, Floris krijgt een melding en keurt goed of zet terug.
- Een freelancer wordt uitgenodigd voor één afgeschermd project, ziet alleen dat project en kan daar taken bijwerken.
- Iemand die in Nordavo en KG zit, ziet zijn taken uit beide in één overzicht.
- Een gast kan via de API of een directe link niets openen buiten zijn eigen projecten.

## 17. Eigendom

Code in een repository en hosting op accounts van Nordavo, niet op die van de ontwikkelaar.
