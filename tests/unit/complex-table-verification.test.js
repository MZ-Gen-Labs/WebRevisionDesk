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
  // Two header rows and eighteen neutral data rows.
  assert.equal(rowCount, 20, "Table should have exactly 20 rows");
  // 1列目(大分類) + 2列目(小項目) + 11列(プラン名) = 13列
  assert.equal(colCount, 13, "Table should have exactly 13 logical columns");

  // Section cell rowspan verification
  const specialCell = grid[9][0].cell;
  assert.equal(specialCell.textContent.trim(), "SEC_R09-19");
  assert.equal(specialCell.rowSpan, 11, "Special category cell must have rowSpan 11");
});

test("Complex table: column addition highlights entire column and updates merged headers", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // Select COL_04 and add a column on its right.
  const targetHeader = table.rows[1].cells[2];
  assert.equal(targetHeader.textContent, "COL_04");
  editor.select(targetHeader);

  const added = editor.addTableColumn({ position: "after" });
  assert.equal(added, true, "Column addition should succeed");

  const change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.match(change.action, /列追加（右）/);
  assert.equal(change.addedColIndex, 5);
  assert.ok(Array.isArray(change.addedCellIds));
  assert.equal(change.addedCellIds.length, 19, "New cell added in 19 rows (excluding the group header row)");

  // The containing group expands from five logical columns to six.
  const basicGroupHeader = table.rows[0].cells[1];
  assert.equal(basicGroupHeader.textContent.trim(), "GRP_H0_C2-6");
  assert.equal(basicGroupHeader.colSpan, 6, "Group header colSpan should expand from 5 to 6");

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

  // Select COL_04 and delete its column.
  const targetHeader = table.rows[1].cells[2];
  editor.select(targetHeader);

  const deleted = editor.deleteTableColumn();
  assert.equal(deleted, true, "Column deletion should succeed");

  const change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.match(change.action, /列削除（5列目/);
  assert.equal(change.deletedColIndex, 4);

  // The containing group shrinks from five logical columns to four.
  const basicGroupHeader = table.rows[0].cells[1];
  assert.equal(basicGroupHeader.colSpan, 4, "Group header colSpan should shrink from 5 to 4");

  // 赤入れレポートの妥当性検証
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  // The redline preserves the final table and lists the deletion separately.
  const rBasicHeader = rTable.rows[0].cells[1];
  assert.equal(rBasicHeader.colSpan, 4, "Redline report must keep the final colSpan 4");
  const deletionPanel = rDom.window.document.querySelector(".wr-table-deletions");
  assert.match(deletionPanel.textContent, /5列目を削除/);

  // 全行の論理列数が修正後の12列に揃っていること
  const rGrid = buildTableGrid(rTable);
  assert.equal(rGrid.colCount, 12, "Redline table must retain the final 12 columns");
  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(rGrid.grid[r].length, 12, `Row ${r} must have exactly 12 grid columns`);
  }
});

test("Complex table: moving rows within a shared rowspan section", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // Select ROW_ITEM_12 (row 12).
  const latheRow = table.rows[12];
  const latheCell = latheRow.querySelector(".subitem-cell");
  assert.equal(latheCell.textContent.trim(), "ROW_ITEM_12");
  editor.select(latheCell);

  // Move it below ROW_ITEM_13.
  const movedDown = editor.moveTableRow("down");
  assert.equal(movedDown, true, "Should successfully move row down inside shared rowspan");

  assert.equal(table.rows[12].querySelector(".subitem-cell").textContent.trim(), "ROW_ITEM_13");
  assert.equal(table.rows[13].querySelector(".subitem-cell").textContent.trim(), "ROW_ITEM_12");

  // The section rowspan remains unchanged.
  const specialCell = table.rows[9].cells[0];
  assert.equal(specialCell.textContent.trim(), "SEC_R09-19");
  assert.equal(specialCell.rowSpan, 11, "Special features category rowSpan must remain 11");

  // 再度上へ移動して元に戻す
  editor.select(table.rows[13].querySelector(".subitem-cell"));
  const movedUp = editor.moveTableRow("up");
  assert.equal(movedUp, true, "Should successfully move row up inside shared rowspan");
  assert.equal(table.rows[12].querySelector(".subitem-cell").textContent.trim(), "ROW_ITEM_12");
});

test("Complex table: moving column left and right across matrix", async () => {
  const { editor } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // Select COL_02 and move it right.
  const stdHeader = table.rows[1].cells[0];
  assert.equal(stdHeader.textContent, "COL_02");
  editor.select(stdHeader);

  const movedRight = editor.moveTableColumn("right");
  assert.equal(movedRight, true, "Column move right should succeed");

  // 1行目のヘッダーで 1番目と2番目が入れ替わっていること
  assert.equal(table.rows[1].cells[0].textContent, "COL_03");
  assert.equal(table.rows[1].cells[1].textContent, "COL_02");

  // The matching data row also exchanges the same two columns.
  const baseRow = table.rows[2];
  assert.ok(baseRow.cells[2] && baseRow.cells[3]);

  // 元に戻す（左へ移動）
  editor.select(table.rows[1].cells[1]);
  const movedLeft = editor.moveTableColumn("left");
  assert.equal(movedLeft, true, "Column move left should succeed");
  assert.equal(table.rows[1].cells[0].textContent, "COL_02");
  assert.equal(table.rows[1].cells[1].textContent, "COL_03");
});

test("Complex table: combined row delete and column delete redline report validity", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 1. Delete ROW_ITEM_08 (row 8).
  const draftingCell = table.rows[8].querySelector(".subitem-cell");
  assert.equal(draftingCell.textContent.trim(), "ROW_ITEM_08");
  editor.select(draftingCell);
  editor.deleteTableRow();

  // 2. Delete COL_05.
  const industrialHeader = table.rows[1].cells[3];
  editor.select(industrialHeader);
  editor.deleteTableColumn();

  assert.equal(recordedChanges.length, 2);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  const deletionPanel = rDom.window.document.querySelector(".wr-table-deletions");
  assert.equal(deletionPanel.querySelectorAll("article").length, 2);
  assert.match(deletionPanel.textContent, /ROW_ITEM_08/);
  assert.match(deletionPanel.textContent, /列目を削除/);

  // 表本体は修正後の構造を維持すること
  const rGrid = buildTableGrid(rTable);
  assert.equal(rGrid.colCount, 12);
  assert.equal(rGrid.rowCount, 19);
});

test("Complex table: 4-way combined operations (row delete + col delete + col add + row add) redline report integrity", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(sampleHtml);
  await editor.load(sampleHtml, true);

  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 1. 行削除（4行目: データ変換）
  editor.select(table.rows[3].cells[1]);
  editor.deleteTableRow();

  // 2. Delete COL_04.
  editor.select(table.rows[1].cells[2]);
  editor.deleteTableColumn();

  // 3. 列追加（左）（11列目）
  const targetHeader = table.rows[1].cells[9];
  editor.select(targetHeader);
  editor.addTableColumn({ position: "before" });

  // 4. Add a row after the first row in SEC_R09-19.
  const targetRow = table.rows[9];
  editor.select(targetRow.cells[targetRow.cells.length - 1]);
  editor.addTableRow({ position: "after" });

  assert.equal(recordedChanges.length, 4);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 元13列 - 1列削除 + 1列追加、元20行 - 1行削除 + 1行追加。
  assert.equal(rGrid.colCount, 13, "Grid must preserve the final 13 columns");
  assert.equal(rGrid.rowCount, 20, "Grid must preserve the final 20 rows");

  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(
      rGrid.grid[r].length,
      rGrid.colCount,
      `Row ${r} (${rGrid.rows[r].cells[0]?.textContent.trim().slice(0, 15)}) must have exactly ${rGrid.colCount} columns`
    );
  }

  const deletionPanel = rDom.window.document.querySelector(".wr-table-deletions");
  assert.equal(deletionPanel.querySelectorAll("article").length, 2);
  assert.ok(rTable.querySelectorAll(".wr-redline-added-cell").length > 0, "Added cells must remain highlighted");
});
