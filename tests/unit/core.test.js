import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClasses } from "../../src/html.js";
import { pagePathForUrl } from "../../src/project-storage.js";
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
