import { expect, test } from "@playwright/test";
import { fakeState, resetFake, signIn } from "./support/session";

// Feedback Julius: dump a task on the phone in one go (open, type, Enter) and
// it lands in your own inbox, sorted later. Filters in My overview stay apart.

test.beforeEach(async () => {
  await resetFake();
});

test("Add a task: the field has the focus and the task lands in the inbox", async ({ page }) => {
  await signIn(page, "/work/add");
  await page.goto("/work/add");
  const field = page.getByRole("textbox", { name: "New task" });
  await expect(field).toBeFocused();
  await expect(page.getByRole("combobox").first()).toHaveValue(/.+/);
  await expect(page.getByRole("combobox").first().locator("option:checked")).toHaveText("Inbox");
  const title = `Dentist ${Date.now()}`;
  await field.fill(title);
  await field.press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect.poll(async () => {
    const state = await fakeState();
    const task = state.work_tasks.find((t) => t.title === title);
    const project = task && state.work_projects.find((p) => p.id === task.project_id);
    return project?.name ?? null;
  }).toBe("Inbox");
});

test("My overview: tabs and filters do not overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await signIn(page, "/work");
  const boxes = await Promise.all(
    ["Workspace", "Project", "Status", "Type"].map((name) => page.getByLabel(name, { exact: true }).first().boundingBox()),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `filters ${i} and ${j} overlap`).toBe(false);
    }
  }
  await expect(page.getByRole("link", { name: /Today and overdue/ })).toBeVisible();
});
