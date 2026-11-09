import { expect, type Page } from "@playwright/test";

/** The fake Supabase's account, or a real test account with E2E_BASE_URL. */
export const credentials = {
  email: process.env.E2E_EMAIL ?? "e2e@nordavo.test",
  password: process.env.E2E_PASSWORD ?? "offline-first",
};

/** The fake keeps its tables in memory; tests start from the seed. */
export async function resetFake() {
  if (process.env.E2E_BASE_URL) return;
  await fetch("http://127.0.0.1:54321/__reset", { method: "POST" });
}

/** What reached "the server" (fake only). */
export async function fakeState(): Promise<Record<string, Record<string, unknown>[]>> {
  const response = await fetch("http://127.0.0.1:54321/__state");
  return response.json();
}

export async function signIn(page: Page, next = "/work") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.locator("#password").press("Enter");
  await expect(page).not.toHaveURL(/\/login/);
}

/** A change someone else makes on the server meanwhile (fake only). */
export async function patchFake(table: string, id: string, fields: Record<string, unknown>) {
  await fetch("http://127.0.0.1:54321/__patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ table, id, fields }),
  });
}
