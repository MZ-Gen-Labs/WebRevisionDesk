import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { compareProjectPages, determineVariantSuffix, pagePathForUrl, ProjectStore } from "../../src/project-storage.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;

class MockFileHandle {
  constructor(name, content = "") {
    this.name = name;
    this.content = content;
  }

  async getFile() {
    return {
      text: async () => this.content,
    };
  }

  async createWritable() {
    let buffer = "";
    return {
      write: async (chunk) => {
        buffer += chunk;
      },
      close: async () => {
        this.content = buffer;
      },
    };
  }
}

class MockDirectoryHandle {
  constructor(name = "root") {
    this.name = name;
    this.entries = new Map();
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) {
        const error = new Error(`File ${name} not found`);
        error.name = "NotFoundError";
        throw error;
      }
      this.entries.set(name, new MockFileHandle(name));
    }
    const entry = this.entries.get(name);
    if (!(entry instanceof MockFileHandle)) {
      const error = new Error(`${name} is not a file`);
      error.name = "TypeMismatchError";
      throw error;
    }
    return entry;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.entries.has(name)) {
      if (!create) {
        const error = new Error(`Directory ${name} not found`);
        error.name = "NotFoundError";
        throw error;
      }
      this.entries.set(name, new MockDirectoryHandle(name));
    }
    const entry = this.entries.get(name);
    if (!(entry instanceof MockDirectoryHandle)) {
      const error = new Error(`${name} is not a directory`);
      error.name = "TypeMismatchError";
      throw error;
    }
    return entry;
  }

  async removeEntry(name, { recursive = false } = {}) {
    if (!this.entries.has(name)) {
      const error = new Error(`Entry ${name} not found`);
      error.name = "NotFoundError";
      throw error;
    }
    this.entries.delete(name);
  }
}

test("determineVariantSuffix increments variant letters cleanly", () => {
  assert.deepEqual(determineVariantSuffix("item", new Set()), { cleanBase: "item", suffix: "_A" });
  assert.deepEqual(determineVariantSuffix("item", new Set(["item_A"])), { cleanBase: "item", suffix: "_B" });
  assert.deepEqual(determineVariantSuffix("item_A", new Set(["item_A", "item_B"])), { cleanBase: "item", suffix: "_C" });
  assert.deepEqual(determineVariantSuffix("page", new Set(["page_A", "page_C"])), { cleanBase: "page", suffix: "_B" });
});

test("duplicatePage creates sibling directory with _A suffix and preserves/updates files", async () => {
  const root = new MockDirectoryHandle("project-root");
  const store = new ProjectStore();
  await store.useDirectory(root);
  store.setMetadata({ projectName: "Test Project", baseUrl: "https://example.com/site" });

  const originalHtml = "<!doctype html><html><head><title>Original Page</title></head><body><p>Hello</p></body></html>";
  const workingHtml = "<!doctype html><html><head><title>Original Page</title></head><body><p>Modified</p></body></html>";
  const changes = [{ type: "text-change", target: "<p>", before: "Hello", after: "Modified" }];

  const page = await store.savePage({
    fileName: "item.html",
    sourceUrl: "https://example.com/site/product/item",
    originalHtml,
    workingHtml,
    changes,
  });

  assert.equal(page.path, "pages/site/product/item");
  assert.equal(store.project.pages.length, 1);

  // Duplicate page
  const duplicated = await store.duplicatePage(page.id);

  assert.equal(duplicated.path, "pages/site/product/item_A");
  assert.equal(duplicated.fileName, "item_A.html");
  assert.equal(duplicated.title, "Original Page (_A)");
  assert.equal(duplicated.variantOf, page.id);
  assert.equal(duplicated.variantSuffix, "_A");
  assert.equal(store.project.pages.length, 2);

  // Second duplicate should get _B
  const duplicatedB = await store.duplicatePage(page.id);
  assert.equal(duplicatedB.path, "pages/site/product/item_B");
  assert.equal(duplicatedB.fileName, "item_B.html");
  assert.equal(duplicatedB.title, "Original Page (_B)");
  assert.equal(store.project.pages.length, 3);

  // Load duplicated page and verify contents
  const loaded = await store.loadPage(duplicated.id);
  assert.equal(loaded.originalHtml, originalHtml);
  assert.equal(loaded.workingHtml, workingHtml);
  assert.equal(loaded.changes.length, 1);
});

test("duplicatePage uses editorOverrides if provided for unsaved changes", async () => {
  const root = new MockDirectoryHandle("project-root");
  const store = new ProjectStore();
  await store.useDirectory(root);
  store.setMetadata({ projectName: "Test Project", baseUrl: "https://example.com/site" });

  const page = await store.savePage({
    fileName: "index.html",
    sourceUrl: "https://example.com/site",
    originalHtml: "<html><body>Original</body></html>",
    workingHtml: "<html><body>Saved Working</body></html>",
    changes: [],
  });

  const editorOverrides = {
    pageId: page.id,
    originalHtml: "<html><body>Original</body></html>",
    workingHtml: "<html><body>Live Unsaved Draft</body></html>",
    changes: [{ type: "text-change", before: "Original", after: "Live Unsaved Draft" }],
  };

  const duplicated = await store.duplicatePage(page.id, editorOverrides);
  const loaded = await store.loadPage(duplicated.id);
  assert.equal(loaded.workingHtml, "<html><body>Live Unsaved Draft</body></html>");
  assert.equal(loaded.changes.length, 1);
});

test("savePage updates existing variant page when pageId is specified", async () => {
  const root = new MockDirectoryHandle("project-root");
  const store = new ProjectStore();
  await store.useDirectory(root);
  store.setMetadata({ projectName: "Test Project", baseUrl: "https://example.com/site" });

  const page = await store.savePage({
    fileName: "about.html",
    sourceUrl: "https://example.com/site/about",
    originalHtml: "<html><body>1</body></html>",
    workingHtml: "<html><body>1</body></html>",
    changes: [],
  });

  const duplicated = await store.duplicatePage(page.id);
  assert.equal(duplicated.path, "pages/site/about_A");

  // Save changes to duplicated page using its pageId
  const updatedVariant = await store.savePage({
    pageId: duplicated.id,
    fileName: duplicated.fileName,
    sourceUrl: duplicated.url,
    originalHtml: "<html><body>1</body></html>",
    workingHtml: "<html><body>Variant Edit</body></html>",
    changes: [{ type: "text-change", before: "1", after: "Variant Edit" }],
  });

  assert.equal(updatedVariant.id, duplicated.id);
  assert.equal(updatedVariant.path, "pages/site/about_A");

  assert.equal(store.project.pages.length, 2);

  // Original page should remain unchanged
  const loadedOriginal = await store.loadPage(page.id);
  assert.equal(loadedOriginal.workingHtml, "<html><body>1</body></html>");
  assert.equal(loadedOriginal.changes.length, 0);

  // Variant page should have new content
  const loadedVariant = await store.loadPage(duplicated.id);
  assert.equal(loadedVariant.workingHtml, "<html><body>Variant Edit</body></html>");
  assert.equal(loadedVariant.changes.length, 1);
});

test("deletePages removes only the specified variant without deleting original", async () => {
  const root = new MockDirectoryHandle("project-root");
  const store = new ProjectStore();
  await store.useDirectory(root);
  store.setMetadata({ projectName: "Test Project", baseUrl: "https://example.com/site" });

  const page = await store.savePage({
    fileName: "contact.html",
    sourceUrl: "https://example.com/site/contact",
    originalHtml: "<html><body>Contact</body></html>",
    workingHtml: "<html><body>Contact</body></html>",
    changes: [],
  });

  const duplicated = await store.duplicatePage(page.id);
  assert.equal(store.project.pages.length, 2);

  // Delete only duplicated variant by target object
  const result = await store.deletePages([duplicated]);
  assert.equal(result.deletedIds.length, 1);
  assert.equal(result.deletedIds[0], duplicated.id);
  assert.equal(store.project.pages.length, 1);
  assert.equal(store.project.pages[0].id, page.id);
});

test("resetPages removes only the specified variant and does not pollute discoveredPages", async () => {
  const root = new MockDirectoryHandle("project-root");
  const store = new ProjectStore();
  await store.useDirectory(root);
  store.setMetadata({ projectName: "Test Project", baseUrl: "https://example.com/site" });

  const page = await store.savePage({
    fileName: "faq.html",
    sourceUrl: "https://example.com/site/faq",
    originalHtml: "<html><body>FAQ</body></html>",
    workingHtml: "<html><body>FAQ</body></html>",
    changes: [],
  });

  const duplicated = await store.duplicatePage(page.id);
  assert.equal(store.project.pages.length, 2);

  const reset = await store.resetPages([duplicated.id]);
  assert.equal(reset.length, 1);
  assert.equal(store.project.pages.length, 1);
  assert.equal(store.project.pages[0].id, page.id);
  // discoveredPages should not have faq since original page is still saved
  assert.equal(store.project.discoveredPages.length, 0);
});

test("index.html contains duplicate-project-page button with label 複製", () => {
  const htmlPath = path.resolve(import.meta.dirname, "../../index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");
  const testDom = new JSDOM(htmlContent);
  const doc = testDom.window.document;

  const duplicateButton = doc.querySelector("#duplicate-project-page");
  assert.ok(duplicateButton, "Button #duplicate-project-page should exist in index.html");
  assert.equal(duplicateButton.textContent.trim(), "複製");
  assert.equal(doc.querySelector("#check-project-pages"), null, "#check-project-pages should no longer exist");
});

test("compareProjectPages preserves base URL first, folder hierarchy, and keeps variants immediately after originals", () => {
  const pages = [
    { url: "https://example.com/site/products/detail/", path: "pages/site/products/detail/index" },
    { url: "https://example.com/site/about/", path: "pages/site/about/index_B", variantOf: "about-1", variantSuffix: "_B" },
    { url: "https://example.com/site/about/", path: "pages/site/about/index" },
    { url: "https://example.com/site/about/", path: "pages/site/about/index_A", variantOf: "about-1", variantSuffix: "_A" },
    { url: "https://example.com/site/", path: "pages/site/index" },
    { url: "https://example.com/site/contact/", path: "pages/site/contact/index" },
  ];

  const sorted = [...pages].sort(compareProjectPages);

  // 1. 基準URL（最短パス・トップページ）が一番上
  assert.equal(sorted[0].url, "https://example.com/site/");

  // 2. 配下の about 階層が次に並び、元ページが先頭、その直下に _A, _B が並ぶ
  assert.equal(sorted[1].url, "https://example.com/site/about/");
  assert.equal(sorted[1].variantOf, undefined, "Original about page should come first");
  assert.equal(sorted[2].url, "https://example.com/site/about/");
  assert.equal(sorted[2].variantSuffix, "_A", "_A should immediately follow original");
  assert.equal(sorted[3].url, "https://example.com/site/about/");
  assert.equal(sorted[3].variantSuffix, "_B", "_B should follow _A");

  // 3. 残りの配下ページがURLフォルダ階層順に続く
  assert.equal(sorted[4].url, "https://example.com/site/contact/");
  assert.equal(sorted[5].url, "https://example.com/site/products/detail/");
});


