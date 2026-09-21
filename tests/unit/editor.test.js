import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PageEditor } from "../../src/editor.js";

function setupEditorEnvironment() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
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

  return { editor, recordedChanges };
}

test("multiple element deletion preserves original DOM order on undo", async () => {
  const { editor, recordedChanges } = setupEditorEnvironment();
  const initialHtml = `<ul id="list"><li id="item-a">A</li><li id="item-b">B</li><li id="item-c">C</li><li id="item-d">D</li></ul>`;
  await editor.load(initialHtml, true);

  const doc = editor.getDocument();
  const itemA = doc.getElementById("item-a");
  const itemB = doc.getElementById("item-b");

  editor.select(itemA);
  editor.select(itemB, { additive: true });
  assert.equal(editor.selectedElements.size, 2);

  const deleted = editor.deleteSelected();
  assert.equal(deleted, true);

  const list = doc.getElementById("list");
  const remainingTexts = [...list.children].map((el) => el.textContent);
  assert.deepEqual(remainingTexts, ["C", "D"]);

  assert.equal(recordedChanges.length, 2);
  const [changeA, changeB] = recordedChanges;
  assert.equal(changeA.nextSiblingId, changeB.elementId);
  assert.ok(changeB.nextSiblingId);

  // Undo (in real app, batch operations are applied in reverse: B, then A)
  const group = [changeB, changeA];
  for (const item of group) {
    const success = editor.applyChange(item, "undo");
    assert.equal(success, true);
  }

  const restoredTexts = [...list.children].map((el) => el.textContent);
  assert.deepEqual(restoredTexts, ["A", "B", "C", "D"], "DOM order must be preserved as [A, B, C, D]");
});

test("deleteTableRow safely handles tables with complex structure (rowspan)", async () => {
  const { editor } = setupEditorEnvironment();
  const htmlWithRowspan = `
    <table id="tbl">
      <tbody>
        <tr><td id="cell-1" rowspan="2">Span Cell</td><td id="cell-1b">Cell 1B</td></tr>
        <tr><td id="cell-2">Cell 2B</td></tr>
        <tr><td id="cell-3a">Cell 3A</td><td id="cell-3b">Cell 3B</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(htmlWithRowspan, true);

  const doc = editor.getDocument();
  const cell2 = doc.getElementById("cell-2");
  editor.select(cell2);

  // Delete row 2 (which is spanned by cell-1 from row 1)
  const deletedRow2 = editor.deleteTableRow();
  assert.equal(deletedRow2, true, "deleteTableRow should succeed on row covered by rowspan");

  const table = doc.getElementById("tbl");
  assert.equal(table.rows.length, 2, "Row count should be 2 after deleting row 2");
  const cell1 = doc.getElementById("cell-1");
  assert.equal(cell1.rowSpan, 1, "cell-1 rowSpan should be decremented to 1");

  // Now delete row 1 (starting cell with rowSpan)
  // Let's create a 2-row table where row 1 has rowspan=2
  const html2 = `
    <table id="tbl2">
      <tbody>
        <tr><td id="top-span" rowspan="2">Top Span</td><td id="top-b">Top B</td></tr>
        <tr><td id="bot-b">Bottom B</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(html2, true);
  const doc2 = editor.getDocument();
  const topSpan = doc2.getElementById("top-span");
  editor.select(topSpan);

  const deletedRow1 = editor.deleteTableRow();
  assert.equal(deletedRow1, true, "deleteTableRow should succeed on origin row of rowspan");
  const table2 = doc2.getElementById("tbl2");
  assert.equal(table2.rows.length, 1, "Table should now have 1 row");
  const remainingSpanCell = doc2.getElementById("top-span");
  assert.ok(remainingSpanCell, "top-span cell should have moved to the remaining row");
  assert.equal(remainingSpanCell.rowSpan, 1, "top-span cell rowSpan should become 1");
  assert.equal(table2.rows[0].cells.length, 2, "Remaining row should have 2 cells");
});

test("normal table row operations and undo function correctly", async () => {
  const { editor, recordedChanges } = setupEditorEnvironment();
  const normalTableHtml = `
    <table id="tbl">
      <tbody>
        <tr><td id="c1">R1C1</td><td>R1C2</td></tr>
        <tr><td id="c2">R2C1</td><td>R2C2</td></tr>
        <tr><td id="c3">R3C1</td><td>R3C2</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(normalTableHtml, true);

  const doc = editor.getDocument();
  const c2 = doc.getElementById("c2");
  editor.select(c2);

  const deleted = editor.deleteTableRow();
  assert.equal(deleted, true);

  const table = doc.getElementById("tbl");
  assert.equal(table.rows.length, 2);

  const lastChange = recordedChanges.at(-1);
  assert.equal(lastChange.type, "table-change");
  assert.equal(lastChange.deletedRowIndex, 1);
  assert.ok(lastChange.deletedRowHtml && lastChange.deletedRowHtml.includes("R2C1"));
  assert.match(lastChange.action, /行削除（2行目/);

  // Undo table change
  const undoResult = editor.applyChange(lastChange, "undo");
  assert.equal(undoResult, true);
  const restoredTable = doc.getElementById("tbl");
  assert.equal(restoredTable.rows.length, 3, "Table should restore to 3 rows after undo");
});

test("table column add and delete updates structure and records deletion details", async () => {
  const { editor, recordedChanges } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <tr><td id="cell">セル1</td></tr>
      <tr><td>セル2</td></tr>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const cell = doc.getElementById("cell");
  editor.select(cell);

  const colAdded = editor.addTableColumn();
  assert.equal(colAdded, true);
  const table = doc.getElementById("tbl");
  assert.equal(table.rows[0].cells.length, 2);
  assert.equal(table.rows[1].cells.length, 2);

  editor.select(cell);
  const colDeleted = editor.deleteTableColumn();
  assert.equal(colDeleted, true);
  assert.equal(table.rows[0].cells.length, 1);

  const deleteColChange = recordedChanges.at(-1);
  assert.equal(deleteColChange.type, "table-change");
  assert.equal(deleteColChange.deletedColIndex, 0);
  assert.deepEqual(deleteColChange.deletedColTexts, ["セル1", "セル2"]);
  assert.match(deleteColChange.action, /列削除（1列目/);
});

test("addTableColumn on table with merged cell auto-expands colspan and inherits styles", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <thead>
        <tr><th id="merged-header" colspan="2" style="background-color: rgb(255, 0, 0); font-weight: bold;" class="custom-header">大見出し</th></tr>
      </thead>
      <tbody>
        <tr>
          <td id="c1" style="background-color: rgb(240, 240, 240); padding: 10px;" class="data-cell">セル1</td>
          <td id="c2">セル2</td>
        </tr>
      </tbody>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const c1 = doc.getElementById("c1");
  editor.select(c1);

  // Add column to the right of c1 (inserting column inside the area spanned by the merged header)
  const success = editor.addTableColumn({ position: "after" });
  assert.equal(success, true);

  const header = doc.getElementById("merged-header");
  assert.equal(header.colSpan, 3, "Merged header should expand colspan from 2 to 3");

  const dataRow = doc.querySelector("tbody tr");
  assert.equal(dataRow.cells.length, 3, "Data row should now have 3 cells");

  const newCell = dataRow.cells[1];
  assert.equal(newCell.textContent, "セル");
  assert.ok(newCell.classList.contains("data-cell"), "New cell should inherit class from reference cell");
  assert.equal(newCell.style.backgroundColor, "rgb(240, 240, 240)", "New cell should inherit background color");
});

test("addTableRow supports inserting before and after with style inheritance", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <tbody>
        <tr id="r1"><td style="color: rgb(0, 128, 0);" class="green-cell">行1</td></tr>
        <tr id="r2"><td>行2</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const r1 = doc.getElementById("r1").cells[0];
  editor.select(r1);

  // Insert before
  const insertedBefore = editor.addTableRow({ position: "before" });
  assert.equal(insertedBefore, true);

  const table = doc.getElementById("tbl");
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0].cells[0].style.color, "rgb(0, 128, 0)", "Inserted row before should inherit styles");
  assert.ok(table.rows[0].cells[0].classList.contains("green-cell"));
});

test("moveTableRow moves row up and down correctly", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <tbody>
        <tr id="r1"><td>行1</td></tr>
        <tr id="r2"><td>行2</td></tr>
        <tr id="r3"><td>行3</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const r2Cell = doc.getElementById("r2").cells[0];
  editor.select(r2Cell);

  // Move r2 down
  const movedDown = editor.moveTableRow("down");
  assert.equal(movedDown, true);
  const rowsAfterDown = [...doc.getElementById("tbl").rows].map((r) => r.cells[0].textContent);
  assert.deepEqual(rowsAfterDown, ["行1", "行3", "行2"]);

  // Move back up
  const movedUp = editor.moveTableRow("up");
  assert.equal(movedUp, true);
  const rowsAfterUp = [...doc.getElementById("tbl").rows].map((r) => r.cells[0].textContent);
  assert.deepEqual(rowsAfterUp, ["行1", "行2", "行3"]);
});

test("toggleCellType, setCellAlign, and toggleFirstColumnHeader work correctly", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <tbody>
        <tr><td id="target-cell">データ</td><td>データ2</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const cell = doc.getElementById("target-cell");
  editor.select(cell);

  // Toggle td -> th
  assert.equal(editor.toggleCellType(), true);
  const thCell = doc.querySelector("th");
  assert.ok(thCell, "Cell should be converted to th");
  assert.equal(thCell.textContent, "データ");

  // Align center
  editor.select(thCell);
  assert.equal(editor.setCellAlign("center"), true);
  assert.equal(thCell.style.textAlign, "center");

  // Toggle first column header
  assert.equal(editor.toggleFirstColumnHeader(), true);
});

test("mergeCellRight, mergeCellDown, and splitCell work correctly", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <tbody>
        <tr><td id="c1">左</td><td id="c2">右</td></tr>
        <tr><td id="c3">下左</td><td id="c4">下右</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const c1 = doc.getElementById("c1");
  editor.select(c1);

  // Merge right
  assert.equal(editor.mergeCellRight(), true);
  const table = doc.getElementById("tbl");
  assert.equal(table.rows[0].cells.length, 1);
  assert.equal(table.rows[0].cells[0].colSpan, 2);
  assert.match(table.rows[0].cells[0].textContent, /左 右/);

  // Split cell
  editor.select(table.rows[0].cells[0]);
  assert.equal(editor.splitCell(), true);
  assert.equal(table.rows[0].cells.length, 2);
  assert.equal(table.rows[0].cells[0].colSpan, 1);
  assert.equal(table.rows[0].cells[1].colSpan, 1);
});

test("deleteTableColumn on table with merged cell shrinks colspan and removes cell", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `
    <table id="tbl">
      <thead>
        <tr><th id="hdr" colspan="3">3列マージ見出し</th></tr>
      </thead>
      <tbody>
        <tr><td id="c1">C1</td><td id="c2">C2</td><td id="c3">C3</td></tr>
      </tbody>
    </table>
  `;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const c2 = doc.getElementById("c2");
  editor.select(c2);

  // Delete column containing c2
  const deleted = editor.deleteTableColumn();
  assert.equal(deleted, true);

  const header = doc.getElementById("hdr");
  assert.equal(header.colSpan, 2, "Merged header colspan should shrink from 3 to 2");

  const dataRow = doc.querySelector("tbody tr");
  assert.equal(dataRow.cells.length, 2, "Data row should now have 2 cells");
  assert.deepEqual([...dataRow.cells].map((c) => c.textContent), ["C1", "C3"]);
});

test("duplicateSelected appends -copy suffix to prevent duplicate HTML ids", async () => {
  const { editor } = setupEditorEnvironment();
  const html = `<div id="card"><span id="title">Card Title</span></div>`;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const card = doc.getElementById("card");
  editor.select(card);

  const duplicated = editor.duplicateSelected();
  assert.equal(duplicated, true);

  const cards = doc.querySelectorAll("[id^='card']");
  assert.equal(cards.length, 2, "Should have 2 card elements");
  assert.equal(cards[0].id, "card");
  assert.equal(cards[1].id, "card-copy", "Duplicated element should have -copy id suffix");

  const titles = doc.querySelectorAll("[id^='title']");
  assert.equal(titles.length, 2);
  assert.equal(titles[0].id, "title");
  assert.equal(titles[1].id, "title-copy", "Nested elements with id should also have -copy suffix");
});

test("image-link-change preserves and restores original anchor attributes on undo", async () => {
  const { editor, recordedChanges } = setupEditorEnvironment();
  const html = `<p><a id="custom-link" class="btn primary" target="_blank" rel="noopener" href="https://example.com"><img id="pic" src="data:image/png;base64,iVBORw0KGgo=" alt="Icon"></a></p>`;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const pic = doc.getElementById("pic");
  editor.select(pic);

  // Update image link URL
  editor.updateImageLink("https://newsite.org");
  const link = doc.getElementById("custom-link");
  assert.equal(link.getAttribute("href"), "https://newsite.org");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("class"), "btn primary");

  // Remove link
  editor.updateImageLink("");
  assert.equal(doc.getElementById("custom-link"), null, "Link should be removed");

  // Undo removal
  const lastChange = recordedChanges.at(-1);
  assert.equal(lastChange.type, "image-link-change");
  editor.applyChange(lastChange, "undo");

  const restoredLink = doc.getElementById("pic").closest("a");
  assert.ok(restoredLink, "Anchor should be restored");
  assert.equal(restoredLink.getAttribute("href"), "https://newsite.org");
  assert.equal(restoredLink.getAttribute("target"), "_blank", "target attribute must be preserved on undo");
  assert.equal(restoredLink.getAttribute("class"), "btn primary", "class attribute must be preserved on undo");
});

test("table operations emit table-change with descriptive action string", async () => {
  const { editor, recordedChanges } = setupEditorEnvironment();
  const html = `<table><tbody><tr><td id="c1">A</td><td id="c2">B</td></tr><tr><td id="c3">C</td><td id="c4">D</td></tr></tbody></table>`;
  await editor.load(html, true);

  const doc = editor.getDocument();
  const c1 = doc.getElementById("c1");
  editor.select(c1);

  editor.addTableRow({ position: "after" });
  let change = recordedChanges.at(-1);
  assert.equal(change.type, "table-change");
  assert.equal(change.action, "行追加（下）");

  editor.select(doc.getElementById("c1"));
  editor.mergeCellRight();
  change = recordedChanges.at(-1);
  assert.equal(change.action, "セル結合（右）");
  assert.ok(change.cellId, "cellId should be captured on cell merge");
});


