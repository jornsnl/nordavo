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

/** Parse the service account JSON from the environment. Accepts escaped newlines in the key. */
export function parseServiceAccount(raw: string | undefined): { client_email: string; private_key: string } {
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing. Put the service account JSON on one line in the environment.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  const parsed = serviceAccountSchema.safeParse(json);
  if (!parsed.success) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON lacks client_email or private_key.");
  return {
    client_email: parsed.data.client_email,
    private_key: parsed.data.private_key.replace(/\\n/g, "\n"),
  };
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
