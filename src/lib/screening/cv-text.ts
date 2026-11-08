import { cleanEmail, cleanLinkedin, cleanPhone } from "@/lib/screening/candidate-csv";

/**
 * Reading CV files (recruitment brief 2.6.2 and 2.11): file kinds, limits,
 * and the fields that can be found in the text without Claude (email,
 * phone, LinkedIn and a likely name). Pure, unit tested.
 */

export const MAX_CV_BYTES = 10 * 1024 * 1024;
/** Longest CV text stored (candidates.cv_text allows 100,000 characters). */
export const MAX_CV_TEXT = 100_000;

export type CvFileKind = "pdf" | "docx" | "doc";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The kind of CV file by extension and mime type, or null when it is not a CV format. */
export function cvFileKind(fileName: string, mime: string | null | undefined): CvFileKind | null {
  const name = fileName.toLowerCase();
  const type = (mime ?? "").toLowerCase();
  if (name.endsWith(".pdf") && (!type || type === "application/pdf" || type === "application/octet-stream")) return "pdf";
  if (name.endsWith(".docx") && (!type || type === DOCX_MIME || type === "application/octet-stream" || type === "application/zip")) return "docx";
  if (name.endsWith(".doc") && (!type || type === "application/msword" || type === "application/octet-stream")) return "doc";
  return null;
}

/** Magic bytes: PDFs start with %PDF, DOCX files are zip archives (PK). */
export function sniffMatches(kind: CvFileKind, bytes: Uint8Array) {
  if (kind === "pdf") return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (kind === "docx") return bytes[0] === 0x50 && bytes[1] === 0x4b;
  return bytes[0] === 0xd0 && bytes[1] === 0xcf;
}

export function mimeFor(kind: CvFileKind) {
  return kind === "pdf" ? "application/pdf" : kind === "docx" ? DOCX_MIME : "application/msword";
}

const NOT_A_NAME = /\b(curriculum|vitae|resume|résumé|cv|profile|summary|contact|email|phone|mobile|address|objective|experience|skills|developer|engineer|manager|analyst|consultant|page)\b/i;

/** "Priya_Sharma-CV (2).pdf" -> "Priya Sharma"; null when nothing name-like is left. */
export function nameFromFileName(fileName: string): string | null {
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\(\d+\)/g, " ")
    .replace(/\b(cv|resume|résumé|curriculum vitae|updated|latest|final|new|naukri|profile)\b/gi, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(" ").filter((w) => /^\p{L}[\p{L}']*$/u.test(w));
  if (words.length < 1 || words.length > 4) return null;
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** A line that looks like a person's name: two to four words of letters, no keywords. */
function looksLikeName(line: string) {
  const text = line.replace(/\s+/g, " ").trim();
  if (text.length < 4 || text.length > 60 || NOT_A_NAME.test(text)) return false;
  const words = text.split(" ");
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{L}[\p{L}.'-]*$/u.test(w));
}

export type HeuristicFields = { full_name: string | null; email: string | null; phone: string | null; linkedin_url: string | null };

/** Fields found in CV text without Claude. */
export function heuristicFields(text: string, fileName: string): HeuristicFields {
  const head = text.slice(0, 3000);
  const email = cleanEmail(head) ?? cleanEmail(text);
  const phoneMatch = head.match(/(?:\+?\d[\d\s().-]{8,}\d)/g)?.find((p) => !/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(p.trim()));
  const linkedinMatch = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/i);
  const nameLine = head
    .split("\n")
    .slice(0, 8)
    .map((l) => l.replace(/^name\s*[:-]\s*/i, ""))
    .find(looksLikeName);
  const name = nameLine
    ? nameLine
        .trim()
        .split(/\s+/)
        .map((w) => (w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w))
        .join(" ")
    : nameFromFileName(fileName);
  return {
    full_name: name,
    email,
    phone: phoneMatch ? cleanPhone(phoneMatch) : null,
    linkedin_url: linkedinMatch ? cleanLinkedin(linkedinMatch[0]) : null,
  };
}

/** CV text as stored: trimmed to the column limit. */
export function storableCvText(text: string | null | undefined) {
  const t = (text ?? "").replace(/\u0000/g, "").trim();
  return t ? t.slice(0, MAX_CV_TEXT) : null;
}
