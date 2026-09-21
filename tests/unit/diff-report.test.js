import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { changeLabel, createDiffReport, createRedlineReport, diffCharacters } from "../../src/diff-report.js";

test("character diff keeps unchanged, removed, and inserted runs distinct", () => {
  assert.deepEqual(diffCharacters("旧名称", "新名称"), [
    { type: "delete", text: "旧" },
    { type: "insert", text: "新" },
    { type: "equal", text: "名称" },
  ]);
});

test("large character diffs use the bounded fallback and preserve shared edges", () => {
  const before = `${"A".repeat(600)}旧${"Z".repeat(600)}`;
  const after = `${"A".repeat(600)}新${"Z".repeat(600)}`;
  const runs = diffCharacters(before, after);
  assert.equal(runs[0].type, "equal");
  assert.equal(runs[0].text.length, 600);
  assert.deepEqual(runs.slice(1, 3), [{ type: "delete", text: "旧" }, { type: "insert", text: "新" }]);
  assert.equal(runs.at(-1).text.length, 600);
});

test("diff report escapes page and change content", () => {
  const report = createDiffReport('<page>', [{ type: "table-change", target: '<table>', before: '<old>', after: '<new>' }]);
  assert.match(report, /&lt;page&gt;/);
  assert.match(report, /&lt;table&gt;/);
  assert.match(report, /表の構成変更/);
  assert.equal(changeLabel("unknown"), "変更");
});

test("redline report preserves child elements in elements with children on text-change", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><p data-editor-id="wr-1">前文 <a href="https://example.com">リンクテキスト</a> 後文</p></body></html>`;
  const changes = [{
    type: "text-change",
    elementId: "wr-1",
    before: "前文 リンクテキスト",
    after: "前文 リンクテキスト 後文",
  }];
  const redlineHtml = createRedlineReport(html, changes, "test.html");
  assert.match(redlineHtml, /href="https:\/\/example\.com"/, "Links and other child elements must not be stripped");
  assert.match(redlineHtml, /wr-redline-text/, "Redline highlight class must be added");
});
