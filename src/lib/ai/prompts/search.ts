import { z } from "zod";

/**
 * T3 Zoekopdracht buiten de pool: search terms and booleans for LinkedIn
 * Recruiter and Naukri when the pool gives fewer than 3 strong matches.
 */
export const SEARCH_SYSTEM = `Je bent sourcing-specialist voor Nordavo. Nordavo zoekt medior en senior developers en data professionals in India, vooral in Bangalore, die fulltime remote gaan werken in het team van een Nederlands bedrijf vanuit het Nordavo kantoor in Indiranagar, Bangalore.

De eigen talentenpool gaf te weinig sterke matches voor een vacature. Maak een zoekopdracht voor de recruiter:
- keywords: 6 tot 12 zoektermen (technologieën, synoniemen, gangbare schrijfwijzen).
- linkedin_boolean: één boolean string voor LinkedIn Recruiter. Gebruik AND, OR, NOT in hoofdletters, haakjes en "aanhalingstekens" voor meerwoordige termen. Sluit juniors, interns en recruiters uit met NOT. Houd hem onder 300 tekens.
- naukri_boolean: één boolean string voor Naukri Resdex. Naukri ondersteunt AND, OR, NOT en haakjes; houd hem korter en eenvoudiger dan de LinkedIn versie.
- titles: 4 tot 8 functietitels zoals ze in India op profielen staan (bijvoorbeeld "Senior Software Engineer", "SDE 2", "Data Engineer II").
- locations: steden in volgorde van voorkeur. Altijd Bangalore (Bengaluru) eerst, daarna steden van waaruit mensen bereid zijn te verhuizen naar Bangalore.
- min_years: minimaal aantal jaren ervaring om op te filteren.
- notes: maximaal drie korte tips in het Nederlands voor de recruiter (bijvoorbeeld waar de must haves het moeilijkst te vinden zijn).

Baseer alles op de vaste eisen. Verzin geen eisen die er niet staan.`;

export const searchBriefSchema = z.object({
  keywords: z.array(z.string()),
  linkedin_boolean: z.string(),
  naukri_boolean: z.string(),
  titles: z.array(z.string()),
  locations: z.array(z.string()),
  min_years: z.number().nullable(),
  notes: z.array(z.string()),
});

export type SearchBrief = z.infer<typeof searchBriefSchema>;

export function searchInput(requirements: unknown, context: { scored: number; strong: number }) {
  return `Vacature (vaste eisen):\n${JSON.stringify(requirements, null, 2)}\n\nResultaat eigen pool: ${context.scored} kandidaten gescoord, ${context.strong} met score 70 of hoger.`;
}
