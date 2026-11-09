import { expect, test, type Page } from "@playwright/test";
import { fakeState, patchFake, resetFake, signIn } from "./support/session";

/**
 * Work without a connection, on a production build: the page opens from the
 * device, a task made and changed offline waits in the outbox, and reaches
 * the server once the connection is back.
 */

const indicator = (page: Page) => page.locator("header").getByRole("button", { name: /Show what this device keeps/ });

async function pageIsKept(page: Page, path: string) {
  return page.evaluate(async (wanted) => {
    const names = await caches.keys();
    for (const name of names.filter((n) => n.startsWith("nordavo-pages"))) {
      const keys = await (await caches.open(name)).keys();
      if (keys.some((r) => new URL(r.url).pathname + new URL(r.url).search === wanted)) return true;
    }
    return false;
  }, path);
}

test.beforeEach(async () => {
  await resetFake();
});

test("a task made and changed offline reaches the server when back online", async ({ page, context }) => {
  await signIn(page, "/work");
  await expect(page.getByRole("heading", { name: "My overview" })).toBeVisible();

  // The service worker takes over, then keeps the main pages ahead of time.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => pageIsKept(page, "/work"), { timeout: 30_000 }).toBe(true);
  await expect(indicator(page)).toHaveAttribute("data-sync-phase", "synced");

  await context.setOffline(true);
  await page.reload();
  // Opened from the device.
  await expect(page.getByRole("heading", { name: "My overview" })).toBeVisible();
  await expect(page.getByText("No connection: this page opened from your device")).toBeVisible();
  await expect(indicator(page)).toHaveAttribute("data-sync-phase", "offline");

  // Make a task.
  const title = `Offline task ${Date.now()}`;
  await page.getByRole("textbox", { name: "New task" }).fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect(indicator(page)).toContainText("1 waiting");

  // Change it: start it from its action menu.
  await page.getByRole("button", { name: `Actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Start" }).click();
  await expect(indicator(page)).toContainText("2 waiting");
  // And change an existing one.
  await page.getByRole("button", { name: "Actions for Prepare the check-in with Arjun after 30 days" }).click();
  await page.getByRole("menuitemradio", { name: "Priority: Urgent" }).click();
  await expect(indicator(page)).toContainText("3 waiting");

  // Nothing reached the server yet.
  let state = await fakeState();
  expect(state.work_tasks.some((t) => t.title === title)).toBe(false);

  // Back online: the outbox goes out in order.
  await context.setOffline(false);
  await expect(indicator(page)).toHaveAttribute("data-sync-phase", "synced", { timeout: 30_000 });
  await expect(indicator(page)).toContainText("Synced");

  state = await fakeState();
  const made = state.work_tasks.filter((t) => t.title === title);
  expect(made).toHaveLength(1);
  expect(made[0].status).toBe("in_progress");
  expect(String(made[0].id)).toMatch(/^[0-9a-f-]{36}$/);
  const checkIn = state.work_tasks.find((t) => t.title === "Prepare the check-in with Arjun after 30 days");
  expect(checkIn?.priority).toBe("urgent");

  // And the server's list shows it, without a second copy.
  await page.reload();
  await expect(page.getByRole("link", { name: title })).toHaveCount(1);
});

test("a change the server refuses leaves the outbox and is reported", async ({ page, context }) => {
  await signIn(page, "/work");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Actions for Call back Bright Fintech about the backend role" }).click();
  await page.getByRole("menuitem", { name: "Start" }).click();
  await expect(indicator(page)).toContainText("1 waiting");

  // Meanwhile someone else deletes the task.
  await patchFake("work_tasks", "44444444-4444-4444-8444-000000000001", { archived_at: new Date().toISOString() });

  await context.setOffline(false);
  await expect(page.getByText(/Not saved: In progress: Call back Bright Fintech/)).toBeVisible({ timeout: 30_000 });
  await expect(indicator(page)).toHaveAccessibleName(/1 not saved/);
  await expect(indicator(page)).not.toContainText("waiting");
});

test("signing out wipes this device", async ({ page }) => {
  await signIn(page, "/work");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => pageIsKept(page, "/work"), { timeout: 30_000 }).toBe(true);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/sign-in|login/);
  expect(await pageIsKept(page, "/work")).toBe(false);
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(databases).not.toContain("nordavo-offline");
});
