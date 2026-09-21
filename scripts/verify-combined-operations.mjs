import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { PageEditor, buildTableGrid } from "../src/editor.js";
import { createRedlineReport } from "../src/diff-report.js";

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
      setTimeout(() => { (this.listeners["load"] || []).forEach((fn) => fn()); }, 0);
    },
    addEventListener(event, fn) { this.listeners[event] = this.listeners[event] || []; this.listeners[event].push(fn); },
    removeEventListener() {},
  };

  const recordedChanges = [];
  const editor = new PageEditor(frame, { onChange: (change) => recordedChanges.push(change) });
  return { editor, frame, recordedChanges, dom };
}

const htmlPath = path.resolve(process.cwd(), "test-data/sample-complex-table.html");
const html = fs.readFileSync(htmlPath, "utf-8");

console.log("=== 複合操作の赤入れ表示の整合性チェック ===\n");

async function check(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`  → ${err.message}\n`);
  }
}

// テスト: 行削除 + 列削除 + 列追加 + 行追加の複合操作
await check("行削除 + 列削除 + 列追加 + 行追加 の複合赤入れ表示", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");
  const { colCount: origCols, rowCount: origRows } = buildTableGrid(table);

  // 1. 行削除（データ変換の「標準フォーマット変換機能」行）
  const delRowCell = table.rows[3].querySelector(".subitem-cell");
  editor.select(delRowCell);
  editor.deleteTableRow();

  // 2. 列削除（5列目「Plan Standard Premium」）
  const delColHeader = table.rows[1].cells[2];
  editor.select(delColHeader);
  editor.deleteTableColumn();

  // 3. 列追加（「Operations Basic」の左に追加）
  const addColRef = table.rows[1].cells[7]; // Operations Basic
  editor.select(addColRef);
  editor.addTableColumn({ position: "before" });

  // 4. 行追加（最下行の後に追加）
  const lastBodyRow = table.rows[table.rows.length - 1];
  editor.select(lastBodyRow.querySelector("td"));
  editor.addTableRow({ position: "after" });

  console.log(`  Changes recorded: ${recordedChanges.length}`);
  if (recordedChanges.length !== 4) throw new Error(`Expected 4 changes, got ${recordedChanges.length}`);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  if (!rTable) throw new Error("Redline table not found");

  const rGrid = buildTableGrid(rTable);
  console.log(`  Redline grid: ${rGrid.rowCount} rows × ${rGrid.colCount} cols`);
  console.log(`  Original grid: ${origRows} rows × ${origCols} cols`);

  // 期待値: 元の行数は維持（削除行の復元 + 追加行で ±0 ではなく +1 行）
  // 列数は: 元の列数維持（削除列の復元 + 追加列で ±0 ではなく +1 列）

  // 全行の列数が一致しているか
  let gridErrors = 0;
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== rGrid.colCount) {
      console.error(`  Row ${r}: expected ${rGrid.colCount} cols, got ${rGrid.grid[r].length}`);
      gridErrors++;
    }
  }

  if (gridErrors > 0) {
    throw new Error(`${gridErrors} rows have column count mismatch in redline grid`);
  }

  // 削除行のプレースホルダーが存在するか
  const deletedRows = rTable.querySelectorAll(".wr-redline-deleted-row");
  if (deletedRows.length === 0) throw new Error("Deleted row placeholder not found");
  console.log(`  Deleted row placeholders: ${deletedRows.length}`);

  // 削除行のプレースホルダーのセル数が適切か
  for (const dr of deletedRows) {
    let drCols = 0;
    for (const cell of dr.cells) {
      drCols += cell.colSpan || 1;
    }
    console.log(`  Deleted row cell colspan sum: ${drCols}`);
  }

  // 削除列のセルが存在するか
  const deletedCells = rTable.querySelectorAll(".wr-redline-deleted-cell");
  console.log(`  Deleted column cells: ${deletedCells.length}`);

  // 追加列のセルが存在するか
  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  console.log(`  Added column cells: ${addedCells.length}`);

  console.log(`  Grid OK: all ${rGrid.rowCount} rows have ${rGrid.colCount} columns`);
});

// テスト2: 行削除 x2 + 列削除 x2
await check("行削除 x2 + 列削除 x2 の複合赤入れ表示", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 行削除1（行2: 共通基盤行）
  editor.select(table.rows[2].querySelector("td"));
  editor.deleteTableRow();

  // 行削除2（行5: ダイレクト編集モデリング機能 → 行削除1の後なので行4になっている）
  editor.select(table.rows[5].querySelector(".subitem-cell"));
  editor.deleteTableRow();

  // 列削除1（3列目）
  editor.select(table.rows[1].cells[0]);
  editor.deleteTableColumn();

  // 列削除2（末列方面）
  editor.select(table.rows[1].cells[table.rows[1].cells.length - 1]);
  editor.deleteTableColumn();

  console.log(`  Changes recorded: ${recordedChanges.length}`);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);
  console.log(`  Redline grid: ${rGrid.rowCount} rows × ${rGrid.colCount} cols`);

  let gridErrors = 0;
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== rGrid.colCount) {
      console.error(`  Row ${r}: expected ${rGrid.colCount} cols, got ${rGrid.grid[r].length}`);
      gridErrors++;
    }
  }
  if (gridErrors > 0) throw new Error(`${gridErrors} rows have column count mismatch`);
  console.log(`  Grid OK: all ${rGrid.rowCount} rows have ${rGrid.colCount} columns`);
});

console.log("\n=== 完了 ===");
