import { expect, test } from "@playwright/test";
import { signIn } from "./support/session";

test.describe("installable app", () => {
  test("the sign in page links a complete manifest", async ({ page, request }) => {
    await page.goto("/login");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");

    const response = await request.get(href!);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "Nordavo Portal",
      short_name: "Nordavo",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: expect.any(String),
      background_color: expect.any(String),
    });
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
    for (const icon of manifest.icons) {
      const image = await request.get(icon.src);
      expect(image.ok(), icon.src).toBe(true);
      expect(image.headers()["content-type"]).toBe("image/png");
    }
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(expect.arrayContaining(["/dashboard", "/work"]));
  });

  test("the signed-in apps link it too", async ({ page }) => {
    await signIn(page, "/work");
    for (const path of ["/work", "/dashboard"]) {
      await page.goto(path);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    }
  });

  test("public pages do not offer to install the portal", async ({ page }) => {
    for (const path of ["/apply/not-a-real-token", "/working-style/not-a-real-token"]) {
      await page.goto(path);
      await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
      await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(0);
    }
  });

  test("the service worker is there and shows the offline page instead of a browser error", async ({ page, context }) => {
    const sw = await page.request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(sw.headers()["cache-control"]).toContain("no-cache");

    await page.goto("/login");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe("/");
    // Controlled from the next load on.
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    // A page this device never opened.
    await page.goto("/dashboard/exchange-rate");
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await context.setOffline(false);
  });
});
