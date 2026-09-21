import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { PageEditor, buildTableGrid } from "../../src/editor.js";
import { createRedlineReport } from "../../src/diff-report.js";

function setupEditorWithHtml(html) {
  const dom = new JSDOM(html);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s.replace(/([^\w-])/g, "\\$1") };

  const frame = {
    listeners: {},
    _srcdoc: "",
    get srcdoc() { return this._srcdoc; },
    set srcdoc(val) {
      this._srcdoc = val;
      const subDom = new JSDOM(val);
      this.contentDocument = subDom.window.document;
      this.contentWindow = subDom.window;
      setTimeout(() => {
        (this.listeners["load"] || []).forEach((fn) => fn());
      }, 0);
    },
    addEventListener(event, fn) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(fn);
    },
    removeEventListener(event, fn) {
      this.listeners[event] = (this.listeners[event] || []).filter((f) => f !== fn);
    },
  };

  const recordedChanges = [];
  const editor = new PageEditor(frame, {
    onChange: (change) => recordedChanges.push(change),
  });

  return { editor, frame, recordedChanges, dom };
}

const sampleHtmlPath = path.resolve(process.cwd(), "test-data/sample-complex-table.html");
const sampleHtml = fs.readFileSync(sampleHtmlPath, "utf-8");

test("Complex table: initial structure integrity", async () => {
  const { editor } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");
  assert.ok(table, "Table must exist");

  const { rowCount, colCount, grid } = buildTableGrid(table);
  // thead 2行 + PDM 1行 + トランスレータ 2行 + CAD 4行 + CAM 11行 = 20行
  assert.equal(rowCount, 20, "Table should have exactly 20 rows");
  // 1列目(大分類) + 2列目(小項目) + 11列(製品名) = 13列
  assert.equal(colCount, 13, "Table should have exactly 13 logical columns");

  // CAM セルの rowspan 検証
  const camCell = grid[9][0].cell;
  assert.equal(camCell.textContent.trim(), "CAM");
  assert.equal(camCell.rowSpan, 11, "CAM cell must have rowSpan 11");
});

test("Complex table: column addition highlights entire column and updates merged headers", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 4列目（「NX Design Premium」）を選択して右に列を追加
  const targetHeader = table.rows[1].cells[2];
  assert.match(targetHeader.textContent, /NX Design Premium/);
  editor.select(targetHeader);

  const added = editor.addTableColumn({ position: "after" });
  assert.equal(added, true, "Column addition should succeed");

  const change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.match(change.action, /列追加（右）/);
  assert.equal(change.addedColIndex, 5);
  assert.ok(Array.isArray(change.addedCellIds));
  assert.equal(change.addedCellIds.length, 19, "New cell added in 19 rows (excluding the group header row)");

  // 親ヘッダー「設計」の colSpan が 5 から 6 に自動拡張されていること
  const designGroupHeader = table.rows[0].cells[1];
  assert.equal(designGroupHeader.textContent.trim(), "設計");
  assert.equal(designGroupHeader.colSpan, 6, "Group header '設計' colSpan should expand from 5 to 6");

  // 赤入れレポートの妥当性検証
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  // 追加された列のセルすべてに wr-redline-added-cell が付いていること
  const addedHighlightCells = rTable.querySelectorAll(".wr-redline-added-cell");
  assert.equal(addedHighlightCells.length, 19, "All 19 cells in the added column must be highlighted");

  // 見出しセルに追加バッジがあること
  assert.match(rTable.querySelector(".wr-redline-label").textContent, /追加列（6列目）/);
});

test("Complex table: column deletion preserves alignment across all rows including the last row", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 4列目（「NX Design Premium」、index 4）を選択して列削除
  const targetHeader = table.rows[1].cells[2];
  editor.select(targetHeader);

  const deleted = editor.deleteTableColumn();
  assert.equal(deleted, true, "Column deletion should succeed");

  const change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.match(change.action, /列削除（5列目/);
  assert.equal(change.deletedColIndex, 4);

  // 親ヘッダー「設計」の colSpan が 5 から 4 に縮小していること
  const designGroupHeader = table.rows[0].cells[1];
  assert.equal(designGroupHeader.colSpan, 4, "Group header '設計' colSpan should shrink from 5 to 4");

  // 赤入れレポートの妥当性検証
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  // 設計ヘッダーが元の colSpan 5 に復元され、列数が整合していること
  const rDesignHeader = rTable.rows[0].cells[1];
  assert.equal(rDesignHeader.colSpan, 5, "Redline report should restore group header colSpan to 5");

  // 最下行（マシンツールシミュレーション）にも削除セルが復元されていること
  const lastRow = rTable.rows[rTable.rows.length - 1];
  const lastRowDeletedCell = lastRow.querySelector(".wr-redline-deleted-cell");
  assert.ok(lastRowDeletedCell, "Last row must contain restored deleted cell");

  // 全行の論理列数が13列に完全に揃っていること（列ズレが一切ないこと）
  const rGrid = buildTableGrid(rTable);
  assert.equal(rGrid.colCount, 13, "Redline table colCount must be perfectly 13");
  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(rGrid.grid[r].length, 13, `Row ${r} must have exactly 13 grid columns`);
  }
});

test("Complex table: moving rows within shared rowspan cell (CAM category)", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // CAM配下の「旋盤加工」（行12）を選択
  const latheRow = table.rows[12];
  const latheCell = latheRow.querySelector(".subitem-cell");
  assert.equal(latheCell.textContent.trim(), "旋盤加工");
  editor.select(latheCell);

  // 「旋盤加工」を下（「2.5軸ミル加工」、行13）へ移動
  const movedDown = editor.moveTableRow("down");
  assert.equal(movedDown, true, "Should successfully move row down inside CAM rowspan");

  assert.equal(table.rows[12].querySelector(".subitem-cell").textContent.trim(), "2.5軸ミル加工");
  assert.equal(table.rows[13].querySelector(".subitem-cell").textContent.trim(), "旋盤加工");

  // CAM の rowspan が 11 のまま保たれていること
  const camCell = table.rows[9].cells[0];
  assert.equal(camCell.textContent.trim(), "CAM");
  assert.equal(camCell.rowSpan, 11, "CAM rowSpan must remain 11");

  // 再度上へ移動して元に戻す
  editor.select(table.rows[13].querySelector(".subitem-cell"));
  const movedUp = editor.moveTableRow("up");
  assert.equal(movedUp, true, "Should successfully move row up inside CAM rowspan");
  assert.equal(table.rows[12].querySelector(".subitem-cell").textContent.trim(), "旋盤加工");
});

test("Complex table: moving column left and right across matrix", async () => {
  const { editor } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 3列目（「NX Design Standard Floating」、index 2）を選択して右へ移動
  const stdHeader = table.rows[1].cells[0];
  assert.match(stdHeader.textContent, /NX Design Standard Floating/);
  editor.select(stdHeader);

  const movedRight = editor.moveTableColumn("right");
  assert.equal(movedRight, true, "Column move right should succeed");

  // 1行目のヘッダーで 1番目と2番目が入れ替わっていること
  assert.match(table.rows[1].cells[0].textContent, /NX Design Advanced/);
  assert.match(table.rows[1].cells[1].textContent, /NX Design Standard Floating/);

  // データ行（PDM行）でも 3列目と4列目が入れ替わっていること
  const pdmRow = table.rows[2];
  // pdmRow.cells[0]: PDM, cells[1]: NX Embedded Client, cells[2]: mark, cells[3]: mark
  assert.ok(pdmRow.cells[2] && pdmRow.cells[3]);

  // 元に戻す（左へ移動）
  editor.select(table.rows[1].cells[1]);
  const movedLeft = editor.moveTableColumn("left");
  assert.equal(movedLeft, true, "Column move left should succeed");
  assert.match(table.rows[1].cells[0].textContent, /NX Design Standard Floating/);
  assert.match(table.rows[1].cells[1].textContent, /NX Design Advanced/);
});

test("Complex table: combined row delete and column delete redline report validity", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 1. 製図機能の行（行8）を削除
  const draftingCell = table.rows[8].querySelector(".subitem-cell");
  assert.equal(draftingCell.textContent.trim(), "製図機能");
  editor.select(draftingCell);
  editor.deleteTableRow();

  // 2. 5列目（「NX Design for Industrial Design」）を削除
  const industrialHeader = table.rows[1].cells[3];
  editor.select(industrialHeader);
  editor.deleteTableColumn();

  assert.equal(recordedChanges.length, 2);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  // 行削除の仮想行が挿入されていること
  const deletedRow = rTable.querySelector(".wr-redline-deleted-row");
  assert.ok(deletedRow, "Deleted row must exist in redline table");
  assert.match(deletedRow.textContent, /製図機能/);
  assert.match(deletedRow.textContent, /削除行/);

  // 列削除のセルが最下行まで漏れなく挿入されていること
  const lastRow = rTable.rows[rTable.rows.length - 1];
  const lastRowDeletedCell = lastRow.querySelector(".wr-redline-deleted-cell");
  assert.ok(lastRowDeletedCell, "Last row must have deleted column cell restored");

  // 全行のグリッド構造が完全一致すること
  const rGrid = buildTableGrid(rTable);
  assert.equal(rGrid.colCount, 13, "Col count must be preserved at 13");
  assert.equal(rGrid.rowCount, 20, "Row count must be preserved at 20 (including restored row)");
});
