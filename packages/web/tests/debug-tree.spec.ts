import { test, expect } from "@playwright/test";

test("debug tree rendering", async ({ page }) => {
  const logs: string[] = [];
  const errors: string[] = [];

  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await page.waitForTimeout(3000);

  console.log("=== Console logs ===");
  for (const log of logs) console.log(log);

  console.log("\n=== Page errors ===");
  for (const err of errors) console.log(err);

  // Check if tree.json was fetched
  const treeJsonResponse = await page.evaluate(async () => {
    try {
      const resp = await fetch("/data/tree.json");
      const data = await resp.json();
      return {
        ok: resp.ok,
        nodeCount: Object.keys(data.nodes || {}).length,
        groupCount: Object.keys(data.groups || {}).length,
        hasConstants: !!data.constants,
        orbitRadii: data.constants?.orbitRadii?.length,
        skillsPerOrbit: data.constants?.skillsPerOrbit?.length,
      };
    } catch (e) {
      return { error: String(e) };
    }
  });
  console.log("\n=== tree.json ===", JSON.stringify(treeJsonResponse, null, 2));

  // Check if canvas exists
  const canvasCount = await page.locator("canvas").count();
  console.log(`\nCanvas elements: ${canvasCount}`);

  expect(errors.length).toBe(0);
});
