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

const htmlPath = path.resolve(process.cwd(), "test-data/sample-complex-table.html");
const html = fs.readFileSync(htmlPath, "utf-8");

console.log("=== 複雑なマージ表に対する全編集機能および赤入れ表示の徹底点検 ===");

const checks = [];

async function runCheck(name, fn) {
  try {
    await fn();
    checks.push({ name, status: "OK" });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    checks.push({ name, status: "FAIL", error: err.message });
    console.error(`[FAIL] ${name}:`, err);
  }
}

// 1. テキスト変更
await runCheck("1. セルのテキスト変更と赤入れ表示", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // セルのテキストを変更
  const cell = table.rows[2].cells[1]; // システム連携クライアント
  editor.select(cell);
  editor.updateText("システム連携クライアント（更新版）");

  const change = recordedChanges.at(-1);
  if (!change || change.type !== "text-change") throw new Error("text-change not recorded");

  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const ins = rDom.window.document.querySelector("ins");
  const del = rDom.window.document.querySelector("del");
  if (!ins || !del) throw new Error("Missing ins or del in redline report");
  if (!ins.textContent.includes("更新版")) throw new Error("ins does not contain updated text");
});

// 2. 列追加（右）
await runCheck("2. 列追加（右）と赤入れ表示（全行ハイライト・親マージ拡張）", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  const targetHeader = table.rows[1].cells[2]; // Plan Standard Premium (4列目)
  editor.select(targetHeader);
  const ok = editor.addTableColumn({ position: "after" });
  if (!ok) throw new Error("addTableColumn failed");

  const change = recordedChanges.at(-1);
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  if (addedCells.length !== 19) throw new Error(`Expected 19 added cells, got ${addedCells.length}`);

  const basicHeader = rTable.rows[0].cells[1];
  if (basicHeader.colSpan !== 6) throw new Error(`Expected basic header colSpan 6, got ${basicHeader.colSpan}`);
});

// 3. 列追加（左）
await runCheck("3. 列追加（左）と赤入れ表示（境界挿入により全20行追加）", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  const targetHeader = table.rows[1].cells[0]; // Plan Standard Entry (3列目)
  editor.select(targetHeader);
  const ok = editor.addTableColumn({ position: "before" });
  if (!ok) throw new Error("addTableColumn(before) failed");

  const change = recordedChanges.at(-1);
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  if (addedCells.length !== 20) throw new Error(`Expected 20 added cells, got ${addedCells.length}`);
});

// 4. 列削除と赤入れ表示（最下行までの完全復元・列ズレなし）
await runCheck("4. 列削除と赤入れ表示（全行の復元と列整合性）", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  const targetHeader = table.rows[1].cells[3]; // Plan Professional (5列目)
  editor.select(targetHeader);
  const ok = editor.deleteTableColumn();
  if (!ok) throw new Error("deleteTableColumn failed");

  const change = recordedChanges.at(-1);
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  const grid = buildTableGrid(rTable);
  if (grid.colCount !== 13) throw new Error(`Expected 13 columns in redline, got ${grid.colCount}`);
  for (let r = 0; r < grid.rowCount; r++) {
    if (grid.grid[r].length !== 13) throw new Error(`Row ${r} has ${grid.grid[r].length} columns instead of 13`);
  }
});

// 5. 行追加（下）と赤入れ表示
await runCheck("5. 行追加（下）と赤入れ表示（全セルハイライト・見出しバッジ）", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  const targetCell = table.rows[2].cells[1]; // 共通基盤行
  editor.select(targetCell);
  const ok = editor.addTableRow({ position: "after" });
  if (!ok) throw new Error("addTableRow failed");

  const change = recordedChanges.at(-1);
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  if (addedCells.length === 0) throw new Error("Expected added cells highlight in redline");
  const badge = rTable.querySelector(".wr-redline-label");
  if (!badge || !badge.textContent.includes("追加行")) throw new Error("Missing added row badge");
});

// 6. 行削除と赤入れ表示（削除行プレースホルダー）
await runCheck("6. 行削除と赤入れ表示（元の位置に復元）", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  const targetCell = table.rows[2].cells[1]; // 共通基盤行
  editor.select(targetCell);
  const ok = editor.deleteTableRow();
  if (!ok) throw new Error("deleteTableRow failed");

  const change = recordedChanges.at(-1);
  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  const deletedRow = rTable.querySelector(".wr-redline-deleted-row");
  if (!deletedRow) throw new Error("Deleted row not found in redline");
  if (!deletedRow.textContent.includes("ROW_ITEM_02")) throw new Error("Deleted row does not contain expected text");
});

// 7. 行移動（上／下）
await runCheck("7. 大分類rowspan配下の行移動（上／下）と状態維持", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // 専門機能配下の「旋盤加工制御」を行12から行13へ下移動
  const cell = table.rows[12].querySelector(".subitem-cell");
  editor.select(cell);
  const okDown = editor.moveTableRow("down");
  if (!okDown) throw new Error("moveTableRow down failed");

  if (table.rows[13].querySelector(".subitem-cell").textContent.trim() !== "ROW_ITEM_12") {
    throw new Error("Row was not moved down correctly");
  }

  // 元に戻す
  editor.select(table.rows[13].querySelector(".subitem-cell"));
  const okUp = editor.moveTableRow("up");
  if (!okUp) throw new Error("moveTableRow up failed");

  if (table.rows[12].querySelector(".subitem-cell").textContent.trim() !== "ROW_ITEM_12") {
    throw new Error("Row was not moved up correctly");
  }
});

// 8. 列移動（左／右）
await runCheck("8. 列の左右移動と整合性", async () => {
  const { editor } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  const targetHeader = table.rows[1].cells[0]; // Plan Standard Entry (index 2)
  editor.select(targetHeader);
  const okRight = editor.moveTableColumn("right");
  if (!okRight) throw new Error("moveTableColumn right failed");

  if (!table.rows[1].cells[1].textContent.includes("COL_02")) {
    throw new Error("Column not moved right correctly");
  }

  editor.select(table.rows[1].cells[1]);
  const okLeft = editor.moveTableColumn("left");
  if (!okLeft) throw new Error("moveTableColumn left failed");

  if (!table.rows[1].cells[0].textContent.includes("COL_02")) {
    throw new Error("Column not moved back left correctly");
  }
});

// 9. セル結合（右へ結合）と赤入れ表示
await runCheck("9. セル結合（右へマージ）と赤入れハイライト", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // データセルの2つを横マージ
  const cell1 = table.rows[2].cells[2]; // 共通基盤行の1つ目のマーク
  editor.select(cell1);
  const ok = editor.mergeCellRight();
  if (!ok) throw new Error("mergeCellRight failed");

  const change = recordedChanges.at(-1);
  if (!change || change.action !== "セル結合（右）") throw new Error("table-change not recorded");

  const redlineHtml = createRedlineReport(doc.body.innerHTML, [change], "page.html");
  const rDom = new JSDOM(redlineHtml);
  const rDoc = rDom.window.document;

  // data-web-revision-id は赤入れ最終出力で除去されるため、
  // data-wr-label にセル結合ラベルが付与された TD を検索して検証する
  const cellWithLabel = rDoc.querySelector('td[data-wr-label*="セル結合（右）"]');
  if (!cellWithLabel) throw new Error("No cell with merge label found in redline report");
  if (!cellWithLabel.classList.contains("wr-redline-target")) {
    throw new Error("Merged cell not highlighted with wr-redline-target in redline report");
  }
});

// 10. 複合編集（行削除 ＋ 列削除 ＋ テキスト編集）の同時反映と赤入れ整合性
await runCheck("10. 複合編集（行削除＋列削除＋テキスト変更）の同時赤入れ表示", async () => {
  const { editor, recordedChanges } = setupEditorWithHtml(html);
  await editor.load(html, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("product-matrix-table");

  // A. テキスト変更
  const textCell = table.rows[3].querySelector(".subitem-cell");
  editor.select(textCell);
  editor.updateText("標準フォーマット変換機能（更新）");

  // B. 行削除（基本モデリングの「2D図面・製図作成機能」行8）
  const draftingCell = table.rows[8].querySelector(".subitem-cell");
  editor.select(draftingCell);
  editor.deleteTableRow();

  // C. 列削除（「Plan Professional」列）
  const profHeader = table.rows[1].cells[3];
  editor.select(profHeader);
  editor.deleteTableColumn();

  if (recordedChanges.length !== 3) throw new Error(`Expected 3 changes, got ${recordedChanges.length}`);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "matrix.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("product-matrix-table");

  // 行削除プレースホルダー
  const delRow = rTable.querySelector(".wr-redline-deleted-row");
  if (!delRow || !delRow.textContent.includes("ROW_ITEM_08")) {
    throw new Error("Deleted row placeholder missing or text mismatch");
  }

  // 最下行まで削除列のセルが復元されていること
  const lastRow = rTable.rows[rTable.rows.length - 1];
  if (!lastRow.querySelector(".wr-redline-deleted-cell")) {
    throw new Error("Last row missing restored deleted column cell");
  }

  // テキストの差分表示
  const ins = rTable.querySelector("ins");
  const del = rTable.querySelector("del");
  if (!ins || !del) throw new Error("Missing ins/del in text change");

  // テーブル全体のグリッド完全性（全行13列）
  const grid = buildTableGrid(rTable);
  if (grid.colCount !== 13) throw new Error(`Grid colCount mismatch: expected 13, got ${grid.colCount}`);
  if (grid.rowCount !== 20) throw new Error(`Grid rowCount mismatch: expected 20, got ${grid.rowCount}`);
  for (let r = 0; r < grid.rowCount; r++) {
    if (grid.grid[r].length !== 13) throw new Error(`Row ${r} grid length is ${grid.grid[r].length} instead of 13`);
  }
});

console.log("\n=== 点検結果サマリー ===");
console.table(checks);
