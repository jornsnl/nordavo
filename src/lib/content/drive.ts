import "server-only";
import { JWT } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseServiceAccount } from "@/lib/integrations/google-sheets";

/**
 * Google Drive import and sync for the media library (docs/content.md).
 *
 * A folder (for example the photoshoot with subfolders Day 1 and Day 2) is
 * shared with the service account of GOOGLE_SERVICE_ACCOUNT_JSON (its
 * client_email, as viewer). A sync lists the folder recursively, imports new
 * images, PDFs and videos into the bucket "content" and adds them to the
 * library with source "drive". Files already imported (drive_file_id) are
 * skipped, so syncing again only adds what is new. Nothing is ever deleted.
 *
 * Endpoints used (REST, bearer token of the service account):
 *   GET https://www.googleapis.com/drive/v3/files?q=...         list a folder
 *   GET https://www.googleapis.com/drive/v3/files/{id}           folder name
 *   GET https://www.googleapis.com/drive/v3/files/{id}?alt=media download
 */

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_MAX_BYTES = 100 * 1024 * 1024;
const FOLDER_MIME = "application/vnd.google-apps.folder";

export function hasGoogleDrive() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export const DRIVE_SETUP_HELP =
  "Google Drive is not connected yet. Put the JSON key of a Google service account (with the Drive API switched on) on one line in GOOGLE_SERVICE_ACCOUNT_JSON, then share the folder with the service account's e-mail address as viewer.";

/** The service account's e-mail address, to share folders with (null when not set up). */
export function driveServiceEmail(): string | null {
  try {
    return parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested in tests/content-drive.test.ts)
// ---------------------------------------------------------------------------

/**
 * A folder id from what someone pastes: the id itself, or a link such as
 * https://drive.google.com/drive/folders/<id>?usp=sharing,
 * https://drive.google.com/drive/u/0/folders/<id> or ...open?id=<id>.
 */
export function extractFolderId(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  const valid = (id: string | undefined | null) => (id && /^[A-Za-z0-9_-]{10,100}$/.test(id) ? id : null);
  if (valid(value)) return value;
  try {
    const url = new URL(value);
    if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
    const folders = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/);
    if (folders) return valid(folders[1]);
    return valid(url.searchParams.get("id"));
  } catch {
    return null;
  }
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  imageMediaMetadata?: { width?: number; height?: number; time?: string };
};

/** Images, PDFs and videos up to 100 MB are imported; everything else is skipped. */
export function shouldImport(file: Pick<DriveFile, "mimeType" | "size">): boolean {
  const mime = file.mimeType;
  const kind = mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
  const size = Number(file.size ?? 0);
  return kind && size > 0 && size <= DRIVE_MAX_BYTES;
}

export function orientationOf(width?: number | null, height?: number | null): "portrait" | "landscape" | "square" | null {
  if (!width || !height) return null;
  const ratio = width / height;
  if (ratio > 1.05) return "landscape";
  if (ratio < 0.95) return "portrait";
  return "square";
}

/**
 * The day a photo was taken: the camera time ("2026:05:14 10:22:31", from
 * EXIF) when there is one, else the day the file was created in Drive.
 */
export function takenOn(file: Pick<DriveFile, "createdTime" | "imageMediaMetadata">): string | null {
  const exif = file.imageMediaMetadata?.time?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);
  if (exif) return `${exif[1]}-${exif[2]}-${exif[3]}`;
  if (file.createdTime && /^\d{4}-\d{2}-\d{2}/.test(file.createdTime)) return file.createdTime.slice(0, 10);
  return null;
}

/** "Photoshoot" + "Day 1" -> "Photoshoot/Day 1". */
export function folderPath(parent: string, name: string): string {
  const clean = name.replace(/\//g, "-").trim() || "Folder";
  return (parent ? `${parent}/${clean}` : clean).slice(0, 300);
}

/** A safe storage name for a file. */
export function safeFileName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(-120) || "file"
  );
}

export type SyncSummary = { imported: number; known: number; skipped: number; failed: number };

export function summaryText(s: SyncSummary): string {
  const parts = [`${s.imported} new`, `${s.known} known`, `${s.skipped} skipped`];
  if (s.failed) parts.push(`${s.failed} failed`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let jwt: JWT | null = null;

async function accessToken(): Promise<string> {
  if (!jwt) {
    const account = parseServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    jwt = new JWT({ email: account.client_email, key: account.private_key, scopes: SCOPES });
  }
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("Google returned no access token for the service account.");
  return token;
}

async function driveJson<T>(url: string): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Google Drive cannot find that folder. Share it with the service account as viewer.");
    }
    throw new Error(`Google Drive answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

/** The name of a folder, to show in the list. */
export async function folderName(folderId: string): Promise<string> {
  const url = `${DRIVE_API}/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`;
  const file = await driveJson<{ name: string; mimeType: string }>(url);
  if (file.mimeType !== FOLDER_MIME) throw new Error("That link is a file, not a folder.");
  return file.name;
}

/** Every file below a folder, with the path of its subfolder. */
export async function listFolderRecursive(folderId: string, rootName: string): Promise<(DriveFile & { folder: string })[]> {
  const result: (DriveFile & { folder: string })[] = [];
  const queue: { id: string; path: string }[] = [{ id: folderId, path: rootName }];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${current.id}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name,mimeType,size,createdTime,imageMediaMetadata(width,height,time),parents)",
        pageSize: "1000",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await driveJson<{ nextPageToken?: string; files?: DriveFile[] }>(`${DRIVE_API}?${params}`);
      for (const file of page.files ?? []) {
        if (file.mimeType === FOLDER_MIME) queue.push({ id: file.id, path: folderPath(current.path, file.name) });
        else result.push({ ...file, folder: current.path });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return result;
}

async function download(fileId: string): Promise<ArrayBuffer> {
  const token = await accessToken();
  const response = await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return response.arrayBuffer();
}

type Db = SupabaseClient<Database>;

/**
 * Sync one folder row with the secret key client: imports what is new and
 * writes last_synced_at and last_result. Never throws for a single file.
 */
export async function syncDriveFolder(
  db: Db,
  folder: { id: string; workspace_id: string | null; folder_id: string; name: string | null; created_by?: string | null },
  log: (message: string) => void = () => {},
): Promise<SyncSummary> {
  const summary: SyncSummary = { imported: 0, known: 0, skipped: 0, failed: 0 };
  try {
    const name = folder.name || (await folderName(folder.folder_id));
    if (!folder.name) await db.from("content_drive_folders").update({ name }).eq("id", folder.id);
    const files = await listFolderRecursive(folder.folder_id, name);

    const ids = files.map((f) => f.id);
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from("content_media").select("drive_file_id").in("drive_file_id", ids.slice(i, i + 200));
      if (error) throw new Error(`Reading the library failed: ${error.message}`);
      for (const row of data ?? []) if (row.drive_file_id) known.add(row.drive_file_id);
    }

    const library = folder.workspace_id ?? "company";
    for (const file of files) {
      if (known.has(file.id)) {
        summary.known++;
        continue;
      }
      if (!shouldImport(file)) {
        summary.skipped++;
        continue;
      }
      try {
        const bytes = await download(file.id);
        const path = `media/${library}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;
        const { error: uploadError } = await db.storage
          .from("content")
          .upload(path, bytes, { contentType: file.mimeType, upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        const width = file.imageMediaMetadata?.width ?? null;
        const height = file.imageMediaMetadata?.height ?? null;
        const { error } = await db.from("content_media").insert({
          workspace_id: folder.workspace_id,
          storage_path: path,
          file_name: file.name.slice(0, 255),
          mime_type: file.mimeType,
          size_bytes: Number(file.size ?? bytes.byteLength),
          width,
          height,
          orientation: orientationOf(width, height),
          folder: file.folder,
          source: "drive",
          drive_file_id: file.id,
          taken_on: takenOn(file),
          uploaded_by: folder.created_by ?? null,
        });
        if (error) {
          await db.storage.from("content").remove([path]);
          throw new Error(error.message);
        }
        summary.imported++;
      } catch (error) {
        summary.failed++;
        log(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await db
      .from("content_drive_folders")
      .update({ last_synced_at: new Date().toISOString(), last_result: summaryText(summary) })
      .eq("id", folder.id);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("content_drive_folders")
      .update({ last_synced_at: new Date().toISOString(), last_result: `Failed: ${message}`.slice(0, 500) })
      .eq("id", folder.id);
    throw error;
  }
}
