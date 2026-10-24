import { z } from "zod";

/**
 * T4 Anoniem profiel. Claude gets only the fields it needs, with names,
 * contact details and employers already redacted; the result still goes
 * through the code check in src/lib/talent/anonymize.ts (hard rule 12).
 */
export const PROFILE_SYSTEM = `Je schrijft een anoniem kandidaatprofiel voor Nordavo. Nordavo plaatst medior en senior developers en data professionals uit Bangalore fulltime in de teams van Nederlandse bedrijven. Het profiel gaat naar een Nederlandse klant die wil beslissen of hij de kandidaat wil spreken.

Toon: zoals nordavo.nl. Nederlands, direct, concreet en eerlijk. Korte zinnen. Geen superlatieven of wervingsjargon ("rockstar", "ninja", "passievol"). Geen streepjes als leesteken: gebruik komma's, dubbele punten of punten.

Strikte anonimiteit, zonder uitzondering:
- Nooit een naam, initialen, foto, e-mailadres, telefoonnummer, adres, LinkedIn of andere links.
- Nooit namen van werkgevers, klanten, opdrachtgevers, scholen of universiteiten. Beschrijf ze generiek: "een groot Indiaas IT-dienstverlener", "een Europese fintech scale-up", "een wereldwijde e-commerce speler".
- Geen details die de persoon herleidbaar maken (exacte projectnamen, unieke prijzen, exacte data).
- In de gegevens staan placeholders als [naam] en [werkgever]: neem die nooit over.

Velden:
- headline: de rol in een paar woorden, bijvoorbeeld "Senior Data Engineer" of "Medior Full Stack Developer (React, Node)".
- seniority: "Medior", "Senior" of "Lead".
- years_experience: jaren relevante werkervaring als geheel getal, of null als onbekend.
- core_skills: 5 tot 10 kernskills, sterkste eerst, relevant voor de vacature.
- project_types: 2 tot 5 korte zinnen over het soort projecten en verantwoordelijkheden.
- sectors: sectoren of domeinen, zonder bedrijfsnamen.
- english_level: kort, bijvoorbeeld "Vloeiend, werkt dagelijks met Europese teams" of "Goed (B2)". Onbekend: "Wordt getoetst in het Engelse interview".
- availability: kort, bijvoorbeeld "Binnen 30 dagen" of "Per direct".
- assessment: de beoordeling van Nordavo in 3 tot 5 zinnen in het Nederlands: waarom deze kandidaat past bij de vacature, waar de kracht zit en eerlijk wat er nog aandacht vraagt.

Gebruik alleen de gegeven gegevens. Verzin geen ervaring.`;

export const profileContentSchema = z.object({
  headline: z.string(),
  seniority: z.string(),
  years_experience: z.number().nullable(),
  core_skills: z.array(z.string()),
  project_types: z.array(z.string()),
  sectors: z.array(z.string()),
  english_level: z.string(),
  availability: z.string(),
  assessment: z.string(),
});

export type ProfileContent = z.infer<typeof profileContentSchema>;

export function profileInput(vacancy: unknown, candidate: unknown, match: { reason: string | null; risks: string[]; missing: string[] }, retryNote?: string) {
  return [
    `Vacature (vaste eisen):\n${JSON.stringify(vacancy, null, 2)}`,
    `Kandidaat (geanonimiseerd):\n${JSON.stringify(candidate, null, 2)}`,
    `Matchbeoordeling van de recruiter:\n${JSON.stringify(match, null, 2)}`,
    retryNote ? `Let op: ${retryNote}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
