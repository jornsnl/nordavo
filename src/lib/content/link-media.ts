/**
 * Putting a file in the media library from a link (Claude, feedback Julius:
 * "mijn foto's van de fotoshoot staan in Google Drive"). Pure helpers, so
 * the rules are unit tested; the download itself is in the MCP tool.
 */

/** At most this much per file from a link (the same as an upload). */
export const LINK_MAX_BYTES = 20 * 1024 * 1024;

/** Photos, videos and PDFs, like the upload form. */
export function allowedMediaType(mime: string | null | undefined): boolean {
  return Boolean(mime && /^(image\/(jpeg|png|webp|gif|heic|heif)|video\/(mp4|quicktime|webm)|application\/pdf)$/i.test(mime.split(";")[0].trim()));
}

/** The file id of a Google Drive link (file/d/<id>, open?id=<id>, uc?id=<id>), or null. */
export function driveFileId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(url.hostname)) return null;
  const path = url.pathname.match(/\/file\/d\/([\w-]{10,})/);
  if (path) return path[1];
  const id = url.searchParams.get("id");
  return id && /^[\w-]{10,}$/.test(id) ? id : null;
}

/**
 * Whether a link may be fetched by the server: https only, and never an IP
 * address, localhost or an internal name (so a link cannot reach the
 * network the portal runs in).
 */
export function fetchableLink(link: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, error: "That is not a link." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Only https links." };
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[") ||
    !host.includes(".") ||
    /\.(local|internal|localhost|lan|home|corp)$/.test(host)
  ) {
    return { ok: false, error: "This link cannot be fetched." };
  }
  if (url.username || url.password) return { ok: false, error: "Links with a user name or password cannot be fetched." };
  return { ok: true, url };
}

/** A file name from a link or a content-disposition header. */
export function fileNameFrom(link: string, disposition: string | null, mime: string | null): string {
  const fromHeader = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  let name = fromHeader ? decodeURIComponent(fromHeader) : "";
  if (!name) {
    try {
      name = decodeURIComponent(new URL(link).pathname.split("/").filter(Boolean).pop() ?? "");
    } catch {
      name = "";
    }
  }
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const ext = mime?.includes("png") ? "png" : mime?.includes("pdf") ? "pdf" : mime?.startsWith("video/") ? "mp4" : "jpg";
    name = `${name || "file"}.${ext}`;
  }
  return name.slice(-200);
}
