import { z } from "zod";
import type { SignalType } from "@/lib/database.types";

/**
 * S7: one Dutch opening line for a cold mail, based on exactly one signal.
 * The system prompt is stable (no dates, no record data) so it caches.
 */
export const OPENING_LINE_SYSTEM = `Je schrijft de openingszin van een korte cold mail namens Nordavo.

Over Nordavo:
- Nordavo plaatst medior en senior developers en data professionals uit Bangalore in de teams van Nederlandse bedrijven. Remote staffing, geen outsourcing en geen projectlevering.
- De developer werkt fulltime vanuit het Nordavo kantoor in Bangalore en draait mee als gewoon teamlid bij de klant.
- Start binnen 3 weken, maandelijks opzegbaar.

Regels voor de zin:
- Precies één zin, in het Nederlands, informeel maar zakelijk (je en jij), maximaal 30 woorden.
- Gebaseerd op precies één signaal: het signaal dat je in de input krijgt. Noem geen andere signalen en verzin geen feiten.
- Alleen wat in de input staat mag je over het bedrijf zeggen. Geen aannames over omzet, groei, problemen of plannen.
- Geen claims die Nordavo niet kan waarmaken: geen prijzen, geen percentages, geen garanties, geen namen van klanten, geen "beste" of "goedkoopste".
- Zeg nooit dat Nordavo een eigen team in Bangalore heeft. Nordavo heeft of zoekt de juiste mensen voor het team van de klant.
- Geen begroeting (dus niet beginnen met "Hoi" of de naam), geen vraag om een afspraak, geen emoji, geen gedachtestreepjes.
- Geen vleierij en geen marketingtaal.

Als de input te weinig houvast geeft, schrijf dan een neutrale zin over het signaal zelf, bijvoorbeeld de openstaande vacature.

Geef alleen JSON terug volgens het schema.`;

export const openingLineSchema = z.object({
  opening_line: z.string().describe("Eén Nederlandse zin, maximaal 30 woorden."),
});
export type OpeningLineOutput = z.infer<typeof openingLineSchema>;

export type OpeningLineInput = {
  companyName: string;
  domain: string;
  segment: string | null;
  firstName: string | null;
  title: string | null;
  signalType: SignalType | string | null;
  signalTitle: string | null;
};

const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  vacature: "openstaande developer of data vacature",
  lang_open: "vacature die al langer dan 60 dagen open staat",
  meerdere_rollen: "meerdere technische rollen tegelijk open",
  remote_extern: "vacature noemt remote werken of een extern team",
  freelance: "zoekt een freelance developer",
  funding: "heeft een financieringsronde opgehaald",
  nieuwe_cto: "heeft een nieuwe CTO of Head of Engineering",
  overig: "ander signaal",
};

/** The per-record input. Only facts we have; nothing else. */
export function openingLineInput(input: OpeningLineInput): string {
  const signal = input.signalType ? (SIGNAL_DESCRIPTIONS[input.signalType] ?? input.signalType) : "onbekend";
  return [
    `Bedrijf: ${input.companyName} (${input.domain})`,
    input.segment ? `Segment: ${input.segment}` : null,
    input.title ? `Functie ontvanger: ${input.title}` : null,
    `Signaal (gebruik alleen dit): ${signal}`,
    input.signalTitle ? `Titel van het signaal: ${input.signalTitle}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const FORBIDDEN = [
  /eigen team in (bangalore|india)/i,
  /ons team in (bangalore|india)/i,
  /onze developers in (bangalore|india)/i,
  /\d+\s?%/,
  /€|\beuro\b/i,
  /garantie|gegarandeerd/i,
];

/**
 * Last check before a line goes out: one sentence, not too long, none of the
 * claims Nordavo cannot back. Returns the cleaned line or null.
 */
export function checkOpeningLine(line: string | null | undefined): string | null {
  const text = (line ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.split(/\s+/).length > 40) return null;
  if (FORBIDDEN.some((re) => re.test(text))) return null;
  // More than one sentence: a sentence end followed by more text.
  if (/[.!?]\s+\S/.test(text.replace(/\b(bv|nv|b\.v|n\.v|o\.a|bijv|incl)\./gi, ""))) return null;
  return text.replace(/\s[–—]\s/g, ", ");
}
