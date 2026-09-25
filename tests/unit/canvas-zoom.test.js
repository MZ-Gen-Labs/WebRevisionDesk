import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CANVAS_ZOOM,
  DEFAULT_CANVAS_ZOOM_STEP,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  SUPPORTED_CANVAS_ZOOM_STEPS,
  normalizeCanvasZoom,
  normalizeCanvasZoomStep,
  stepCanvasZoom,
} from "../../src/canvas-zoom.js";

test("canvas zoom normalizes to integer percentages and clamps its range", () => {
  assert.equal(normalizeCanvasZoom(83.4), 83);
  assert.equal(normalizeCanvasZoom(86.7), 87);
  assert.equal(normalizeCanvasZoom(12), MIN_CANVAS_ZOOM);
  assert.equal(normalizeCanvasZoom(250), MAX_CANVAS_ZOOM);
  assert.equal(normalizeCanvasZoom(Number.NaN), DEFAULT_CANVAS_ZOOM);
});

test("canvas zoom step normalizes to supported values and falls back to default", () => {
  assert.equal(normalizeCanvasZoomStep(1), 1);
  assert.equal(normalizeCanvasZoomStep(5), 5);
  assert.equal(normalizeCanvasZoomStep(10), 10);
  assert.equal(normalizeCanvasZoomStep(3), DEFAULT_CANVAS_ZOOM_STEP);
  assert.equal(normalizeCanvasZoomStep("5"), 5);
  assert.equal(normalizeCanvasZoomStep(Number.NaN), DEFAULT_CANVAS_ZOOM_STEP);
  assert.deepEqual(SUPPORTED_CANVAS_ZOOM_STEPS, [1, 5, 10]);
});

test("canvas zoom steps with default 5% step and snaps to boundaries", () => {
  assert.equal(stepCanvasZoom(DEFAULT_CANVAS_ZOOM, 1), 105);
  assert.equal(stepCanvasZoom(DEFAULT_CANVAS_ZOOM, -1), 95);
  assert.equal(stepCanvasZoom(MAX_CANVAS_ZOOM, 1), MAX_CANVAS_ZOOM);
  assert.equal(stepCanvasZoom(MIN_CANVAS_ZOOM, -1), MIN_CANVAS_ZOOM);
  assert.equal(stepCanvasZoom(100, 0), 100);
});

test("canvas zoom steps with 1%, 5%, and 10% steps and snaps irregular values", () => {
  // 1% step
  assert.equal(stepCanvasZoom(100, 1, 1), 101);
  assert.equal(stepCanvasZoom(100, -1, 1), 99);
  assert.equal(stepCanvasZoom(103, 1, 1), 104);

  // 5% step snaps
  assert.equal(stepCanvasZoom(103, 1, 5), 105);
  assert.equal(stepCanvasZoom(103, -1, 5), 100);
  assert.equal(stepCanvasZoom(105, 1, 5), 110);
  assert.equal(stepCanvasZoom(105, -1, 5), 100);

  // 10% step snaps
  assert.equal(stepCanvasZoom(100, 1, 10), 110);
  assert.equal(stepCanvasZoom(100, -1, 10), 90);
  assert.equal(stepCanvasZoom(103, 1, 10), 110);
  assert.equal(stepCanvasZoom(103, -1, 10), 100);
});

test("index.html contains zoom step controls with 1%, 5%, and 10% options", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const html = await readFile(path.join(root, "index.html"), "utf8");

  assert.match(html, /class="canvas-zoom-step-group"/);
  assert.match(html, /data-step="1"/);
  assert.match(html, /data-step="5"/);
  assert.match(html, /data-step="10"/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /role="radio"/);
});
