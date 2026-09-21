import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { PageEditor, buildTableGrid } from "../../src/editor.js";
import { createRedlineReport } from "../../src/diff-report.js";
import { generateAbstractTableHtml } from "../helpers/abstract-table-fixture.js";

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

test("abstract table generator creates neutral coordinate-labelled merge fixtures", () => {
  const html = generateAbstractTableHtml({
    rows: 4, cols: 5, headerRows: 1,
    merges: [{ row: 0, col: 1, colSpan: 3 }, { row: 1, col: 2, rowSpan: 2, colSpan: 2 }],
  });
  const table = new JSDOM(html).window.document.querySelector("table");
  const grid = buildTableGrid(table);
  assert.equal(grid.rowCount, 4);
  assert.equal(grid.colCount, 5);
  assert.equal(table.rows[0].cells[1].textContent, "SPAN_H_R0_C1-3");
  assert.equal(table.rows[1].cells[2].textContent, "SPAN_BOX_R1-2_C2-3");
  assert.equal(table.rows[3].cells[1].textContent, "VAL_R03_C01");
});

test("abstract table generator rejects invalid merge definitions", () => {
  assert.throws(() => generateAbstractTableHtml({ rows: 2, cols: 2, merges: [{ row: 1, col: 1, colSpan: 2 }] }), RangeError);
  assert.throws(() => generateAbstractTableHtml({ rows: 2, cols: 2, merges: [{ row: 0, col: 0, colSpan: 2 }, { row: 0, col: 1 }] }), RangeError);
});

test("Abstract matrix table: initial structure integrity (2x2 corner, colspan, rowspan)", () => {
  const dom = new JSDOM(abstractHtml);
  const table = dom.window.document.getElementById("abstract-matrix-table");
  const grid = buildTableGrid(table);
  assert.equal(grid.rowCount, 14, "Abstract table must have 14 rows initially");
  assert.equal(grid.colCount, 12, "Abstract table must have 12 columns initially");
  for (let r = 0; r < grid.rowCount; r++) {
    assert.equal(grid.grid[r].length, 12, `Row ${r} must have 12 columns`);
  }
});

test("Abstract matrix table: multiple column deletions across colspan groups", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  // GRP_A から 2列削除, GRP_C から 1列削除
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableColumn();
  editor.select(table.rows[1].cells[table.rows[1].cells.length - 2]);
  editor.deleteTableColumn();

  assert.equal(recordedChanges.length, 3);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  assert.equal(rGrid.colCount, 9, "Redline must preserve the final 9-column table");
  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(rGrid.grid[r].length, 9, `Row ${r} must have 9 cols`);
  }

  const panel = rDom.window.document.querySelector(".wr-table-deletions");
  assert.equal(panel.querySelectorAll("article").length, 3, "Must list 3 deleted columns");
});

test("Abstract matrix table: multiple row deletions within rowspan group preserve parent span", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  editor.select(table.rows[3].cells[0]);
  editor.deleteTableRow();
  editor.select(table.rows[3].cells[0]);
  editor.deleteTableRow();

  const gammaRow = [...table.rows].find((r) => r.textContent.includes("SUB_C3"));
  editor.select(gammaRow.cells[0]);
  editor.deleteTableRow();

  assert.equal(recordedChanges.length, 3);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  assert.equal(rGrid.rowCount, 11, "Redline must preserve the final 11-row table");
  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(rGrid.grid[r].length, 12, `Row ${r} must have 12 cols`);
  }

  const panel = rDom.window.document.querySelector(".wr-table-deletions");
  assert.equal(panel.querySelectorAll("article").length, 3, "Must list 3 deleted rows");
});

test("Abstract matrix table: complex 4-way multi-add multi-delete and text edit integrity", async () => {
  const { editor, recordedChanges } = setupEditor(abstractHtml);
  await editor.load(abstractHtml, true);
  const doc = editor.getDocument();
  const table = doc.getElementById("abstract-matrix-table");

  // 1. テキスト変更
  const cornerCell = table.querySelector(".corner-cell");
  editor.select(cornerCell);
  editor.updateText("CORNER_MODIFIED");

  // 2. 行削除 1
  const a1Row = [...table.rows].find((r) => r.textContent.includes("SUB_A1"));
  editor.select(a1Row.cells[1]);
  editor.deleteTableRow();

  // 3. 列削除 1
  const c05Header = [...table.rows[1].cells].find((c) => c.textContent.trim() === "C05");
  editor.select(c05Header);
  editor.deleteTableColumn();

  // 4. 行削除 2
  const c2Row = [...table.rows].find((r) => r.textContent.includes("SUB_C2"));
  editor.select(c2Row.cells[0]);
  editor.deleteTableRow();

  // 5. 列削除 2
  const c10Header = table.rows[1].cells[table.rows[1].cells.length - 1];
  editor.select(c10Header);
  editor.deleteTableColumn();

  // 6. 列追加 1
  editor.select(table.rows[1].cells[0]);
  editor.addTableColumn({ position: "before" });

  // 7. 列追加 2
  editor.select(table.rows[1].cells[4]);
  editor.addTableColumn({ position: "after" });

  // 8. 行追加 1
  const b3Row = [...table.rows].find((r) => r.textContent.includes("SUB_B3"));
  editor.select(b3Row.cells[0]);
  editor.addTableRow({ position: "after" });

  // 9. 行追加 2
  const lastRow = table.rows[table.rows.length - 1];
  editor.select(lastRow.cells[0]);
  editor.addTableRow({ position: "after" });

  // 10. テキスト変更 2
  const sampleDataCell = table.querySelector("tbody td:not(.cat-cell):not(.sub-cell)");
  editor.select(sampleDataCell);
  editor.updateText("VAL_CHANGED");

  assert.equal(recordedChanges.length, 10);

  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.getElementById("abstract-matrix-table");
  const rGrid = buildTableGrid(rTable);

  assert.equal(rGrid.rowCount, 14, "Must preserve the final 14 rows");
  assert.equal(rGrid.colCount, 12, "Must preserve the final 12 columns");

  for (let r = 0; r < rGrid.rowCount; r++) {
    assert.equal(rGrid.grid[r].length, 12, `Row ${r} must have 12 columns`);
  }

  // 赤入れ差分要素の検証
  const dels = rTable.querySelectorAll("del");
  const inss = rTable.querySelectorAll("ins");
  assert.ok(dels.length >= 2, "Must contain deleted text runs");
  assert.ok(inss.length >= 2, "Must contain inserted text runs");

  const deletionPanel = rDom.window.document.querySelector(".wr-table-deletions");
  assert.equal(deletionPanel.querySelectorAll("article").length, 4, "Must list 2 deleted rows and 2 deleted columns");

  const addedCells = rTable.querySelectorAll(".wr-redline-added-cell");
  assert.ok(addedCells.length > 0, "Must contain added cells");
});

test("2-row merged cell: deleting the first row (where rowspan=2 starts) keeps structure and redlines correctly", async () => {
  const testHtml = `<table>
    <thead><tr><th>H1</th><th>H2</th><th>H3</th></tr></thead>
    <tbody>
      <tr id="r0"><td rowspan="2" id="cat">MERGED_CAT</td><td>SUB_1</td><td>DATA_1</td></tr>
      <tr id="r1"><td>SUB_2</td><td>DATA_2</td></tr>
      <tr id="r2"><td>OTHER_CAT</td><td>SUB_3</td><td>DATA_3</td></tr>
    </tbody>
  </table>`;

  const { editor, recordedChanges } = setupEditor(testHtml);
  await editor.load(testHtml, true);
  const doc = editor.getDocument();
  const table = doc.querySelector("table");

  // Select row 1 (the first row with rowspan=2)
  editor.select(table.rows[1].cells[1]);
  editor.deleteTableRow();

  // Verify editor grid integrity
  const gEditor = buildTableGrid(table);
  assert.equal(gEditor.rowCount, 3);
  assert.equal(gEditor.colCount, 3);
  for (let r = 0; r < gEditor.rowCount; r++) {
    assert.equal(gEditor.grid[r].length, 3, `Editor Row ${r} must have 3 columns`);
  }
  assert.equal(table.rows[1].cells[0].textContent.trim(), "MERGED_CAT");
  assert.equal(table.rows[1].cells[0].rowSpan, 1);

  // Redline report verification
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.querySelector("table");
  const rg = buildTableGrid(rTable);
  assert.equal(rg.rowCount, 3);
  assert.equal(rg.colCount, 3);
  for (let r = 0; r < rg.rowCount; r++) {
    assert.equal(rg.grid[r].length, 3, `Redline Row ${r} must have 3 columns`);
  }
  assert.equal(rTable.rows[1].cells[0].textContent.trim(), "MERGED_CAT");
  assert.match(rDom.window.document.querySelector(".wr-table-deletions").textContent, /MERGED_CAT/);
});

test("2-row merged cell: deleting the second row (spanned by rowspan=2) keeps structure and redlines correctly", async () => {
  const testHtml = `<table>
    <thead><tr><th>H1</th><th>H2</th><th>H3</th></tr></thead>
    <tbody>
      <tr id="r0"><td rowspan="2" id="cat">MERGED_CAT</td><td>SUB_1</td><td>DATA_1</td></tr>
      <tr id="r1"><td>SUB_2</td><td>DATA_2</td></tr>
      <tr id="r2"><td>OTHER_CAT</td><td>SUB_3</td><td>DATA_3</td></tr>
    </tbody>
  </table>`;

  const { editor, recordedChanges } = setupEditor(testHtml);
  await editor.load(testHtml, true);
  const doc = editor.getDocument();
  const table = doc.querySelector("table");

  // Select row 2 (the spanned row)
  editor.select(table.rows[2].cells[0]);
  editor.deleteTableRow();

  // Verify editor grid integrity
  const gEditor = buildTableGrid(table);
  assert.equal(gEditor.rowCount, 3);
  assert.equal(gEditor.colCount, 3);
  for (let r = 0; r < gEditor.rowCount; r++) {
    assert.equal(gEditor.grid[r].length, 3, `Editor Row ${r} must have 3 columns`);
  }
  assert.equal(table.rows[1].cells[0].textContent.trim(), "MERGED_CAT");
  assert.equal(table.rows[1].cells[0].rowSpan, 1);

  // Redline report verification
  const redlineHtml = createRedlineReport(doc.body.innerHTML, recordedChanges, "report.html");
  const rDom = new JSDOM(redlineHtml);
  const rTable = rDom.window.document.querySelector("table");
  const rg = buildTableGrid(rTable);
  assert.equal(rg.rowCount, 3);
  assert.equal(rg.colCount, 3);
  for (let r = 0; r < rg.rowCount; r++) {
    assert.equal(rg.grid[r].length, 3, `Redline Row ${r} must have 3 columns`);
  }
  assert.equal(rTable.rows[1].cells[0].rowSpan, 1);
  assert.match(rDom.window.document.querySelector(".wr-table-deletions").textContent, /SUB_2/);
});
