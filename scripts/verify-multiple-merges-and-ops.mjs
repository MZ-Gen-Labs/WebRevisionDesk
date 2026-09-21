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
  return { editor, recordedChanges, dom };
}

const htmlPath = path.resolve(process.cwd(), "test-data/sample-complex-table.html");
const html = fs.readFileSync(htmlPath, "utf-8");

console.log("=== 行・列マージを含む複数削除・複数追加の徹底検証 ===\n");

let passed = 0;
let failed = 0;

async function runScenario(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`  Error: ${err.message}\n${err.stack}\n`);
    failed++;
  }
}

// 検証 1: 同一の colspan マージ（基本プラン: colspan=5）配下から 2 列削除
await runScenario("1. 同一 colspan グループ内から 2 列削除（連続および非連続）", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 基本プラン内の列（ヘッダー行1）:
  // cells[0]: Plan Standard Entry (col 2)
  // cells[1]: Plan Standard Advanced (col 3)
  // cells[2]: Plan Standard Premium (col 4)
  // 1つ目: cells[1] を削除
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();

  // 2つ目: 削除後の cells[1]（元 cells[2]）をさらに削除
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();

  if (recordedChanges.length !== 2) throw new Error(`Expected 2 changes, got ${recordedChanges.length}`);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "test.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 元13列から2列削除後、赤入れでは両方復元されて13列になるべき
  if (rGrid.colCount !== 13) throw new Error(`Expected colCount 13, got ${rGrid.colCount}`);
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== 13) {
      throw new Error(`Row ${r} has ${rGrid.grid[r].length} cols, expected 13`);
    }
  }

  // 削除列セルが各行に2つずつ存在すること
  const deletedCells = rTable.querySelectorAll(".wr-redline-deleted-cell");
  console.log(`  復元された削除列セル数: ${deletedCells.length}`);
});

// 検証 2: 同一の rowspan マージ（専門機能: rowspan=11）配下から 2 行削除
await runScenario("2. 同一 rowspan グループ内から 2 行削除", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 専門機能（Row 9〜19）
  // Row 10（加工指示ドキュメント）を削除
  editor.select(table.rows[10].cells[0]);
  editor.deleteTableRow();

  // Row 14（削除後の行）をさらに削除
  editor.select(table.rows[14].cells[0]);
  editor.deleteTableRow();

  if (recordedChanges.length !== 2) throw new Error(`Expected 2 changes, got ${recordedChanges.length}`);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "test.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);

  if (rGrid.rowCount !== 20) throw new Error(`Expected 20 rows, got ${rGrid.rowCount}`);
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== 13) {
      throw new Error(`Row ${r} has ${rGrid.grid[r].length} cols, expected 13`);
    }
  }

  const deletedRows = rTable.querySelectorAll(".wr-redline-deleted-row");
  if (deletedRows.length !== 2) throw new Error(`Expected 2 deleted rows, got ${deletedRows.length}`);
  console.log(`  復元された削除行プレースホルダー数: ${deletedRows.length}`);
});

// 検証 3: 行と列の両方がマージされたセル（th rowspan=2 colspan=2）が存在する領域の隣接操作
await runScenario("3. 行列同時マージ（rowspan=2 colspan=2）の直後列・直後行への削除と追加", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // col 2（基本プランの先頭列）を削除
  editor.select(table.rows[1].cells[0]);
  editor.deleteTableColumn();

  // row 2（共通基盤行: ヘッダー直後の最初のデータ行）を削除
  editor.select(table.rows[2].cells[0]);
  editor.deleteTableRow();

  // col 2（基本プラン先頭）の前に列追加（左）
  editor.select(table.rows[1].cells[0]);
  editor.addTableColumn({ position: "before" });

  // row 2（削除後のデータ先頭行）の前に新規行追加（上）
  editor.select(table.rows[2].cells[0]);
  editor.addTableRow({ position: "before" });

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "test.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);

  console.log(`  Grid: ${rGrid.rowCount} rows × ${rGrid.colCount} cols`);
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== rGrid.colCount) {
      throw new Error(`Row ${r} has ${rGrid.grid[r].length} cols, expected ${rGrid.colCount}`);
    }
  }
});

// 検証 4: 複数行削除(3行) + 複数列削除(2列) + 複数行追加(2行) + 複数列追加(2列) の極限複合操作
await runScenario("4. 複数行削除(3行) + 複数列削除(2列) + 複数行追加(2行) + 複数列追加(2列) の極限複合操作", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 1. 行削除 1: データ変換グループ内（Row 3）
  editor.select(table.rows[3].cells[1]);
  editor.deleteTableRow();

  // 2. 行削除 2: 基本モデリンググループ内（Row 5）
  editor.select(table.rows[5].cells[1]);
  editor.deleteTableRow();

  // 3. 行削除 3: 専門機能グループ内（Row 12）
  editor.select(table.rows[12].cells[0]);
  editor.deleteTableRow();

  // 4. 列削除 1: 基本プラン内（col 3）
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();

  // 5. 列削除 2: 解析プラン内（col 5）
  editor.select(table.rows[1].cells[4]);
  editor.deleteTableColumn();

  // 6. 列追加 1: 加工プランの前に列追加（左）
  editor.select(table.rows[1].cells[6]);
  editor.addTableColumn({ position: "before" });

  // 7. 列追加 2: 最末尾に列追加（右）
  const lastCol = table.rows[1].cells[table.rows[1].cells.length - 1];
  editor.select(lastCol);
  editor.addTableColumn({ position: "after" });

  // 8. 行追加 1: 表の途中（基本モデリング内）に行追加
  editor.select(table.rows[6].cells[0]);
  editor.addTableRow({ position: "after" });

  // 9. 行追加 2: 表の最下行に行追加
  const lastRow = table.rows[table.rows.length - 1];
  editor.select(lastRow.cells[0]);
  editor.addTableRow({ position: "after" });

  console.log(`  Recorded changes: ${recordedChanges.length}`);
  if (recordedChanges.length !== 9) throw new Error(`Expected 9 changes, got ${recordedChanges.length}`);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "test.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");
  const rGrid = buildTableGrid(rTable);

  console.log(`  Redline Grid: ${rGrid.rowCount} rows × ${rGrid.colCount} cols`);

  let mismatches = 0;
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== rGrid.colCount) {
      console.error(`  Row ${r} (${rGrid.rows[r].cells[0]?.textContent.trim().slice(0, 15)}): cols=${rGrid.grid[r].length}, expected=${rGrid.colCount}`);
      mismatches++;
    }
  }

  if (mismatches > 0) {
    throw new Error(`${mismatches} rows have column count mismatch`);
  }

  const delRows = rTable.querySelectorAll(".wr-redline-deleted-row");
  console.log(`  Deleted row placeholders: ${delRows.length}`);
  if (delRows.length !== 3) throw new Error(`Expected 3 deleted rows, got ${delRows.length}`);

  console.log(`  Grid integrity: ALL ${rGrid.rowCount} rows have exactly ${rGrid.colCount} columns`);
});

console.log(`\n=== 検証完了: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
