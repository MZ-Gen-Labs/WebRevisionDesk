import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { PageEditor, buildTableGrid } from "../src/editor.js";
import { createRedlineReport } from "../src/diff-report.js";

function setupEditor(html) {
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
  const editor = new PageEditor(frame, { onChange: (c) => recordedChanges.push(c) });
  return { editor, recordedChanges };
}

const htmlPath = path.resolve(process.cwd(), "test-data/sample-abstract-matrix.html");
const abstractHtml = fs.readFileSync(htmlPath, "utf-8");

console.log("================================================================================");
console.log("  無意味・抽象行列マトリクス表（2x2マージ / rowspan / colspan 内包）に対する");
console.log("  複数削除・複数追加の複合操作および赤入れ変更箇所表示の妥当性 徹底検証");
console.log("================================================================================\n");

let passed = 0;
let failed = 0;

async function checkTest(title, testFn) {
  try {
    await testFn();
    console.log(`[PASS] ${title}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${title}`);
    console.error(`  Error: ${err.message}`);
    console.error(`  Stack: ${err.stack}\n`);
    failed++;
  }
}

// --------------------------------------------------------------------------------
// テスト 1: 複数列削除（colspan グループ内連続削除 + 別グループ列削除）と赤入れ妥当性
// --------------------------------------------------------------------------------
await checkTest("Test 1: 複数列削除（GRP_A内 2列削除 + GRP_C内 1列削除）の赤入れ妥当性", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  // 1. GRP_A (col 2..5) の中の C02 (col 3) を削除
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();

  // 2. GRP_A の中の C03 (削除後の col 3) をさらに削除
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();

  // 3. GRP_C (末尾グループ) の中の C09 を削除
  editor.select(table.rows[1].cells[table.rows[1].cells.length - 2]);
  editor.deleteTableColumn();

  if (recordedChanges.length !== 3) throw new Error(`Expected 3 changes, got ${recordedChanges.length}`);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 【妥当性検証 A: グリッド完全性】元12列が全行で完全に復元されていること
  if (rGrid.colCount !== 12) throw new Error(`Expected colCount 12, got ${rGrid.colCount}`);
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== 12) {
      throw new Error(`Row ${r} has ${rGrid.grid[r].length} cols, expected 12`);
    }
  }

  // 【妥当性検証 B: 削除列セルの表示】
  const deletedCells = rTable.querySelectorAll(".wr-redline-deleted-cell");
  if (deletedCells.length === 0) throw new Error("No deleted cells found in redline table");
  // 3列削除 × 各行に復元セルが存在すること（shrink セルを除く）
  for (const dc of deletedCells) {
    if (!dc.classList.contains("wr-redline-delete")) throw new Error("Deleted cell missing wr-redline-delete class");
    if (dc.style.textDecoration !== "line-through") throw new Error("Deleted cell missing line-through style");
    if (!dc.style.backgroundColor.includes("rgb(255, 236, 236)") && dc.style.backgroundColor !== "#ffecec") {
      throw new Error(`Deleted cell has wrong bgColor: ${dc.style.backgroundColor}`);
    }
  }

  // 【妥当性検証 C: 削除列バッジの存在】
  const labels = rTable.querySelectorAll(".wr-redline-label");
  const colLabels = [...labels].filter((l) => l.textContent.includes("削除列"));
  if (colLabels.length < 3) throw new Error(`Expected at least 3 '削除列' badges, found ${colLabels.length}`);

  console.log(`    → 全${rGrid.rowCount}行×12列完全一致、削除セル${deletedCells.length}個、削除列バッジ${colLabels.length}個 確認`);
});

// --------------------------------------------------------------------------------
// テスト 2: 複数行削除（rowspan グループ内 2行削除 + 独立セクション行削除）と赤入れ妥当性
// --------------------------------------------------------------------------------
await checkTest("Test 2: 複数行削除（CAT_ALPHA内 2行削除 + CAT_GAMMA内 1行削除）の赤入れ妥当性", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  // 1. CAT_ALPHA (Row 2..5) の中の SUB_A2 (Row 3) を削除
  editor.select(table.rows[3].cells[0]);
  editor.deleteTableRow();

  // 2. CAT_ALPHA の中の SUB_A3 (横マージA3-SPAN2を含む行: 削除後の Row 3) を削除
  editor.select(table.rows[3].cells[0]);
  editor.deleteTableRow();

  // 3. CAT_GAMMA の中の SUB_C3 を削除
  const gammaRow = [...table.rows].find((r) => r.textContent.includes("SUB_C3"));
  editor.select(gammaRow.cells[0]);
  editor.deleteTableRow();

  if (recordedChanges.length !== 3) throw new Error(`Expected 3 changes, got ${recordedChanges.length}`);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 【妥当性検証 A: 元の14行がすべて復元されていること】
  if (rGrid.rowCount !== 14) throw new Error(`Expected rowCount 14, got ${rGrid.rowCount}`);
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== 12) {
      throw new Error(`Row ${r} has ${rGrid.grid[r].length} cols, expected 12`);
    }
  }

  // 【妥当性検証 B: 削除行プレースホルダーの妥当性】
  const delRows = rTable.querySelectorAll(".wr-redline-deleted-row");
  if (delRows.length !== 3) throw new Error(`Expected 3 deleted rows, got ${delRows.length}`);

  for (const dr of delRows) {
    if (!dr.classList.contains("wr-redline-delete")) throw new Error("Deleted row missing wr-redline-delete class");
    const badge = dr.querySelector(".wr-redline-label");
    if (!badge || !badge.textContent.includes("削除行")) throw new Error("Deleted row missing 削除行 badge");
    for (const cell of dr.cells) {
      if (cell.style.textDecoration !== "line-through") throw new Error("Deleted row cell missing line-through");
    }
  }

  // 【妥当性検証 C: 親 rowspan の復元】
  // CAT_ALPHA は 4行分（削除された2行 + 残った2行）をカバーしていること
  const alphaCell = [...rTable.querySelectorAll("td")].find((c) => c.textContent.includes("CAT_ALPHA"));
  if (!alphaCell) throw new Error("CAT_ALPHA cell not found in redline");
  if (alphaCell.rowSpan !== 4) throw new Error(`Expected CAT_ALPHA rowSpan 4, got ${alphaCell.rowSpan}`);

  console.log(`    → 全${rGrid.rowCount}行×12列完全一致、削除行3行（バッジ・打ち消し線付）、CAT_ALPHA rowSpan=4 復元確認`);
});

// --------------------------------------------------------------------------------
// テスト 3: 2x2 ブロックマージ（B_BLOCK_2x2）に隣接・交差する複数列追加・複数行追加
// --------------------------------------------------------------------------------
await checkTest("Test 3: 2x2ブロックマージ（B_BLOCK_2x2）周辺への複数列追加・複数行追加の赤入れ妥当性", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  // 1. 列追加 1: B_BLOCK_2x2 (col 4..5) の直前（col 4 の左）に追加
  editor.select(table.rows[1].cells[3]); // C04
  editor.addTableColumn({ position: "before" });

  // 2. 列追加 2: B_BLOCK_2x2 の直後（右）に追加
  editor.select(table.rows[1].cells[6]); // C06
  editor.addTableColumn({ position: "after" });

  // 3. 行追加 1: B_BLOCK_2x2 の上の行（SUB_B1）の上に追加
  const b1Row = [...table.rows].find((r) => r.textContent.includes("SUB_B1"));
  editor.select(b1Row.cells[1]);
  editor.addTableRow({ position: "before" });

  // 4. 行追加 2: B_BLOCK_2x2 の下の行（SUB_B2）の下に追加
  const b2Row = [...table.rows].find((r) => r.textContent.includes("SUB_B2"));
  editor.select(b2Row.cells[1]);
  editor.addTableRow({ position: "after" });

  if (recordedChanges.length !== 4) throw new Error(`Expected 4 changes, got ${recordedChanges.length}`);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 元12列 + 2列追加 = 14列
  // 元14行 + 2行追加 = 16行
  if (rGrid.colCount !== 14) throw new Error(`Expected colCount 14, got ${rGrid.colCount}`);
  if (rGrid.rowCount !== 16) throw new Error(`Expected rowCount 16, got ${rGrid.rowCount}`);

  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== 14) {
      throw new Error(`Row ${r} has ${rGrid.grid[r].length} cols, expected 14`);
    }
  }

  // 【妥当性検証: 追加セルのハイライト】
  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  if (addedCells.length === 0) throw new Error("No added cells found");
  for (const ac of addedCells) {
    if (!ac.classList.contains("wr-redline-add")) throw new Error("Added cell missing wr-redline-add");
    if (!ac.style.backgroundColor.includes("rgb(240, 250, 244)") && ac.style.backgroundColor !== "#f0faf4") {
      throw new Error(`Added cell wrong bgColor: ${ac.style.backgroundColor}`);
    }
  }

  // 追加バッジの確認
  const addBadges = [...rTable.querySelectorAll(".wr-redline-label")].filter((l) => l.textContent.includes("追加"));
  if (addBadges.length < 4) throw new Error(`Expected at least 4 add badges, got ${addBadges.length}`);

  console.log(`    → 全${rGrid.rowCount}行×${rGrid.colCount}列完全一致、追加セル${addedCells.length}個（緑枠・緑背景）、追加バッジ${addBadges.length}個 確認`);
});

// --------------------------------------------------------------------------------
// テスト 4: 【極限複合検証】複数行削除(2) + 複数列削除(2) + 複数行追加(2) + 複数列追加(2) + テキスト変更(2)
// --------------------------------------------------------------------------------
await checkTest("Test 4: 極限複合操作（2行削除 + 2列削除 + 2行追加 + 2列追加 + 2セルテキスト変更）の完全整合性", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  // 1. テキスト変更 1: コーナーセル
  const cornerCell = table.querySelector(".corner-cell");
  editor.select(cornerCell);
  editor.updateText("CORNER_MODIFIED");

  // 2. 行削除 1: CAT_ALPHA 内（SUB_A1 行）
  const a1Row = [...table.rows].find((r) => r.textContent.includes("SUB_A1"));
  editor.select(a1Row.cells[1]);
  editor.deleteTableRow();

  // 3. 列削除 1: GRP_B の先頭列（C05）
  const c05Header = [...table.rows[1].cells].find((c) => c.textContent.trim() === "C05");
  editor.select(c05Header);
  editor.deleteTableColumn();

  // 4. 行削除 2: CAT_GAMMA 内（SUB_C2 行）
  const c2Row = [...table.rows].find((r) => r.textContent.includes("SUB_C2"));
  editor.select(c2Row.cells[0]);
  editor.deleteTableRow();

  // 5. 列削除 2: GRP_C の末尾列（C10）
  const c10Header = table.rows[1].cells[table.rows[1].cells.length - 1];
  editor.select(c10Header);
  editor.deleteTableColumn();

  // 6. 列追加 1: GRP_A の先頭（左）に列追加
  editor.select(table.rows[1].cells[0]);
  editor.addTableColumn({ position: "before" });

  // 7. 列追加 2: GRP_B の中央に列追加（右）
  editor.select(table.rows[1].cells[4]);
  editor.addTableColumn({ position: "after" });

  // 8. 行追加 1: CAT_BETA 内（SUB_B3 の下）に行追加
  const b3Row = [...table.rows].find((r) => r.textContent.includes("SUB_B3"));
  editor.select(b3Row.cells[0]);
  editor.addTableRow({ position: "after" });

  // 9. 行追加 2: 最下行の下に行追加
  const lastRow = table.rows[table.rows.length - 1];
  editor.select(lastRow.cells[0]);
  editor.addTableRow({ position: "after" });

  // 10. テキスト変更 2: データセル内のテキスト変更
  const sampleDataCell = table.querySelector("tbody td:not(.cat-cell):not(.sub-cell)");
  editor.select(sampleDataCell);
  editor.updateText("VAL_CHANGED");

  console.log(`    → 記録された総変更数: ${recordedChanges.length}`);
  if (recordedChanges.length !== 10) throw new Error(`Expected 10 changes, got ${recordedChanges.length}`);

  // 赤入れレポート生成
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  // 計算上のグリッドサイズ:
  // 元12列 - 2列削除 + 2列追加 = 12列 + 削除列復元(2) + 追加列(2) = 14列
  // 元14行 - 2行削除 + 2行追加 = 14行 + 削除行復元(2) = 16行
  console.log(`    → 生成された赤入れグリッド: ${rGrid.rowCount} 行 × ${rGrid.colCount} 列`);

  if (rGrid.rowCount !== 16) throw new Error(`Expected 16 rows, got ${rGrid.rowCount}`);
  if (rGrid.colCount !== 14) throw new Error(`Expected 14 cols, got ${rGrid.colCount}`);

  // 全16行すべての列数が14列であること
  for (let r = 0; r < rGrid.rowCount; r++) {
    if (rGrid.grid[r].length !== 14) {
      throw new Error(`Row ${r} (${rGrid.rows[r].cells[0]?.textContent.trim().slice(0, 15)}) has ${rGrid.grid[r].length} cols, expected 14`);
    }
  }

  // テキスト差分（<del> / <ins>）が正しく含まれていること
  const dels = rTable.querySelectorAll("del");
  const inss = rTable.querySelectorAll("ins");
  if (dels.length < 2 || inss.length < 2) {
    throw new Error(`Expected at least 2 del/ins pairs, got ${dels.length} del, ${inss.length} ins`);
  }

  // 削除行プレースホルダーが2行存在すること
  const delRows = rTable.querySelectorAll(".wr-redline-deleted-row");
  if (delRows.length !== 2) throw new Error(`Expected 2 deleted rows, got ${delRows.length}`);

  // 削除列セルが存在すること
  const delCells = rTable.querySelectorAll(".wr-redline-deleted-cell");
  if (delCells.length === 0) throw new Error("Expected deleted cells to be present");

  // 追加セルが存在すること
  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  if (addedCells.length === 0) throw new Error("Expected added cells to be present");

  console.log(`    → テキスト差分（del/ins: ${dels.length}/${inss.length}）、削除行: ${delRows.length}行、削除列セル: ${delCells.length}個、追加セル: ${addedCells.length}個`);
  console.log(`    → 全行全列のグリッド整合性が 100% 完璧に維持されています！`);
});

console.log("\n================================================================================");
console.log(`  全検証結果: ${passed} PASSED, ${failed} FAILED`);
console.log("================================================================================\n");

if (failed > 0) process.exit(1);
