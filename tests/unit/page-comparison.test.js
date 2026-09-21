import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { comparePageHtml } from "../../src/page-comparison.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;

test("comparePageHtml detects title changes", () => {
  const previousHtml = `<!doctype html><html><head><title>Original Title</title></head><body><p>Content</p></body></html>`;
  const currentHtml = `<!doctype html><html><head><title>New Title</title></head><body><p>Content</p></body></html>`;

  const comparison = comparePageHtml(previousHtml, currentHtml);
  assert.equal(comparison.changed, true, "Title change should be detected");
  assert.equal(comparison.fields.title, true);
  assert.ok(comparison.changedKinds.includes("title"));
});

test("comparePageHtml detects meta description changes", () => {
  const previousHtml = `<!doctype html><html><head><meta name="description" content="Old description"></head><body><p>Content</p></body></html>`;
  const currentHtml = `<!doctype html><html><head><meta name="description" content="Updated description"></head><body><p>Content</p></body></html>`;

  const comparison = comparePageHtml(previousHtml, currentHtml);
  assert.equal(comparison.changed, true, "Meta description change should be detected");
  assert.equal(comparison.fields.metaDescription, true);
  assert.ok(comparison.changedKinds.includes("metaDescription"));
});

test("comparePageHtml returns unchanged when content and meta match", () => {
  const html1 = `<!doctype html><html><head><title>Same</title><meta name="description" content="Desc"></head><body><p>Content</p></body></html>`;
  const html2 = `<!doctype html><html><head><title>Same</title><meta name="description" content="Desc"></head><body><p>Content</p></body></html>`;

  const comparison = comparePageHtml(html1, html2);
  assert.equal(comparison.changed, false);
  assert.equal(comparison.changedKinds.length, 0);
});

test("comparePageHtml detects body text, links, and structure changes", () => {
  const html1 = `<html><body><p>Hello</p><a href="/about">About</a></body></html>`;
  const html2 = `<html><body><p>World</p><a href="/contact">Contact</a></body></html>`;

  const comparison = comparePageHtml(html1, html2);
  assert.equal(comparison.changed, true);
  assert.equal(comparison.fields.text, true);
  assert.equal(comparison.fields.links, true);
});
