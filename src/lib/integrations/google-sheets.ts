import "server-only";
import { JWT } from "google-auth-library";
import { z } from "zod";

/**
 * Google Sheets via a service account (GOOGLE_SERVICE_ACCOUNT_JSON).
 * Used for the Web Partners call lists (S6) and their appointments sheet (S8).
 *
 * Endpoints used (REST, bearer token from the service account):
 *   POST https://sheets.googleapis.com/v4/spreadsheets                         create a spreadsheet
 *   PUT  https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}     write header + rows (valueInputOption=RAW)
 *   GET  https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}     read a range
 *   POST https://www.googleapis.com/drive/v3/files/{id}/permissions            share with an email (writer)
 *
 * Assumptions to check with real credentials:
 *   - The service account creates the spreadsheet in its own Drive. The scope
 *     drive.file is enough to share files the app created itself. Web Partners
 *     get writer access by email; the sheet stays owned by the service account.
 *   - To read the Web Partners appointments sheet, that sheet must be shared
 *     with the service account's client_email.
 *   - RAW input keeps values literal: "+316..." and "=..." are never parsed as
 *     formulas or numbers.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

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
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ontbreekt. Zet de JSON van het service account op één regel in de omgeving.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is geen geldige JSON.");
  }
  const parsed = serviceAccountSchema.safeParse(json);
  if (!parsed.success) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON mist client_email of private_key.");
  return {
    client_email: parsed.data.client_email,
    private_key: parsed.data.private_key.replace(/\\n/g, "\n"),
  };
}

/** 1 -> "A", 26 -> "Z", 27 -> "AA". */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || "A";
}

/** A sheet title quoted for A1 notation: Bellijst -> 'Bellijst', It's -> 'It''s'. */
export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function toCell(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  return value;
}

/**
 * The body for values.update: header first, every row padded or cut to the
 * header width, so a missing value never shifts the columns.
 */
export function buildValueRange(
  sheetTitle: string,
  header: string[],
  rows: (string | number | null)[][],
): { range: string; majorDimension: "ROWS"; values: (string | number)[][] } {
  const width = Math.max(header.length, 1);
  const values = [
    header.map((h) => toCell(h)),
    ...rows.map((row) => Array.from({ length: width }, (_, i) => toCell(row[i]))),
  ];
  const range = `${quoteSheetTitle(sheetTitle)}!A1:${columnLetter(width)}${values.length}`;
  return { range, majorDimension: "ROWS", values };
}

/** Normalise a values.get response to rows of strings. */
export function valuesToRows(values: unknown[][] | undefined): string[][] {
  return (values ?? []).map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const createResponseSchema = z.looseObject({
  spreadsheetId: z.string().min(1),
  spreadsheetUrl: z.string().optional(),
});

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
  if (!token) throw new Error("Google gaf geen access token terug voor het service account.");
  return token;
}

async function googleFetch(url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const token = await accessToken();
  const { json, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google API ${response.status} bij ${new URL(url).pathname}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

const SHEET_TITLE = "Lijst";

/** Create a new spreadsheet with one tab, share it, and return its URL. */
export async function createSheet(input: {
  title: string;
  header: string[];
  rows: (string | number | null)[][];
  shareWith?: string[];
}): Promise<{ spreadsheetId: string; url: string }> {
  const created = createResponseSchema.parse(
    await googleFetch(SHEETS_API, {
      method: "POST",
      json: {
        properties: { title: input.title, locale: "nl_NL", timeZone: "Europe/Amsterdam" },
        sheets: [{ properties: { title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } } }],
      },
    }),
  );
  const spreadsheetId = created.spreadsheetId;

  const body = buildValueRange(SHEET_TITLE, input.header, input.rows);
  await googleFetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(body.range)}?valueInputOption=RAW`,
    { method: "PUT", json: body },
  );

  for (const email of input.shareWith ?? []) {
    await googleFetch(`${DRIVE_API}/${encodeURIComponent(spreadsheetId)}/permissions?sendNotificationEmail=true`, {
      method: "POST",
      json: { type: "user", role: "writer", emailAddress: email },
    });
  }

  return {
    spreadsheetId,
    url: created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

/** Read a range (for example "Afspraken!A1:Z") as rows of strings, header first. */
export async function readSheet(spreadsheetId: string, range: string): Promise<string[][]> {
  const data = valuesResponseSchema.parse(
    await googleFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`),
  );
  return valuesToRows(data.values);
}

/** Emails from WEBPARTNERS_SHARE_WITH (comma separated). */
export function webPartnersShareWith(): string[] {
  return (process.env.WEBPARTNERS_SHARE_WITH ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}
