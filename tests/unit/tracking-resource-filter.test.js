import assert from "node:assert/strict";
import test from "node:test";
import { isTrackingResourceUrl } from "../../src/tracking-resource-filter.js";

test("tracking and analytics resources are excluded from offline capture warnings", () => {
  assert.equal(isTrackingResourceUrl("https://www.googletagmanager.com/a?id=GTM-123"), true);
  assert.equal(isTrackingResourceUrl("https://ssl.google-analytics.com/g/collect?v=2"), true);
  assert.equal(isTrackingResourceUrl("https://analytics.google.com/collect"), true);
  assert.equal(isTrackingResourceUrl("https://stats.g.doubleclick.net/j/collect"), true);
});

test("display assets stay eligible for offline capture", () => {
  assert.equal(isTrackingResourceUrl("https://cdn.example.com/assets/hero.webp"), false);
  assert.equal(isTrackingResourceUrl("not a url"), false);
});
