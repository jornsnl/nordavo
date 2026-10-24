import "server-only";

/**
 * Google Sheets via a service account (GOOGLE_SERVICE_ACCOUNT_JSON).
 * Used for the Web Partners call lists (S6) and their appointments sheet (S8).
 *
 * PLACEHOLDER: implemented by the outreach engineer. Signatures are the contract.
 */

export function hasGoogleSheets() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

/** Create a new spreadsheet with one tab, share it, and return its URL. */
export async function createSheet(input: {
  title: string;
  header: string[];
  rows: (string | number | null)[][];
  shareWith?: string[];
}): Promise<{ spreadsheetId: string; url: string }> {
  void input;
  throw new Error("Google Sheets is nog niet gebouwd");
}

/** Read a range (for example "Afspraken!A1:Z") as rows of strings, header first. */
export async function readSheet(spreadsheetId: string, range: string): Promise<string[][]> {
  void spreadsheetId;
  void range;
  throw new Error("Google Sheets is nog niet gebouwd");
}
