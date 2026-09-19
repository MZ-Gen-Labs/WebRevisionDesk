import test from "node:test";
import assert from "node:assert/strict";

import {
  crawlBasePath,
  isCrawlTarget,
  normalizeHttpUrl,
  redactUrl,
  safeArtifactBaseName,
} from "../../src/electron-feasibility-core.js";

test("Electron feasibility URLs are normalized and tracking parameters are removed", () => {
  assert.equal(normalizeHttpUrl("/product//item/?utm_source=test&b=2&a=1#part", "https://example.com/root/").href, "https://example.com/product/item?a=1&b=2");
  assert.throws(() => normalizeHttpUrl("file:///etc/passwd", "https://example.com"), /http/);
});

test("Electron feasibility crawl remains within the base hierarchy", () => {
  const base = "https://example.com/product/solidedge";
  assert.equal(crawlBasePath(base), "/product/solidedge");
  assert.equal(isCrawlTarget("https://example.com/product/solidedge/functions", base), true);
  assert.equal(isCrawlTarget("https://example.com/product/other", base), false);
  assert.equal(isCrawlTarget("https://other.example/product/solidedge", base), false);
  assert.equal(isCrawlTarget("https://example.com/product/solidedge/manual.pdf", base), false);
});

test("Electron feasibility output names and diagnostic URLs omit unsafe data", () => {
  assert.equal(safeArtifactBaseName('A/B:*?"<>| Page'), "A-B------- Page");
  assert.equal(redactUrl("https://user:secret@example.com/path?token=secret#part"), "https://example.com/path");
});
