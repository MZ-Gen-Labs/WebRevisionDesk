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
  // thead 2行 + 共通基盤 1行 + データ変換 2行 + 基本モデリング 4行 + 専門機能 11行 = 20行
  assert.equal(rowCount, 20, "Table should have exactly 20 rows");
  // 1列目(大分類) + 2列目(小項目) + 11列(プラン名) = 13列
  assert.equal(colCount, 13, "Table should have exactly 13 logical columns");

  // 「専門機能」大分類セルの rowspan 検証
  const specialCell = grid[9][0].cell;
  assert.equal(specialCell.textContent.trim(), "専門機能");
  assert.equal(specialCell.rowSpan, 11, "Special category cell must have rowSpan 11");
});

test("Complex table: column addition highlights entire column and updates merged headers", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 4列目（「Plan Standard Premium」）を選択して右に列を追加
  const targetHeader = table.rows[1].cells[2];
  assert.match(targetHeader.textContent, /Plan Standard Premium/);
  editor.select(targetHeader);

  const added = editor.addTableColumn({ position: "after" });
  assert.equal(added, true, "Column addition should succeed");

  const change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.match(change.action, /列追加（右）/);
  assert.equal(change.addedColIndex, 5);
  assert.ok(Array.isArray(change.addedCellIds));
  assert.equal(change.addedCellIds.length, 19, "New cell added in 19 rows (excluding the group header row)");

  // 親ヘッダー「基本プラン」の colSpan が 5 から 6 に自動拡張されていること
  const basicGroupHeader = table.rows[0].cells[1];
  assert.equal(basicGroupHeader.textContent.trim(), "基本プラン");
  assert.equal(basicGroupHeader.colSpan, 6, "Group header '基本プラン' colSpan should expand from 5 to 6");

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

  // 4列目（「Plan Standard Premium」、index 4）を選択して列削除
  const targetHeader = table.rows[1].cells[2];
  editor.select(targetHeader);

  const deleted = editor.deleteTableColumn();
  assert.equal(deleted, true, "Column deletion should succeed");

  const change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.match(change.action, /列削除（5列目/);
  assert.equal(change.deletedColIndex, 4);

  // 親ヘッダー「基本プラン」の colSpan が 5 から 4 に縮小していること
  const basicGroupHeader = table.rows[0].cells[1];
  assert.equal(basicGroupHeader.colSpan, 4, "Group header '基本プラン' colSpan should shrink from 5 to 4");

  // 赤入れレポートの妥当性検証
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  // 基本プランヘッダーが元の colSpan 5 に復元され、列数が整合していること
  const rBasicHeader = rTable.rows[0].cells[1];
  assert.equal(rBasicHeader.colSpan, 5, "Redline report should restore group header colSpan to 5");

  // 最下行（シミュレーション検証機能）にも削除セルが復元されていること
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

test("Complex table: moving rows within shared rowspan cell (Special features category)", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 専門機能配下の「旋盤加工制御」（行12）を選択
  const latheRow = table.rows[12];
  const latheCell = latheRow.querySelector(".subitem-cell");
  assert.equal(latheCell.textContent.trim(), "旋盤加工制御");
  editor.select(latheCell);

  // 「旋盤加工制御」を下（「2.5軸ミル加工制御」、行13）へ移動
  const movedDown = editor.moveTableRow("down");
  assert.equal(movedDown, true, "Should successfully move row down inside shared rowspan");

  assert.equal(table.rows[12].querySelector(".subitem-cell").textContent.trim(), "2.5軸ミル加工制御");
  assert.equal(table.rows[13].querySelector(".subitem-cell").textContent.trim(), "旋盤加工制御");

  // 「専門機能」の rowspan が 11 のまま保たれていること
  const specialCell = table.rows[9].cells[0];
  assert.equal(specialCell.textContent.trim(), "専門機能");
  assert.equal(specialCell.rowSpan, 11, "Special features category rowSpan must remain 11");

  // 再度上へ移動して元に戻す
  editor.select(table.rows[13].querySelector(".subitem-cell"));
  const movedUp = editor.moveTableRow("up");
  assert.equal(movedUp, true, "Should successfully move row up inside shared rowspan");
  assert.equal(table.rows[12].querySelector(".subitem-cell").textContent.trim(), "旋盤加工制御");
});

test("Complex table: moving column left and right across matrix", async () => {
  const { editor } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 3列目（「Plan Standard Entry」、index 2）を選択して右へ移動
  const stdHeader = table.rows[1].cells[0];
  assert.match(stdHeader.textContent, /Plan Standard Entry/);
  editor.select(stdHeader);

  const movedRight = editor.moveTableColumn("right");
  assert.equal(movedRight, true, "Column move right should succeed");

  // 1行目のヘッダーで 1番目と2番目が入れ替わっていること
  assert.match(table.rows[1].cells[0].textContent, /Plan Standard Advanced/);
  assert.match(table.rows[1].cells[1].textContent, /Plan Standard Entry/);

  // データ行（共通基盤行）でも 3列目と4列目が入れ替わっていること
  const baseRow = table.rows[2];
  assert.ok(baseRow.cells[2] && baseRow.cells[3]);

  // 元に戻す（左へ移動）
  editor.select(table.rows[1].cells[1]);
  const movedLeft = editor.moveTableColumn("left");
  assert.equal(movedLeft, true, "Column move left should succeed");
  assert.match(table.rows[1].cells[0].textContent, /Plan Standard Entry/);
  assert.match(table.rows[1].cells[1].textContent, /Plan Standard Advanced/);
});

test("Complex table: combined row delete and column delete redline report validity", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 1. 「2D図面・製図作成機能」の行（行8）を削除
  const draftingCell = table.rows[8].querySelector(".subitem-cell");
  assert.equal(draftingCell.textContent.trim(), "2D図面・製図作成機能");
  editor.select(draftingCell);
  editor.deleteTableRow();

  // 2. 5列目（「Plan Professional」）を削除
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
  assert.match(deletedRow.textContent, /2D図面・製図作成機能/);
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

test("Complex table: 4-way combined operations (row delete + col delete + col add + row add) redline report integrity", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 1. 行削除（4行目: データ変換）
  editor.select(table.rows[3].cells[1]);
  editor.deleteTableRow();

  // 2. 列削除（5列目: Plan Standard Premium）
  editor.select(table.rows[1].cells[2]);
  editor.deleteTableColumn();

  // 3. 列追加（左）（11列目）
  const targetHeader = table.rows[1].cells[9];
  editor.select(targetHeader);
  editor.addTableColumn({ position: "before" });

  // 4. 行追加（下）（途中の行10: 専門機能の先頭行）
  const targetRow = table.rows[9];
  editor.select(targetRow.cells[targetRow.cells.length - 1]);
  editor.addTableRow({ position: "after" });

  assert.equal(recordedChanges.length, 4);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 期待グリッド: 元13列 - 1列削除 + 1列追加 = 13列 + 削除列復元(1) + 追加列(1) = 14列
  // 元20行 - 1行削除 + 1行追加 = 20行 + 削除行復元(1) = 21行
  assert.equal(rGrid.colCount, 14, "Grid must have exactly 14 columns across all rows");
  assert.equal(rGrid.rowCount, 21, "Grid must have exactly 21 rows");

  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(
      rGrid.grid[r].length,
      rGrid.colCount,
      `Row ${r} (${rGrid.rows[r].cells[0]?.textContent.trim().slice(0, 15)}) must have exactly ${rGrid.colCount} columns`
    );
  }

  // 最下行にも正しく削除列セルと追加列セルが含まれ、ズレていないこと
  const lastRow = rTable.rows[rTable.rows.length - 1];
  const lastRowDeletedCell = lastRow.querySelector(".wr-redline-deleted-cell");
  const lastRowAddedCell = lastRow.querySelector(".wr-redline-added-cell");
  assert.ok(lastRowDeletedCell, "Last row must have restored deleted-column cell");
  assert.ok(lastRowAddedCell, "Last row must have added-column cell");
});

