import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  normalizeCanvasZoom,
  stepCanvasZoom,
} from "../../src/canvas-zoom.js";

test("canvas zoom normalizes to 10 percent increments and clamps its range", () => {
  assert.equal(normalizeCanvasZoom(83), 80);
  assert.equal(normalizeCanvasZoom(86), 90);
  assert.equal(normalizeCanvasZoom(12), MIN_CANVAS_ZOOM);
  assert.equal(normalizeCanvasZoom(250), MAX_CANVAS_ZOOM);
  assert.equal(normalizeCanvasZoom(Number.NaN), DEFAULT_CANVAS_ZOOM);
});

test("canvas zoom steps in either direction without exceeding its limits", () => {
  assert.equal(stepCanvasZoom(DEFAULT_CANVAS_ZOOM, 1), 110);
  assert.equal(stepCanvasZoom(DEFAULT_CANVAS_ZOOM, -1), 90);
  assert.equal(stepCanvasZoom(MAX_CANVAS_ZOOM, 1), MAX_CANVAS_ZOOM);
  assert.equal(stepCanvasZoom(MIN_CANVAS_ZOOM, -1), MIN_CANVAS_ZOOM);
});
