import { inflateRawSync } from "node:zlib";

/**
 * DOCX text extraction without a dependency: a DOCX is a zip archive with
 * the text in word/document.xml (and contact details often in the headers).
 * Reads the zip central directory, inflates the needed parts and turns the
 * WordprocessingML into plain text. Pure, unit tested.
 */

const MAX_PART_BYTES = 20 * 1024 * 1024;

type ZipEntry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

function findEndOfCentralDirectory(buf: Buffer) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** The entries of a zip archive (central directory). Throws on something that is not a zip. */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new Error("Not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("Broken zip directory");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The uncompressed bytes of one entry (stored or deflated). */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new Error("Broken zip entry");
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.size > MAX_PART_BYTES) throw new Error("Zip entry too large");
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
  throw new Error(`Unsupported zip compression ${entry.method}`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** WordprocessingML to plain text: paragraphs become lines, tabs and breaks kept. */
export function wordXmlToText(xml: string): string {
  const out: string[] = [];
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml))) {
    if (m[1] !== undefined) out.push(decodeXmlEntities(m[1]));
    else if (m[0] === "<w:tab/>") out.push("\t");
    else out.push("\n");
  }
  return cleanText(out.join(""));
}

/** Collapse runs of spaces and blank lines. */
export function cleanText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text of a DOCX file: headers first (contact details), then the body. */
export function extractDocxText(bytes: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const entries = listZipEntries(buf);
  const body = entries.find((e) => e.name === "word/document.xml");
  if (!body) throw new Error("This is not a Word document (no word/document.xml)");
  const headers = entries.filter((e) => /^word\/header\d*\.xml$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const parts = [...headers, body].map((e) => wordXmlToText(readZipEntry(buf, e).toString("utf8")));
  const seen = new Set<string>();
  return cleanText(parts.filter((p) => p && !seen.has(p) && seen.add(p)).join("\n\n"));
}
