import { z } from "zod";
import { VACANCY_SYSTEM, vacancyExtractionSchema } from "./vacancy";

/**
 * A client's vacancy file (PDF or Word) read into the vacancy: the fixed
 * requirements as in T1, plus the job profile as clean Markdown.
 * Keep this prompt stable so it caches.
 */
export const VACANCY_FILE_SYSTEM = `${VACANCY_SYSTEM}

Daarnaast schrijf je job_profile: de vacaturetekst zelf, netjes opgemaakt in Markdown voor het vacatureprofiel in ons portaal. Regels voor job_profile:
- Houd de inhoud en de taal van de tekst aan (vaak Engels of Nederlands). Vat niet samen en verzin niets.
- Gebruik ## voor kopjes (bijvoorbeeld de rol, wat je gaat doen, wat we vragen, wat we bieden), - voor opsommingen en **vet** voor nadruk.
- Laat contactgegevens van recruiters, sollicitatie instructies en juridische kleine lettertjes weg.
- Geen HTML, geen tabellen.`;

export const VACANCY_FILE_PDF_EXTRA = `Je krijgt het bestand als PDF. Lees de tekst van de vacature eruit en doe daarna hetzelfde als bij een geplakte tekst. Zet in source_text de platte tekst van de vacature.`;

export const vacancyFileSchema = vacancyExtractionSchema.extend({
  job_profile: z.string(),
});

export const vacancyFilePdfSchema = vacancyFileSchema.extend({
  source_text: z.string(),
});

export type VacancyFileReading = z.infer<typeof vacancyFileSchema>;
