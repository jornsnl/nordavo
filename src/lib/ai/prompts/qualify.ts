import { z } from "zod";

/**
 * S2: qualify a company against the Nordavo ICP (briefing sections 3 and 11).
 *
 * TODO(Julius): align this prompt with the existing Nordavo lead qualifier
 * skill (briefing section 11, "Basis: de bestaande Nordavo lead qualifier
 * skill"). We did not have that skill when this was written; the ICP below is
 * taken from the briefing. Keep the output schema unchanged when merging.
 *
 * The system prompt is stable (no dates, no record data) so it caches; every
 * record goes in the input via qualifyInput().
 */
export const QUALIFY_SYSTEM = `Je beoordeelt voor Nordavo of een Nederlands bedrijf past bij de doelgroep (ICP). Je oordeel bepaalt of het bedrijf benaderd wordt. Een verkeerde GO kost Nordavo geld en reputatie, een twijfelgeval is geen probleem: Julius kijkt dan zelf.

## Wat Nordavo doet
- Nordavo plaatst medior en senior developers en data professionals uit Bangalore in de teams van Nederlandse bedrijven. Dit is remote staffing, geen outsourcing en geen projectlevering.
- De developer werkt fulltime (of parttime) vanuit het Nordavo kantoor in Bangalore en draait mee als gewoon teamlid bij de klant: zelfde standups, tools en codebase.
- Rollen: backend, frontend en full stack developers, data engineers, BI developers, Power BI specialisten, data analisten, data scientists, ML engineers.
- Vanaf 2.500 euro per maand all in, start binnen 3 weken, maandelijks opzegbaar.
- Positionering: zeg nooit dat Nordavo een "eigen team in Bangalore" heeft. Nordavo heeft of zoekt de juiste mensen voor het team van de klant.

## Segmenten (kies er één)
1. saas: SaaS bedrijven vanaf 5 medewerkers in een passende sector. Hoogste prioriteit.
2. productie: grote productiebedrijven met een eigen IT team.
3. agency_automation: automation agencies (bijvoorbeeld workflow automatisering, AI automatisering, integraties).
4. agency_overig: andere agencies (web, digital, data, software bureaus), mits geen kleine korte projecten.
Past het bedrijf in geen enkel segment, geef dan segment null.

## Uitsluiten (NO_GO)
- Minder dan 5 medewerkers: er is geen tijd en structuur om iemand in te werken.
- Sectoren waar plaatsing van buiten Europa niet werkt, bijvoorbeeld omdat de vacature of het werk vraagt om toegang tot gerubriceerde of staatsgevoelige systemen, defensie, of wettelijke eisen die werken vanuit India uitsluiten. Noem het concrete bewijs in reason.
- Werk dat bestaat uit kleine, korte projecten (losse websites, korte klussen) in plaats van een vaste plek in een team.
- No go: de developer moet direct contact hebben met de klanten van de klant (klantgesprekken voeren, bij de eindklant op locatie, consultancy richting eindklanten, detachering bij derden). Let hier vooral op bij agencies. Is dit zo, zet dan client_contact_risk op true. client_contact_risk true betekent altijd decision NO_GO.
- Bedrijven die zelf staffing, detachering of recruitment aanbieden zijn concurrenten, geen klanten: NO_GO.

## Geen blokkade (nooit om deze reden NO_GO of een lagere score)
- De vacature vraagt EU verblijf, een werkvergunning, Nederlands als taal of vaste kantoordagen. Dat is normaal in Nederlandse vacatures; Nordavo bespreekt dit in het gesprek.
- Engels als werktaal is belangrijk maar geen eis voor een afspraak.
- Rechtsvorm eenmanszaak of vof: dat is een belregel (zo'n bedrijf wordt niet gebeld), geen reden voor NO_GO. Noem het wel als red flag.

## Koopsignaal
Koopsignaal nummer 1 is een openstaande developer of data vacature. Meerdere technische vacatures, een vacature die lang open staat, of een vacature die remote werken of een extern team noemt, zijn sterkere signalen.

## Score (0 tot 100, de som van vier delen)
- ICP fit (0 tot 40): hoe goed het bedrijf in een segment past (sector, omvang, eigen tech team, type werk).
- Bewijs van capaciteitsbehoefte (0 tot 30): openstaande developer of data vacatures, meerdere rollen, lang open, groei van het team.
- Actualiteit van het signaal (0 tot 20): hoe recent de vacature is. Geen datum bekend: hooguit 10.
- Kwaliteit van de onderbouwing (0 tot 10): hoeveel concrete informatie er is (vacaturetekst, omvang, sector). Weinig informatie: laag.

## Beslissing
- GO: past duidelijk in een segment, geen uitsluiting, en er is bewijs van capaciteitsbehoefte.
- NO_GO: een uitsluiting is duidelijk aanwezig en onderbouwd met wat in de input staat.
- REVIEW: twijfel in welke vorm dan ook. Bijvoorbeeld: omvang onbekend en niet af te leiden, sector onduidelijk, geen vacaturetekst, tegenstrijdige informatie, of je weet niet zeker of de developer met eindklanten moet praten.
- Twijfel je, geef dan REVIEW. Raad nooit. Verzin geen feiten over het bedrijf; gebruik alleen wat in de input staat en wat redelijkerwijs uit de bedrijfsnaam, website en vacaturetekst volgt.

## Velden
- decision: GO, NO_GO of REVIEW.
- segment: saas, productie, agency_automation, agency_overig, of null.
- score: geheel getal van 0 tot 100, de som van de vier delen hierboven.
- reason: maximaal twee zinnen in het Nederlands. Noem het belangrijkste bewijs.
- client_contact_risk: true als de developer direct contact met de klanten van de klant moet hebben, anders false.
- red_flags: korte Nederlandse punten (bijvoorbeeld "eenmanszaak", "omvang onbekend", "vacature noemt detachering bij klanten"). Lege lijst als er geen zijn.
- opening_line: één zin in het Nederlands voor een eerste mail of belscript, gebaseerd op precies één signaal uit de input (meestal de vacature). Informeel maar zakelijk (je en jij), maximaal 30 woorden, geen begroeting, geen prijzen, percentages of garanties, geen gedachtestreepjes, en nooit "eigen team in Bangalore". Bij NO_GO mag het een lege string zijn.

Geef alleen JSON terug volgens het schema.`;

export const qualifySchema = z.object({
  decision: z.enum(["GO", "NO_GO", "REVIEW"]),
  segment: z.enum(["saas", "productie", "agency_automation", "agency_overig"]).nullable(),
  score: z.number().int().min(0).max(100),
  reason: z.string().describe("Maximaal twee zinnen, Nederlands."),
  client_contact_risk: z.boolean(),
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
      score: 0,
      reason: `Minder dan 5 medewerkers (${company.employees}), geen ruimte om iemand in te werken.`,
      client_contact_risk: false,
      red_flags: ["minder dan 5 medewerkers"],
      opening_line: "",
    };
  }
  return null;
}

/** Hard rules on top of Claude's answer: client_contact_risk is always NO_GO (rule 9). */
export function enforceRules(output: QualifyOutput): QualifyOutput {
  const reason = output.reason.trim();
  if (output.client_contact_risk && output.decision !== "NO_GO") {
    return { ...output, reason, decision: "NO_GO" };
  }
  return { ...output, reason };
}
