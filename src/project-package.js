import { strToU8, zip, zipSync } from "fflate";
import { createDiffReport, createRedlineReport } from "./diff-report.js";
import { cleanHtmlString } from "./html.js";

function baseName(fileName) {
  return (fileName || "page.html")
    .replace(/\.(html?)$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim() || "page";
}

function sourceUrlFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector('meta[name="web-revision-source-url"]')?.content ?? "";
}

const DEFAULT_FILES = ["original", "modified", "diff", "redline", "project", "readme"];

function createPageEntries({ fileName, originalHtml, modifiedHtml, changes = [], sourceUrl, path = "" }, selectedFiles) {
  const generatedAt = new Date().toISOString();
  const resolvedSourceUrl = sourceUrl || sourceUrlFromHtml(originalHtml);
  const project = {
    format: "web-revision-project",
    version: 1,
    pageFileName: fileName,
    sourceUrl: resolvedSourceUrl,
    generatedAt,
    changeCount: changes.length,
    changes,
  };
  const fileDescriptions = [
    ["original", "original.html  修正前ページ"],
    ["modified", "modified.html  修正後ページ"],
    ["diff", "diff.html      操作履歴と修正指示一覧"],
    ["redline", "redline.html   ページ上へ変更箇所を示した赤入れページ"],
    ["project", "project.json   案件情報と変更履歴（機械可読）"],
    ["readme", "README.txt     この内容説明"],
  ].filter(([key]) => selectedFiles.has(key)).map(([, description]) => description);
  const readme = [
    "Web Revision Desk 案件一式",
    "",
    `対象ファイル: ${fileName}`,
    `取得元URL: ${resolvedSourceUrl || "（ローカルHTML）"}`,
    `生成日時: ${generatedAt}`,
    `変更件数: ${changes.length}`,
    "",
    ...fileDescriptions,
  ].join("\n");

  const prefix = path ? `${path.replace(/^\/+|\/+$/g, "")}/` : "";
  const entries = {};
  if (selectedFiles.has("original")) entries[`${prefix}original.html`] = strToU8(originalHtml);
  if (selectedFiles.has("modified")) entries[`${prefix}modified.html`] = strToU8(cleanHtmlString(modifiedHtml));
  if (selectedFiles.has("diff")) entries[`${prefix}diff.html`] = strToU8(createDiffReport(fileName, changes));
  if (selectedFiles.has("redline")) entries[`${prefix}redline.html`] = strToU8(createRedlineReport(modifiedHtml, changes, fileName));
  if (selectedFiles.has("project")) entries[`${prefix}project.json`] = strToU8(JSON.stringify(project, null, 2));
  if (selectedFiles.has("readme")) entries[`${prefix}README.txt`] = strToU8(readme);
  return entries;
}

function collectEntries({ pages, files = DEFAULT_FILES, structureMode = "flat", numberPadding = "auto" }) {
  if (!pages?.length) throw new Error("保存するページがありません。");
  const selectedFiles = new Set(files);
  if (!selectedFiles.size) throw new Error("保存するファイルを1つ以上選択してください。");
  const multiple = pages.length > 1;
  const padding = numberPadding === "auto"
    ? (pages.length <= 99 ? 2 : 3)
    : Math.max(2, Math.min(4, Number(numberPadding) || 2));
  const entries = {};
  pages.forEach((page, index) => {
    let path = "";
    if (multiple && structureMode === "flat") {
      const folderName = baseName(page.fileName)
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
        .replace(/\.+$/g, "") || "page";
      path = `${String(index + 1).padStart(padding, "0")}_${folderName}`;
    } else if (multiple) {
      path = page.path || `pages/${baseName(page.fileName)}-${index + 1}`;
    }
    Object.assign(entries, createPageEntries({ ...page, path }, selectedFiles));
  });
  return entries;
}

export function createProjectPackages({ pages, files = DEFAULT_FILES, structureMode = "flat", numberPadding = "auto" }) {
  const entries = collectEntries({ pages, files, structureMode, numberPadding });
  return new Blob([zipSync(entries, { level: 6 })], { type: "application/zip" });
}

export function createProjectPackagesAsync({ pages, files = DEFAULT_FILES, structureMode = "flat", numberPadding = "auto" }) {
  return new Promise((resolve, reject) => {
    try {
      const entries = collectEntries({ pages, files, structureMode, numberPadding });
      zip(entries, { level: 6 }, (err, data) => {
        if (err) reject(err);
        else resolve(new Blob([data], { type: "application/zip" }));
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function createProjectPackage(input) {
  return createProjectPackages({ pages: [input], files: input.files });
}

export async function downloadProjectPackage(input) {
  const pages = input.pages || [input];
  const blob = await createProjectPackagesAsync({ pages, files: input.files });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = input.packageName
    ? `${baseName(input.packageName)}-revision-package.zip`
    : pages.length > 1
      ? "selected-pages-revision-package.zip"
      : `${baseName(pages[0].fileName)}-revision-package.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
