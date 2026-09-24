export const DEFAULT_CANVAS_ZOOM = 100;
export const MIN_CANVAS_ZOOM = 50;
export const MAX_CANVAS_ZOOM = 200;
export const CANVAS_ZOOM_STEP = 10;

export function normalizeCanvasZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CANVAS_ZOOM;
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, Math.round(numeric / 10) * 10));
}

export function stepCanvasZoom(value, direction) {
  const current = normalizeCanvasZoom(value);
  const step = Math.sign(Number(direction) || 0) * CANVAS_ZOOM_STEP;
  return normalizeCanvasZoom(current + step);
}
