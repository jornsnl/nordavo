import { expect, test } from "@playwright/test";
import { fakeState, resetFake, signIn } from "./support/session";

/**
 * The planning features from Athmium in Work: type and label filters, the
 * calendar and the timeline, and dragging a task to another day.
 */

const CALL = "Call back Bright Fintech about the backend role";
const SHORTLIST = "Shortlist three React developers for Lumen";

test.beforeEach(async () => {
  await resetFake();
});

test("filter on type and label", async ({ page }) => {
  await signIn(page, "/work?type=call");
  await expect(page.getByRole("link", { name: CALL })).toBeVisible();
  await expect(page.getByRole("link", { name: SHORTLIST })).toHaveCount(0);

  await page.goto("/work?label=lumen");
  await expect(page.getByRole("link", { name: SHORTLIST })).toBeVisible();
  await expect(page.getByRole("link", { name: CALL })).toHaveCount(0);
});

test("calendar and timeline show the tasks, a drag moves the deadline", async ({ page }) => {
  await signIn(page, "/work?view=calendar");
  await expect(page.getByRole("heading", { level: 2, name: /\d{4}/ })).toBeVisible();
  await expect(page.getByRole("link", { name: CALL })).toBeVisible();
  await page.screenshot({ path: "test-results/planning-calendar.png", fullPage: true });

  // Week view, then drag the call one day on.
  await page.getByRole("button", { name: "week" }).click();
  const chip = page.getByRole("link", { name: CALL });
  const before = (await fakeState()).work_tasks.find((t) => t.title === CALL)!.due_at as string;
  const box = (await chip.boundingBox())!;
  const dayWidth = (await page.locator(".grid-cols-7").nth(1).boundingBox())!.width / 7;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Mouse drag (Pixel 7 emulates touch; the mouse still drags).
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y, { steps: 3 });
  await page.mouse.move(x + dayWidth, y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await fakeState()).work_tasks.find((t) => t.title === CALL)!.due_at)
    .not.toBe(before);
  const after = (await fakeState()).work_tasks.find((t) => t.title === CALL)!.due_at as string;
  // One day later at the same time of day (to the minute: seconds are not kept).
  expect(Math.abs(new Date(after).getTime() - new Date(before).getTime() - 86_400_000)).toBeLessThan(60_000);

  await page.goto("/work?view=timeline");
  await expect(page.getByRole("heading", { level: 2, name: / – / })).toBeVisible();
  await expect(page.getByRole("link", { name: SHORTLIST })).toBeVisible();
  await page.screenshot({ path: "test-results/planning-timeline.png", fullPage: true });
});

test("the task page sets type, labels, start date and estimate", async ({ page }) => {
  await signIn(page, "/work/tasks/44444444-4444-4444-8444-000000000003");
  await page.getByLabel("Type", { exact: true }).selectOption("writing");
  await page.getByLabel("Start date").fill("2026-11-20");
  await page.getByLabel("Estimate").fill("1h30");
  await page.getByLabel("Labels").fill("report");
  await page.getByLabel("Labels").press("Enter");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const task = (await fakeState()).work_tasks.find((t) => t.id === "44444444-4444-4444-8444-000000000003")!;
  expect(task.task_type).toBe("writing");
  expect(task.start_on).toBe("2026-11-20");
  expect(task.estimate_minutes).toBe(90);
  expect(task.labels).toEqual(["report"]);
});
