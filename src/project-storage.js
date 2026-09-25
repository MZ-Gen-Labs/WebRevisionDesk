import { cleanHtmlString } from "./html.js";
import { createDiffReport, createRedlineReport } from "./diff-report.js";
import {
  desktopFileSystemAvailable,
  listRecentDesktopProjectDirectories,
  openRecentDesktopProjectDirectory,
  removeRecentDesktopProjectDirectory,
  selectDesktopProjectDirectory,
} from "./desktop-file-system.js";

const PROJECT_FILE = "project.json";
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function safeSegment(value, fallback = "page") {
  let result = String(value || "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!result) result = fallback;
  if (RESERVED_NAMES.test(result)) result = `_${result}`;
  return [...result].slice(0, 80).join("");
}

function shortHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizePageUrl(value) {
  const url = new URL(value);
  url.hash = "";
  [...url.searchParams.keys()].forEach((key) => {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  });
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString();
}

export function pagePathForUrl(pageUrl, baseUrl) {
  const page = new URL(pageUrl);
  const base = new URL(baseUrl);
  const rawBasePath = base.pathname.replace(/\/+$/, "");
  const baseLastSegment = rawBasePath.split("/").filter(Boolean).at(-1) || "";
  const basePath = baseLastSegment.includes(".") ? rawBasePath.slice(0, rawBasePath.lastIndexOf("/")) : rawBasePath;
  const samePath = page.pathname.replace(/\/+$/, "") === rawBasePath;
  if (page.origin !== base.origin || !(samePath || page.pathname.startsWith(`${basePath}/`))) {
    throw new Error("基準URL配下のページではありません。");
  }
  const segments = page.pathname.split("/").filter(Boolean).map((part) => {
    try { return safeSegment(decodeURIComponent(part)); } catch { return safeSegment(part); }
  });
  if ((samePath && !baseLastSegment.includes(".")) || page.pathname.endsWith("/")) segments.push("index");
  if (page.search) segments[segments.length - 1] += `--query-${shortHash(page.search)}`;
  return ["pages", ...segments];
}

export function determineVariantSuffix(baseSegment, existingSegments = new Set()) {
  const cleanBase = String(baseSegment || "page").replace(/_[A-Z]+$/, "");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < letters.length; i++) {
    const candidate = `_${letters[i]}`;
    if (!existingSegments.has(`${cleanBase}${candidate}`)) {
      return { cleanBase, suffix: candidate };
    }
  }
  for (let i = 0; i < letters.length; i++) {
    for (let j = 0; j < letters.length; j++) {
      const candidate = `_${letters[i]}${letters[j]}`;
      if (!existingSegments.has(`${cleanBase}${candidate}`)) {
        return { cleanBase, suffix: candidate };
      }
    }
  }
  let counter = 1;
  while (true) {
    const candidate = `_copy${counter}`;
    if (!existingSegments.has(`${cleanBase}${candidate}`)) {
      return { cleanBase, suffix: candidate };
    }
    counter++;
  }
}


async function readTextFile(directory, name) {
  const handle = await directory.getFileHandle(name);
  return (await handle.getFile()).text();
}

async function writeTextFile(directory, name, content) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function ensureDirectory(root, segments) {
  let current = root;
  for (const segment of segments) current = await current.getDirectoryHandle(segment, { create: true });
  return current;
}

async function clearPageDirectory(root, segments) {
  if (segments[0] !== "pages" || segments.length < 2) throw new Error("削除対象のページフォルダが不正です。");
  let parent = root;
  for (const segment of segments.slice(0, -1)) parent = await parent.getDirectoryHandle(segment);
  const directory = await parent.getDirectoryHandle(segments.at(-1));
  const fileNames = [
    "original.html", "working.html", "modified.html", "diff.html", "redline.html",
    "latest-online.html", "page.json", "versions",
  ];
  for (const name of fileNames) {
    try { await directory.removeEntry(name, { recursive: name === "versions" }); } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
  }
  // 子ページのURLがこのフォルダ配下にある場合は、空でないため削除せず残す。
  try { await parent.removeEntry(segments.at(-1)); } catch (error) {
    if (error.name !== "InvalidModificationError") throw error;
  }
}

function documentTitle(html, fallback) {
  return new DOMParser().parseFromString(html, "text/html").title || fallback;
}

export class ProjectStore {
  constructor() {
    this.directory = null;
    this.project = null;
  }

  static isSupported() {
    return desktopFileSystemAvailable() || "showDirectoryPicker" in window;
  }

  async selectDirectory() {
    if (!ProjectStore.isSupported()) throw new Error("このブラウザはフォルダ保存に対応していません。ChromeまたはEdgeを使用してください。");
    const pickerOptions = { mode: "readwrite", id: "web-revision-project" };
    if (this.directory) pickerOptions.startIn = this.directory;
    const directory = desktopFileSystemAvailable()
      ? await selectDesktopProjectDirectory()
      : await window.showDirectoryPicker(pickerOptions);
    const permission = await directory.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("フォルダへの読み書きが許可されませんでした。");
    return this.useDirectory(directory);
  }

  async useDirectory(directory) {
    this.directory = directory;
    try {
      const saved = JSON.parse(await readTextFile(directory, PROJECT_FILE));
      if (saved.format !== "web-revision-folder-project") throw new Error("対応する案件フォルダではありません。");
      saved.pages ||= [];
      saved.discoveredPages ||= [];
      this.project = saved;
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
      const now = new Date().toISOString();
      this.project = {
        format: "web-revision-folder-project",
        version: 1,
        projectName: directory.name,
        baseUrl: "",
        createdAt: now,
        updatedAt: now,
        pages: [],
        discoveredPages: [],
      };
    }
    return this.project;
  }

  async listRecentDirectories() {
    return listRecentDesktopProjectDirectories();
  }

  async openRecentDirectory(projectPath) {
    if (!desktopFileSystemAvailable()) throw new Error("最近の案件はデスクトップ版で利用できます。");
    return this.useDirectory(await openRecentDesktopProjectDirectory(projectPath));
  }

  async removeRecentDirectory(projectPath) {
    return removeRecentDesktopProjectDirectory(projectPath);
  }

  setMetadata({ projectName, baseUrl }) {
    if (!this.project) throw new Error("先に案件フォルダを選択してください。");
    const normalizedBase = new URL(baseUrl).toString().replace(/\/$/, "");
    this.project.projectName = String(projectName || this.directory.name).trim() || this.directory.name;
    this.project.baseUrl = normalizedBase;
  }

  async saveProject() {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    this.project.updatedAt = new Date().toISOString();
    await writeTextFile(this.directory, PROJECT_FILE, JSON.stringify(this.project, null, 2));
  }

  async mergeDiscoveredPages(pages) {
    if (!this.project?.baseUrl) throw new Error("基準URLを入力してください。");
    const existing = new Map((this.project.discoveredPages || []).map((page) => [page.url, page]));
    const now = new Date().toISOString();
    for (const page of pages) {
      pagePathForUrl(page.url, this.project.baseUrl);
      existing.set(page.url, {
        ...existing.get(page.url),
        url: page.url,
        title: page.title || page.url,
        httpStatus: page.status || 0,
        discoveredAt: existing.get(page.url)?.discoveredAt || now,
        checkedAt: now,
      });
    }
    this.project.discoveredPages = [...existing.values()].sort((a, b) => a.url.localeCompare(b.url, "ja"));
    await this.saveProject();
    return this.project.discoveredPages;
  }

  async savePage({ pageId, fileName, sourceUrl, originalHtml, workingHtml, changes, resourceFailures = [] }) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    if (!this.project.baseUrl) throw new Error("基準URLを入力してください。");
    const normalizedUrl = normalizePageUrl(sourceUrl);
    const existing = pageId
      ? this.project.pages.find((page) => page.id === pageId)
      : this.project.pages.find((page) => page.url === normalizedUrl);
    const path = existing ? existing.path.split("/").filter(Boolean) : pagePathForUrl(normalizedUrl, this.project.baseUrl);
    const pageDirectory = await ensureDirectory(this.directory, path);
    const modifiedHtml = cleanHtmlString(workingHtml);
    const title = existing?.title || documentTitle(workingHtml, fileName);
    const now = new Date().toISOString();
    const resolvedFileName = existing?.fileName || fileName;
    const pageInfo = {
      id: existing?.id || pageId || `page-${shortHash(normalizedUrl)}`,
      url: normalizedUrl,
      title,
      fileName: resolvedFileName,
      path: path.join("/"),
      status: existing?.status || "editing",
      changeCount: changes.length,
      resourceFailures: Array.isArray(resourceFailures) ? resourceFailures.slice(0, 30) : [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      ...(existing?.variantOf ? { variantOf: existing.variantOf, variantSuffix: existing.variantSuffix } : {}),
    };
    const pageData = {
      format: "web-revision-page",
      version: 1,
      ...pageInfo,
      changes,
    };

    await writeTextFile(pageDirectory, "original.html", originalHtml);
    await writeTextFile(pageDirectory, "working.html", workingHtml);
    await writeTextFile(pageDirectory, "modified.html", modifiedHtml);
    await writeTextFile(pageDirectory, "diff.html", createDiffReport(resolvedFileName, changes));
    await writeTextFile(pageDirectory, "redline.html", createRedlineReport(workingHtml, changes, resolvedFileName));
    await writeTextFile(pageDirectory, "page.json", JSON.stringify(pageData, null, 2));

    if (existing) Object.assign(existing, pageInfo);
    else this.project.pages.push(pageInfo);
    this.project.pages.sort((a, b) => a.path.localeCompare(b.path, "ja"));
    this.project.updatedAt = now;
    await writeTextFile(this.directory, PROJECT_FILE, JSON.stringify(this.project, null, 2));
    return pageInfo;
  }

  async duplicatePage(pageId, editorOverrides = null) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const sourcePage = this.project.pages.find((entry) => entry.id === pageId);
    if (!sourcePage) throw new Error("複製元のページが見つかりません。");

    const sourceSegments = sourcePage.path.split("/").filter(Boolean);
    const parentSegments = sourceSegments.slice(0, -1);
    const lastSegment = sourceSegments.at(-1);

    const parentPathPrefix = parentSegments.join("/");
    const existingSiblings = new Set(
      this.project.pages
        .map((p) => p.path.split("/").filter(Boolean))
        .filter((segs) => segs.slice(0, -1).join("/") === parentPathPrefix)
        .map((segs) => segs.at(-1))
    );

    const { cleanBase, suffix } = determineVariantSuffix(lastSegment, existingSiblings);
    const newSegment = `${cleanBase}${suffix}`;
    const newPathSegments = [...parentSegments, newSegment];
    const newPath = newPathSegments.join("/");

    const extMatch = (sourcePage.fileName || "page.html").match(/(\.[^.]+)$/);
    const ext = extMatch ? extMatch[1] : ".html";
    const rawFileNameBase = (sourcePage.fileName || "page.html").slice(0, -(ext.length));
    const cleanFileNameBase = rawFileNameBase.replace(/_[A-Z]+$/, "");
    const newFileName = `${cleanFileNameBase}${suffix}${ext}`;

    const cleanTitle = (sourcePage.title || "ページ").replace(/\s*\(_[A-Z]+\)$/, "").trim();
    const newTitle = `${cleanTitle} (${suffix})`;

    let originalHtml, workingHtml, changes, resourceFailures;
    if (editorOverrides && (editorOverrides.pageId === pageId || editorOverrides.sourceUrl === sourcePage.url)) {
      originalHtml = editorOverrides.originalHtml;
      workingHtml = editorOverrides.workingHtml;
      changes = editorOverrides.changes || [];
      resourceFailures = editorOverrides.resourceFailures || sourcePage.resourceFailures || [];
    } else {
      const loaded = await this.loadPage(pageId);
      originalHtml = loaded.originalHtml;
      workingHtml = loaded.workingHtml;
      changes = loaded.changes;
      resourceFailures = loaded.page.resourceFailures || [];
    }

    const modifiedHtml = cleanHtmlString(workingHtml);
    const now = new Date().toISOString();
    const newPageId = `page-${shortHash(`${sourcePage.url}:${newPath}`)}`;

    const pageInfo = {
      id: newPageId,
      url: sourcePage.url,
      title: newTitle,
      fileName: newFileName,
      path: newPath,
      status: "editing",
      changeCount: changes.length,
      resourceFailures: Array.isArray(resourceFailures) ? resourceFailures.slice(0, 30) : [],
      createdAt: now,
      updatedAt: now,
      variantOf: sourcePage.id,
      variantSuffix: suffix,
    };

    const pageData = {
      format: "web-revision-page",
      version: 1,
      ...pageInfo,
      changes,
    };

    const targetDirectory = await ensureDirectory(this.directory, newPathSegments);
    await writeTextFile(targetDirectory, "original.html", originalHtml);
    await writeTextFile(targetDirectory, "working.html", workingHtml);
    await writeTextFile(targetDirectory, "modified.html", modifiedHtml);
    await writeTextFile(targetDirectory, "diff.html", createDiffReport(newFileName, changes));
    await writeTextFile(targetDirectory, "redline.html", createRedlineReport(workingHtml, changes, newFileName));
    await writeTextFile(targetDirectory, "page.json", JSON.stringify(pageData, null, 2));

    this.project.pages.push(pageInfo);
    this.project.pages.sort((a, b) => a.path.localeCompare(b.path, "ja"));
    this.project.updatedAt = now;
    await writeTextFile(this.directory, PROJECT_FILE, JSON.stringify(this.project, null, 2));

    return pageInfo;
  }


  async loadPage(pageId) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const page = this.project.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error("案件内のページが見つかりません。");
    const directory = await ensureDirectory(this.directory, page.path.split("/"));
    const [originalHtml, workingHtml, dataText] = await Promise.all([
      readTextFile(directory, "original.html"),
      readTextFile(directory, "working.html"),
      readTextFile(directory, "page.json"),
    ]);
    const data = JSON.parse(dataText);
    return { page: { ...page, resourceFailures: data.resourceFailures || page.resourceFailures || [] }, originalHtml, workingHtml, changes: data.changes || [] };
  }

  async regeneratePageReports(pageId) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const page = this.project.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error("案件内のページが見つかりません。");
    const directory = await ensureDirectory(this.directory, page.path.split("/"));
    const [workingHtml, dataText] = await Promise.all([
      readTextFile(directory, "working.html"),
      readTextFile(directory, "page.json"),
    ]);
    const data = JSON.parse(dataText);
    const fileName = data.fileName || page.fileName || "page.html";
    const changes = Array.isArray(data.changes) ? data.changes : [];
    await writeTextFile(directory, "diff.html", createDiffReport(fileName, changes));
    await writeTextFile(directory, "redline.html", createRedlineReport(workingHtml, changes, fileName));
    return { ...page, fileName, changeCount: changes.length };
  }

  async resetPageChanges(pageIds) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const ids = new Set(pageIds);
    const targets = this.project.pages.filter((page) => ids.has(page.id));
    const resetPages = [];
    for (const page of targets) {
      const saved = await this.loadPage(page.id);
      const reset = await this.savePage({
        fileName: page.fileName,
        sourceUrl: page.url,
        originalHtml: saved.originalHtml,
        workingHtml: saved.originalHtml,
        changes: [],
      });
      resetPages.push(reset);
    }
    return resetPages;
  }

  async resetPages(pageIds) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const ids = new Set(pageIds);
    const targets = this.project.pages.filter((page) => ids.has(page.id));
    if (!targets.length) return [];

    const resetPages = [];
    for (const page of targets) {
      try {
        await clearPageDirectory(this.directory, page.path.split("/").filter(Boolean));
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      resetPages.push(page);
    }

    const resetIds = new Set(resetPages.map((page) => page.id));
    const remainingPages = this.project.pages.filter((page) => !resetIds.has(page.id));
    const remainingUrls = new Set(remainingPages.map((page) => page.url));

    const discoveredByUrl = new Map((this.project.discoveredPages || []).map((page) => [page.url, page]));
    const now = new Date().toISOString();
    for (const page of resetPages) {
      if (page.variantOf || remainingUrls.has(page.url)) continue;
      if (!discoveredByUrl.has(page.url)) {
        discoveredByUrl.set(page.url, {
          url: page.url,
          title: page.title || page.url,
          httpStatus: 0,
          discoveredAt: now,
          checkedAt: now,
        });
      }
    }
    this.project.discoveredPages = [...discoveredByUrl.values()].sort((a, b) => a.url.localeCompare(b.url, "ja"));
    this.project.pages = remainingPages;
    await this.saveProject();
    return resetPages;
  }

  async deletePages(pageTargets, { force = false } = {}) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const targets = Array.isArray(pageTargets) ? pageTargets : [pageTargets];
    const targetIds = new Set();
    const targetUrls = new Set();

    for (const target of targets) {
      if (typeof target === "object" && target !== null) {
        if (target.id) targetIds.add(target.id);
        if (target.url) {
          try { targetUrls.add(normalizePageUrl(target.url)); } catch { targetUrls.add(String(target.url)); }
        }
      } else if (typeof target === "string") {
        if (target.startsWith("page-")) {
          targetIds.add(target);
        } else {
          try { targetUrls.add(normalizePageUrl(target)); } catch { targetUrls.add(String(target)); }
        }
      }
    }

    const matchesSaved = (page) => {
      if (targetIds.has(page.id)) return true;
      if (targetIds.size === 0 && targetUrls.has(normalizePageUrl(page.url))) return true;
      return false;
    };

    const savedTargets = this.project.pages
      .filter(matchesSaved)
      .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
    const cleanupErrors = [];

    for (const page of savedTargets) {
      try {
        await clearPageDirectory(this.directory, page.path.split("/").filter(Boolean));
      } catch (error) {
        if (error.name === "NotFoundError") continue;
        if (!force) throw error;
        cleanupErrors.push({ url: page.url, message: error.message || String(error) });
      }
    }

    const deletedIds = new Set(savedTargets.map((page) => page.id));
    this.project.pages = this.project.pages.filter((page) => !deletedIds.has(page.id));
    const remainingUrls = new Set(this.project.pages.map((page) => page.url));

    this.project.discoveredPages = (this.project.discoveredPages || []).filter((page) => {
      const normalized = normalizePageUrl(page.url);
      if (targetUrls.has(normalized) && !remainingUrls.has(page.url)) return false;
      return true;
    });

    await this.saveProject();
    return {
      deletedUrls: [...targetUrls],
      deletedIds: [...deletedIds],
      deletedSavedPages: savedTargets,
      cleanupErrors,
    };
  }


  async checkSource(pageId, currentHtml, comparison) {
    const page = this.project?.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error("案件内のページが見つかりません。");
    const directory = await ensureDirectory(this.directory, page.path.split("/"));
    await writeTextFile(directory, "latest-online.html", currentHtml);
    page.checkStatus = comparison.changed ? "changed" : "same";
    page.lastCheckedAt = new Date().toISOString();
    page.comparison = comparison;
    delete page.checkError;
    delete page.updateDecision;
    delete page.updateDecisionAt;
    await this.saveProject();
    return page;
  }

  async markCurrentVersionKept(pageId) {
    const page = this.project?.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error("案件内のページが見つかりません。");
    page.updateDecision = "kept";
    page.updateDecisionAt = new Date().toISOString();
    await this.saveProject();
  }

  async markCheckFailed(pageId, message) {
    const page = this.project?.pages.find((entry) => entry.id === pageId);
    if (!page) return;
    page.checkStatus = "error";
    page.checkError = String(message || "確認に失敗しました。");
    page.lastCheckedAt = new Date().toISOString();
    await this.saveProject();
  }

  async replaceWithLatest(pageId) {
    const page = this.project?.pages.find((entry) => entry.id === pageId);
    if (!page) throw new Error("案件内のページが見つかりません。");
    const directory = await ensureDirectory(this.directory, page.path.split("/"));
    const latestHtml = await readTextFile(directory, "latest-online.html");
    const versionName = new Date().toISOString().replace(/[:.]/g, "-");
    const versionDirectory = await ensureDirectory(directory, ["versions", versionName]);
    for (const name of ["original.html", "working.html", "modified.html", "diff.html", "redline.html", "page.json"]) {
      try { await writeTextFile(versionDirectory, name, await readTextFile(directory, name)); } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
    }
    const now = new Date().toISOString();
    const pageData = {
      format: "web-revision-page",
      version: 1,
      ...page,
      changeCount: 0,
      updatedAt: now,
      checkStatus: "same",
      lastCheckedAt: now,
      updateDecision: "replaced",
      updateDecisionAt: now,
      changes: [],
    };
    await writeTextFile(directory, "original.html", latestHtml);
    await writeTextFile(directory, "working.html", latestHtml);
    await writeTextFile(directory, "modified.html", cleanHtmlString(latestHtml));
    await writeTextFile(directory, "diff.html", createDiffReport(page.fileName, []));
    await writeTextFile(directory, "redline.html", createRedlineReport(latestHtml, [], page.fileName));
    await writeTextFile(directory, "page.json", JSON.stringify(pageData, null, 2));
    Object.assign(page, {
      changeCount: 0, updatedAt: now, checkStatus: "same", lastCheckedAt: now,
      updateDecision: "replaced", updateDecisionAt: now,
    });
    await this.saveProject();
    return this.loadPage(pageId);
  }
}
