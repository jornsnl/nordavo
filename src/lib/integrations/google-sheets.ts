import "server-only";
import { JWT } from "google-auth-library";
import { z } from "zod";

/**
 * Reading a Google Sheet via a service account (GOOGLE_SERVICE_ACCOUNT_JSON).
 * Only the fallback job s8-webpartners-import still uses it, to read the old
 * Web Partners appointments sheet. The meetings register (Meetings) and
 * Claude's Cal.com task replaced that sheet (docs/claude-jobs.md); the call
 * list sheet for Web Partners (S6) is gone.
 *
 * Endpoint used (REST, bearer token from the service account):
 *   GET https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}   read a range
 *
 * The sheet must be shared with the service account's client_email.
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export function hasGoogleSheets() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

const serviceAccountSchema = z.looseObject({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

export type ServiceAccountFormat = "json" | "base64";

/** The JSON text of the key: raw JSON (one line or the file as is) or base64 of the file. */
function serviceAccountText(raw: string): { text: string; format: ServiceAccountFormat } {
  let value = raw.trim();
  // Double encoded: the JSON as a JSON string ("{\"type\": ...}").
  if (value.startsWith('"')) {
    try {
      const inner: unknown = JSON.parse(value);
      if (typeof inner === "string") value = inner.trim();
    } catch {
      // Not a JSON string; plain quotes are removed below.
    }
  }
  // Quotes around the whole value, as some dashboards and .env files keep them.
  if (/^(['"])[\s\S]*\1$/.test(value) && value.length > 1) value = value.slice(1, -1).trim();
  if (value.startsWith("{")) return { text: value, format: "json" };
  const compact = value.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    const decoded = Buffer.from(compact.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").trim();
    if (decoded.startsWith("{")) return { text: decoded, format: "base64" };
  }
  return { text: value, format: "json" };
}

function parseJsonLoose(text: string): unknown {
  try {
    const first: unknown = JSON.parse(text);
    // Double encoded ("{\"type\": ...}") as a JSON string.
    return typeof first === "string" ? JSON.parse(first) : first;
  } catch {
    // Real line breaks inside the private key (the key pasted unescaped).
    const repaired = text.replace(/("private_key"\s*:\s*")([\s\S]*?)(")/, (_m, a: string, key: string, c: string) => a + key.replace(/\r?\n/g, "\\n") + c);
    return JSON.parse(repaired);
  }
}

/**
 * Parse the service account key from the environment. Accepts the JSON on
 * one line, the downloaded file as is (several lines), base64 of the file,
 * quotes around the value and escaped (or double escaped) newlines in the key.
 */
export function parseServiceAccount(raw: string | undefined): {
  client_email: string;
  private_key: string;
  project_id: string | null;
  format: ServiceAccountFormat;
} {
  if (!raw || !raw.trim()) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing. Put the service account JSON (or its base64) in the environment.");
  }
  const { text, format } = serviceAccountText(raw);
  let json: unknown;
  try {
    json = parseJsonLoose(text);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (nor base64 of it). Paste the whole key file of the service account.");
  }
  const parsed = serviceAccountSchema.safeParse(json);
  if (!parsed.success) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON lacks client_email or private_key. Use a key of type service_account, not an OAuth client.");
  const type = (json as { type?: unknown }).type;
  if (typeof type === "string" && type !== "service_account") {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is a key of type "${type}", not a service account.`);
  }
  const key = parsed.data.private_key.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) {
    throw new Error("The private_key in GOOGLE_SERVICE_ACCOUNT_JSON is not a PEM key. Download a new JSON key for the service account.");
  }
  const projectId = (json as { project_id?: unknown }).project_id;
  return {
    client_email: parsed.data.client_email,
    private_key: key,
    project_id: typeof projectId === "string" ? projectId : null,
    format,
  };
}

export type ServiceAccountStatus =
  | { configured: false; ok: false; error: string }
  | { configured: true; ok: false; error: string }
  | { configured: true; ok: true; email: string; projectId: string | null; format: ServiceAccountFormat };

/** Whether GOOGLE_SERVICE_ACCOUNT_JSON is set and readable, for status screens. Never throws. */
export function serviceAccountStatus(raw: string | undefined = process.env.GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccountStatus {
  if (!raw || !raw.trim()) return { configured: false, ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set." };
  try {
    const account = parseServiceAccount(raw);
    return { configured: true, ok: true, email: account.client_email, projectId: account.project_id, format: account.format };
  } catch (error) {
    return { configured: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Normalise a values.get response to rows of strings. */
export function valuesToRows(values: unknown[][] | undefined): string[][] {
  return (values ?? []).map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const valuesResponseSchema = z.looseObject({
  range: z.string().optional(),
  values: z.array(z.array(z.unknown())).optional(),
});

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

/** Read a range (for example "Afspraken!A1:Z") as rows of strings, header first. */
export async function readSheet(spreadsheetId: string, range: string): Promise<string[][]> {
  const token = await accessToken();
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google API ${response.status} at ${new URL(url).pathname}: ${text.slice(0, 300)}`);
  }
  const data = valuesResponseSchema.parse(text ? JSON.parse(text) : {});
  return valuesToRows(data.values);
}
