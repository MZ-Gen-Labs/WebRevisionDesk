import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { removeProjectEntry } from "../../electron/project-file-system.mjs";
import { normalizeClasses } from "../../src/html.js";
import { pagePathForUrl, ProjectStore } from "../../src/project-storage.js";
import { compareVersions, normalizedVersion, parseRepository, releaseAsset } from "../../src/update-service.js";

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

test("GitHub repository URLs are strictly validated", () => {
  assert.deepEqual(parseRepository("https://github.com/MZ-Gen-Labs/WebRevisionDesk.git"), {
    owner: "MZ-Gen-Labs",
    repo: "WebRevisionDesk",
    url: "https://github.com/MZ-Gen-Labs/WebRevisionDesk",
  });
  assert.equal(parseRepository(""), null);
  assert.throws(() => parseRepository("https://example.com/repository"), /github\.com/);
});

test("versions are normalized and compared numerically", () => {
  assert.equal(normalizedVersion("v1.2.3"), "1.2.3");
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("v1.2.0", "1.2"), 0);
  assert.equal(compareVersions("1.1.9", "1.2.0"), -1);
});

test("update release prefers non-complete Windows x64 archive", () => {
  const selected = releaseAsset({ assets: [
    { name: "WebRevisionDesk-1.0.0-win-x64-complete.zip" },
    { name: "WebRevisionDesk-1.0.0-linux-x64.zip" },
    { name: "WebRevisionDesk-1.0.0-win-x64.zip" },
  ] });
  assert.equal(selected.name, "WebRevisionDesk-1.0.0-win-x64.zip");
  assert.equal(releaseAsset({ assets: [] }), null);
  assert.equal(releaseAsset({ assets: [{ name: "app-linux-x64.zip" }] }), null);
  assert.equal(releaseAsset({ assets: [{ name: "app-win-x64-complete.zip" }] }), null);
});
