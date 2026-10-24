import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ProfileContent } from "@/lib/ai/prompts/profile";
import { profileFileName, renderProfilePdf, toPdfText, wrapText } from "@/lib/talent/profile-pdf";

const content: ProfileContent = {
  headline: "Senior Data Engineer (Python, Snowflake)",
  seniority: "Senior",
  years_experience: 7,
  core_skills: ["Python", "Snowflake", "dbt", "Airflow", "AWS", "SQL"],
  project_types: ["Bouwde een dataplatform voor een Europese e-commerce speler.", "Migreerde ETL naar dbt met tests en CI."],
  sectors: ["E-commerce", "Fintech"],
  english_level: "Vloeiend, werkt dagelijks met Europese teams",
  availability: "Binnen 30 dagen",
  assessment: "Sterke data engineer die zelfstandig pipelines ontwerpt. Communiceert helder in het Engels. Let op: weinig ervaring met realtime streaming.",
};

test("renders a valid one page PDF with code-only metadata", async () => {
  const bytes = await renderProfilePdf(content, { code: "NV-3F2A9C", vacancyTitle: "Senior Data Engineer", date: "2026-10-24" });
  assert.ok(bytes.length > 1000);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), "Nordavo profiel NV-3F2A9C");
  assert.equal(pdf.getAuthor(), "Nordavo");
  assert.equal(pdf.getProducer(), "Nordavo");
});

test("long content flows onto extra pages", async () => {
  const long = {
    ...content,
    project_types: Array.from({ length: 30 }, (_, i) => `Project ${i + 1}: een lange beschrijving van verantwoordelijkheden, keuzes en resultaten in een groot team.`),
    assessment: "Zin. ".repeat(400),
  };
  const pdf = await PDFDocument.load(await renderProfilePdf(long, { code: "NV-ABCDEF" }));
  assert.ok(pdf.getPageCount() >= 2);
});

test("text outside the standard font is folded or dropped instead of crashing", async () => {
  assert.equal(toPdfText("Café — één"), "Café, één");
  assert.equal(toPdfText("Ş✓ ok"), "S ok");
  const tricky = { ...content, headline: "Data engineer ✓ बेंगलुरु", assessment: "Ǆ “quotes” • €" };
  const pdf = await PDFDocument.load(await renderProfilePdf(tricky, { code: "NV-000001" }));
  assert.equal(pdf.getPageCount(), 1);
});

test("wrapText respects the width and breaks very long words", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapText(`kort ${"x".repeat(200)} einde`, font, 10, 100);
  assert.ok(lines.length > 3);
  for (const line of lines) assert.ok(font.widthOfTextAtSize(line, 10) <= 100);
});

test("file name holds only the profile code", () => {
  assert.equal(profileFileName("NV-3F2A9C"), "Nordavo-profiel-NV-3F2A9C.pdf");
  assert.equal(profileFileName("NV-../x y"), "Nordavo-profiel-NV-xy.pdf");
});
