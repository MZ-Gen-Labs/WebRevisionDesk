import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { unzipSync } from "fflate";

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

async function prepareMemoryProject(page, sourceUrl = "https://example.com/pages/sample", initialProject = null) {
  const now = new Date().toISOString();
  const project = initialProject || {
    format: "web-revision-folder-project", version: 1, projectName: "Editor test",
    baseUrl: "https://example.com/pages", createdAt: now, updatedAt: now, pages: [], discoveredPages: [],
  };
  await page.addInitScript(({ project }) => {
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
    root.entries.set("project.json", new MemoryFileHandle("project.json", JSON.stringify(project)));
    window.__testProjectDirectory = root;
    window.__directoryPickerCalls = [];
    window.showDirectoryPicker = async (options) => {
      window.__directoryPickerCalls.push(options);
      return root;
    };
  }, { project });
  await page.goto(baseUrl);
  assert.equal(await page.locator("#html-file").isDisabled(), true);
  await page.locator("#select-project-folder").click();
  assert.equal(await page.locator("#html-file").isEnabled(), true);
  await page.locator(".alternative-import summary").click();
  await page.locator("#manual-page-url").fill(sourceUrl);
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

test("a user can add saved HTML to a project, edit, inspect changes and export", async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  await page.locator("#mode-badge").filter({ hasText: "修正後・編集可能" }).waitFor();
  await page.locator("#save-state").filter({ hasText: "保存済み" }).waitFor();

  const frame = page.frameLocator("#page-frame");
  const heading = frame.locator("h1").first();
  await heading.click();
  assert.equal(await page.locator('[data-editor-field="text"]').isVisible(), true);
  assert.equal(await page.locator('[data-editor-field="image"]').isVisible(), false);

  await page.locator("#text-value").fill("自動テストで変更した見出し");
  await page.locator("#text-value").press("Tab");
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  assert.equal(await heading.textContent(), "自動テストで変更した見出し");
  assert.match(await page.locator("#save-state").textContent(), /自動保存/);

  await page.locator("#undo").click();
  assert.notEqual(await heading.textContent(), "自動テストで変更した見出し");
  await page.locator("#redo").click();
  assert.equal(await heading.textContent(), "自動テストで変更した見出し");

  await page.locator("#show-redline").click();
  await page.frameLocator("#page-frame").locator("del").filter({ hasText: "より良い未来を、技術とともに。" }).waitFor();
  await page.frameLocator("#page-frame").locator("ins").filter({ hasText: "自動テストで変更した見出し" }).waitFor();
  assert.match(await page.locator("#mode-badge").textContent(), /変更箇所・参照専用/);
  await page.locator("#show-modified").click();
  assert.equal(await heading.textContent(), "自動テストで変更した見出し");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-package").click();
  await page.locator("#package-dialog").waitFor({ state: "visible" });
  await page.locator("#confirm-package-download").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /-revision-package\.zip$/);
  await page.close();
});

test("a deleted image shows a visible deletion label in the redline page", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  const image = page.frameLocator("#page-frame").locator("img").first();
  await image.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-element").click();
  await page.locator("#show-redline").click();
  const label = page.frameLocator("#page-frame").locator(".wr-deleted-image > .wr-redline-label");
  await label.waitFor();
  assert.equal(await label.textContent(), "削除");
  await page.close();
});

test("project page list supports shift ranges and ctrl additive selection", async () => {
  const now = new Date().toISOString();
  const pages = [1, 2, 3, 4].map((number) => ({
    url: `https://example.com/pages/${number}`,
    title: `Page ${number}`,
    discoveredAt: now,
    checkedAt: now,
  }));
  const page = await browser.newPage();
  await prepareMemoryProject(page, pages[0].url, {
    format: "web-revision-folder-project", version: 1, projectName: "Range selection test",
    baseUrl: "https://example.com/pages", createdAt: now, updatedAt: now,
    pages: pages.map((item, index) => ({
      ...item,
      id: `page-${index + 1}`,
      fileName: `${index + 1}.html`,
      path: `pages/pages/${index + 1}`,
      changeCount: 0,
    })),
    discoveredPages: pages,
  });
  const rows = page.locator(".project-page-row");
  await rows.nth(0).locator(".project-page").click();
  await page.locator("#status").filter({ hasText: "案件ページを開けませんでした" }).waitFor();
  assert.match(await rows.nth(0).locator(".project-page").getAttribute("class"), /active/);
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [false, false, false, false]);
  await rows.nth(1).locator(".project-page").dispatchEvent("click", { metaKey: true });
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [true, true, false, false]);
  await page.locator("#clear-project-selection").click();
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [false, false, false, false]);

  await rows.nth(0).locator('input[type="checkbox"]').check();
  await rows.nth(2).locator(".project-page").click({ modifiers: ["Shift"] });
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [true, true, true, false]);
  await rows.nth(3).locator(".project-page").dispatchEvent("click", { ctrlKey: true });
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [true, true, true, true]);
  await rows.nth(1).locator(".project-page").dispatchEvent("click", { ctrlKey: true });
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [true, false, true, true]);
  await page.locator("#clear-project-selection").click();
  await page.locator("#select-all-project-pages").click();
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [true, true, true, true]);
  await page.locator("#clear-project-selection").click();
  assert.deepEqual(await rows.locator('input[type="checkbox"]').evaluateAll((items) => items.map((item) => item.checked)), [false, false, false, false]);
  await page.close();
});

test("editor supports ctrl additive selection and shift sibling ranges", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  const frame = page.frameLocator("#page-frame");
  const cards = frame.locator(".card");
  await cards.nth(0).dispatchEvent("click");
  await cards.nth(2).dispatchEvent("click", { shiftKey: true });
  assert.equal(await frame.locator(".card.web-revision-selected").count(), 3);
  await page.locator("#element-label").filter({ hasText: "3個の要素を選択" }).waitFor();

  const heading = frame.locator("h1").first();
  await heading.dispatchEvent("click", { ctrlKey: true });
  assert.equal(await frame.locator(".web-revision-selected").count(), 4);
  await heading.dispatchEvent("click", { ctrlKey: true });
  assert.equal(await frame.locator(".web-revision-selected").count(), 3);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-element").click();
  assert.equal(await frame.locator(".card").count(), 0);
  await page.locator("#history-count").filter({ hasText: "3" }).waitFor();
  await page.close();
});

test("sidebar can be resized, parent elements can be selected, and reversed moves cancel their history", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.locator("#select-project-folder").click();
  assert.equal(await page.evaluate(() => window.__directoryPickerCalls[1].id), "web-revision-project");
  assert.equal(await page.evaluate(() => window.__directoryPickerCalls[1].startIn === window.__testProjectDirectory), true);
  const sidebar = page.locator(".project-sidebar");
  const resizer = page.locator("#project-sidebar-resizer");
  const beforeWidth = (await sidebar.boundingBox()).width;
  const handle = await resizer.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + 80);
  await page.mouse.up();
  assert.ok((await sidebar.boundingBox()).width >= beforeWidth + 70);

  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  const frame = page.frameLocator("#page-frame");
  await frame.locator(".card").nth(1).locator("p").dispatchEvent("click");
  await page.locator("#select-parent-element").click();
  assert.equal(await frame.locator(".card.web-revision-selected").count(), 1);
  await page.locator("#select-parent-element").click();
  assert.equal(await frame.locator("section.cards.web-revision-selected").count(), 1);
  await page.locator("#return-child-element").click();
  assert.equal(await frame.locator(".card.web-revision-selected").count(), 1);
  await page.locator("#return-child-element").click();
  assert.equal(await frame.locator(".card p.web-revision-selected").count(), 1);
  assert.equal(await page.locator("#return-child-element").isDisabled(), true);

  await frame.locator(".card").nth(1).dispatchEvent("click");
  await page.locator("#move-before").click();
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  await page.locator("#move-after").click();
  await page.locator("#history-count").filter({ hasText: "0" }).waitFor();
  assert.equal(await page.locator("#show-redline").isDisabled(), true);

  await frame.locator(".card").nth(0).dispatchEvent("click");
  await page.locator("#move-after").click();
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  await frame.locator(".card").nth(0).dispatchEvent("click");
  await page.locator("#move-after").click();
  await page.locator("#history-count").filter({ hasText: "0" }).waitFor();
  assert.deepEqual(await frame.locator(".card h2").allTextContents(), ["企画", "開発", "支援"]);
  assert.equal(await page.locator("#show-redline").isDisabled(), true);
  await page.close();
});

test("selected elements can be copied and pasted before or after targets across pages", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  let frame = page.frameLocator("#page-frame");
  await frame.locator(".card").first().dispatchEvent("click");
  await page.locator("#copy-element").click();
  await frame.locator("h1").dispatchEvent("click");
  await page.locator("#paste-after-element").click();
  assert.equal(await frame.locator("h1 + article.card").count(), 1);
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  await frame.locator("h1 + article.card h2").dispatchEvent("click");
  await page.locator("#text-value").fill("貼り付け後の変更");
  await page.locator("#text-value").dispatchEvent("change");
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  assert.match(await page.locator("#history-list").textContent(), /ブロック追加/);
  assert.doesNotMatch(await page.locator("#history-list").textContent(), /テキスト変更/);
  await page.locator("#show-redline").click();
  const redlineFrame = page.frameLocator("#page-frame");
  await redlineFrame.locator(".wr-redline-add").filter({ hasText: "貼り付け後の変更" }).waitFor();
  assert.equal(await redlineFrame.locator(".wr-redline-text").count(), 0);
  await page.locator("#show-modified").click();
  frame = page.frameLocator("#page-frame");
  await frame.locator("h1 + article.card h2").dispatchEvent("click");
  await page.locator("#select-parent-element").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-element").click();
  assert.equal(await frame.locator("h1 + article.card").count(), 0);
  await page.locator("#history-count").filter({ hasText: "0" }).waitFor();
  assert.equal(await page.locator("#show-redline").isDisabled(), true);

  await frame.locator("h1").dispatchEvent("click");
  await page.locator("#paste-after-element").click();
  await page.locator("#undo").click();
  assert.equal(await frame.locator("h1 + article.card").count(), 0);

  const otherPage = `<!doctype html><html><head><meta name="web-revision-source-url" content="https://example.com/pages/other"></head><body><main><h1 id="target">別ページ</h1><p>貼り付け先</p></main></body></html>`;
  await page.setInputFiles("#html-file", {
    name: "other.html",
    mimeType: "text/html",
    buffer: Buffer.from(otherPage),
  });
  await page.locator("#file-name").filter({ hasText: "other.html" }).waitFor();
  frame = page.frameLocator("#page-frame");
  await frame.locator("#target").dispatchEvent("click");
  assert.equal(await page.locator("#paste-before-element").isEnabled(), true);
  await page.locator("#paste-before-element").click();
  assert.equal(await frame.locator("article.card + #target").count(), 1);
  assert.equal(await frame.locator("article.card h2").textContent(), "企画");
  await page.close();
});

test("edits autosave and an explicit exit flush writes the latest working page", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  const frame = page.frameLocator("#page-frame");
  await frame.locator("h1").dispatchEvent("click");
  await page.locator("#text-value").fill("自動保存された見出し");
  await page.locator("#text-value").dispatchEvent("change");
  await page.locator("#save-state").filter({ hasText: "自動保存待ち" }).waitFor();
  assert.equal(await page.locator("#save-project-page").textContent(), "今すぐ保存");
  assert.deepEqual(await page.evaluate(() => window.webRevisionFlushAutosave()), { ok: true });
  await page.locator("#save-state").filter({ hasText: "自動保存済み" }).waitFor();
  const workingHtml = await page.evaluate(() => {
    const rootDirectory = window.__testProjectDirectory;
    const project = JSON.parse(rootDirectory.entries.get("project.json").content);
    let directory = rootDirectory;
    for (const segment of project.pages[0].path.split("/")) directory = directory.entries.get(segment);
    return directory.entries.get("working.html").content;
  });
  assert.match(workingHtml, /自動保存された見出し/);
  await page.close();
});

test("selected text inside a paragraph can receive, change, and undo an inline link", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  const frame = page.frameLocator("#page-frame");
  const paragraph = frame.locator("p.lead");
  await paragraph.dblclick();
  await paragraph.evaluate((element) => {
    const text = element.firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#inline-link-tools").waitFor({ state: "visible" });
  await page.locator("#inline-link-url").fill("https://example.com/inline");
  await page.locator("#apply-inline-link").click();
  assert.equal(await paragraph.locator('a[href="https://example.com/inline"]').textContent(), "私たちは");
  await page.locator("#history-count").filter({ hasText: "1" }).waitFor();
  await page.locator("#undo").click();
  assert.equal(await paragraph.locator("a").count(), 0);
  await page.locator("#redo").click();
  assert.equal(await paragraph.locator('a[href="https://example.com/inline"]').count(), 1);

  let existingLink = frame.locator('a[href="https://example.com/contact"]');
  await existingLink.dblclick();
  await existingLink.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#inline-link-url").fill("https://example.com/changed");
  await page.locator("#apply-inline-link").click();
  existingLink = frame.locator('a[href="https://example.com/changed"]');
  assert.equal(await existingLink.textContent(), "お問い合わせはこちら");
  await existingLink.dblclick();
  await existingLink.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.locator("#remove-inline-link").click();
  assert.equal(await frame.locator('a[href="https://example.com/changed"]').count(), 0);
  assert.match(await frame.locator("p").filter({ hasText: "お問い合わせはこちら" }).textContent(), /お問い合わせはこちら/);
  await page.close();
});

test("a focused broken page is automatically removed through the single delete action", async () => {
  const now = new Date().toISOString();
  const url = "https://example.com/pages/missing";
  const page = await browser.newPage();
  await prepareMemoryProject(page, url, {
    format: "web-revision-folder-project", version: 1, projectName: "Broken page test",
    baseUrl: "https://example.com/pages", createdAt: now, updatedAt: now,
    pages: [{ id: "missing", url, title: "実体なしページ", fileName: "missing.html", path: "pages/pages/missing", changeCount: 0 }],
    discoveredPages: [{ url, title: "実体なしページ", discoveredAt: now, checkedAt: now }],
  });
  const row = page.locator(".project-page-row").filter({ hasText: "実体なしページ" });
  assert.equal(await row.locator('input[type="checkbox"]').isChecked(), false);
  await row.locator(".project-page").click();
  await page.locator("#status").filter({ hasText: "案件ページを開けませんでした" }).waitFor();
  assert.equal(await row.locator(".project-page").getAttribute("class").then((value) => value.includes("active")), true);
  assert.match(await row.locator(".page-status").textContent(), /保存データを開けません/);
  assert.equal(await page.locator("#delete-project-pages").isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-project-pages").click();
  await page.locator("#project-pages .project-empty").waitFor();
  assert.match(await page.locator("#status").textContent(), /一覧から削除しました/);
  await page.close();
});

test("checked saved pages can be packaged together with selected output files", async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  await prepareMemoryProject(page);
  const fixture = path.join(root, "test-data", "sample.html");
  await page.setInputFiles("#html-file", fixture);
  await page.locator("#save-state").filter({ hasText: "保存済み" }).waitFor();
  await page.locator("#setup-panel > summary").click();
  await page.locator("#manual-page-url").fill("https://example.com/pages/second");
  await page.setInputFiles("#html-file", fixture);
  await page.waitForFunction(() => document.querySelectorAll(".project-page.saved").length === 2);
  assert.equal(await page.locator(".project-page.saved").count(), 2);
  await page.locator("#select-all-project-pages").click();

  await page.locator("#download-package").click();
  await page.locator("#package-target-summary").filter({ hasText: "2件" }).waitFor();
  const fileOptions = page.locator('input[name="package-file"]');
  for (let index = 0; index < await fileOptions.count(); index++) await fileOptions.nth(index).uncheck();
  await page.locator('input[name="package-file"][value="modified"]').check();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#confirm-package-download").click();
  const download = await downloadPromise;
  const archive = unzipSync(await readFile(await download.path()));
  const names = Object.keys(archive);
  assert.equal(names.length, 2);
  assert.equal(names.every((name) => name.endsWith("/modified.html")), true);
  await page.close();
});

test("package file choices are kept after reopening and reloading the app", async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.locator("#package-dialog").evaluate((dialog) => dialog.showModal());
  await page.locator('input[name="package-file"][value="diff"]').uncheck();
  await page.locator('input[name="package-file"][value="readme"]').uncheck();
  await page.locator("#package-dialog").evaluate((dialog) => dialog.close());

  await page.reload();
  await page.locator("#package-dialog").evaluate((dialog) => dialog.showModal());
  assert.equal(await page.locator('input[name="package-file"][value="original"]').isChecked(), true);
  assert.equal(await page.locator('input[name="package-file"][value="diff"]').isChecked(), false);
  assert.equal(await page.locator('input[name="package-file"][value="readme"]').isChecked(), false);
  await page.close();
});

test("long-running page discovery shows an animated processing state", async () => {
  const page = await browser.newPage();
  await page.route("**/api/crawl", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ pages: [], errors: [], truncated: false }),
    });
  });
  await prepareMemoryProject(page);

  await page.locator("#crawl-project-pages").click();
  const button = page.locator("#crawl-project-pages");
  assert.equal(await button.getAttribute("aria-busy"), "true");
  assert.equal(await button.textContent(), "関連ページを探す");
  assert.equal(await button.getAttribute("aria-label"), "関連ページを探す（処理中）");
  assert.equal(await button.evaluate((element) => element.classList.contains("is-processing")), true);

  await page.locator("#status").filter({ hasText: "配下ページを0件確認しました" }).waitFor();
  assert.equal(await button.getAttribute("aria-busy"), null);
  assert.equal(await button.textContent(), "関連ページを探す");
  await page.close();
});

test("image controls expose alt text and support adding, changing, removing, and undoing links", async () => {
  const page = await browser.newPage({ acceptDownloads: true });
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  await page.locator("#mode-badge").filter({ hasText: "修正後・編集可能" }).waitFor();
  const image = page.frameLocator("#page-frame").locator("img").first();
  await image.click();
  assert.equal(await page.locator('[data-editor-field="image"]').isVisible(), true);
  assert.equal(await page.locator('[data-editor-field="alt"]').isVisible(), true);
  assert.equal(await page.locator('[data-editor-field="link"]').isVisible(), true);
  assert.equal(await page.locator("#link-value").inputValue(), "");
  assert.equal(await page.locator("#remove-image-link").isVisible(), false);
  await page.locator("#alt-value").fill("変更後の画像説明");
  await page.locator("#alt-value").dispatchEvent("change");
  assert.equal(await image.getAttribute("alt"), "変更後の画像説明");

  await page.locator("#link-value").fill("https://example.com/image-first");
  await page.locator("#link-value").dispatchEvent("change");
  assert.equal(await image.locator("xpath=parent::a").getAttribute("href"), "https://example.com/image-first");
  assert.equal(await page.locator("#remove-image-link").isVisible(), true);
  await page.locator("#link-value").fill("https://example.com/image-updated");
  await page.locator("#link-value").dispatchEvent("change");
  assert.equal(await image.locator("xpath=parent::a").getAttribute("href"), "https://example.com/image-updated");
  await page.locator("#remove-image-link").click();
  assert.equal(await image.locator("xpath=parent::a").count(), 0);
  await page.locator("#undo").click();
  assert.equal(await image.locator("xpath=parent::a").getAttribute("href"), "https://example.com/image-updated");

  const replacementFileName = "高品質-製品画像.png";
  await page.locator("#image-file").setInputFiles({
    name: replacementFileName,
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0sAAAAASUVORK5CYII=", "base64"),
  });
  await page.waitForFunction((name) => document.querySelector("#page-frame")?.contentDocument
    ?.querySelector("img")?.getAttribute("data-web-revision-asset-name") === name, replacementFileName);
  const changedImage = await image.getAttribute("src");
  assert.equal(await image.getAttribute("src"), changedImage);
  assert.equal(await image.getAttribute("data-web-revision-asset-name"), replacementFileName);
  await page.locator("#undo").click();
  assert.equal(await image.getAttribute("data-web-revision-asset-name"), null);
  await page.locator("#redo").click();
  assert.equal(await image.getAttribute("data-web-revision-asset-name"), replacementFileName);
  await page.locator("#show-redline").click();
  const redline = page.frameLocator("#page-frame");
  await redline.locator(".wr-image-comparison").waitFor();
  const imageSummary = await redline.locator(".wr-image-change-summary").textContent();
  assert.match(imageSummary, /alt変更.*青緑色のサンプル画像 → 変更後の画像説明/s);
  assert.match(imageSummary, /画像リンク変更.*https:\/\/example.com\/image-updated/s);
  assert.equal(await redline.locator(".wr-image-comparison").count(), 1);
  const imageDownload = redline.locator(".wr-image-download");
  assert.equal(await imageDownload.getAttribute("download"), replacementFileName);
  assert.equal(await imageDownload.getAttribute("href"), changedImage);
  const imageDownloadPromise = page.waitForEvent("download");
  await imageDownload.click();
  assert.equal((await imageDownloadPromise).suggestedFilename(), replacementFileName);
  assert.equal(await redline.locator(".wr-image-marker").filter({ hasText: "画像変更 1" }).count(), 1);
  assert.equal(await redline.locator("img.wr-redline-image").isVisible(), true);
  await page.locator("#show-modified").click();
  await page.frameLocator("#page-frame").locator("img").first().click();

  assert.equal(await page.locator('[data-editor-field="class"]').isVisible(), false);
  await page.locator("#advanced-mode").check();
  assert.equal(await page.locator('[data-editor-field="class"]').isVisible(), true);
  await page.close();
});

test("page metadata can be edited and H1-H3 can be browsed from the sidebar outline", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
  await page.setInputFiles("#html-file", path.join(root, "test-data", "sample.html"));
  await page.locator("#mode-badge").filter({ hasText: "修正後・編集可能" }).waitFor();
  await page.waitForFunction(() => document.querySelector("#page-title-value")?.value === "サンプル会社");

  assert.equal(await page.locator("#page-title-value").inputValue(), "サンプル会社");
  assert.equal(await page.locator("#page-description-value").inputValue(), "");
  assert.equal(await page.locator("#page-h1-value").inputValue(), "より良い未来を、技術とともに。");
  await page.locator("#page-title-value").fill("構造化されたページタイトル");
  await page.locator("#page-title-value").dispatchEvent("change");
  await page.locator("#page-description-value").fill("ページの概要を構造的に設定します。");
  await page.locator("#page-description-value").dispatchEvent("change");
  await page.locator("#page-h1-value").fill("変更後の主要見出し");
  await page.locator("#page-h1-value").dispatchEvent("change");

  await page.keyboard.press("Alt+ArrowRight");
  assert.equal(await page.locator("#heading-count").textContent(), "4");
  assert.match(await page.locator("#heading-outline").textContent(), /H1変更後の主要見出し/);
  assert.equal(await page.locator("#show-heading-outline").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Alt+ArrowDown");
  assert.match(await page.locator("#element-label").textContent(), /^h1/);
  await page.keyboard.press("Alt+ArrowDown");
  assert.match(await page.locator("#element-label").textContent(), /^h2/);
  await page.keyboard.press("Alt+ArrowLeft");
  assert.equal(await page.locator("#show-project-list").getAttribute("aria-selected"), "true");

  await page.locator("#show-redline").click();
  const redline = page.frameLocator("#page-frame");
  const metadata = redline.locator(".wr-page-info-changes");
  await metadata.waitFor();
  assert.match(await metadata.textContent(), /Title変更.*サンプル会社.*構造化されたページタイトル/s);
  assert.match(await metadata.textContent(), /Description変更.*ページの概要を構造的に設定します/s);
  assert.equal(await redline.locator("h1 ins").textContent(), "変更後の主要見出し");
  await page.close();
});

test("loaded page gets viewport height and setup can be reopened without losing edits", async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await prepareMemoryProject(page);
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
  assert.equal(await page.locator("#project-base-url").isVisible(), true);
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
  await prepareMemoryProject(page, "https://example.com/pages/private");
  await page.locator("#login-required").check();
  assert.match(await page.locator("#login-state").textContent(), /ログイン完了待ち/);
  await page.locator("#login-open").click();
  await page.locator("#login-done").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#login-done").disabled);
  assert.equal(completions, 0);
  assert.equal(await page.locator("#crawl-project-pages").isDisabled(), true);
  await page.locator("#login-done").click();
  await page.locator("#login-state").filter({ hasText: "利用者確認" }).waitFor();
  assert.equal(completions, 1);
  assert.equal(await page.locator("#crawl-project-pages").isEnabled(), true);
  await page.locator("#project-base-url").fill("https://example.com/another");
  assert.match(await page.locator("#login-state").textContent(), /ログイン完了待ち/);
  await page.close();
});

test("a URL not found by crawling can be added to the project page list", async () => {
  const page = await browser.newPage();
  await page.route(`${baseUrl}/api/capture/start`, (route) => route.fulfill({ json: { sessionId: "manual-session" } }));
  await page.route(`${baseUrl}/api/capture/cancel`, (route) => route.fulfill({ json: { ok: true } }));
  await prepareMemoryProject(page, "https://example.com/pages/manual");
  await page.locator("#add-project-url").click();
  const added = page.locator(".project-page-row").filter({ hasText: "https://example.com/pages/manual" });
  await added.waitFor();
  assert.match(await added.locator(".project-page").textContent(), /未取得.*画像とページを取得/);
  await added.getByRole("button", { name: "取得用ブラウザで開く" }).click();
  await page.locator("#capture-session-actions").waitFor();
  await page.waitForFunction(() => !document.querySelector("#capture-current-page").disabled);
  assert.equal(await page.locator("#capture-current-page").isEnabled(), true);
  await page.locator("#cancel-capture").click();
  await page.locator("#capture-session-actions").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#capture-session-actions").isHidden(), true);
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

test("screenshot preview returns a viewport image and reuses its short-lived cache", async () => {
  const requestPreview = () => fetch(`${baseUrl}/api/preview/screenshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: baseUrl }),
  });
  const first = await requestPreview();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/jpeg");
  assert.equal(first.headers.get("x-preview-cached"), "0");
  assert.ok((await first.arrayBuffer()).byteLength > 1000);

  const second = await requestPreview();
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-preview-cached"), "1");
  assert.ok((await second.arrayBuffer()).byteLength > 1000);
});

test("undo restores nested links and formatting, then project import can be repeated", async () => {
  const page = await browser.newPage();
  await prepareMemoryProject(page);
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
  await page.setInputFiles("#html-file", fixture);
  await heading.filter({ hasText: "Before link" }).waitFor();
  assert.match(await page.locator("#save-state").textContent(), /保存済み/);
  await page.close();
});

test("clicking an uncaptured project page previews it, captures it, saves it, and allows reset", async () => {
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
  const requestOrder = [];
  await page.route("**/api/capture/direct", async (route) => {
    requestOrder.push("page");
    assert.equal(route.request().headers()["x-browser-task-priority"], "interactive");
    await new Promise((resolve) => setTimeout(resolve, 150));
    return route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Captured-Filename": encodeURIComponent("one.html"),
        "X-Captured-Url": encodeURIComponent("https://example.com/base/one"),
      },
      body: "<!doctype html><html><head><title>Captured page</title></head><body><h1>中央に表示されたページ</h1></body></html>",
    });
  });
  let previewRequests = 0;
  await page.route("**/api/preview/screenshot", (route) => {
    previewRequests++;
    requestOrder.push("image");
    assert.equal(route.request().headers()["x-browser-task-priority"], "interactive");
    return route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "X-Preview-Title": encodeURIComponent("Screenshot preview"),
        "X-Preview-Url": encodeURIComponent("https://example.com/base/one"),
      },
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
  });

  await page.goto(baseUrl);
  await page.locator("#select-project-folder").click();
  const projectPage = page.locator(".project-page").filter({ hasText: "未取得テストページ" });
  await projectPage.waitFor();
  assert.match(await projectPage.textContent(), /画像とページを取得/);
  assert.equal(await page.locator(".project-page-actions").getByText("取得用ブラウザで開く").isVisible(), true);

  await projectPage.click();
  await page.locator("#screenshot-preview").waitFor({ state: "visible" });
  assert.match(await page.locator("#screenshot-preview-image").getAttribute("src"), /^blob:/);
  await page.frameLocator("#page-frame").locator("h1").filter({ hasText: "中央に表示されたページ" }).waitFor();
  await page.locator(".project-page.saved").filter({ hasText: "Captured page" }).waitFor();
  assert.equal(await page.locator("#show-modified").isEnabled(), true);
  assert.equal(await page.locator("#import-preview-page").isHidden(), true);
  assert.equal(previewRequests, 1);
  assert.deepEqual(requestOrder, ["image", "page"]);

  await page.locator('.project-page-row input[type="checkbox"]').check();
  assert.equal(await page.locator("#reset-project-pages").isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#reset-project-pages").click();
  await page.locator(".project-page:not(.saved)").filter({ hasText: "未取得テストページ" }).waitFor();
  assert.equal(await page.locator("#empty-state").isVisible(), true);
  assert.match(await page.locator("#status").textContent(), /未取得状態へ戻しました/);
  await page.locator('.project-page-row input[type="checkbox"]').check();
  assert.equal(await page.locator("#delete-project-pages").isEnabled(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#delete-project-pages").click();
  await page.locator(".project-empty").waitFor();
  assert.match(await page.locator("#status").textContent(), /一覧から削除しました/);
  await page.close();
});
