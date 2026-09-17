import { strToU8, zipSync } from "fflate";
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

export function createProjectPackage({ fileName, originalHtml, modifiedHtml, changes }) {
  const generatedAt = new Date().toISOString();
  const sourceUrl = sourceUrlFromHtml(originalHtml);
  const diffHtml = createDiffReport(fileName, changes);
  const redlineHtml = createRedlineReport(modifiedHtml, changes, fileName);
  const project = {
    format: "web-revision-project",
    version: 1,
    pageFileName: fileName,
    sourceUrl,
    generatedAt,
    changeCount: changes.length,
    changes,
  };
  const readme = [
    "Web Revision Editor 案件一式",
    "",
    `対象ファイル: ${fileName}`,
    `取得元URL: ${sourceUrl || "（ローカルHTML）"}`,
    `生成日時: ${generatedAt}`,
    `変更件数: ${changes.length}`,
    "",
    "original.html  修正前ページ",
    "modified.html  修正後ページ",
    "diff.html      操作履歴と修正指示一覧",
    "redline.html   ページ上へ変更箇所を示した赤入れページ",
    "project.json   案件情報と変更履歴（機械可読）",
  ].join("\n");

  return new Blob([zipSync({
    "original.html": strToU8(originalHtml),
    "modified.html": strToU8(cleanHtmlString(modifiedHtml)),
    "diff.html": strToU8(diffHtml),
    "redline.html": strToU8(redlineHtml),
    "project.json": strToU8(JSON.stringify(project, null, 2)),
    "README.txt": strToU8(readme),
  }, { level: 6 })], { type: "application/zip" });
}

export function downloadProjectPackage(input) {
  const blob = createProjectPackage(input);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName(input.fileName)}-revision-package.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
