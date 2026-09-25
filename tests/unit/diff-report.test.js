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

test("diff report identifies the target cell for table operations", () => {
  const report = createDiffReport("test.html", [{
    type: "table-change", target: "table", action: "セル分割",
    targetRowIndex: 2, targetColIndex: 4, targetCellText: "SPAN_H_R02_C04-05",
  }]);
  assert.match(report, /操作対象: 3行目・5列目（SPAN_H_R02_C04-05）/);
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
  const parsed = new JSDOM(redlineHtml).window.document;
  const paragraph = parsed.querySelector("p");
  assert.match(redlineHtml, /href="https:\/\/example\.com"/, "Links and other child elements must not be stripped");
  assert.match(redlineHtml, /wr-redline-text/, "Redline highlight class must be added");
  assert.equal(paragraph.querySelector("a").textContent, "リンクテキスト");
  assert.equal(paragraph.querySelector("ins").textContent, " 後文", "Inserted text should be highlighted in place");
  assert.equal(parsed.querySelector(".wr-redline-text-diff-box"), null, "A separate diff box is unnecessary when inline mapping succeeds");
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

test("redline report lists a deleted row without changing the final table", () => {
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
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  assert.equal(parsed.querySelector("table").rows.length, 1, "Final table must remain unchanged");
  const panel = parsed.querySelector(".wr-table-deletions");
  assert.match(panel.textContent, /2行目を削除/);
  assert.match(panel.textContent, /削除されたデータ/);
});

test("redline report lists a deleted column without changing the final table", () => {
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
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  assert.equal([...parsed.querySelectorAll("table tr")].every((row) => row.cells.length === 1), true);
  const panel = parsed.querySelector(".wr-table-deletions");
  assert.match(panel.textContent, /1列目を削除/);
  assert.match(panel.textContent, /削除見出し/);
  assert.match(panel.textContent, /削除セルデータ/);
});

test("redline report preserves the final merged-cell structure when a column was deleted", () => {
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
  assert.equal(headerThs[0].colSpan, 1, "Final colSpan must not be rewritten");

  // データ行の確認
  const bodyTds = table.querySelectorAll("tbody td");
  assert.equal(bodyTds.length, 2, "Deleted cells must not be inserted into the final table");
  assert.deepEqual([...bodyTds].map((cell) => cell.id), ["c2", "c3"]);
  assert.match(parsedDom.window.document.querySelector(".wr-table-deletions").textContent, /1-1/);

  // 残ったセルに誤ってセルバッジが付いていないことを確認
  assert.equal(table.querySelectorAll("[data-wr-label*='セル: 列削除']").length, 0, "Non-deleted cells should not have cell deletion label");
});

test("redline report aggregates row and column deletion summaries without changing table rows", () => {
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

  assert.equal(table.rows.length, 3);
  assert.equal([...table.rows].every((row) => row.cells.length === 1), true);
  const panel = parsedDom.window.document.querySelector(".wr-table-deletions");
  assert.equal(panel.querySelectorAll("article").length, 2);
  assert.match(panel.textContent, /削除された行データ/);
  const columnSummary = panel.querySelectorAll("article")[1];
  assert.equal(columnSummary.querySelectorAll("li").length, 2);
  assert.match(columnSummary.textContent, /ほか1件/);
  assert.doesNotMatch(columnSummary.textContent, /最下行データ2-1/);
});

test("redline report limits deleted row contents to two non-empty cells", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><table data-web-revision-id="table"><tbody><tr><td>残存</td></tr></tbody></table></body></html>`;
  const change = {
    type: "table-change",
    elementId: "table",
    deletedRowIndex: 0,
    deletedRowHtml: "<tr><td>第一</td><td></td><td>第二</td><td>第三</td><td>第四</td></tr>",
  };
  const parsed = new JSDOM(createRedlineReport(html, [change], "test.html")).window.document;
  const summary = parsed.querySelector(".wr-table-deletions article");
  assert.deepEqual([...summary.querySelectorAll("li")].map((item) => item.textContent), ["第一", "第二"]);
  assert.match(summary.textContent, /ほか2件/);
  assert.doesNotMatch(summary.textContent, /第三|第四/);
});

test("redline report highlights all cells in added column across all rows", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body>
    <table data-web-revision-id="tbl-add-col">
      <thead>
        <tr><th>見出し1</th><th data-web-revision-id="new-h">新見出し</th></tr>
      </thead>
      <tbody>
        <tr><td>データ1</td><td data-web-revision-id="new-c1">新セル1</td></tr>
        <tr><td>データ2</td><td data-web-revision-id="new-c2">新セル2</td></tr>
      </tbody>
    </table>
  </body></html>`;

  const changes = [{
    type: "table-change",
    elementId: "tbl-add-col",
    action: "列追加（右）（2列目）",
    addedColIndex: 1,
    addedCellIds: ["new-h", "new-c1", "new-c2"],
    cellId: null,
    before: "<table>...</table>",
    after: "<table>...</table>",
  }];

  const redlineHtml = createRedlineReport(html, changes, "test.html");
  const parsedDom = new JSDOM(redlineHtml);
  const table = parsedDom.window.document.querySelector("table");

  const addedCells = table.querySelectorAll(".wr-redline-added-cell");
  assert.equal(addedCells.length, 3, "All 3 cells in the added column should have added cell class");
  assert.match(table.querySelector("thead th:last-child").textContent, /追加列（2列目）/, "Header should display badge");
});

test("redline report applies inline text diffs inside table-cell child elements", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><table><tbody><tr><td data-web-revision-id="cell"><a href="/old">新</a></td></tr></tbody></table></body></html>`;
  const report = createRedlineReport(html, [{ type: "text-change", elementId: "cell", before: "旧", after: "新" }], "test.html");
  const parsed = new JSDOM(report).window.document;
  const row = parsed.querySelector("tr");
  assert.equal([...row.children].every((child) => child.tagName === "TD" || child.tagName === "TH"), true);
  assert.equal(row.querySelector("a del").textContent, "旧");
  assert.equal(row.querySelector("a ins").textContent, "新");
  assert.equal(row.querySelector(".wr-redline-text-diff-box"), null);
});

test("redline report highlights repeated replacements across preserved line breaks", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  const html = `<html><body><p data-web-revision-id="text">Designcenter、<br>Designcenter Solid Edge</p></body></html>`;
  const report = createRedlineReport(html, [{
    type: "text-change",
    elementId: "text",
    before: "NX、Solid Edge",
    after: "Designcenter、Designcenter Solid Edge",
  }], "test.html");
  const parsed = new JSDOM(report).window.document;
  const paragraph = parsed.querySelector("p");
  assert.equal(paragraph.querySelectorAll("ins").length, 2);
  assert.deepEqual([...paragraph.querySelectorAll("ins")].map((marker) => marker.textContent), ["Designcenter", "Designcenter "]);
  assert.equal(paragraph.querySelector("del").textContent, "NX");
  assert.ok(paragraph.querySelector("br"), "Line breaks must be preserved");
});

test("redline report summarizes repeated table operations in a compact badge", () => {
  const html = `<html><body><table data-web-revision-id="table"><tr><td>A</td></tr></table></body></html>`;
  const changes = [
    { type: "table-change", elementId: "table", action: "行追加（下）（2行目）" },
    { type: "table-change", elementId: "table", action: "列追加（右）（2列目）" },
    { type: "table-change", elementId: "table", action: "行追加（下）（3行目）" },
    { type: "table-change", elementId: "table", action: "セル結合（右）" },
  ];
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  const badge = parsed.querySelector(".wr-table-redline-label");
  assert.equal(badge.textContent, "表の構成変更（行追加2件、列追加1件、セル結合1件）");
  assert.ok(badge.textContent.length < 40);
});

test("redline report describes images in deleted table cells", () => {
  const html = `<html><body><table data-web-revision-id="table"><tr><td>A</td></tr></table></body></html>`;
  const changes = [{
    type: "table-change", elementId: "table", action: "列削除（1列目）", deletedColIndex: 0,
    deletedCellsInfo: [{ action: "deleted", cellHtml: `<td><img src="banner.png" alt="キャンペーンバナー"></td>`, text: "" }],
  }];
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  assert.match(parsed.querySelector(".wr-table-deletions").textContent, /画像: キャンペーンバナー/);
});

test("redline report disables active content restored for deleted elements", () => {
  const html = `<html><body><main data-web-revision-id="parent"></main></body></html>`;
  const changes = [{
    type: "element-delete", elementId: "deleted", parentId: "parent", index: 0,
    before: `<section data-web-revision-id="deleted" onclick="alert(1)"><script>alert(2)</script><img src="x" onerror="alert(3)"><a href="javascript:alert(4)">link</a></section>`,
  }];
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  const restored = parsed.querySelector(".wr-redline-delete");
  assert.ok(restored);
  assert.equal(restored.querySelector("script"), null);
  assert.equal(restored.hasAttribute("onclick"), false);
  assert.equal(restored.querySelector("img").hasAttribute("onerror"), false);
  assert.equal(restored.querySelector("a").hasAttribute("href"), false);
});

test("redline report omits a text change that was manually restored", () => {
  const html = `<html><body><p data-web-revision-id="text">元の文章</p></body></html>`;
  const changes = [
    { type: "text-change", elementId: "text", before: "元の文章", after: "途中の文章" },
    { type: "text-change", elementId: "text", before: "途中の文章", after: "元の文章" },
  ];
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  assert.equal(parsed.querySelector(".wr-redline-text"), null);
  assert.equal(parsed.querySelector("ins, del"), null);
});

test("redline report restores successive deleted siblings in their original order", () => {
  const html = `<html><body><main data-web-revision-id="parent"><p>A</p><p>D</p></main></body></html>`;
  const changes = [
    { type: "element-delete", elementId: "b", parentId: "parent", index: 1, before: `<p data-web-revision-id="b">B</p>` },
    { type: "element-delete", elementId: "c", parentId: "parent", index: 1, before: `<p data-web-revision-id="c">C</p>` },
  ];
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;
  assert.deepEqual([...parsed.querySelector("main").children].map((element) => element.textContent.trim()), ["A", "削除B", "削除C", "D"]);
});

test("redline additions keep list and definition-list child structure valid", () => {
  const html = `<html><body><main>
    <ul data-web-revision-id="ul"><li>item</li></ul>
    <ol data-web-revision-id="ol"><li>item</li></ol>
    <dl data-web-revision-id="dl"><dt>term</dt><dd>definition</dd></dl>
  </main></body></html>`;
  const changes = ["ul", "ol", "dl"].map((elementId) => ({ type: "element-add", elementId }));
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;

  assert.deepEqual([...parsed.querySelector("ul").children].map((child) => child.tagName), ["LI"]);
  assert.deepEqual([...parsed.querySelector("ol").children].map((child) => child.tagName), ["LI"]);
  assert.deepEqual([...parsed.querySelector("dl").children].map((child) => child.tagName), ["DT", "DT", "DD"]);
  assert.deepEqual([...parsed.querySelector("dl").children].filter((child) => !child.hasAttribute("aria-hidden")).map((child) => child.tagName), ["DT", "DD"]);
  for (const [index, id] of ["ul", "ol"].entries()) {
    const target = [...parsed.querySelectorAll("ul, ol, dl")][index];
    const badge = [...parsed.querySelectorAll(".wr-redline-label-sibling")]
      .find((label) => label.getAttribute("data-wr-label-for") === id);
    assert.ok(target);
    assert.ok(badge);
    assert.equal(badge.nextElementSibling, parsed.querySelector(id));
    assert.match(badge.textContent, /追加/);
  }
  const definitionList = parsed.querySelector("dl");
  assert.equal(definitionList.getAttribute("data-wr-label"), "追加");
  const badge = definitionList.querySelector(":scope > dt.wr-redline-label-inside");
  assert.equal(badge.getAttribute("aria-hidden"), "true");
  assert.equal(badge.textContent, "追加");
  assert.match(parsed.querySelector("style").textContent, /\.wr-redline-label-inside\{/);
});

test("redline additions label void elements as siblings without inserting children", () => {
  const html = `<html><body><main>
    <input data-web-revision-id="input" value="x"><br data-web-revision-id="br"><hr data-web-revision-id="hr">
  </main></body></html>`;
  const changes = ["input", "br", "hr"].map((elementId) => ({ type: "element-add", elementId }));
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;

  for (const id of ["input", "br", "hr"]) {
    const target = parsed.querySelector(id);
    assert.equal(target.childElementCount, 0);
    assert.equal(target.previousElementSibling?.getAttribute("data-wr-label-for"), id);
    assert.match(target.previousElementSibling.textContent, /追加/);
  }
});

test("redline additions keep picture and select child models intact", () => {
  const html = `<html><body><main>
    <picture><source data-web-revision-id="source" srcset="photo.webp"><img data-web-revision-id="photo" src="photo.png"></picture>
    <select><option data-web-revision-id="option">Choice</option></select>
  </main></body></html>`;
  const changes = [
    { type: "element-add", elementId: "option" },
    { type: "element-add", elementId: "source" },
    { type: "element-add", elementId: "photo" },
  ];
  const parsed = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document;

  assert.deepEqual([...parsed.querySelector("picture").children].map((child) => child.tagName), ["SOURCE", "IMG"]);
  assert.deepEqual([...parsed.querySelector("select").children].map((child) => child.tagName), ["OPTION"]);
  assert.equal(parsed.querySelector("picture").previousElementSibling?.classList.contains("wr-redline-label-sibling"), true);
  assert.equal(parsed.querySelector("select").previousElementSibling?.getAttribute("data-wr-label-for"), "option");
  assert.equal(parsed.querySelector("main .wr-image-marker")?.parentElement, parsed.querySelector("main"));
});

test("redline deletion keeps an image inside picture without adding an invalid wrapper", () => {
  const html = `<html><body><main><picture data-web-revision-id="parent"></picture></main></body></html>`;
  const parsed = new JSDOM(createRedlineReport(html, [{
    type: "element-delete", elementId: "photo", parentId: "parent", index: 0,
    before: `<img src="removed.png" alt="removed">`,
  }], "test.html")).window.document;

  assert.deepEqual([...parsed.querySelector("picture").children].map((child) => child.tagName), ["IMG"]);
  assert.match(parsed.querySelector("main .wr-image-marker")?.textContent, /削除/);
});

test("redline deletions restore lists and void elements with sibling labels", () => {
  const html = `<html><body><main data-web-revision-id="parent"><p>remaining</p></main></body></html>`;
  const deleted = [
    ["list", `<ul><li>removed list item</li></ul>`],
    ["input", `<input value="removed">`],
    ["br", `<br>`],
    ["hr", `<hr>`],
  ];

  for (const [id, before] of deleted) {
    const parsed = new JSDOM(createRedlineReport(html, [{
      type: "element-delete", elementId: id, parentId: "parent", index: 0, before,
    }], "test.html")).window.document;
    const parent = parsed.querySelector("main");
    const target = parent.querySelector("ul, input, br, hr");
    assert.ok(target, `${id} should be restored`);
    const siblingLabel = [...parent.children].find((child) => child.classList.contains("wr-redline-label-sibling"));
    assert.ok(siblingLabel, `${id} should have a sibling label`);
    assert.equal(siblingLabel.nextElementSibling, target, `${id} label should appear directly before its target`);
    assert.match(siblingLabel.textContent, /削除/);
    if (target.tagName === "UL") assert.deepEqual([...target.children].map((child) => child.tagName), ["LI"]);
    else assert.equal(target.childElementCount, 0);
  }
});

test("redline report includes both text and images from deleted table cells", () => {
  const html = `<html><body><table data-web-revision-id="table"><tr><td>A</td></tr></table></body></html>`;
  const changes = [{
    type: "table-change", elementId: "table", action: "行削除（1行目）", deletedRowIndex: 0,
    deletedRowHtml: `<tr><td>説明<img src="icon.png" alt="アイコン"></td></tr>`,
  }];
  const text = new JSDOM(createRedlineReport(html, changes, "test.html")).window.document
    .querySelector(".wr-table-deletions").textContent;
  assert.match(text, /説明/);
  assert.match(text, /画像: アイコン/);
});

test("redline report lists successive row deletions without restoring them", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  // Final HTML after deleting original row 5, then original row 2.
  const html = `<html><body><table data-web-revision-id="table"><tbody><tr><td>0</td></tr><tr><td>1</td></tr><tr><td>3</td></tr><tr><td>4</td></tr></tbody></table></body></html>`;
  const changes = [
    { type: "table-change", elementId: "table", deletedRowIndex: 5, deletedRowHtml: "<tr><td>5</td></tr>" },
    { type: "table-change", elementId: "table", deletedRowIndex: 2, deletedRowHtml: "<tr><td>2</td></tr>" },
  ];
  const report = createRedlineReport(html, changes, "test.html");
  const parsed = new JSDOM(report).window.document;
  const rows = [...parsed.querySelector("table").rows];
  assert.deepEqual(rows.map((row) => row.textContent.trim()), ["0", "1", "3", "4"]);
  const articles = [...parsed.querySelectorAll(".wr-table-deletions article")];
  assert.equal(articles.length, 2);
  assert.match(articles[0].textContent, /6行目を削除.*5/s);
  assert.match(articles[1].textContent, /3行目を削除.*2/s);
});

test("redline report lists successive column deletions without restoring them", () => {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.CSS = dom.window.CSS || { escape: (s) => s };

  // Original: A B C D E. Delete B, then (in the shortened table) delete D.
  const html = `<html><body><table data-web-revision-id="table"><tbody><tr data-web-revision-id="row"><td>A</td><td>C</td><td>E</td></tr></tbody></table></body></html>`;
  const changes = [
    { type: "table-change", elementId: "table", deletedColIndex: 1, deletedCellsInfo: [{ rowId: "row", action: "deleted", cellHtml: "<td>B</td>" }] },
    { type: "table-change", elementId: "table", deletedColIndex: 2, deletedCellsInfo: [{ rowId: "row", action: "deleted", cellHtml: "<td>D</td>" }] },
  ];
  const report = createRedlineReport(html, changes, "test.html");
  const parsed = new JSDOM(report).window.document;
  const cells = [...parsed.querySelector("tr").cells];
  assert.deepEqual(cells.map((cell) => cell.textContent.trim()), ["A", "C", "E"]);
  const articles = [...parsed.querySelectorAll(".wr-table-deletions article")];
  assert.equal(articles.length, 2);
  assert.match(articles[0].textContent, /2列目を削除.*B/s);
  assert.match(articles[1].textContent, /3列目を削除.*D/s);
});
