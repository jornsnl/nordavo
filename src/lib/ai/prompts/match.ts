import { z } from "zod";

/**
 * T2 Kandidaat matchen (briefing section 11): per candidate a score, a short
 * reason, risks and the must haves that are missing. Candidates arrive with an
 * opaque ref and without name or contact details (hard rule 11 and 12).
 */
export const MATCH_SYSTEM = `Je beoordeelt kandidaten uit de talentenpool van Nordavo voor één vacature. Nordavo plaatst medior en senior developers en data professionals uit Bangalore fulltime in de teams van Nederlandse bedrijven. Ze werken remote vanuit Bangalore als gewoon teamlid, met overlap met Nederlandse werktijden en Engels als werktaal.

Je krijgt de vaste eisen van de vacature en een lijst kandidaten. Elke kandidaat heeft een ref, skills, jaren ervaring, senioriteit, type projecten, sectoren, Engels niveau, beschikbaarheid en soms een korte samenvatting waarin namen en werkgevers zijn weggelaten.

Geef voor elke kandidaat precies één beoordeling terug met dezelfde ref:
- score: geheel getal van 0 tot 100. Opbouw: must haves en stack (50), relevante ervaring en senioriteit (25), type projecten en sector (10), Engels en beschikbaarheid (15). 70 of hoger betekent: zou je met een gerust hart aan de klant voorstellen. Ontbreekt een must have, dan maximaal 65.
- reason: maximaal twee zinnen in het Nederlands, concreet: waarom deze kandidaat wel of niet past.
- risks: korte punten in het Nederlands (bijvoorbeeld "Engels niveau onbekend", "weinig ervaring met grote datasets", "pas over 2 maanden beschikbaar"). Leeg als er geen risico's zijn.
- missing: de must haves uit de vacature die je niet terugziet bij de kandidaat, in de bewoording van de vacature. Leeg als alles er is.

Beoordeel alleen op de gegeven gegevens. Ontbreekt informatie, noem dat als risico en geef geen hoge score op aannames. Noem geen namen of werkgevers.`;

export const matchResultSchema = z.object({
  candidates: z.array(
    z.object({
      ref: z.string(),
      score: z.number(),
      reason: z.string(),
      risks: z.array(z.string()),
      missing: z.array(z.string()),
    }),
  ),
});

export type MatchResult = z.infer<typeof matchResultSchema>;

export function matchInput(requirements: unknown, candidates: unknown[]) {
  return `Vacature (vaste eisen):\n${JSON.stringify(requirements, null, 2)}\n\nKandidaten:\n${JSON.stringify(candidates, null, 2)}`;
}
