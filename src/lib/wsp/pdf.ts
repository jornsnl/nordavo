import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { toPdfText, wrapText } from "@/lib/talent/profile-pdf";
import {
  BAND_LABELS,
  COLUMN_FOR_EMPLOYER,
  COLUMN_FOR_YOU,
  COLUMN_HIGHER_STRENGTHS,
  COLUMN_LOWER_STRENGTHS,
  REPORT_FOOTER,
  REPORT_TITLE,
  SCORE_TOOLTIP,
} from "./content";
import { formatWspDate, reportIntro, splitName, watermarkText, type ReportAudience } from "./text";
import { orderedDimensions, type ResultRow } from "./view";

// The report as a PDF, made on the server from the stored results and the
// fixed texts (part 4, Export). Same content as the page, with the intro of
// the role that downloads it. A PDF for a client carries the watermark on
// every page. Never answers or flags. No AI.

const NAVY = rgb(10 / 255, 26 / 255, 47 / 255);
const SAFFRON = rgb(242 / 255, 163 / 255, 58 / 255);
const INK = rgb(0.13, 0.16, 0.22);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.86, 0.88, 0.91);
const SOFT = rgb(0.965, 0.957, 0.937);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 44;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 70;

export type ReportPdfInput = {
  fullName: string;
  roleLabel: string | null;
  completedAt: string;
  results: ResultRow[];
  audience: ReportAudience;
  /** Only for a client: the share the watermark names. */
  watermark: { clientName: string; consentedAt: string } | null;
};

export async function buildReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const created = new Date(input.completedAt);
  pdf.setTitle(toPdfText(`${REPORT_TITLE} ${input.fullName}`));
  pdf.setAuthor("Nordavo");
  pdf.setCreator("Nordavo");
  pdf.setProducer("Nordavo");
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { first } = splitName(input.fullName);
  const intro = reportIntro(input.audience, first);
  const watermark = input.watermark
    ? watermarkText(input.watermark.clientName, input.fullName, formatWspDate(input.watermark.consentedAt))
    : null;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    const barH = pages.length === 1 ? 84 : 36;
    page.drawRectangle({ x: 0, y: PAGE_H - barH, width: PAGE_W, height: barH, color: NAVY });
    page.drawRectangle({ x: 0, y: PAGE_H - barH - 3, width: PAGE_W, height: 3, color: SAFFRON });
    if (pages.length === 1) {
      page.drawText("Nordavo", { x: MARGIN, y: PAGE_H - 34, size: 12, font: bold, color: SAFFRON });
      page.drawText(REPORT_TITLE, { x: MARGIN, y: PAGE_H - 62, size: 22, font: bold, color: WHITE });
      y = PAGE_H - barH - 30;
    } else {
      page.drawText(toPdfText(`${REPORT_TITLE} · ${input.fullName}`), { x: MARGIN, y: PAGE_H - 23, size: 10, font: bold, color: WHITE });
      y = PAGE_H - barH - 26;
    }
  }

  function ensure(height: number) {
    if (y - height < BOTTOM) newPage();
  }

  function paragraph(text: string, size: number, font: PDFFont, color = INK, width = CONTENT_W, x = MARGIN, gap = 4): number {
    const lines = wrapText(text, font, size, width);
    for (const line of lines) {
      page.drawText(line, { x, y: y - size, size, font, color });
      y -= size + gap;
    }
    return lines.length;
  }

  function measure(text: string, size: number, font: PDFFont, width: number, gap = 4) {
    return wrapText(text, font, size, width).length * (size + gap);
  }

  newPage();

  // Header: name, role or vacancy, date of the questionnaire.
  paragraph(input.fullName, 16, bold, NAVY);
  const sub = [input.roleLabel, formatWspDate(input.completedAt)].filter(Boolean).join("  ·  ");
  if (sub) paragraph(sub, 10, regular, MUTED);
  y -= 14;

  // Intro for the role.
  const introH = measure(intro.body, 10, regular, CONTENT_W - 24) + 40;
  ensure(introH);
  page.drawRectangle({ x: MARGIN, y: y - introH + 8, width: CONTENT_W, height: introH, color: SOFT });
  y -= 6;
  paragraph(intro.heading, 12, bold, NAVY, CONTENT_W - 24, MARGIN + 12);
  y -= 2;
  paragraph(intro.body, 10, regular, INK, CONTENT_W - 24, MARGIN + 12);
  y -= 22;

  // One block per dimension, in report order.
  const colW = (CONTENT_W - 16) / 2;
  for (const dim of orderedDimensions(input.results)) {
    const t = dim.text;
    const band = t.bands[dim.band];
    const strengthsH = Math.max(
      measure(t.lowerStrengths, 9, regular, colW - 16),
      measure(t.higherStrengths, 9, regular, colW - 16),
    );
    const bandH = Math.max(measure(band.forYou, 9, regular, colW - 16), measure(band.forEmployer, 9, regular, colW - 16));
    const blockH = 30 + measure(t.description, 10, regular, CONTENT_W) + 62 + strengthsH + 26 + bandH + 34;
    ensure(blockH);

    const top = y;
    page.drawRectangle({ x: MARGIN, y: top - blockH + 10, width: CONTENT_W, height: blockH, borderColor: LINE, borderWidth: 1, color: WHITE });
    y -= 10;
    // Name, score in large with the band label.
    page.drawText(toPdfText(t.name), { x: MARGIN + 12, y: y - 15, size: 15, font: bold, color: NAVY });
    const score = `${dim.score} / 100`;
    const scoreW = bold.widthOfTextAtSize(score, 20);
    const label = BAND_LABELS[dim.band];
    const labelW = bold.widthOfTextAtSize(label, 9) + 14;
    page.drawText(score, { x: PAGE_W - MARGIN - 12 - scoreW, y: y - 18, size: 20, font: bold, color: NAVY });
    page.drawRectangle({ x: PAGE_W - MARGIN - 12 - scoreW - labelW - 8, y: y - 19, width: labelW, height: 16, color: SAFFRON });
    page.drawText(label, { x: PAGE_W - MARGIN - 12 - scoreW - labelW - 1, y: y - 14, size: 9, font: bold, color: NAVY });
    y -= 28;
    paragraph(t.description, 10, regular, INK, CONTENT_W - 24, MARGIN + 12);

    // The bar from 0 to 100 with a marker on the score.
    y -= 8;
    const barX = MARGIN + 12;
    const barW = CONTENT_W - 24;
    page.drawText(toPdfText(t.leftLabel), { x: barX, y: y - 9, size: 9, font: bold, color: MUTED });
    const rightW = bold.widthOfTextAtSize(toPdfText(t.rightLabel), 9);
    page.drawText(toPdfText(t.rightLabel), { x: barX + barW - rightW, y: y - 9, size: 9, font: bold, color: MUTED });
    y -= 18;
    page.drawRectangle({ x: barX, y: y - 6, width: barW, height: 6, color: LINE });
    page.drawRectangle({ x: barX, y: y - 6, width: (barW * dim.score) / 100, height: 6, color: NAVY });
    const markerX = barX + (barW * dim.score) / 100;
    page.drawCircle({ x: markerX, y: y - 3, size: 6, color: SAFFRON, borderColor: NAVY, borderWidth: 1.5 });
    y -= 18;
    for (const [tick, at] of [["0", 0], ["50", 0.5], ["100", 1]] as const) {
      const w = regular.widthOfTextAtSize(tick, 8);
      const x = at === 0 ? barX : at === 1 ? barX + barW - w : barX + barW / 2 - w / 2;
      page.drawText(tick, { x, y: y - 2, size: 8, font: regular, color: MUTED });
    }
    y -= 18;

    // Strengths of both sides, then the two columns for the person's band.
    const columns = (left: [string, string], right: [string, string], h: number) => {
      const start = y;
      page.drawText(left[0], { x: MARGIN + 12, y: y - 9, size: 9, font: bold, color: NAVY });
      page.drawText(right[0], { x: MARGIN + 12 + colW + 16, y: y - 9, size: 9, font: bold, color: NAVY });
      y -= 14;
      const afterTitle = y;
      paragraph(left[1], 9, regular, INK, colW - 16, MARGIN + 12);
      y = afterTitle;
      paragraph(right[1], 9, regular, INK, colW - 16, MARGIN + 12 + colW + 16);
      y = start - 14 - h - 8;
    };
    columns([COLUMN_LOWER_STRENGTHS, t.lowerStrengths], [COLUMN_HIGHER_STRENGTHS, t.higherStrengths], strengthsH);
    columns([COLUMN_FOR_YOU, band.forYou], [COLUMN_FOR_EMPLOYER, band.forEmployer], bandH);
    y = top - blockH - 2;
  }

  // What the score means (the tooltip on the page) and the footer.
  const endH = measure(SCORE_TOOLTIP, 8.5, regular, CONTENT_W) + measure(REPORT_FOOTER, 8.5, regular, CONTENT_W) + 20;
  ensure(endH);
  paragraph(`i  ${SCORE_TOOLTIP}`, 8.5, regular, MUTED);
  y -= 8;
  paragraph(REPORT_FOOTER, 8.5, regular, MUTED);

  // Page numbers, and the watermark on every page of a client PDF.
  pages.forEach((p, index) => {
    const label = `${index + 1} / ${pages.length}`;
    p.drawText(label, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 8), y: 22, size: 8, font: regular, color: MUTED });
    if (watermark) {
      p.drawRectangle({ x: 0, y: 38, width: PAGE_W, height: 0.75, color: SAFFRON });
      wrapText(watermark, bold, 8, CONTENT_W - 50).forEach((line, i) => {
        p.drawText(line, { x: MARGIN, y: 26 - i * 10, size: 8, font: bold, color: NAVY });
      });
    }
  });

  return pdf.save();
}
