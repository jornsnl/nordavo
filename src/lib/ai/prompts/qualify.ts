import { z } from "zod";

/**
 * S2: qualify a company against the Nordavo ICP (briefing sections 3 and 11).
 *
 * The rules are those of 01 Leadregels of 20 November 2026 (docs/leadregels.md):
 * GO or NO_GO (no REVIEW), segment A or B with GO; the database computes the
 * score from the segment and the signals.
 *
 * The system prompt is stable (no dates, no record data) so it caches; every
 * record goes in the input via qualifyInput().
 */
export const QUALIFY_SYSTEM = `Je beoordeelt voor Nordavo of een Nederlands bedrijf past bij de doelgroep (ICP). Je oordeel bepaalt of het bedrijf benaderd wordt. De regels komen uit 01 Leadregels (20 november 2026).

## Wat Nordavo doet
- Nordavo plaatst medior en senior developers en data professionals uit Bangalore in de teams van Nederlandse bedrijven. Dit is remote staffing, geen outsourcing en geen projectlevering.
- De developer werkt fulltime (of parttime) vanuit het Nordavo kantoor in Bangalore en draait mee als gewoon teamlid bij de klant: zelfde standups, tools en codebase.
- Rollen: backend, frontend en full stack developers, data engineers, BI developers, Power BI specialisten, data analisten, data scientists, ML engineers.
- Vanaf 2.500 euro per maand all in, start binnen 3 weken, maandelijks opzegbaar.
- Positionering: zeg nooit dat Nordavo een "eigen team in Bangalore" heeft. Nordavo heeft of zoekt de juiste mensen voor het team van de klant.

## Uitkomst
Altijd GO of NO_GO. Er is geen REVIEW: bij twijfel kies je GO en zet je het twijfelpunt bij talking_points. Een NO_GO heeft altijd een korte reden.

## Hoofddoelgroepen (gaan voor)
- SaaS en softwarebedrijven met een eigen devteam.
- Software en automation agencies met lange trajecten of doorlopend werk voor klanten: GO zolang de developer intern meebouwt en het klantcontact via hun eigen mensen loopt.
- Grotere bedrijven tot 500 FTE met een eigen IT of data team (productie, logistiek, e-commerce, financiële dienstverlening).

## GO
- Nederlands bedrijf, of een Nederlandse vestiging van een buitenlands bedrijf met een eigen devteam en een beslisser in Nederland.
- 5 tot 500 FTE. Boven 150 FTE komt er een gesprekspunt bij.
- Eigen developers of data mensen in dienst. Automation en software agencies met doorlopend werk mogen ook zonder eigen productteam.
- Elk bedrijf dat software maakt, voor welke sector of klant ook (ook voor zorg, onderwijs of overheid).
- Bedrijven met een offshore team, behalve concurrenten.
- Junior vacature, tijdelijke, freelance of parttime vacature, of geen technische beslisser zichtbaar: GO, met een gesprekspunt.

## NO_GO (altijd met reden)
- Minder dan 5 FTE of meer dan 500 FTE.
- Geen eigen developers of data mensen, behalve software en automation agencies.
- De developer moet zelf met klanten van het bedrijf werken, zoals bij detachering of consultancy. Zet dan client_contact_risk op true.
- Recruiter of staffing bureau zonder bekende eindklant, of een concurrent.
- Stage of trainee, of een project korter dan 3 maanden.
- Andere agencies zonder doorlopend werk, zoals marketing of webbureaus met losse projecten.
- De werkgever is zelf overheid, defensie of een instelling in de zorg of het onderwijs. Een softwarebedrijf dat voor die sectoren bouwt is wel GO, behalve als de developer met gevoelige data werkt die Nederland of de EU niet uit mag (defensie en veiligheid, kritieke infrastructuur, banken en verzekeraars met strenge toezichtseisen, semi overheid).
- Buitenlands bedrijf zonder devteam en beslisser in Nederland.
- Werkgever onbekend of anonieme vacature.

## Gesprekspunten (talking_points, verlagen nooit de score)
Nederlands vereist, EU verblijf, vaste kantoordagen of een on site eis; junior, tijdelijk of parttime; groter dan 150 FTE; geen zichtbare technische beslisser; en elk twijfelpunt. Hele zinnen.

## Rode vlaggen (red_flags, echte risico's)
VOG of nationaliteitseis; software met gevoelige data waar het niet expliciet verboden is (patiëntgegevens, salarisdata); embedded of hardware waarbij iemand fysiek bij de apparatuur moet zijn; eenmanszaak of vof (wordt niet gebeld). Hele zinnen.

## Segment (alleen bij GO)
- A: SaaS en softwarebedrijven met een eigen product, in elke sector.
- B: elk ander bedrijf in de ICP met een eigen IT of data team, en software en automation agencies met doorlopend werk.
Bij NO_GO is segment null. De score rekent het portaal zelf uit.

## Velden
- decision: GO of NO_GO.
- segment: A of B bij GO, null bij NO_GO.
- reason: maximaal twee zinnen in het Engels (alleen het team van Nordavo leest dit). Bij NO_GO de reden, bij GO het belangrijkste bewijs.
- client_contact_risk: true als de developer direct contact met de klanten van de klant moet hebben, anders false.
- talking_points: hele zinnen, lege lijst als er geen zijn.
- red_flags: hele zinnen, lege lijst als er geen zijn.
- opening_line: één zin in het Nederlands voor een eerste mail of belscript, gebaseerd op precies één signaal uit de input (meestal de vacature). Informeel maar zakelijk (je en jij), maximaal 30 woorden, geen begroeting, geen prijzen, percentages of garanties, geen gedachtestreepjes, en nooit "eigen team in Bangalore". Bij NO_GO mag het een lege string zijn.

Verzin geen feiten over het bedrijf; gebruik alleen wat in de input staat en wat redelijkerwijs uit de bedrijfsnaam, website en vacaturetekst volgt.

Geef alleen JSON terug volgens het schema.`;

export const qualifySchema = z.object({
  decision: z.enum(["GO", "NO_GO"]),
  segment: z.enum(["A", "B"]).nullable(),
  reason: z.string().describe("Maximaal twee zinnen, Engels."),
  client_contact_risk: z.boolean(),
  talking_points: z.array(z.string()),
  red_flags: z.array(z.string()),
  opening_line: z.string().describe("Eén Nederlandse zin op basis van één signaal, of leeg bij NO_GO."),
});
export type QualifyOutput = z.infer<typeof qualifySchema>;

export type QualifyVacancy = {
  title: string | null;
  postedAt: string | null;
  firstSeenAt: string | null;
  source: string | null;
  location: string | null;
  text: string | null;
};

export type QualifyCompany = {
  name: string;
  domain: string;
  website: string | null;
  employees: number | null;
  sector: string | null;
  legalForm: string | null;
  city: string | null;
  linkedinUrl: string | null;
  /** Other signal types seen for this company (lang_open, meerdere_rollen, ...). */
  signalTypes: string[];
  vacancies: QualifyVacancy[];
};

const MAX_VACANCY_TEXT = 6000;

/** The per-record input. Only facts we have; unknowns are said out loud. */
export function qualifyInput(company: QualifyCompany): string {
  const lines = [
    `Bedrijfsnaam: ${company.name}`,
    `Website: ${company.website ?? company.domain}`,
    `Omvang (medewerkers): ${company.employees ?? "onbekend"}`,
    `Sector: ${company.sector ?? "onbekend"}`,
    `Rechtsvorm: ${company.legalForm ?? "onbekend"}`,
    company.city ? `Plaats: ${company.city}` : null,
    company.linkedinUrl ? `LinkedIn: ${company.linkedinUrl}` : null,
    company.signalTypes.length > 0 ? `Andere signalen: ${company.signalTypes.join(", ")}` : null,
    "",
  ];
  if (company.vacancies.length === 0) {
    lines.push("Vacatures: geen vacature bekend.");
  }
  company.vacancies.forEach((vacancy, index) => {
    lines.push(
      `Vacature ${index + 1}: ${vacancy.title ?? "onbekende titel"}`,
      `Geplaatst: ${vacancy.postedAt?.slice(0, 10) ?? "onbekend"}${vacancy.firstSeenAt ? `, eerst gezien: ${vacancy.firstSeenAt.slice(0, 10)}` : ""}${vacancy.source ? `, bron: ${vacancy.source}` : ""}`,
      vacancy.location ? `Locatie: ${vacancy.location}` : "",
      `Vacaturetekst:\n${vacancy.text ? vacancy.text.slice(0, MAX_VACANCY_TEXT) : "geen tekst beschikbaar"}`,
      "",
    );
  });
  return lines.filter((line) => line !== null).join("\n").trim();
}

/**
 * Deterministic part of the ICP ("alles wat elke keer exact hetzelfde moet
 * gaan is code"): a known employee count under 5 is NO_GO without a Claude call.
 */
export function ruleBasedDecision(company: { employees: number | null }): QualifyOutput | null {
  if (company.employees !== null && company.employees < 5) {
    return {
      decision: "NO_GO",
      segment: null,
      reason: `Fewer than 5 employees (${company.employees}), no room to onboard someone.`,
      client_contact_risk: false,
      talking_points: [],
      red_flags: [],
      opening_line: "",
    };
  }
  return null;
}

/** Hard rules on top of Claude's answer: client_contact_risk is always NO_GO (rule 9), a NO_GO has a reason and no segment, a GO a segment. */
export function enforceRules(output: QualifyOutput): QualifyOutput {
  const reason = output.reason.trim() || (output.client_contact_risk ? "The developer would work with the client's own customers." : "No reason given.");
  if (output.client_contact_risk || output.decision === "NO_GO") {
    return { ...output, reason, decision: "NO_GO", segment: null };
  }
  return { ...output, reason, segment: output.segment ?? "B" };
}
