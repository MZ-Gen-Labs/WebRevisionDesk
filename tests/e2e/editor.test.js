import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = 21000 + Math.floor(Math.random() * 10000);
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let browser;
let dataDirectory;

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Test server did not start.");
}

before(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "web-revision-test-"));
  server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      WEB_REVISION_DATA_DIR: dataDirectory,
      WEB_REVISION_PRODUCTION: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
  await rm(dataDirectory, { recursive: true, force: true });
});

test("a user can load, edit, undo, redo and export a page", async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(baseUrl);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  await page.locator("#mode-badge").filter({ hasText: "修正後・編集可能" }).waitFor();
  assert.match(await page.locator("#step-edit").getAttribute("class"), /active/);

  const frame = page.frameLocator("#page-frame");
  const heading = frame.locator("h1").first();
  await heading.click();
  assert.equal(await page.locator('[data-editor-field="text"]').isVisible(), true);
  assert.equal(await page.locator('[data-editor-field="image"]').isVisible(), false);

  await page.locator("#text-value").fill("自動テストで変更した見出し");
  await page.locator("#text-value").press("Tab");
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  assert.equal(await heading.textContent(), "自動テストで変更した見出し");
  assert.match(await page.locator("#save-state").textContent(), /未保存/);
  assert.match(await page.locator("#step-export").getAttribute("class"), /active/);

  await page.locator("#undo").click();
  assert.notEqual(await heading.textContent(), "自動テストで変更した見出し");
  await page.locator("#redo").click();
  assert.equal(await heading.textContent(), "自動テストで変更した見出し");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-package").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /-revision-package\.zip$/);
  await page.close();
});

test("advanced image fields only appear for images", async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  await page.locator("#mode-badge").filter({ hasText: "修正後・編集可能" }).waitFor();
  const image = page.frameLocator("#page-frame").locator("img").first();
  await image.click();
  assert.equal(await page.locator('[data-editor-field="image"]').isVisible(), true);
  assert.equal(await page.locator('[data-editor-field="alt"]').isVisible(), false);
  await page.locator("#advanced-mode").check();
  assert.equal(await page.locator('[data-editor-field="alt"]').isVisible(), true);
  assert.equal(await page.locator('[data-editor-field="class"]').isVisible(), true);
  await page.close();
});
