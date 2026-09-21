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

  const html = `<html><body><p data-web-revision-id="wr-1">前文 <a href="https://example.com">リンクテキスト</a> 後文</p></body></html>`;
  const changes = [{
    type: "text-change",
    elementId: "wr-1",
    before: "前文 リンクテキスト",
    after: "前文 リンクテキスト 後文",
  }];
  const redlineHtml = createRedlineReport(html, changes, "test.html");
  assert.match(redlineHtml, /href="https:\/\/example\.com"/, "Links and other child elements must not be stripped");
  assert.match(redlineHtml, /wr-redline-text/, "Redline highlight class must be added");
  assert.match(redlineHtml, /wr-redline-text-diff-box/, "Diff box with del/ins should be rendered for elements with children");
  assert.match(redlineHtml, /<ins> 後文<\/ins>/, "Inserted text should be highlighted in diff box");
});

test("redline report displays specific table action in table-change label", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><table data-web-revision-id="tbl-1"><tbody><tr><td>Cell</td></tr></tbody></table></body></html>`;
  const changes = [{
    type: "table-change",
    elementId: "tbl-1",
    action: "行追加（下）",
    before: "<table>...</table>",
    after: "<table>...</table>",
  }];
  const redlineHtml = createRedlineReport(html, changes, "test.html");
  assert.match(redlineHtml, /表の構成変更（行追加（下））/);
});

test("redline report highlights specific merged cell when cellId is provided", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><table data-web-revision-id="tbl-1"><tbody><tr><td data-web-revision-id="c-merged" colspan="2">Merged</td></tr></tbody></table></body></html>`;
  const changes = [{
    type: "table-change",
    elementId: "tbl-1",
    cellId: "c-merged",
    action: "セル結合（右）",
    before: "<table>...</table>",
    after: "<table>...</table>",
  }];
  const redlineHtml = createRedlineReport(html, changes, "test.html");
  assert.match(redlineHtml, /表の構成変更（セル結合（右））/);
  assert.match(redlineHtml, /セル: セル結合（右）/);
});

test("redline report visualizes deleted table row at original row position", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><table data-web-revision-id="tbl-del-row"><tbody><tr><td>残る行</td></tr></tbody></table></body></html>`;
  const changes = [{
    type: "table-change",
    elementId: "tbl-del-row",
    action: "行削除（2行目：「削除されたデータ」）",
    deletedRowIndex: 1,
    deletedRowHtml: `<tr><td>削除されたデータ</td></tr>`,
    before: "<table>...</table>",
    after: "<table>...</table>",
  }];
  const redlineHtml = createRedlineReport(html, changes, "test.html");
  assert.match(redlineHtml, /wr-redline-deleted-row/, "Should insert deleted row with deleted row class");
  assert.match(redlineHtml, /削除行（2行目）/, "Should display badge for deleted row");
  assert.match(redlineHtml, /削除されたデータ/, "Should preserve deleted row content");
});

test("redline report visualizes deleted table column at original column position across rows", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><table data-web-revision-id="tbl-del-col"><tbody><tr><th>残る見出し</th></tr><tr><td>残るセル</td></tr></tbody></table></body></html>`;
  const changes = [{
    type: "table-change",
    elementId: "tbl-del-col",
    action: "列削除（1列目：「削除見出し」）",
    deletedColIndex: 0,
    deletedColTexts: ["削除見出し", "削除セルデータ"],
    before: "<table>...</table>",
    after: "<table>...</table>",
  }];
  const redlineHtml = createRedlineReport(html, changes, "test.html");
  assert.match(redlineHtml, /wr-redline-deleted-cell/, "Should insert deleted cells with deleted cell class");
  assert.match(redlineHtml, /削除列（1列目）/, "Should display badge for deleted column header");
  assert.match(redlineHtml, /削除見出し/, "Should preserve deleted header content");
  assert.match(redlineHtml, /削除セルデータ/, "Should preserve deleted cell content");
});

test("redline report accurately restores merged cell colspan and inserts deleted cells without shifting columns", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  // 1列目を削除した後のテーブル（見出しは colspan=1 に縮んでいる）
  const html = `<html><body>
    <table data-web-revision-id="tbl-merged-col">
      <thead>
        <tr><th colspan="1" id="h-merge">マージ見出し</th><th id="h-sub">見出し2</th></tr>
      </thead>
      <tbody>
        <tr><td id="c2">1-2</td><td id="c3">1-3</td></tr>
      </tbody>
    </table>
  </body></html>`;

  const changes = [{
    type: "table-change",
    elementId: "tbl-merged-col",
    action: "列削除（1列目：「1-1」）",
    deletedColIndex: 0,
    cellId: null,
    deletedCellsInfo: [
      { action: "shrink", cellId: "h-merge", originalColSpan: 2, isOrigin: true },
      { action: "deleted", cellHtml: `<td id="c1">1-1</td>`, text: "1-1" },
    ],
    before: "<table>...</table>",
    after: "<table>...</table>",
  }];

  const redlineHtml = createRedlineReport(html, changes, "test.html");
  const parsedDom = new JSDOM(redlineHtml);
  const table = parsedDom.window.document.querySelector("table");

  // 見出し行の確認
  const headerThs = table.querySelectorAll("thead th");
  assert.equal(headerThs.length, 2, "Header row should not have extra cells inserted");
  assert.equal(headerThs[0].colSpan, 2, "Merged header should be restored to original colSpan 2");

  // データ行の確認
  const bodyTds = table.querySelectorAll("tbody td");
  assert.equal(bodyTds.length, 3, "Body row should have restored cell + existing 2 cells (3 total)");
  assert.equal(bodyTds[0].id, "c1", "Deleted cell c1 should be restored at column index 0");
  assert.ok(bodyTds[0].classList.contains("wr-redline-deleted-cell"), "Restored cell should have wr-redline-deleted-cell class");
  assert.match(bodyTds[0].textContent, /削除列（1列目）/, "Restored cell should display badge");
  assert.match(bodyTds[0].textContent, /1-1/, "Restored cell text should be preserved");

  // 残ったセルに誤ってセルバッジが付いていないことを確認
  assert.equal(table.querySelectorAll("[data-wr-label*='セル: 列削除']").length, 0, "Non-deleted cells should not have cell deletion label");
});

test("redline report applies column deletion to all rows including the very last row when combined with row deletion", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  // 行削除と列削除がされた後のテーブル（2行目「削除行」が消え、1列目が消えている）
  const html = `<html><body>
    <table data-web-revision-id="tbl-multi-op">
      <thead>
        <tr><th id="h2">見出し2</th></tr>
      </thead>
      <tbody>
        <tr><td id="r1c2">データ1-2</td></tr>
        <tr><td id="r2c2">最下行データ2-2</td></tr>
      </tbody>
    </table>
  </body></html>`;

  const changes = [
    // 先に行削除が実行された
    {
      type: "table-change",
      elementId: "tbl-multi-op",
      action: "行削除（2行目：「削除された行データ」）",
      deletedRowIndex: 1,
      deletedRowHtml: `<tr><td>削除された行データ</td></tr>`,
      cellId: null,
      before: "<table>...</table>",
      after: "<table>...</table>",
    },
    // 次に1列目が削除された
    {
      type: "table-change",
      elementId: "tbl-multi-op",
      action: "列削除（1列目：「見出し1 / データ1-1 / 最下行データ2-1」）",
      deletedColIndex: 0,
      cellId: null,
      deletedCellsInfo: [
        { action: "deleted", cellHtml: `<th id="h1">見出し1</th>`, text: "見出し1" },
        { action: "deleted", cellHtml: `<td id="r1c1">データ1-1</td>`, text: "データ1-1" },
        { action: "deleted", cellHtml: `<td id="r2c1">最下行データ2-1</td>`, text: "最下行データ2-1" },
      ],
      before: "<table>...</table>",
      after: "<table>...</table>",
    },
  ];

  const redlineHtml = createRedlineReport(html, changes, "test.html");
  const parsedDom = new JSDOM(redlineHtml);
  const table = parsedDom.window.document.querySelector("table");

  // 最下行（「最下行データ2-2」の行）を取得
  const lastRow = table.rows[table.rows.length - 1];
  assert.equal(lastRow.cells.length, 2, "Last row must contain both deleted cell and remaining cell");
  assert.ok(
    lastRow.cells[0].classList.contains("wr-redline-deleted-cell"),
    "Last row's first cell must be the restored deleted cell"
  );
  assert.match(
    lastRow.cells[0].textContent,
    /最下行データ2-1/,
    "Last row's deleted cell content must not be skipped"
  );
});



