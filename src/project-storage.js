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

  async savePage({ fileName, sourceUrl, originalHtml, workingHtml, changes }) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    if (!this.project.baseUrl) throw new Error("基準URLを入力してください。");
    const normalizedUrl = normalizePageUrl(sourceUrl);
    const path = pagePathForUrl(normalizedUrl, this.project.baseUrl);
    const pageDirectory = await ensureDirectory(this.directory, path);
    const modifiedHtml = cleanHtmlString(workingHtml);
    const title = documentTitle(workingHtml, fileName);
    const now = new Date().toISOString();
    const existing = this.project.pages.find((page) => page.url === normalizedUrl);
    const pageInfo = {
      id: existing?.id || `page-${shortHash(normalizedUrl)}`,
      url: normalizedUrl,
      title,
      fileName,
      path: path.join("/"),
      status: existing?.status || "editing",
      changeCount: changes.length,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
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
    await writeTextFile(pageDirectory, "diff.html", createDiffReport(fileName, changes));
    await writeTextFile(pageDirectory, "redline.html", createRedlineReport(workingHtml, changes, fileName));
    await writeTextFile(pageDirectory, "page.json", JSON.stringify(pageData, null, 2));

    if (existing) Object.assign(existing, pageInfo);
    else this.project.pages.push(pageInfo);
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
    return { page, originalHtml, workingHtml, changes: data.changes || [] };
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

    const discoveredByUrl = new Map((this.project.discoveredPages || []).map((page) => [page.url, page]));
    const now = new Date().toISOString();
    for (const page of resetPages) {
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
    const resetIds = new Set(resetPages.map((page) => page.id));
    this.project.pages = this.project.pages.filter((page) => !resetIds.has(page.id));
    await this.saveProject();
    return resetPages;
  }

  async deletePages(pageUrls, { force = false } = {}) {
    if (!this.directory || !this.project) throw new Error("案件フォルダが選択されていません。");
    const identity = (url) => {
      try { return normalizePageUrl(url); } catch { return String(url); }
    };
    const urls = new Set(pageUrls.map(identity));
    const matches = (page) => urls.has(identity(page.url));
    const savedTargets = this.project.pages
      .filter(matches)
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

    this.project.pages = this.project.pages.filter((page) => !matches(page));
    this.project.discoveredPages = (this.project.discoveredPages || []).filter((page) => !matches(page));
    await this.saveProject();
    return { deletedUrls: [...urls], deletedSavedPages: savedTargets, cleanupErrors };
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
