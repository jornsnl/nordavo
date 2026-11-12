/**
 * Job profile text (feedback round 3): a client's vacancy file read without
 * Claude still gets some structure. Pure, so the upload and the tests share it.
 */

const BULLET = /^\s*([•●▪◦‣⁃–—*\-]|\d{1,2}[.)])\s+/;

/** Plain text from a PDF or Word file to light Markdown: headings and bullets. */
export function plainTextToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/g, ""));
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (BULLET.test(line)) {
      const ordered = /^\d/.test(line);
      out.push(ordered ? line.replace(/^(\d{1,2})[.)]\s+/, "$1. ") : `- ${line.replace(BULLET, "")}`);
      continue;
    }
    const words = line.split(/\s+/).length;
    const isHeading =
      words <= 8 &&
      line.length <= 60 &&
      !/[.,;]$/.test(line) &&
      (/:$/.test(line) || (line === line.toUpperCase() && /[A-Z]/.test(line)));
    if (isHeading) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      const title = line.replace(/:$/, "");
      out.push(`## ${title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase() : title}`);
      continue;
    }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

export const JOB_FILE_EXTENSIONS = [".pdf", ".docx", ".doc"];
