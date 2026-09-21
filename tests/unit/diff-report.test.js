import test from "node:test";
import assert from "node:assert/strict";
import { changeLabel, createDiffReport, diffCharacters } from "../../src/diff-report.js";

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
