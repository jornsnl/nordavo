import { inflateSync } from "node:zlib";

/**
 * Light PDF text extraction without a dependency: inflate the content
 * streams and read the text operators (Tj, TJ, ' and "). Works for PDFs with
 * simple fonts (many CV builders and exports); PDFs with embedded CID fonts
 * produce garbage, which looksLikeText() rejects so the caller can send the
 * file to Claude instead (or mark the text as pending). Pure, unit tested.
 */

const MAX_STREAM_BYTES = 8 * 1024 * 1024;

/** Decode a PDF literal string body (between the parentheses). */
function decodeLiteral(body: string) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    i += 1;
    if (next === undefined) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b" || next === "f") out += "";
    else if (next === "\n" || next === "\r") {
      if (next === "\r" && body[i + 1] === "\n") i += 1;
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? "")) {
        i += 1;
        oct += body[i];
      }
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
    } else out += next;
  }
  return out;
}

/** Hex string to text when it reads as single-byte text; CID (two-byte) strings are dropped. */
function decodeHex(hex: string) {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code === 0) return "";
    out += String.fromCharCode(code);
  }
  return out;
}

/** Text from one content stream. */
export function textFromContentStream(content: string): string {
  const out: string[] = [];
  let i = 0;
  const operands: string[] = [];
  let inText = false;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < content.length && depth > 0) {
        if (content[j] === "\\") j += 2;
        else {
          if (content[j] === "(") depth += 1;
          else if (content[j] === ")") depth -= 1;
          j += 1;
        }
      }
      operands.push(decodeLiteral(content.slice(i + 1, j - 1)));
      i = j;
      continue;
    }
    if (ch === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i);
      if (end < 0) break;
      operands.push(decodeHex(content.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    if (ch === "[") {
      operands.push("\u0000[");
      i += 1;
      continue;
    }
    if (ch === "]") {
      // Collapse the array into one operand; large negative kerning means a space.
      const start = operands.lastIndexOf("\u0000[");
      const parts = start >= 0 ? operands.splice(start) : [];
      operands.push(parts.slice(1).join(""));
      i += 1;
      continue;
    }
    if (/[-\d.]/.test(ch)) {
      let j = i + 1;
      while (j < content.length && /[\d.]/.test(content[j])) j += 1;
      const n = Number(content.slice(i, j));
      // Inside a TJ array a kerning below -200 is a word gap.
      if (operands.includes("\u0000[") && n < -200) operands.push(" ");
      i = j;
      continue;
    }
    if (/[A-Za-z'"*]/.test(ch)) {
      let j = i + 1;
      while (j < content.length && /[A-Za-z*]/.test(content[j])) j += 1;
      const op = content.slice(i, j);
      if (op === "BT") inText = true;
      else if (op === "ET") {
        inText = false;
        out.push("\n");
      } else if (inText) {
        if (op === "Tj" || op === "TJ") out.push(operands.filter((o) => o !== "\u0000[").join(""));
        else if (op === "'" || op === '"') out.push("\n", operands[operands.length - 1] ?? "");
        else if ((op === "T*" || op === "Td" || op === "TD") && out.length > 0 && !out[out.length - 1].endsWith("\n")) out.push("\n");
        else if (op === "Tm") out.push(" ");
      }
      if (!operands.includes("\u0000[")) operands.length = 0;
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Every decodable content stream of a PDF, inflated. */
function contentStreams(pdf: string): string[] {
  const streams: string[] = [];
  const re = /<<((?:[^<>]|<<(?:[^<>]|<<[^<>]*>>)*>>|<[^<>]*>)*)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf))) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const end = pdf.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end;
    if (/\/Subtype\s*\/(Image|Form|XML)|\/Type\s*\/(XObject|ObjStm|XRef|Metadata|EmbeddedFile)|\/Length1|\/FontFile/.test(dict)) continue;
    if (/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|LZWDecode|ASCII85Decode)/.test(dict)) continue;
    const raw = Buffer.from(pdf.slice(start, end), "latin1");
    if (raw.length > MAX_STREAM_BYTES) continue;
    if (/\/FlateDecode/.test(dict)) {
      try {
        streams.push(inflateSync(raw, { maxOutputLength: MAX_STREAM_BYTES }).toString("latin1"));
      } catch {
        // A damaged stream: skip it.
      }
    } else if (!/\/Filter/.test(dict)) {
      streams.push(raw.toString("latin1"));
    }
  }
  return streams;
}

/** Best-effort plain text of a PDF. Empty when nothing readable was found. */
export function extractPdfText(bytes: Buffer | Uint8Array): string {
  const pdf = Buffer.from(bytes).toString("latin1");
  if (!pdf.startsWith("%PDF")) return "";
  const text = contentStreams(pdf)
    .filter((s) => /\bBT\b/.test(s))
    .map(textFromContentStream)
    .join("\n");
  return text
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Whether extracted text is real text and not glyph garbage: long enough,
 * mostly letters, and mostly words with a vowel.
 */
export function looksLikeText(text: string, minLength = 150) {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < minLength) return false;
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  if (letters / compact.length < 0.55) return false;
  const words = text.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 20) return false;
  const wordLike = words.filter((w) => /^[A-Za-z][A-Za-z.,:;()'&/+#-]*$/.test(w) && /[aeiouy]/i.test(w)).length;
  return wordLike / words.length >= 0.5;
}
