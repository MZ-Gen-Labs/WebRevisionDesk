import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true, maxRetries: 3 });
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

test("loaded page gets viewport height and setup can be reopened without losing edits", async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(baseUrl);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  await page.waitForFunction(() => !document.querySelector("#setup-panel").open);
  const frame = page.frameLocator("#page-frame");
  await frame.locator("h1").first().click();
  await page.locator("#text-value").fill("レイアウト確認");
  await page.locator("#text-value").press("Tab");
  const height = await page.locator("#page-frame").evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(height >= 550, `Expected at least 550px, got ${height}`);
  assert.equal(await page.locator("#save-project-page").isVisible(), true);
  await page.locator("#setup-panel > summary").click();
  assert.equal(await page.locator("#capture-url").isVisible(), true);
  await page.locator("#setup-panel > summary").click();
  assert.equal(await frame.locator("h1").first().textContent(), "レイアウト確認");
  await page.close();
});

test("login preparation waits for explicit completion and resets on URL change", async () => {
  const page = await browser.newPage();
  let completions = 0;
  await page.route("**/api/capture/start", (route) => route.fulfill({ json: { sessionId: "login-test" } }));
  await page.route("**/api/login/finish", (route) => {
    completions++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(baseUrl);
  await page.locator("#capture-url").fill("https://example.com/private");
  await page.locator("#login-required").check();
  assert.match(await page.locator("#login-state").textContent(), /ログイン完了待ち/);
  await page.locator("#login-open").click();
  await page.locator("#login-done").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#login-done").disabled);
  assert.equal(completions, 0);
  assert.equal(await page.locator("#open-capture-browser").isDisabled(), true);
  assert.equal(await page.locator("#crawl-project-pages").isDisabled(), true);
  await page.locator("#login-done").click();
  await page.locator("#login-state").filter({ hasText: "利用者確認" }).waitFor();
  assert.equal(completions, 1);
  assert.equal(await page.locator("#open-capture-browser").isEnabled(), true);
  await page.locator("#capture-url").fill("https://example.com/another");
  assert.match(await page.locator("#login-state").textContent(), /ログイン完了待ち/);
  await page.close();
});

test("login finish rejects an unknown session", async () => {
  const response = await fetch(`${baseUrl}/api/login/finish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "missing" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /開き直して/);
});

test("cross-site API writes and form requests are rejected", async () => {
  const crossSite = await fetch(`${baseUrl}/api/settings`, {
    method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(crossSite.status, 403);
  const form = await fetch(`${baseUrl}/api/settings`, { method: "POST", body: "{}" });
  assert.equal(form.status, 415);
  const settings = await fetch(`${baseUrl}/api/settings`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ githubRepository: "https://github.com/MZ-Gen-Labs/WebRevisionDesk", checkUpdatesOnStartup: false, lastDownloadedUpdate: { path: "untrusted" } }),
  });
  assert.equal((await settings.json()).settings.lastDownloadedUpdate, null);
});

test("undo restores nested links and formatting, reload can be cancelled", async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  const fixture = { name: "nested.html", mimeType: "text/html", buffer: Buffer.from('<!doctype html><html><body><h1>Before <a href="/target"><strong>link</strong></a></h1></body></html>') };
  await page.setInputFiles("#html-file", fixture);
  const heading = page.frameLocator("#page-frame").locator("h1");
  await heading.click({ position: { x: 5, y: 5 } });
  await page.locator("#text-value").fill("Changed");
  await page.locator("#text-value").press("Tab");
  await page.locator("#undo").click();
  assert.equal(await heading.locator("a strong").textContent(), "link");
  assert.equal(await heading.locator("a").getAttribute("href"), "/target");
  await page.locator("#redo").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.setInputFiles("#html-file", fixture);
  assert.equal(await heading.textContent(), "Changed");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#clear-history").click();
  assert.match(await page.locator("#save-state").textContent(), /未保存/);
  await page.close();
});

test("an uncaptured project page previews without saving, then can be imported and reset", async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    class MemoryFileHandle {
      constructor(name, content = "") { this.name = name; this.kind = "file"; this.content = content; }
      async getFile() { return { text: async () => this.content }; }
      async createWritable() {
        return { write: async (content) => { this.content = content; }, close: async () => {} };
      }
    }
    class MemoryDirectoryHandle {
      constructor(name) { this.name = name; this.kind = "directory"; this.entries = new Map(); }
      async requestPermission() { return "granted"; }
      async getDirectoryHandle(name, { create = false } = {}) {
        if (!this.entries.has(name) && create) this.entries.set(name, new MemoryDirectoryHandle(name));
        const entry = this.entries.get(name);
        if (!entry || entry.kind !== "directory") throw new DOMException("Not found", "NotFoundError");
        return entry;
      }
      async getFileHandle(name, { create = false } = {}) {
        if (!this.entries.has(name) && create) this.entries.set(name, new MemoryFileHandle(name));
        const entry = this.entries.get(name);
        if (!entry || entry.kind !== "file") throw new DOMException("Not found", "NotFoundError");
        return entry;
      }
      async removeEntry(name, { recursive = false } = {}) {
        const entry = this.entries.get(name);
        if (!entry) throw new DOMException("Not found", "NotFoundError");
        if (entry.kind === "directory" && entry.entries.size && !recursive) {
          throw new DOMException("Directory is not empty", "InvalidModificationError");
        }
        this.entries.delete(name);
      }
    }
    const root = new MemoryDirectoryHandle("test-project");
    root.entries.set("project.json", new MemoryFileHandle("project.json", JSON.stringify({
      format: "web-revision-folder-project",
      version: 1,
      projectName: "Direct capture test",
      baseUrl: "https://example.com/base",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pages: [],
      discoveredPages: [{
        url: "https://example.com/base/one",
        title: "未取得テストページ",
        httpStatus: 200,
        discoveredAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
      }],
    })));
    window.__testProjectDirectory = root;
    window.showDirectoryPicker = async () => root;
  });
  await page.route("**/api/capture/direct", (route) => route.fulfill({
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Captured-Filename": encodeURIComponent("one.html"),
      "X-Captured-Url": encodeURIComponent("https://example.com/base/one"),
    },
    body: "<!doctype html><html><head><title>Captured page</title></head><body><h1>中央に表示されたページ</h1></body></html>",
  }));

  await page.goto(baseUrl);
  await page.locator("#select-project-folder").click();
  const projectPage = page.locator(".project-page").filter({ hasText: "未取得テストページ" });
  await projectPage.waitFor();
  assert.match(await projectPage.textContent(), /中央へ一時表示/);
  assert.equal(await page.locator(".project-page-actions").getByText("取得用ブラウザで開く").isVisible(), true);

  await projectPage.click();
  await page.frameLocator("#page-frame").locator("h1").filter({ hasText: "中央に表示されたページ" }).waitFor();
  assert.equal(await page.locator(".project-page.saved").count(), 0);
  assert.match(await page.locator("#save-state").textContent(), /未取得・一時プレビュー/);
  assert.equal(await page.locator("#show-modified").isDisabled(), true);
  assert.equal(await page.locator("#import-preview-page").isVisible(), true);

  await page.locator("#import-preview-page").click();
  await page.locator(".project-page.saved").filter({ hasText: "Captured page" }).waitFor();
  assert.equal(await page.locator("#show-modified").isEnabled(), true);

  await page.locator('.project-page-row input[type="checkbox"]').check();
  assert.equal(await page.locator("#reset-project-pages").isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#reset-project-pages").click();
  await page.locator(".project-page:not(.saved)").filter({ hasText: "未取得テストページ" }).waitFor();
  assert.equal(await page.locator("#empty-state").isVisible(), true);
  assert.match(await page.locator("#status").textContent(), /未取得状態へ戻しました/);
  await page.close();
});
