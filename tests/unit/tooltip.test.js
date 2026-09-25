import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { initTooltips, positionTooltip } from "../../src/tooltip.js";

test("initTooltips converts title attributes to data-tooltip and manages app-tooltip element", () => {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <button id="btn1" disabled title="無効なボタンのヒント">ボタン1</button>
        <button id="btn2" title="有効なボタンのヒント">ボタン2</button>
      </body>
    </html>
  `);

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;

  initTooltips(dom.window.document);

  const btn1 = dom.window.document.querySelector("#btn1");
  const btn2 = dom.window.document.querySelector("#btn2");
  const tooltipEl = dom.window.document.querySelector("#app-tooltip");

  assert.ok(tooltipEl, "#app-tooltip element should be created in DOM");
  assert.equal(tooltipEl.getAttribute("role"), "tooltip");
  assert.equal(tooltipEl.hidden, true);

  // title 属性が data-tooltip に移動し、標準の遅延ツールチップを抑制していること
  assert.equal(btn1.getAttribute("title"), null);
  assert.equal(btn1.dataset.tooltip, "無効なボタンのヒント");
  assert.equal(btn2.getAttribute("title"), null);
  assert.equal(btn2.dataset.tooltip, "有効なボタンのヒント");
});

test("positionTooltip prefers top placement when there is enough space above", () => {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <button id="sidebar-btn" style="position: absolute; top: 200px; left: 50px; width: 60px; height: 30px;">取得</button>
        <div id="app-tooltip" class="app-tooltip" role="tooltip">選択したページのHTMLを取得</div>
      </body>
    </html>
  `);

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  dom.window.innerHeight = 900;
  dom.window.innerWidth = 1400;

  const btn = dom.window.document.querySelector("#sidebar-btn");
  const tooltip = dom.window.document.querySelector("#app-tooltip");

  btn.getBoundingClientRect = () => ({
    top: 200, bottom: 230, left: 50, right: 110, width: 60, height: 30,
  });
  tooltip.getBoundingClientRect = () => ({
    top: 0, bottom: 36, left: 0, right: 220, width: 220, height: 36,
  });

  positionTooltip(btn, 80, 215);

  assert.equal(tooltip.dataset.placement, "top");
  const top = parseFloat(tooltip.style.top);
  // 上部に配置され、ボタンより完全に上（200 - 36 - 8 = 156）であること
  assert.equal(top, 156);
  assert.ok(top + 36 <= 200, "Tooltip must be completely above the target button");
});

test("positionTooltip places on left or right side when top space is constrained (e.g. topbar)", () => {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <button id="topbar-right-btn">更新確認</button>
        <div id="app-tooltip" class="app-tooltip" role="tooltip">最新バージョンの有無を確認</div>
      </body>
    </html>
  `);

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  dom.window.innerHeight = 900;
  dom.window.innerWidth = 1400;

  const btn = dom.window.document.querySelector("#topbar-right-btn");
  const tooltip = dom.window.document.querySelector("#app-tooltip");

  // 右側のボタン（左側に余白が多い場合）
  btn.getBoundingClientRect = () => ({
    top: 15, bottom: 47, left: 1200, right: 1280, width: 80, height: 32,
  });
  tooltip.getBoundingClientRect = () => ({
    top: 0, bottom: 30, left: 0, right: 180, width: 180, height: 30,
  });

  positionTooltip(btn, 1240, 31);

  // 上に余白がなく右側も狭いため、左側に配置されること
  assert.equal(tooltip.dataset.placement, "left");
  const left = parseFloat(tooltip.style.left);
  // ツールチップの右端（left + width）がボタンの左端（1200）より前にあること（カーソルと絶対に重ならない）
  assert.ok(left + 180 <= 1200, "Tooltip must be placed to the left of the button");

  // 左側のボタン（右側に余白が多い場合）
  btn.getBoundingClientRect = () => ({
    top: 15, bottom: 47, left: 200, right: 280, width: 80, height: 32,
  });
  positionTooltip(btn, 240, 31);

  // 上に余白がなく左側より右側の方が広いため、右側に配置されること
  assert.equal(tooltip.dataset.placement, "right");
  const rightLeft = parseFloat(tooltip.style.left);
  // ツールチップの左端（rightLeft）がボタンの右端（280）より右にあること
  assert.ok(rightLeft >= 280, "Tooltip must be placed to the right of the button");
});
