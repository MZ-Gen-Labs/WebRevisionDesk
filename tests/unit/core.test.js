import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";

import { removeProjectEntry } from "../../electron/project-file-system.mjs";
import { normalizeClasses } from "../../src/html.js";
import { pagePathForUrl, ProjectStore } from "../../src/project-storage.js";

test("class names are normalized without duplicates", () => {
  assert.deepEqual(normalizeClasses("  hero  centered hero\nlarge "), ["hero", "centered", "large"]);
  assert.deepEqual(normalizeClasses(""), []);
});

test("project paths follow URL hierarchy and handle Windows reserved names", () => {
  assert.deepEqual(
    pagePathForUrl("https://example.com/product/widget/", "https://example.com/product"),
    ["pages", "product", "widget", "index"],
  );
  assert.deepEqual(
    pagePathForUrl("https://example.com/product/con", "https://example.com/product"),
    ["pages", "product", "_con"],
  );
  assert.throws(
    () => pagePathForUrl("https://other.example/product/widget", "https://example.com/product"),
    /基準URL配下/,
  );
});

test("query parameters are represented by stable path suffixes", () => {
  const first = pagePathForUrl("https://example.com/product/item?a=1", "https://example.com/product");
  const second = pagePathForUrl("https://example.com/product/item?a=2", "https://example.com/product");
  assert.match(first.at(-1), /^item--query-/);
  assert.notEqual(first.at(-1), second.at(-1));
});

class MemoryFileHandle {
  constructor(name, content = "") { this.name = name; this.kind = "file"; this.content = content; }
  async getFile() { return { text: async () => this.content }; }
  async createWritable() {
    return { write: async (content) => { this.content = content; }, close: async () => {} };
  }
}

class MemoryDirectoryHandle {
  constructor(name) { this.name = name; this.kind = "directory"; this.entries = new Map(); }
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

test("resetting a parent page removes its artifacts but preserves nested pages", async () => {
  const root = new MemoryDirectoryHandle("project");
  const pages = await root.getDirectoryHandle("pages", { create: true });
  const parent = await pages.getDirectoryHandle("parent", { create: true });
  await parent.getFileHandle("original.html", { create: true });
  await parent.getFileHandle("working.html", { create: true });
  const child = await parent.getDirectoryHandle("child", { create: true });
  await child.getFileHandle("original.html", { create: true });

  const store = new ProjectStore();
  store.directory = root;
  store.project = {
    format: "web-revision-folder-project", version: 1, projectName: "test", baseUrl: "https://example.com/",
    pages: [
      { id: "parent", url: "https://example.com/parent", title: "Parent", path: "pages/parent" },
      { id: "child", url: "https://example.com/parent/child", title: "Child", path: "pages/parent/child" },
    ],
    discoveredPages: [],
  };

  const reset = await store.resetPages(["parent"]);
  assert.deepEqual(reset.map((page) => page.id), ["parent"]);
  assert.deepEqual(store.project.pages.map((page) => page.id), ["child"]);
  assert.equal(store.project.discoveredPages[0].url, "https://example.com/parent");
  assert.equal(parent.entries.has("original.html"), false);
  assert.equal(parent.entries.has("working.html"), false);
  assert.equal(parent.entries.has("child"), true);
  assert.equal(child.entries.has("original.html"), true);
  assert.equal(root.entries.has("project.json"), true);
});

test("deleting a listed page removes its metadata and artifacts without deleting nested pages", async () => {
  const root = new MemoryDirectoryHandle("project");
  const pages = await root.getDirectoryHandle("pages", { create: true });
  const parent = await pages.getDirectoryHandle("parent", { create: true });
  await parent.getFileHandle("original.html", { create: true });
  const child = await parent.getDirectoryHandle("child", { create: true });
  await child.getFileHandle("original.html", { create: true });

  const store = new ProjectStore();
  store.directory = root;
  store.project = {
    format: "web-revision-folder-project", version: 1, projectName: "test", baseUrl: "https://example.com/",
    pages: [
      { id: "parent", url: "https://example.com/parent", title: "Parent", path: "pages/parent" },
      { id: "child", url: "https://example.com/parent/child", title: "Child", path: "pages/parent/child" },
    ],
    discoveredPages: [
      { url: "https://example.com/parent", title: "Parent" },
      { url: "https://example.com/parent/child", title: "Child" },
    ],
  };

  const deleted = await store.deletePages(["https://example.com/parent"]);
  assert.deepEqual(deleted.deletedSavedPages.map((page) => page.id), ["parent"]);
  assert.deepEqual(store.project.pages.map((page) => page.id), ["child"]);
  assert.deepEqual(store.project.discoveredPages.map((page) => page.title), ["Child"]);
  assert.equal(parent.entries.has("original.html"), false);
  assert.equal(parent.entries.has("child"), true);
  assert.equal(child.entries.has("original.html"), true);
});

test("regenerating page reports rewrites redline and diff from saved working HTML and changes", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (value) => value.replace(/([^a-zA-Z0-9_-])/g, "\\$1") };
  const root = new MemoryDirectoryHandle("project");
  const pages = await root.getDirectoryHandle("pages", { create: true });
  const pageDirectory = await pages.getDirectoryHandle("saved-page", { create: true });
  await pageDirectory.getFileHandle("working.html", { create: true }).then(async (file) => {
    const writable = await file.createWritable();
    await writable.write("<!doctype html><html><head><title>Saved</title></head><body><p>Current saved text</p></body></html>");
    await writable.close();
  });
  await pageDirectory.getFileHandle("page.json", { create: true }).then(async (file) => {
    const writable = await file.createWritable();
    await writable.write(JSON.stringify({
      fileName: "saved.html",
      changes: [{ type: "text-change", elementId: "text-1", before: "Old text", after: "Current saved text" }],
    }));
    await writable.close();
  });
  for (const name of ["redline.html", "diff.html"]) {
    const file = await pageDirectory.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write("stale report");
    await writable.close();
  }

  const store = new ProjectStore();
  store.directory = root;
  store.project = {
    format: "web-revision-folder-project", version: 1, projectName: "test", baseUrl: "https://example.com/",
    pages: [{ id: "page-1", url: "https://example.com/saved", title: "Saved page", fileName: "saved.html", path: "pages/saved-page" }],
    discoveredPages: [],
  };

  await store.regeneratePageReports("page-1");
  const redline = await (await pageDirectory.getFileHandle("redline.html")).getFile().then((file) => file.text());
  const diff = await (await pageDirectory.getFileHandle("diff.html")).getFile().then((file) => file.text());
  assert.notEqual(redline, "stale report");
  assert.match(redline, /Current saved text/);
  assert.notEqual(diff, "stale report");
  assert.match(diff, /Old text/);
});

test("force deletion removes project metadata when physical cleanup fails", async () => {
  const root = new MemoryDirectoryHandle("project");
  const pages = await root.getDirectoryHandle("pages", { create: true });
  const broken = await pages.getDirectoryHandle("broken", { create: true });
  await broken.getFileHandle("original.html", { create: true });
  broken.removeEntry = async () => { throw new DOMException("Access denied", "NotAllowedError"); };

  const store = new ProjectStore();
  store.directory = root;
  store.project = {
    format: "web-revision-folder-project", version: 1, projectName: "test", baseUrl: "https://example.com/",
    pages: [{ id: "broken", url: "https://example.com/broken", title: "Broken", path: "pages/broken" }],
    discoveredPages: [{ url: "https://example.com/broken", title: "Broken" }],
  };

  await assert.rejects(() => store.deletePages(["https://example.com/broken"]), { name: "NotAllowedError" });
  const result = await store.deletePages(["https://example.com/broken"], { force: true });
  assert.equal(result.cleanupErrors.length, 1);
  assert.deepEqual(store.project.pages, []);
  assert.deepEqual(store.project.discoveredPages, []);
});

test("Electron removes empty project folders and preserves non-empty folders", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "web-revision-remove-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const empty = path.join(root, "empty");
  const nonEmpty = path.join(root, "non-empty");
  await mkdir(empty);
  await mkdir(nonEmpty);
  await writeFile(path.join(nonEmpty, "child.txt"), "keep");

  await removeProjectEntry(empty);
  await assert.rejects(() => readFile(path.join(empty, "missing.txt")), { code: "ENOENT" });
  await assert.rejects(() => removeProjectEntry(nonEmpty), { code: "ENOTEMPTY" });
  assert.equal(await readFile(path.join(nonEmpty, "child.txt"), "utf8"), "keep");
  await removeProjectEntry(nonEmpty, true);
  await assert.rejects(() => readFile(path.join(nonEmpty, "child.txt")), { code: "ENOENT" });
});
