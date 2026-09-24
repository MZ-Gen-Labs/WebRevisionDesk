import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { unzipSync } from "fflate";
import { createProjectPackages, createProjectPackagesAsync } from "../../src/project-package.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.DOMParser = dom.window.DOMParser;

test("createProjectPackages generates a valid zip blob containing selected files", async () => {
  const pageInput = {
    fileName: "test-page.html",
    originalHtml: "<html><body><p>Before</p></body></html>",
    modifiedHtml: "<html><body><p>After</p></body></html>",
    changes: [{ type: "text-change", target: "<p>", before: "Before", after: "After" }],
    sourceUrl: "https://example.com/test",
  };

  const blob = createProjectPackages({ pages: [pageInput] });
  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > 0);

  const arrayBuffer = await blob.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(arrayBuffer));

  assert.ok(unzipped["original.html"], "original.html should be in zip");
  assert.ok(unzipped["modified.html"], "modified.html should be in zip");
  assert.ok(unzipped["diff.html"], "diff.html should be in zip");
  assert.ok(unzipped["redline.html"], "redline.html should be in zip");
  assert.ok(unzipped["project.json"], "project.json should be in zip");
  assert.ok(unzipped["README.txt"], "README.txt should be in zip");
});

test("createProjectPackagesAsync generates a valid zip blob asynchronously", async () => {
  const pageInput = {
    fileName: "test-page-async.html",
    originalHtml: "<html><body><h1>Title</h1></body></html>",
    modifiedHtml: "<html><body><h1>Updated</h1></body></html>",
    changes: [],
    sourceUrl: "https://example.com/test-async",
  };

  const blob = await createProjectPackagesAsync({ pages: [pageInput] });
  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > 0);

  const arrayBuffer = await blob.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(arrayBuffer));
  assert.ok(unzipped["modified.html"]);
});

test("createProjectPackages handles multiple pages with subdirectories", async () => {
  const pages = [
    {
      fileName: "page1.html",
      path: "pages/page1",
      originalHtml: "<html><body>Page 1</body></html>",
      modifiedHtml: "<html><body>Page 1 Mod</body></html>",
      changes: [],
    },
    {
      fileName: "page2.html",
      path: "pages/page2",
      originalHtml: "<html><body>Page 2</body></html>",
      modifiedHtml: "<html><body>Page 2 Mod</body></html>",
      changes: [],
    },
  ];

  const blob = await createProjectPackagesAsync({ pages, files: ["original", "modified"], structureMode: "hierarchical" });
  const arrayBuffer = await blob.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(arrayBuffer));

  assert.ok(unzipped["pages/page1/original.html"]);
  assert.ok(unzipped["pages/page1/modified.html"]);
  assert.ok(unzipped["pages/page2/original.html"]);
  assert.ok(unzipped["pages/page2/modified.html"]);
  assert.equal(unzipped["pages/page1/diff.html"], undefined, "diff.html should be excluded when not selected");
});

test("createProjectPackages emits numbered flat page folders in input order with configured padding", async () => {
  const pages = [
    { fileName: "top.html", originalHtml: "<html>1</html>", modifiedHtml: "<html>1</html>", changes: [] },
    { fileName: "about-company.html", originalHtml: "<html>2</html>", modifiedHtml: "<html>2</html>", changes: [] },
  ];
  const blob = await createProjectPackagesAsync({ pages, files: ["modified"], structureMode: "flat", numberPadding: "3" });
  const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(unzipped["001_top/modified.html"]);
  assert.ok(unzipped["002_about-company/modified.html"]);
});

test("createProjectPackages uses two digit auto numbering through 99 pages", async () => {
  const pages = Array.from({ length: 3 }, (_, index) => ({
    fileName: `page-${index + 1}.html`, originalHtml: "<html></html>", modifiedHtml: "<html></html>", changes: [],
  }));
  const blob = await createProjectPackagesAsync({ pages, files: ["modified"], structureMode: "flat" });
  const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(unzipped["01_page-1/modified.html"]);
  assert.ok(unzipped["03_page-3/modified.html"]);
});
