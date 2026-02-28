import { test, expect } from "@playwright/test";

// A real PoB-PoE2 build code for testing (simple Monk build)
// This is a minimal build code - just class + a few passives
const SAMPLE_BUILD_CODE =
  "eNrtVU1v2zAMvRfYfxB0t-M4TdKhSLrDDj10h57cUpZpmwtFCiSVOP--kp04SdOtG3bpwTQlPj4-kvKNGjwPJHnyhqNVnk7jcZwQNtQqPJYN3b7JvRp_fJ5qyoP54JUZWXQFR7FKl6iBZ2F9JqFHHkfCxRHe7d0Pqsd7Oygz3hxJc4xgI5hbPfsnNmJ3lhZgMRr74V8sMrRsH0bq7SGqH9cQqucT5Eo73MIYZnzq_oSgF-BfgI7A";

test("app loads and shows header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("PoB Web")).toBeVisible();
  await expect(page.getByText("Path of Building for POE2")).toBeVisible();
});

test("passive tree area is visible", async ({ page }) => {
  await page.goto("/");
  // The tree canvas container should exist
  await expect(page.getByText("Scroll to zoom")).toBeVisible({ timeout: 5000 });
});

test("import panel is visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Import Build")).toBeVisible();
  await expect(page.getByPlaceholder("Paste PoB build code here...")).toBeVisible();
});

test("tree.json loads successfully", async ({ page }) => {
  await page.goto("/");
  // Should not show the error message
  await expect(page.getByText("Failed to load tree data")).not.toBeVisible({ timeout: 5000 });
  // Should show loading or the tree canvas
  // Wait a moment for the tree to render
  await page.waitForTimeout(2000);
  await expect(page.getByText("Scroll to zoom")).toBeVisible();
});

test("search input works", async ({ page }) => {
  await page.goto("/");
  const search = page.getByPlaceholder("Search passives...");
  await expect(search).toBeVisible();
  await search.fill("life");
  // Should be able to type without errors
  await expect(search).toHaveValue("life");
});

test("tab switching works", async ({ page }) => {
  await page.goto("/");
  // Start on Import tab
  await expect(page.getByText("Import Build")).toBeVisible();

  // Switch to Stats tab
  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.getByText("Import a build to see stats")).toBeVisible();

  // Switch back to Import tab
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Import Build")).toBeVisible();
});
