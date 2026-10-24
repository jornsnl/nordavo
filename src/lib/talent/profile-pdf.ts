import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProfileContent } from "@/lib/ai/prompts/profile";

/**
 * T4: the anonymous profile as a PDF in Nordavo style: navy header bar, saffron
 * accent, the compass mark drawn with simple shapes and a "Profiel via Nordavo"
 * footer. The document carries only the profile code (NV-xxxxxx), never a
 * candidate identifier, also not in the metadata or file name.
 */

const NAVY = rgb(10 / 255, 26 / 255, 47 / 255);
const SAFFRON = rgb(242 / 255, 163 / 255, 58 / 255);
const INK = rgb(0.13, 0.16, 0.22);
const MUTED = rgb(0.42, 0.46, 0.53);
const SOFT = rgb(0.965, 0.957, 0.937);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 56;

/** Characters the standard fonts (WinAnsi) can encode, beyond Latin-1. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Make text safe for the standard PDF fonts: fold accents where needed, drop the rest. */
export function toPdfText(value: string) {
  let out = "";
  for (const ch of value.replace(/\r/g, "").replace(/\t/g, " ").replace(/\s[—–]\s/g, ", ")) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
      continue;
    }
    const folded = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (folded && [...folded].every((c) => (c.codePointAt(0) ?? 0) < 256)) out += folded;
  }
  return out;
}

/** Break text into lines that fit `maxWidth`. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toPdfText(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word longer than the line: hard break it.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** The Nordavo compass: a ring with a saffron north needle and a white south needle. */
function drawCompass(page: PDFPage, cx: number, cy: number, r: number) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: WHITE, borderWidth: 1.6 });
  page.drawCircle({ x: cx, y: cy, size: r * 0.12, color: WHITE });
  // drawSvgPath uses SVG coordinates: origin at (x, y), y grows downwards.
  const n = r * 0.78;
  const w = r * 0.26;
  page.drawSvgPath(`M 0 ${-n} L ${w} 0 L 0 ${w * 0.4} L ${-w} 0 Z`, { x: cx, y: cy, color: SAFFRON });
  page.drawSvgPath(`M 0 ${n} L ${w} 0 L 0 ${-w * 0.4} L ${-w} 0 Z`, { x: cx, y: cy, color: WHITE, opacity: 0.85 });
  for (const [dx, dy] of [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ]) {
    page.drawLine({
      start: { x: cx + dx * r * 0.82, y: cy + dy * r * 0.82 },
      end: { x: cx + dx * r, y: cy + dy * r },
      thickness: 1.2,
      color: WHITE,
    });
  }
}

export type ProfilePdfOptions = {
  code: string;
  /** Role the profile is for, for example "Senior Data Engineer". No client name. */
  vacancyTitle?: string | null;
  /** Date shown in the header, YYYY-MM-DD. */
  date?: string;
};

export async function renderProfilePdf(content: ProfileContent, { code, vacancyTitle, date }: ProfilePdfOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Nordavo profiel ${code}`);
  pdf.setAuthor("Nordavo");
  pdf.setSubject("Anoniem kandidaatprofiel");
  pdf.setCreator("Nordavo");
  pdf.setProducer("Nordavo");
  pdf.setKeywords([code]);
  const created = date ? new Date(`${date}T12:00:00Z`) : new Date();
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    const barH = pages.length === 1 ? 96 : 40;
    page.drawRectangle({ x: 0, y: PAGE_H - barH, width: PAGE_W, height: barH, color: NAVY });
    page.drawRectangle({ x: 0, y: PAGE_H - barH - 4, width: PAGE_W, height: 4, color: SAFFRON });
    if (pages.length === 1) {
      drawCompass(page, MARGIN + 20, PAGE_H - 48, 20);
      page.drawText("Nordavo", { x: MARGIN + 52, y: PAGE_H - 46, size: 22, font: bold, color: WHITE });
      page.drawText("Anoniem kandidaatprofiel", { x: MARGIN + 52, y: PAGE_H - 64, size: 10, font: regular, color: SAFFRON });
      const right = toPdfText(code);
      page.drawText(right, {
        x: PAGE_W - MARGIN - bold.widthOfTextAtSize(right, 12),
        y: PAGE_H - 46,
        size: 12,
        font: bold,
        color: WHITE,
      });
      const when = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(created);
      const whenText = toPdfText(when);
      page.drawText(whenText, {
        x: PAGE_W - MARGIN - regular.widthOfTextAtSize(whenText, 9),
        y: PAGE_H - 62,
        size: 9,
        font: regular,
        color: rgb(0.8, 0.84, 0.9),
      });
      y = PAGE_H - barH - 40;
    } else {
      drawCompass(page, MARGIN + 10, PAGE_H - 20, 10);
      page.drawText(`Nordavo  ${toPdfText(code)}`, { x: MARGIN + 28, y: PAGE_H - 24, size: 10, font: bold, color: WHITE });
      y = PAGE_H - barH - 32;
    }
  }

  function ensure(height: number) {
    if (y - height < MARGIN + FOOTER_H) newPage();
  }

  function paragraph(text: string, { size = 10.5, font = regular, color = INK, indent = 0, gap = 4 } = {}) {
    const lineH = size * 1.45;
    for (const line of wrapText(text, font, size, CONTENT_W - indent)) {
      ensure(lineH);
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= lineH;
    }
    y -= gap;
  }

  function sectionTitle(title: string) {
    ensure(40);
    y -= 10;
    page.drawRectangle({ x: MARGIN, y: y - 12, width: 3, height: 13, color: SAFFRON });
    page.drawText(toPdfText(title.toUpperCase()), { x: MARGIN + 10, y: y - 11, size: 9.5, font: bold, color: NAVY });
    y -= 24;
  }

  function bullets(items: string[]) {
    for (const item of items) {
      const lines = wrapText(item, regular, 10.5, CONTENT_W - 14);
      lines.forEach((line, i) => {
        ensure(15);
        if (i === 0) page.drawCircle({ x: MARGIN + 4, y: y - 7, size: 1.8, color: SAFFRON });
        page.drawText(line, { x: MARGIN + 14, y: y - 10.5, size: 10.5, font: regular, color: INK });
        y -= 15.2;
      });
      y -= 2;
    }
  }

  function chips(items: string[]) {
    const size = 9.5;
    const padX = 8;
    const h = 18;
    let x = MARGIN;
    ensure(h + 6);
    for (const raw of items) {
      const text = toPdfText(raw);
      const w = Math.min(CONTENT_W, bold.widthOfTextAtSize(text, size) + padX * 2);
      if (x + w > MARGIN + CONTENT_W) {
        x = MARGIN;
        y -= h + 6;
        ensure(h + 6);
      }
      page.drawRectangle({ x, y: y - h, width: w, height: h, color: SOFT, borderColor: rgb(0.88, 0.86, 0.82), borderWidth: 0.6 });
      page.drawText(text, { x: x + padX, y: y - h + 5.5, size, font: bold, color: NAVY, maxWidth: w - padX * 2 });
      x += w + 6;
    }
    y -= h + 10;
  }

  newPage();

  // Headline and key facts.
  const headlineLines = wrapText(content.headline, bold, 22, CONTENT_W);
  for (const line of headlineLines) {
    ensure(28);
    page.drawText(line, { x: MARGIN, y: y - 22, size: 22, font: bold, color: NAVY });
    y -= 28;
  }
  if (vacancyTitle) paragraph(`Voorgesteld voor: ${vacancyTitle}`, { size: 10, color: MUTED, gap: 8 });

  const facts: [string, string][] = [
    ["Niveau", content.seniority],
    ["Ervaring", content.years_experience === null ? "Onbekend" : `${content.years_experience} jaar`],
    ["Engels", content.english_level],
    ["Beschikbaar", content.availability],
  ];
  const colW = CONTENT_W / 2;
  const factRows = Math.ceil(facts.length / 2);
  const factH = factRows * 40 + 12;
  ensure(factH);
  page.drawRectangle({ x: MARGIN, y: y - factH, width: CONTENT_W, height: factH, color: SOFT });
  facts.forEach(([label, value], i) => {
    const fx = MARGIN + 14 + (i % 2) * colW;
    const fy = y - 14 - Math.floor(i / 2) * 40;
    page.drawText(toPdfText(label.toUpperCase()), { x: fx, y: fy - 8, size: 8, font: bold, color: MUTED });
    const valueLine = wrapText(value, bold, 11, colW - 24)[0] ?? "";
    page.drawText(valueLine, { x: fx, y: fy - 24, size: 11, font: bold, color: INK });
  });
  y -= factH + 6;

  if (content.core_skills.length > 0) {
    sectionTitle("Kernskills");
    chips(content.core_skills);
  }
  if (content.project_types.length > 0) {
    sectionTitle("Type projecten");
    bullets(content.project_types);
  }
  if (content.sectors.length > 0) {
    sectionTitle("Sectoren");
    paragraph(content.sectors.join(", "));
  }

  sectionTitle("Beoordeling door Nordavo");
  const assessmentLines = wrapText(content.assessment, regular, 10.5, CONTENT_W - 28);
  const blockH = assessmentLines.length * 15.2 + 20;
  if (y - blockH >= MARGIN + FOOTER_H) {
    page.drawRectangle({ x: MARGIN, y: y - blockH, width: CONTENT_W, height: blockH, color: SOFT });
    page.drawRectangle({ x: MARGIN, y: y - blockH, width: 3, height: blockH, color: SAFFRON });
    y -= 10;
    for (const line of assessmentLines) {
      page.drawText(line, { x: MARGIN + 16, y: y - 10.5, size: 10.5, font: regular, color: INK });
      y -= 15.2;
    }
    y -= 10;
  } else {
    paragraph(content.assessment);
  }

  // Footer on every page.
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 22 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 22 }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) });
    p.drawText("Profiel via Nordavo", { x: MARGIN, y: MARGIN + 6, size: 9, font: bold, color: NAVY });
    p.drawText("nordavo.nl", { x: MARGIN + bold.widthOfTextAtSize("Profiel via Nordavo", 9) + 8, y: MARGIN + 6, size: 9, font: regular, color: SAFFRON });
    const right = toPdfText(`${code}  ·  pagina ${i + 1} van ${pages.length}`);
    p.drawText(right, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(right, 8.5), y: MARGIN + 6, size: 8.5, font: regular, color: MUTED });
    p.drawText("Vertrouwelijk. Persoonsgegevens deelt Nordavo pas na akkoord van de kandidaat.", {
      x: MARGIN,
      y: MARGIN - 8,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}

/** File name for downloads: the profile code only. */
export function profileFileName(code: string) {
  return `Nordavo-profiel-${code.replace(/[^A-Z0-9-]/gi, "")}.pdf`;
}
