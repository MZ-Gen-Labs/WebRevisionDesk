export const DEFAULT_CANVAS_ZOOM = 100;
export const MIN_CANVAS_ZOOM = 50;
export const MAX_CANVAS_ZOOM = 200;
export const CANVAS_ZOOM_STEP = 10;
export const SUPPORTED_CANVAS_ZOOM_STEPS = [1, 5, 10];
export const DEFAULT_CANVAS_ZOOM_STEP = 5;

export function normalizeCanvasZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CANVAS_ZOOM;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, Math.round(numeric)));
}

export function normalizeCanvasZoomStep(step) {
  const numeric = Number(step);
  return SUPPORTED_CANVAS_ZOOM_STEPS.includes(numeric) ? numeric : DEFAULT_CANVAS_ZOOM_STEP;
}

export function stepCanvasZoom(value, direction, step = DEFAULT_CANVAS_ZOOM_STEP) {
  const current = normalizeCanvasZoom(value);
  const dir = Math.sign(Number(direction) || 0);
  if (dir === 0) return current;
  const stepSize = normalizeCanvasZoomStep(step);
  const next = dir > 0
    ? (Math.floor(current / stepSize) + 1) * stepSize
    : (Math.ceil(current / stepSize) - 1) * stepSize;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, next));
}
