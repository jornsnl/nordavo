import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AcademyLocale } from "@/lib/academy/database";
import { toPdfText } from "@/lib/talent/profile-pdf";

/**
 * The certificate of a completed course (Academy: gebruikersomgeving), in
 * the Academy house style: light blue frame and band, orange accent, the
 * Nordavo compass. A4 landscape, one page, in the person's language. Pure:
 * rendered on request from the academy_certificates row
 * (/academy/certificates/[id]), tested in tests/academy-media.test.ts.
 */

const BLUE_900 = rgb(11 / 255, 53 / 255, 80 / 255);
const BLUE_700 = rgb(27 / 255, 99 / 255, 144 / 255);
const BLUE_200 = rgb(197 / 255, 228 / 255, 247 / 255);
const BLUE_50 = rgb(242 / 255, 249 / 255, 254 / 255);
const ORANGE = rgb(194 / 255, 65 / 255, 12 / 255);
const ORANGE_SOFT = rgb(242 / 255, 107 / 255, 29 / 255);
const MUTED = rgb(0.38, 0.44, 0.5);
const WHITE = rgb(1, 1, 1);

const W = 841.89;
const H = 595.28;

export type CertificateInput = {
  fullName: string;
  courseTitle: string;
  number: string;
  /** ISO timestamp or YYYY-MM-DD. */
  issuedAt: string;
  locale: AcademyLocale;
};

function centered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = BLUE_900) {
  const clean = toPdfText(text);
  const width = font.widthOfTextAtSize(clean, size);
  page.drawText(clean, { x: (W - width) / 2, y, size, font, color });
}

/** Shrink the size until the text fits the width (long names and titles). */
function fitSize(text: string, font: PDFFont, size: number, maxWidth: number, min = 14) {
  let s = size;
  while (s > min && font.widthOfTextAtSize(toPdfText(text), s) > maxWidth) s -= 1;
  return s;
}

function compass(page: PDFPage, cx: number, cy: number, r: number) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: BLUE_700, borderWidth: 1.6 });
  page.drawCircle({ x: cx, y: cy, size: r * 0.12, color: BLUE_700 });
  const n = r * 0.78;
  const w = r * 0.26;
  page.drawSvgPath(`M 0 ${-n} L ${w} 0 L 0 ${w * 0.4} L ${-w} 0 Z`, { x: cx, y: cy, color: ORANGE_SOFT });
  page.drawSvgPath(`M 0 ${n} L ${w} 0 L 0 ${-w * 0.4} L ${-w} 0 Z`, { x: cx, y: cy, color: BLUE_700, opacity: 0.85 });
}

function issuedDate(value: string, locale: AcademyLocale) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  }).format(date);
}

export async function renderCertificatePdf({ fullName, courseTitle, number, issuedAt, locale }: CertificateInput): Promise<Uint8Array> {
  const nl = locale === "nl";
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(nl ? `Certificaat ${courseTitle}` : `Certificate ${courseTitle}`);
  pdf.setAuthor("Nordavo");
  pdf.setSubject(nl ? "Certificaat Nordavo Academy" : "Nordavo Academy certificate");
  pdf.setCreator("Nordavo Academy");
  pdf.setProducer("Nordavo");
  pdf.setKeywords([number]);
  const created = /^\d{4}-\d{2}-\d{2}$/.test(issuedAt) ? new Date(`${issuedAt}T12:00:00Z`) : new Date(issuedAt);
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([W, H]);

  // Background, frame and the light blue band at the top.
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: BLUE_50 });
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, color: WHITE, borderColor: BLUE_200, borderWidth: 2 });
  page.drawRectangle({ x: 24, y: H - 24 - 86, width: W - 48, height: 86, color: BLUE_200 });
  page.drawRectangle({ x: 24, y: H - 24 - 90, width: W - 48, height: 4, color: ORANGE });

  compass(page, 76, H - 24 - 43, 22);
  page.drawText("nordavo", { x: 108, y: H - 24 - 50, size: 22, font: bold, color: BLUE_900 });
  page.drawText("ACADEMY", { x: 206, y: H - 24 - 49, size: 12, font: bold, color: ORANGE });

  centered(page, nl ? "CERTIFICAAT" : "CERTIFICATE", bold, 30, H - 190, BLUE_900);
  centered(page, nl ? "Hierbij verklaart Nordavo dat" : "Nordavo hereby certifies that", regular, 14, H - 228, MUTED);

  const nameSize = fitSize(fullName, bold, 36, W - 200);
  centered(page, fullName, bold, nameSize, H - 285, BLUE_900);
  const nameWidth = Math.min(W - 200, bold.widthOfTextAtSize(toPdfText(fullName), nameSize) + 40);
  page.drawLine({ start: { x: (W - nameWidth) / 2, y: H - 300 }, end: { x: (W + nameWidth) / 2, y: H - 300 }, thickness: 1.5, color: ORANGE });

  centered(page, nl ? "de course heeft afgerond" : "has completed the course", regular, 14, H - 336, MUTED);
  const titleSize = fitSize(courseTitle, bold, 22, W - 200, 12);
  centered(page, courseTitle, bold, titleSize, H - 372, BLUE_700);

  // Footer: date and number left and right, signature line in the middle.
  const footY = 92;
  page.drawText(toPdfText(nl ? "Datum" : "Date"), { x: 84, y: footY + 22, size: 10, font: regular, color: MUTED });
  page.drawText(toPdfText(issuedDate(issuedAt, locale)), { x: 84, y: footY, size: 13, font: bold, color: BLUE_900 });

  const numberLabel = toPdfText(nl ? "Certificaatnummer" : "Certificate number");
  const numberText = toPdfText(number);
  page.drawText(numberLabel, { x: W - 84 - regular.widthOfTextAtSize(numberLabel, 10), y: footY + 22, size: 10, font: regular, color: MUTED });
  page.drawText(numberText, { x: W - 84 - bold.widthOfTextAtSize(numberText, 13), y: footY, size: 13, font: bold, color: BLUE_900 });

  page.drawLine({ start: { x: W / 2 - 110, y: footY + 14 }, end: { x: W / 2 + 110, y: footY + 14 }, thickness: 1, color: BLUE_200 });
  centered(page, "Nordavo", bold, 13, footY - 4, BLUE_900);
  centered(page, nl ? "De brug tussen Nederlandse groeibedrijven en Indiaas tech-talent" : "The bridge between Dutch growth companies and Indian tech talent", regular, 9, 48, MUTED);

  return pdf.save();
}

/** File name for the download: certificate-<course>-<number>.pdf, ASCII only. */
export function certificateFileName(courseTitle: string, number: string, locale: AcademyLocale): string {
  const slug = courseTitle
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${locale === "nl" ? "certificaat" : "certificate"}-${slug || "course"}-${number}.pdf`;
}
