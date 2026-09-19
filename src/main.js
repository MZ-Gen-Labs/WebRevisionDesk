import { PageEditor } from "./editor.js";
import { cleanHtmlString, downloadHtml, EDITOR_CLASS } from "./html.js";
import { changeLabel, createRedlineReport, downloadDiffReport, downloadRedlineReport } from "./diff-report.js";
import { downloadProjectPackage } from "./project-package.js";
import { pagePathForUrl, ProjectStore } from "./project-storage.js";
import { comparePageHtml } from "./page-comparison.js";
import { shouldCheckForUpdatesOnStartup } from "./update-policy.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  loginRequired: $("#login-required"), loginOpen: $("#login-open"), loginDone: $("#login-done"),
  loginCancel: $("#login-cancel"), loginState: $("#login-state"),
  file: $("#html-file"), htmlImportButton: $("#html-import-button"), frame: $("#page-frame"), empty: $("#empty-state"), status: $("#status"),
  fileName: $("#file-name"), badge: $("#mode-badge"), original: $("#show-original"),
  modified: $("#show-modified"), redline: $("#show-redline"), undo: $("#undo"), redo: $("#redo"), reset: $("#reset"), download: $("#download"),
  downloadDiff: $("#download-diff"),
  downloadRedline: $("#download-redline"),
  downloadPackage: $("#download-package"),
  fields: $("#inspector-fields"), label: $("#element-label"), text: $("#text-value"),
  link: $("#link-value"), alt: $("#alt-value"), image: $("#image-file"),
  classes: $("#class-value"), classOptions: $("#class-options"), before: $("#move-before"),
  after: $("#move-after"), duplicate: $("#duplicate-element"), delete: $("#delete-element"),
  historyCount: $("#history-count"), historyList: $("#history-list"), clearHistory: $("#clear-history"),
  manualPageUrl: $("#manual-page-url"), addProjectUrl: $("#add-project-url"),
  captureSessionActions: $("#capture-session-actions"), finishCapture: $("#capture-current-page"),
  cancelCapture: $("#cancel-capture"), captureState: $("#capture-state"),
  selectProjectFolder: $("#select-project-folder"), projectName: $("#project-name"),
  projectBaseUrl: $("#project-base-url"), saveProjectPage: $("#save-project-page"),
  crawlProjectPages: $("#crawl-project-pages"),
  projectState: $("#project-state"), projectPages: $("#project-pages"), projectPageCount: $("#project-page-count"),
  selectAllProjectPages: $("#select-all-project-pages"), batchCapturePages: $("#batch-capture-pages"),
  checkProjectPages: $("#check-project-pages"), resetProjectPages: $("#reset-project-pages"), batchProgress: $("#batch-progress"),
  appUpdateButton: $("#app-update-button"), updatePanel: $("#update-panel"),
  closeUpdatePanel: $("#close-update-panel"), updateRepository: $("#update-repository"),
  checkUpdatesOnStartup: $("#check-updates-on-startup"), saveUpdateSettings: $("#save-update-settings"),
  checkAppUpdate: $("#check-app-update"), updateResult: $("#update-result"),
  openUpdateRelease: $("#open-update-release"), downloadAppUpdate: $("#download-app-update"),
  applyAppUpdate: $("#apply-app-update"),
  saveState: $("#save-state"), selectionHelp: $("#selection-help"),
  importPreviewPage: $("#import-preview-page"), refreshPreview: $("#refresh-preview"),
  screenshotPreview: $("#screenshot-preview"), screenshotPreviewImage: $("#screenshot-preview-image"),
  advancedMode: $("#advanced-mode"), inspector: $(".inspector"),
};

const state = {
  fileName: "page.html", originalHtml: "", modifiedHtml: "", mode: "modified", changes: [], redoChanges: [],
  sourceUrl: "", activeProjectPageId: "", dirty: false, previewOnly: false, previewObjectUrl: "",
  selectedProjectUrls: new Set(), batchRunning: false, queuedCaptureUrls: new Set(), activeCaptureUrl: "",
};
let captureSessionId = "";
let loginSessionId = "";
let loginReady = false;
let loginBusy = false;
let interactiveCaptureQueue = Promise.resolve();

function loginBlocked() {
  return loginBusy || Boolean(loginSessionId) || (ui.loginRequired.checked && !loginReady);
}

function syncLoginControls() {
  const enabled = ui.loginRequired.checked;
  ui.loginOpen.hidden = ui.loginDone.hidden = ui.loginCancel.hidden = !enabled;
  ui.loginRequired.disabled = loginBusy || Boolean(loginSessionId) || state.batchRunning;
  ui.loginOpen.disabled = loginBusy || Boolean(loginSessionId) || Boolean(captureSessionId) || state.batchRunning;
  ui.loginDone.disabled = ui.loginCancel.disabled = loginBusy || !loginSessionId;
  ui.selectProjectFolder.disabled = !ProjectStore.isSupported() || loginBusy || Boolean(loginSessionId);
  ui.loginState.textContent = loginBusy ? "処理中…" : loginSessionId ? "ブラウザで認証後、「ログイン完了」を押してください" : !enabled ? "ログイン待機なし" : loginReady ? "ログイン完了を確認済み（利用者確認）" : "ログイン完了待ち：検索・一括取得は待機中";
  syncProjectControls();
}
let latestAppUpdate = null;
let canApplyAppUpdate = false;
const projectStore = new ProjectStore();

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

async function loadAppInfo() {
  try {
    const response = await fetch("/api/app-info", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    ui.appUpdateButton.textContent = `v${data.version}`;
    ui.appUpdateButton.title = `設定保存先: ${data.dataDirectory}`;
    canApplyAppUpdate = data.canApplyUpdate === true;
    ui.updateRepository.value = data.settings.githubRepository || "";
    ui.checkUpdatesOnStartup.checked = data.settings.checkUpdatesOnStartup !== false;
    if (shouldCheckForUpdatesOnStartup(data.settings)) await checkAppUpdate({ quiet: true });
  } catch (error) {
    ui.appUpdateButton.textContent = "更新設定";
    console.warn("App information could not be loaded:", error);
  }
}

async function saveUpdateSettings() {
  const response = await postJson("/api/settings", {
    githubRepository: ui.updateRepository.value.trim(),
    checkUpdatesOnStartup: ui.checkUpdatesOnStartup.checked,
  });
  const data = await response.json();
  ui.updateRepository.value = data.settings.githubRepository || "";
  ui.updateResult.dataset.kind = "current";
  ui.updateResult.textContent = "更新設定を保存しました。設定はアプリ本体とは別の場所に保持されます。";
}

async function checkAppUpdate({ quiet = false } = {}) {
  ui.checkAppUpdate.disabled = true;
  if (!quiet) {
    ui.updateResult.dataset.kind = "";
    ui.updateResult.textContent = "GitHub Releasesを確認しています…";
  }
  try {
    const response = await postJson("/api/update/check", {});
    latestAppUpdate = await response.json();
    const security = latestAppUpdate.updateType === "security";
    const severity = latestAppUpdate.severity ? `・重要度 ${latestAppUpdate.severity.toUpperCase()}` : "";
    const asset = latestAppUpdate.asset ? `\n配布ファイル: ${latestAppUpdate.asset.name}（${formatBytes(latestAppUpdate.asset.size)}）` : "";
    if (latestAppUpdate.updateAvailable) {
      ui.updateResult.dataset.kind = security ? "security" : "available";
      ui.updateResult.textContent = `${security ? "セキュリティ更新" : "新しいバージョン"}があります。\n現在 v${latestAppUpdate.currentVersion} → 最新 v${latestAppUpdate.latestVersion}${severity}${asset}\n\n${latestAppUpdate.notes || "更新内容はGitHubで確認できます。"}`;
      ui.downloadAppUpdate.hidden = !latestAppUpdate.downloadable;
      ui.applyAppUpdate.hidden = true;
      if (quiet) {
        ui.updatePanel.hidden = false;
        setStatus(`${security ? "セキュリティ更新" : "更新版"} v${latestAppUpdate.latestVersion} が公開されています。`, security ? "error" : "info");
      }
    } else {
      ui.updateResult.dataset.kind = "current";
      ui.updateResult.textContent = `v${latestAppUpdate.currentVersion} は最新です。`;
      ui.downloadAppUpdate.hidden = true;
      ui.applyAppUpdate.hidden = true;
    }
    ui.openUpdateRelease.href = latestAppUpdate.releaseUrl;
    ui.openUpdateRelease.hidden = false;
  } catch (error) {
    latestAppUpdate = null;
    ui.updateResult.dataset.kind = "";
    ui.updateResult.textContent = `更新を確認できませんでした: ${error.message}`;
    ui.downloadAppUpdate.hidden = true;
    ui.applyAppUpdate.hidden = true;
    if (!quiet) setStatus(`アプリの更新確認に失敗しました: ${error.message}`, "error");
  } finally {
    ui.checkAppUpdate.disabled = false;
  }
}
const editor = new PageEditor(ui.frame, {
  onSelect: showSelection,
  onChange: (change) => {
    state.modifiedHtml = editor.getHtml();
    if (change) {
      state.changes.push(change);
      state.redoChanges = [];
      state.dirty = true;
      renderHistory();
    }
    updateGuidance();
    setStatus("修正を反映しました。続けて編集するか、確認して保存できます。", "success");
  },
});

function updateGuidance() {
  const loaded = Boolean(state.originalHtml);
  if (state.previewOnly) {
    ui.saveState.textContent = "未取得・画像プレビュー";
    ui.saveState.className = "save-state";
    return;
  }
  if (!loaded) {
    ui.saveState.textContent = "ページ未読込";
    ui.saveState.className = "save-state";
    return;
  }
  ui.saveState.textContent = state.dirty ? "● 案件フォルダへ未保存" : "保存済み";
  ui.saveState.className = `save-state ${state.dirty ? "dirty" : "saved"}`;
}

function setStatus(message, kind = "info") {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

function setControls(enabled) {
  [ui.original, ui.reset, ui.download].forEach((button) => { button.disabled = !enabled; });
  ui.modified.disabled = !enabled || state.previewOnly;
  ui.redline.disabled = !enabled || state.previewOnly || state.changes.length === 0;
  ui.downloadPackage.disabled = !enabled;
  ui.downloadDiff.disabled = !enabled || state.changes.length === 0;
  ui.downloadRedline.disabled = !enabled || state.changes.length === 0;
  updateUndoControls();
  syncProjectControls();
}

function syncProjectControls() {
  const hasProject = Boolean(projectStore.project);
  ui.projectName.disabled = !hasProject;
  ui.projectBaseUrl.disabled = !hasProject;
  ui.saveProjectPage.disabled = !hasProject || !state.originalHtml || state.previewOnly;
  ui.crawlProjectPages.disabled = !hasProject || loginBlocked();
  ui.manualPageUrl.disabled = !hasProject;
  ui.addProjectUrl.disabled = !hasProject || !ui.manualPageUrl.value.trim();
  ui.file.disabled = !hasProject;
  ui.htmlImportButton.setAttribute("aria-disabled", String(!hasProject));
  updateBatchControls();
}

function updateBatchControls() {
  const listed = listedProjectPages();
  const selected = listed.filter((page) => state.selectedProjectUrls.has(page.url));
  ui.selectAllProjectPages.disabled = state.batchRunning || listed.length === 0;
  ui.selectAllProjectPages.textContent = selected.length === listed.length && listed.length ? "すべて解除" : "すべて選択";
  ui.batchCapturePages.disabled = loginBlocked() || state.batchRunning || selected.length === 0;
  ui.checkProjectPages.disabled = loginBlocked() || state.batchRunning || !selected.some((page) => page.saved);
  ui.resetProjectPages.disabled = state.batchRunning || !selected.some((page) => page.saved);
}

function updateUndoControls() {
  const editable = Boolean(state.originalHtml) && state.mode === "modified";
  ui.undo.disabled = !editable || state.changes.length === 0;
  ui.redo.disabled = !editable || state.redoChanges.length === 0;
}

function renderHistory() {
  ui.historyCount.textContent = String(state.changes.length);
  ui.clearHistory.disabled = state.changes.length === 0;
  ui.downloadDiff.disabled = !state.originalHtml || state.changes.length === 0;
  ui.downloadRedline.disabled = !state.originalHtml || state.changes.length === 0;
  ui.redline.disabled = !state.originalHtml || state.previewOnly || state.changes.length === 0;
  updateUndoControls();
  updateGuidance();
  if (!state.changes.length) {
    ui.historyList.innerHTML = '<li class="history-empty">まだ変更はありません。</li>';
    return;
  }
  ui.historyList.replaceChildren(...state.changes.map((change, index) => {
    const item = document.createElement("li");
    const type = document.createElement("strong");
    const target = document.createElement("span");
    type.textContent = `${index + 1}. ${changeLabel(change.type)}`;
    target.textContent = change.target;
    item.append(type, target);
    return item;
  }));
}

function setMode(mode) {
  state.mode = mode;
  ui.badge.textContent = state.previewOnly
    ? "公開ページ・画像プレビュー"
    : mode === "original"
      ? "修正前・参照専用"
      : mode === "redline"
        ? "変更箇所・参照専用"
        : "修正後・編集可能";
  ui.badge.dataset.mode = state.previewOnly ? "preview" : mode;
  ui.original.classList.toggle("active", mode === "original");
  ui.modified.classList.toggle("active", mode === "modified");
  ui.redline.classList.toggle("active", mode === "redline");
  updateUndoControls();
}

async function render(mode, { captureCurrent = true } = {}) {
  if (!state.originalHtml) return;
  if (state.previewOnly && mode === "modified") return;
  // 初回読込前のiframeは空のabout:blank。これをmodifiedHtmlへ保存すると、
  // 読み込んだHTMLを空ページで上書きしてしまうため、準備済みの場合だけ同期する。
  if (captureCurrent && state.mode === "modified" && editor.hasLoadedDocument()) {
    state.modifiedHtml = editor.getHtml();
  }
  setMode(mode);
  showSelection(null);
  const html = mode === "original"
    ? state.originalHtml
    : mode === "redline"
      ? createRedlineReport(state.modifiedHtml, state.changes, state.fileName)
      : state.modifiedHtml;
  await editor.load(html, mode === "modified");
  if (mode === "modified") refreshClassOptions();
}

function refreshClassOptions() {
  ui.classOptions.replaceChildren(...editor.getClassNames().map((name) => {
    const option = document.createElement("option");
    option.value = name;
    return option;
  }));
}

function selectedImage(element) {
  const ImageType = ui.frame.contentWindow?.HTMLImageElement;
  return ImageType && element instanceof ImageType ? element : null;
}

function showSelection(element) {
  const editable = Boolean(element) && state.mode === "modified";
  ui.fields.disabled = !editable;
  ui.label.textContent = element ? describeElement(element) : "未選択";
  const fieldVisibility = {
    text: false, link: false, image: false, alt: false, class: Boolean(element),
  };
  if (!element) {
    ui.text.value = ui.link.value = ui.alt.value = ui.classes.value = "";
    ui.selectionHelp.textContent = state.previewOnly
      ? "一時プレビューです。編集するには「このページを取り込んで編集」を押してください。"
      : state.mode === "redline"
        ? "変更された文章、画像、リンク、追加・削除・移動箇所をページ上で確認できます。"
      : state.mode === "original"
      ? "修正前は参照専用です。「修正後」を押すと編集できます。"
      : "ページ内の直したい文章や画像をクリックしてください。";
    document.querySelectorAll("[data-editor-field]").forEach((field) => { field.hidden = true; });
    return;
  }
  const classNames = [...element.classList].filter((name) => name !== EDITOR_CLASS);
  const link = element.closest("a");
  const image = selectedImage(element);
  const textEditable = !["IMG", "SCRIPT", "STYLE", "HTML", "HEAD", "BODY"].includes(element.tagName);
  fieldVisibility.text = textEditable;
  fieldVisibility.link = Boolean(link);
  fieldVisibility.image = Boolean(image);
  fieldVisibility.alt = Boolean(image);
  document.querySelectorAll("[data-editor-field]").forEach((field) => {
    field.hidden = !fieldVisibility[field.dataset.editorField];
  });
  ui.selectionHelp.textContent = image
    ? "画像を選択中です。下の「画像を差し替える」から変更できます。"
    : link
      ? "リンク付きの要素を選択中です。文章とリンク先を変更できます。"
      : textEditable
        ? "文章を変更できます。ページ上でダブルクリックして直接編集することもできます。"
        : "このブロックは複製、移動、削除ができます。";
  ui.text.value = ["IMG", "SCRIPT", "STYLE", "HTML", "HEAD", "BODY"].includes(element.tagName) ? "" : element.textContent ?? "";
  ui.text.disabled = ["IMG", "SCRIPT", "STYLE", "HTML", "HEAD", "BODY"].includes(element.tagName);
  ui.link.value = link?.getAttribute("href") ?? "";
  ui.link.disabled = !link;
  ui.alt.value = image?.alt ?? "";
  ui.alt.disabled = !image;
  ui.image.disabled = !image;
  ui.classes.value = classNames.join(" ");
}

function describeElement(element) {
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList].filter((name) => name !== EDITOR_CLASS).slice(0, 2);
  return `${element.tagName.toLowerCase()}${id}${classes.map((name) => `.${name}`).join("")}`;
}

async function loadHtml(html, fileName, options = {}) {
  if (!/<(?:!doctype|html|head|body)[\s>]/i.test(html)) throw new Error("HTML文書として認識できませんでした。");
  state.fileName = fileName || "captured-page.html";
  state.originalHtml = html;
  state.modifiedHtml = options.workingHtml || html;
  state.changes = options.changes || [];
  state.redoChanges = [];
  state.sourceUrl = options.sourceUrl ?? sourceUrlFromHtml(html);
  state.activeProjectPageId = options.activeProjectPageId || "";
  state.dirty = options.dirty ?? true;
  state.previewOnly = options.previewOnly ?? false;
  clearScreenshotPreview();
  renderHistory();
  ui.fileName.textContent = state.fileName;
  ui.empty.hidden = true;
  ui.frame.hidden = false;
  ui.importPreviewPage.hidden = true;
  ui.refreshPreview.hidden = true;
  setControls(true);
  await render(state.previewOnly ? "original" : "modified", { captureCurrent: false });
  renderProjectPages();
  updateGuidance();
  document.querySelector("#setup-panel").open = false;
}

function sourceUrlFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector('meta[name="web-revision-source-url"]')?.content ?? "";
}

function listedProjectPages() {
  const savedPages = projectStore.project?.pages || [];
  const savedByUrl = new Map(savedPages.map((page) => [page.url, page]));
  const discovered = projectStore.project?.discoveredPages || [];
  const listed = discovered.map((page) => ({ ...page, ...savedByUrl.get(page.url), saved: savedByUrl.has(page.url) }));
  savedPages.filter((page) => !discovered.some((item) => item.url === page.url)).forEach((page) => listed.push({ ...page, saved: true }));
  listed.sort((a, b) => a.url.localeCompare(b.url, "ja"));
  return listed;
}

function renderProjectPages() {
  const listed = listedProjectPages();
  const availableUrls = new Set(listed.map((page) => page.url));
  state.selectedProjectUrls = new Set([...state.selectedProjectUrls].filter((url) => availableUrls.has(url)));
  ui.projectPageCount.textContent = String(listed.length);
  if (!listed.length) {
    ui.projectPages.innerHTML = '<p class="project-empty">「配下ページを一括検索」でページ候補を取得するか、現在のページを案件へ保存してください。</p>';
    updateBatchControls();
    return;
  }
  ui.projectPages.replaceChildren(...listed.map((page) => {
    const row = document.createElement("div");
    row.className = "project-page-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedProjectUrls.has(page.url);
    checkbox.setAttribute("aria-label", `${page.title}を選択`);
    checkbox.addEventListener("change", () => {
      checkbox.checked ? state.selectedProjectUrls.add(page.url) : state.selectedProjectUrls.delete(page.url);
      updateBatchControls();
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-page";
    button.classList.toggle("saved", page.saved);
    button.classList.toggle("changed", page.checkStatus === "changed");
    button.classList.toggle("active", page.id === state.activeProjectPageId);
    const title = document.createElement("strong");
    const path = document.createElement("small");
    const status = document.createElement("span");
    title.textContent = page.title;
    path.textContent = page.saved ? page.path.replace(/^pages\//, "") : new URL(page.url).pathname;
    status.className = "page-status";
    const savedStatus = {
      same: "公開版と同じ",
      changed: page.updateDecision === "kept" ? "公開版に更新あり・現在版を維持" : "公開版に更新あり",
      error: "公開版の確認失敗",
    }[page.checkStatus] || `保存済み・変更 ${page.changeCount}件`;
    status.textContent = page.saved
      ? savedStatus
      : state.activeCaptureUrl === page.url
        ? "画像・ページを取得中"
        : state.queuedCaptureUrls.has(page.url)
          ? "優先取得待ち"
          : "未取得・クリックして画像とページを取得";
    button.append(title, path, status);
    button.addEventListener("click", () => page.saved ? openProjectPage(page.id) : previewUncapturedProjectPage(page));
    row.append(checkbox, button);
    if (page.saved && page.checkStatus === "changed") {
      const actions = document.createElement("div");
      actions.className = "project-update-actions";
      const keep = document.createElement("button");
      const replace = document.createElement("button");
      keep.type = replace.type = "button";
      keep.textContent = "上書きしない";
      replace.textContent = "バックアップして更新";
      keep.addEventListener("click", () => keepCurrentProjectPage(page.id));
      replace.addEventListener("click", () => replaceProjectPage(page.id));
      actions.append(keep, replace);
      row.append(actions);
    } else if (!page.saved) {
      const actions = document.createElement("div");
      actions.className = "project-page-actions";
      const manual = document.createElement("button");
      manual.type = "button";
      manual.textContent = "取得用ブラウザで開く";
      manual.disabled = loginBusy || Boolean(loginSessionId) || Boolean(captureSessionId) || state.batchRunning;
      manual.addEventListener("click", () => startCaptureForUrl(page.url));
      actions.append(manual);
      row.append(actions);
    }
    return row;
  }));
  updateBatchControls();
}

async function captureUrlDirectly(url, priority = "normal") {
  const response = await postJson("/api/capture/direct", { url }, { browserPriority: priority });
  const html = await response.text();
  return {
    html,
    fileName: decodeURIComponent(response.headers.get("X-Captured-Filename") || "captured-page.html"),
    url: decodeURIComponent(response.headers.get("X-Captured-Url") || url),
  };
}

async function captureScreenshot(url, refresh = false, priority = "interactive") {
  const response = await postJson("/api/preview/screenshot", { url, refresh }, { browserPriority: priority });
  const image = await response.blob();
  return {
    imageUrl: URL.createObjectURL(image),
    title: decodeURIComponent(response.headers.get("X-Preview-Title") || "公開ページ"),
    url: decodeURIComponent(response.headers.get("X-Preview-Url") || url),
  };
}

function clearScreenshotPreview() {
  if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = "";
  ui.screenshotPreviewImage.removeAttribute("src");
  ui.screenshotPreview.hidden = true;
}

function showScreenshotPreview(preview) {
  editor.unload();
  clearScreenshotPreview();
  Object.assign(state, {
    fileName: "page.html", originalHtml: "", modifiedHtml: "", mode: "original", changes: [], redoChanges: [],
    sourceUrl: preview.url, activeProjectPageId: "", dirty: false, previewOnly: true, previewObjectUrl: preview.imageUrl,
  });
  ui.manualPageUrl.value = preview.url;
  ui.fileName.textContent = preview.title;
  ui.badge.textContent = "公開ページ・画像プレビュー";
  ui.badge.dataset.mode = "preview";
  ui.empty.hidden = true;
  ui.frame.hidden = true;
  ui.screenshotPreviewImage.src = preview.imageUrl;
  ui.screenshotPreview.hidden = false;
  ui.importPreviewPage.hidden = false;
  ui.refreshPreview.hidden = false;
  showSelection(null);
  renderHistory();
  setControls(false);
}

async function previewUncapturedProjectPage(page) {
  if (loginBlocked()) return setStatus("先にログインを完了してください。", "error");
  if (captureSessionId) return setStatus("取得用ブラウザを取り込みまたはキャンセルしてからページを開いてください。", "error");
  if (state.queuedCaptureUrls.has(page.url) || state.activeCaptureUrl === page.url) {
    return setStatus(`「${page.title}」は取得待ち、または取得中です。`, "info");
  }
  state.queuedCaptureUrls.add(page.url);
  renderProjectPages();
  setStatus(state.batchRunning
    ? `一括取得の現在ページが終わり次第、「${page.title}」を優先取得します。`
    : `「${page.title}」の画像・ページ取得を開始します。`, "info");

  const run = async () => {
    state.queuedCaptureUrls.delete(page.url);
    state.activeCaptureUrl = page.url;
    renderProjectPages();
    try {
      const latest = listedProjectPages().find((item) => item.url === page.url);
      if (latest?.saved) {
        await openProjectPage(latest.id);
        return;
      }
      if (!(await preserveCurrentPage())) return;
      if (state.batchRunning) ui.batchProgress.textContent = `一括取得を一時待機：「${page.title}」を優先取得中`;
      setStatus(`「${page.title}」の画像を取得しています…`, "info");
      const preview = await captureScreenshot(page.url, false, "interactive");
      showScreenshotPreview(preview);
      setStatus(`「${page.title}」の編集用ページを取得しています…`, "info");
      const captured = await captureUrlDirectly(preview.url, "interactive");
      await loadHtml(captured.html, captured.fileName, { sourceUrl: captured.url, dirty: true });
      await saveCurrentToProject({ quiet: true });
      setStatus(`「${page.title}」を案件フォルダへ取得しました。中央の画面で編集できます。`, "success");
    } catch (error) {
      setStatus(`「${page.title}」を取得できませんでした: ${error.message}。「取得用ブラウザで開く」も利用できます。`, "error");
    } finally {
      state.activeCaptureUrl = "";
      renderProjectPages();
      updateBatchControls();
    }
  };
  interactiveCaptureQueue = interactiveCaptureQueue.then(run, run);
}

function clearLoadedPage() {
  editor.unload();
  clearScreenshotPreview();
  Object.assign(state, {
    fileName: "page.html", originalHtml: "", modifiedHtml: "", mode: "modified", changes: [], redoChanges: [],
    sourceUrl: "", activeProjectPageId: "", dirty: false, previewOnly: false, previewObjectUrl: "",
  });
  ui.fileName.textContent = "ファイル未選択";
  ui.badge.textContent = "未読込";
  delete ui.badge.dataset.mode;
  ui.empty.hidden = false;
  ui.frame.hidden = true;
  ui.importPreviewPage.hidden = true;
  ui.refreshPreview.hidden = true;
  showSelection(null);
  renderHistory();
  setControls(false);
}

async function resetSelectedProjectPages() {
  const targets = listedProjectPages().filter((page) => page.saved && state.selectedProjectUrls.has(page.url));
  if (!targets.length) return;
  const message = `${targets.length}ページを未取得状態へ戻します。\n\n原本・編集中・修正後・差分・変更履歴・旧版バックアップが案件フォルダから削除されます。URLは一覧に残ります。続けますか？`;
  if (!window.confirm(message)) return;
  state.batchRunning = true;
  updateBatchControls();
  try {
    const activeReset = targets.some((page) => page.id === state.activeProjectPageId);
    const reset = await projectStore.resetPages(targets.map((page) => page.id));
    reset.forEach((page) => state.selectedProjectUrls.delete(page.url));
    if (activeReset) clearLoadedPage();
    ui.projectState.textContent = `${projectStore.project.projectName}：保存済み${projectStore.project.pages.length}ページ`;
    setStatus(`${reset.length}ページの保存データを削除し、未取得状態へ戻しました。`, "success");
  } catch (error) {
    setStatus(`ページをリセットできませんでした: ${error.message}`, "error");
  } finally {
    state.batchRunning = false;
    renderProjectPages();
    updateBatchControls();
  }
}

async function processSelectedPages(mode) {
  if (loginBlocked()) return setStatus("先にログインを完了してください。", "error");
  if (captureSessionId) return setStatus("取得用ブラウザを取り込みまたはキャンセルしてから一括処理してください。", "error");
  const selected = listedProjectPages().filter((page) => state.selectedProjectUrls.has(page.url));
  const targets = mode === "check" ? selected.filter((page) => page.saved) : selected;
  if (!targets.length) return;
  state.batchRunning = true;
  updateBatchControls();
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < targets.length; index++) {
    const page = targets[index];
    await interactiveCaptureQueue;
    const latest = listedProjectPages().find((item) => item.url === page.url);
    if (!page.saved && latest?.saved) {
      completed++;
      renderProjectPages();
      continue;
    }
    ui.batchProgress.textContent = `${targets.length}件中 ${index + 1}件目：${page.title}`;
    try {
      const captured = await captureUrlDirectly(page.url);
      if (page.saved) {
        const saved = await projectStore.loadPage(page.id);
        const comparison = comparePageHtml(saved.originalHtml, captured.html);
        await projectStore.checkSource(page.id, captured.html, comparison);
      } else {
        await projectStore.savePage({
          fileName: captured.fileName,
          sourceUrl: captured.url,
          originalHtml: captured.html,
          workingHtml: captured.html,
          changes: [],
        });
      }
      completed++;
    } catch (error) {
      failed++;
      if (page.saved) await projectStore.markCheckFailed(page.id, error.message).catch(() => {});
    }
    renderProjectPages();
  }
  await interactiveCaptureQueue;
  state.batchRunning = false;
  ui.batchProgress.textContent = `完了 ${completed}件${failed ? `・失敗 ${failed}件` : ""}`;
  updateBatchControls();
  setStatus(`${mode === "check" ? "公開ページの更新確認" : "一括取得"}が完了しました。成功 ${completed}件、失敗 ${failed}件です。`, failed ? "error" : "success");
}

async function keepCurrentProjectPage(pageId) {
  await projectStore.markCurrentVersionKept(pageId);
  renderProjectPages();
  setStatus("公開ページでは更新が見つかりましたが、案件内の現在版を維持します。", "success");
}

async function replaceProjectPage(pageId) {
  if (!window.confirm("現在の編集内容を旧版フォルダへバックアップし、公開中の最新版で上書きしますか？")) return;
  try {
    const saved = await projectStore.replaceWithLatest(pageId);
    if (state.activeProjectPageId === pageId) {
      await loadHtml(saved.originalHtml, saved.page.fileName, {
        workingHtml: saved.workingHtml,
        changes: saved.changes,
        sourceUrl: saved.page.url,
        activeProjectPageId: saved.page.id,
        dirty: false,
      });
    }
    renderProjectPages();
    setStatus("旧版をversionsフォルダへバックアップし、公開中の最新版へ更新しました。", "success");
  } catch (error) {
    setStatus(`最新版へ更新できませんでした: ${error.message}`, "error");
  }
}

ui.selectAllProjectPages.addEventListener("click", () => {
  const pages = listedProjectPages();
  const allSelected = pages.length > 0 && pages.every((page) => state.selectedProjectUrls.has(page.url));
  state.selectedProjectUrls = allSelected ? new Set() : new Set(pages.map((page) => page.url));
  renderProjectPages();
});
ui.batchCapturePages.addEventListener("click", () => processSelectedPages("capture"));
ui.checkProjectPages.addEventListener("click", () => processSelectedPages("check"));
ui.resetProjectPages.addEventListener("click", resetSelectedProjectPages);

ui.importPreviewPage.addEventListener("click", async () => {
  if (!state.previewOnly || !state.sourceUrl) return;
  ui.importPreviewPage.disabled = true;
  ui.refreshPreview.disabled = true;
  try {
    setStatus("編集用HTMLを取得しています…", "info");
    const captured = await captureUrlDirectly(state.sourceUrl);
    await loadHtml(captured.html, captured.fileName, { sourceUrl: captured.url, dirty: true });
    await saveCurrentToProject({ quiet: true });
    setStatus("ページを案件フォルダへ取り込みました。中央の画面で編集できます。", "success");
  } catch (error) {
    setStatus(`ページを取り込めませんでした: ${error.message}`, "error");
  } finally {
    ui.importPreviewPage.disabled = false;
    ui.refreshPreview.disabled = false;
  }
});

ui.refreshPreview.addEventListener("click", async () => {
  if (!state.previewOnly || !state.sourceUrl) return;
  ui.refreshPreview.disabled = true;
  ui.importPreviewPage.disabled = true;
  try {
    setStatus("最新のスクリーンショットを取得しています…", "info");
    const preview = await captureScreenshot(state.sourceUrl, true);
    showScreenshotPreview(preview);
    setStatus("スクリーンショットを更新しました。", "success");
  } catch (error) {
    setStatus(`スクリーンショットを更新できませんでした: ${error.message}`, "error");
  } finally {
    ui.refreshPreview.disabled = false;
    ui.importPreviewPage.disabled = false;
  }
});

async function saveCurrentToProject({ quiet = false } = {}) {
  if (!state.originalHtml) throw new Error("保存するページがありません。");
  projectStore.setMetadata({
    projectName: ui.projectName.value,
    baseUrl: ui.projectBaseUrl.value,
  });
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  const sourceUrl = state.sourceUrl || ui.manualPageUrl.value.trim();
  if (!sourceUrl) throw new Error("ページURLが不明です。「その他の取り込み」でページURLを指定してください。");
  const page = await projectStore.savePage({
    fileName: state.fileName,
    sourceUrl,
    originalHtml: state.originalHtml,
    workingHtml: state.modifiedHtml,
    changes: state.changes,
  });
  state.sourceUrl = page.url;
  state.activeProjectPageId = page.id;
  state.dirty = false;
  updateGuidance();
  renderProjectPages();
  ui.projectState.textContent = `${projectStore.project.projectName}：${projectStore.project.pages.length}ページ`;
  if (!quiet) setStatus(`案件フォルダの ${page.path} へ保存しました。`, "success");
  return page;
}

async function openProjectPage(pageId) {
  if (pageId === state.activeProjectPageId) return;
  try {
    if (!(await preserveCurrentPage())) return;
    const saved = await projectStore.loadPage(pageId);
    await loadHtml(saved.originalHtml, saved.page.fileName, {
      workingHtml: saved.workingHtml,
      changes: saved.changes,
      sourceUrl: saved.page.url,
      activeProjectPageId: saved.page.id,
      dirty: false,
    });
    ui.manualPageUrl.value = saved.page.url;
    setStatus(`案件ページ「${saved.page.title}」を開きました。`, "success");
  } catch (error) {
    setStatus(`案件ページを開けませんでした: ${error.message}`, "error");
  }
}

async function preserveCurrentPage() {
  if (!state.dirty || !state.originalHtml) return true;
  if (projectStore.project && state.activeProjectPageId) {
    await saveCurrentToProject({ quiet: true });
    return true;
  }
  return window.confirm("現在のページは案件フォルダへ保存されていません。別のページへ進むと現在の編集状態は失われます。続けますか？");
}

ui.selectProjectFolder.addEventListener("click", async () => {
  try {
    if (!(await preserveCurrentPage())) return;
    const project = await projectStore.selectDirectory();
    state.activeProjectPageId = "";
    if (state.originalHtml) state.dirty = true;
    updateGuidance();
    ui.projectName.value = project.projectName;
    ui.projectBaseUrl.value = project.baseUrl;
    ui.loginRequired.checked = project.loginRequired === true;
    loginReady = false;
    syncLoginControls();
    ui.projectState.textContent = `${project.projectName}：保存済み${project.pages.length}ページ`;
    syncProjectControls();
    renderProjectPages();
    setStatus(project.pages.length ? "案件フォルダを開きました。左の一覧からページを選べます。" : "新しい案件フォルダを選択しました。案件名と基準URLを入力してください。", "success");
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`案件フォルダを開けませんでした: ${error.message}`, "error");
  }
});

ui.saveProjectPage.addEventListener("click", async () => {
  ui.saveProjectPage.disabled = true;
  try {
    await saveCurrentToProject();
  } catch (error) {
    setStatus(`案件フォルダへ保存できませんでした: ${error.message}`, "error");
  } finally {
    syncProjectControls();
  }
});

ui.crawlProjectPages.addEventListener("click", async () => {
  if (loginBlocked()) return setStatus("先にログインを完了してください。", "error");
  ui.crawlProjectPages.disabled = true;
  try {
    projectStore.setMetadata({ projectName: ui.projectName.value, baseUrl: ui.projectBaseUrl.value });
    await projectStore.saveProject();
    ui.projectState.textContent = "基準URL配下を検索しています…";
    setStatus("リンクをたどって配下ページを検索しています。ページ数によって時間がかかります。", "info");
    const response = await postJson("/api/crawl", { baseUrl: projectStore.project.baseUrl, maxPages: 100 });
    const result = await response.json();
    await projectStore.mergeDiscoveredPages(result.pages);
    renderProjectPages();
    const errorText = result.errors.length ? `、取得失敗 ${result.errors.length}件` : "";
    const limitText = result.truncated ? "（100件で打ち切り）" : "";
    ui.projectState.textContent = `${projectStore.project.projectName}：候補${projectStore.project.discoveredPages.length}ページ`;
    setStatus(`配下ページを${result.pages.length}件確認しました${errorText}${limitText}。未取得ページをクリックすると画像プレビューを表示します。`, "success");
  } catch (error) {
    ui.projectState.textContent = "配下ページの検索に失敗しました";
    setStatus(`配下ページを検索できませんでした: ${error.message}`, "error");
  } finally {
    syncProjectControls();
  }
});

ui.addProjectUrl.addEventListener("click", async () => {
  try {
    if (!projectStore.project) throw new Error("先に案件フォルダを選択してください。");
    const url = new URL(ui.manualPageUrl.value.trim()).toString();
    projectStore.setMetadata({ projectName: ui.projectName.value, baseUrl: ui.projectBaseUrl.value });
    await projectStore.mergeDiscoveredPages([{ url, title: url, status: 0 }]);
    renderProjectPages();
    ui.projectState.textContent = `${projectStore.project.projectName}：候補${projectStore.project.discoveredPages.length}ページ`;
    setStatus("URLを未取得ページとして一覧へ追加しました。クリックすると画像プレビューを確認できます。", "success");
  } catch (error) {
    setStatus(`URLをページ一覧へ追加できませんでした: ${error.message}`, "error");
  }
});

if (!ProjectStore.isSupported()) {
  ui.selectProjectFolder.disabled = true;
  ui.projectState.textContent = "フォルダ保存にはChromeまたはEdgeが必要です";
}

ui.file.addEventListener("change", async () => {
  const file = ui.file.files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024 && !window.confirm("100MBを超えるHTMLです。読み込みを続けますか？")) return;
  try {
    if (!projectStore.project) throw new Error("先に案件フォルダを選択してください。");
    if (!(await preserveCurrentPage())) return;
    const html = await file.text();
    const sourceUrl = sourceUrlFromHtml(html) || ui.manualPageUrl.value.trim();
    if (!sourceUrl) throw new Error("「その他の取り込み」のページURLに、このHTMLの元URLを入力してください。");
    projectStore.setMetadata({ projectName: ui.projectName.value, baseUrl: ui.projectBaseUrl.value });
    pagePathForUrl(sourceUrl, projectStore.project.baseUrl);
    await loadHtml(html, file.name, { sourceUrl, dirty: true });
    await saveCurrentToProject({ quiet: true });
    setStatus("保存済みHTMLを案件へ追加しました。ページ内の要素を編集できます。", "success");
  } catch (error) {
    setStatus(`読み込みに失敗しました: ${error.message}`, "error");
  } finally {
    ui.file.value = "";
  }
});

async function postJson(url, body, { browserPriority } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (browserPriority) headers["X-Browser-Task-Priority"] = browserPriority;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response;
}

async function startCaptureForUrl(url) {
  if (loginBusy || loginSessionId) return setStatus("ログイン完了または中止を押してください。", "error");
  if (!url) return setStatus("取得するURLを入力してください。", "error");
  ui.manualPageUrl.value = url;
  ui.captureSessionActions.hidden = false;
  ui.finishCapture.disabled = true;
  ui.cancelCapture.disabled = true;
  ui.captureState.textContent = "取得用ブラウザを起動しています…";
  try {
    const response = await postJson("/api/capture/start", { url });
    const data = await response.json();
    captureSessionId = data.sessionId;
    ui.finishCapture.disabled = false;
    ui.cancelCapture.disabled = false;
    ui.captureState.textContent = "取得用ブラウザでログインや表示調整後、取り込みを押してください";
    renderProjectPages();
    setStatus("取得用ブラウザを開きました。対象画面を表示してから「表示中ページを取り込む」を押してください。", "success");
  } catch (error) {
    ui.captureSessionActions.hidden = true;
    renderProjectPages();
    setStatus(`ページ取得の開始に失敗しました: ${error.message}`, "error");
  }
}

ui.finishCapture.addEventListener("click", async () => {
  if (!captureSessionId) return;
  ui.finishCapture.disabled = true;
  ui.captureState.textContent = "CSS・画像を埋め込んでいます…";
  setStatus("表示中ページを取り込んでいます。ページによっては少し時間がかかります。", "info");
  try {
    if (!(await preserveCurrentPage())) { ui.finishCapture.disabled = false; return; }
    const response = await postJson("/api/capture/finish", { sessionId: captureSessionId });
    const html = await response.text();
    const fileName = decodeURIComponent(response.headers.get("X-Captured-Filename") || "captured-page.html");
    const sourceUrl = decodeURIComponent(response.headers.get("X-Captured-Url") || ui.manualPageUrl.value.trim());
    captureSessionId = "";
    await loadHtml(html, fileName, { sourceUrl, dirty: true });
    if (projectStore.project) await saveCurrentToProject({ quiet: true });
    ui.captureSessionActions.hidden = true;
    setStatus("表示中ページを案件へ取り込みました。編集を開始できます。", "success");
  } catch (error) {
    ui.finishCapture.disabled = false;
    ui.captureState.textContent = "取り込みに失敗しました";
    setStatus(`ページ取得に失敗しました: ${error.message}`, "error");
  }
});

ui.cancelCapture.addEventListener("click", async () => {
  if (captureSessionId) await postJson("/api/capture/cancel", { sessionId: captureSessionId }).catch(() => {});
  captureSessionId = "";
  ui.finishCapture.disabled = true;
  ui.cancelCapture.disabled = true;
  ui.captureSessionActions.hidden = true;
  renderProjectPages();
  setStatus("取得用ブラウザをキャンセルしました。", "success");
});

ui.original.addEventListener("click", () => render("original"));
ui.modified.addEventListener("click", () => render("modified"));
ui.redline.addEventListener("click", () => render("redline"));
ui.undo.addEventListener("click", () => applyUndoRedo("undo"));
ui.redo.addEventListener("click", () => applyUndoRedo("redo"));
ui.reset.addEventListener("click", async () => {
  if (!window.confirm("すべての修正を破棄して、読み込み時点へ戻しますか？")) return;
  state.modifiedHtml = state.originalHtml;
  state.changes = [];
  state.redoChanges = [];
  state.dirty = true;
  renderHistory();
  // リセット直前の編集DOMでoriginalHtmlを再上書きしない。
  await render("modified", { captureCurrent: false });
  setStatus("読み込み時点へ戻しました。", "success");
});
ui.download.addEventListener("click", () => {
  const html = state.mode === "modified" ? editor.getExportHtml() : cleanHtmlString(state.modifiedHtml);
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  downloadHtml(html, state.fileName);
  setStatus("修正後HTMLをダウンロードしました。", "success");
});
ui.downloadRedline.addEventListener("click", () => {
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  downloadRedlineReport(state.fileName, state.modifiedHtml, state.changes);
  setStatus("ページ上で変更箇所を示す赤入れHTMLをダウンロードしました。", "success");
});
ui.downloadDiff.addEventListener("click", () => {
  downloadDiffReport(state.fileName, state.changes);
  setStatus("差分・修正指示HTMLをダウンロードしました。", "success");
});
ui.downloadPackage.addEventListener("click", () => {
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  downloadProjectPackage({
    fileName: state.fileName,
    originalHtml: state.originalHtml,
    modifiedHtml: state.modifiedHtml,
    changes: state.changes,
  });
  setStatus("修正前・修正後・差分・赤入れを案件一式ZIPでダウンロードしました。", "success");
});

function applyUndoRedo(direction) {
  if (state.mode !== "modified") return;
  const source = direction === "undo" ? state.changes : state.redoChanges;
  const destination = direction === "undo" ? state.redoChanges : state.changes;
  const change = source.pop();
  if (!change) return;
  if (!editor.applyChange(change, direction)) {
    source.push(change);
    setStatus("この操作を復元できませんでした。すべてリセットは利用できます。", "error");
    return;
  }
  destination.push(change);
  state.modifiedHtml = editor.getHtml();
  state.dirty = true;
  renderHistory();
  refreshClassOptions();
  setStatus(direction === "undo" ? "直前の編集を元に戻しました。" : "編集をやり直しました。", "success");
}

document.addEventListener("keydown", (event) => {
  const shortcut = event.metaKey || event.ctrlKey;
  const typing = ["INPUT", "TEXTAREA"].includes(event.target?.tagName);
  if (!shortcut || event.key.toLowerCase() !== "z" || typing) return;
  event.preventDefault();
  applyUndoRedo(event.shiftKey ? "redo" : "undo");
});

ui.text.addEventListener("change", () => editor.updateText(ui.text.value));
ui.link.addEventListener("change", () => editor.updateLink(ui.link.value));
ui.alt.addEventListener("change", () => editor.updateAlt(ui.alt.value));
ui.classes.addEventListener("change", () => {
  editor.updateClasses(ui.classes.value);
  refreshClassOptions();
});
ui.before.addEventListener("click", () => editor.moveBefore());
ui.after.addEventListener("click", () => editor.moveAfter());
ui.duplicate.addEventListener("click", () => {
  if (editor.duplicateSelected()) refreshClassOptions();
});
ui.delete.addEventListener("click", () => {
  if (window.confirm("選択した要素を削除しますか？")) editor.deleteSelected();
});
ui.clearHistory.addEventListener("click", async () => {
  if (!window.confirm("変更履歴だけを消去しますか？ 編集内容はそのまま残ります。")) return;
  state.changes = [];
  state.redoChanges = [];
  state.dirty = true;
  renderHistory();
  if (state.mode === "redline") await render("modified", { captureCurrent: false });
  setStatus("変更履歴を消去しました。編集内容は維持されています。", "success");
});
ui.advancedMode.addEventListener("change", () => {
  ui.inspector.classList.toggle("show-advanced", ui.advancedMode.checked);
});
ui.image.addEventListener("change", () => {
  const file = ui.image.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024 && !window.confirm("画像が10MBを超えています。埋め込みを続けますか？")) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    editor.updateImage(String(reader.result));
    ui.image.value = "";
  });
  reader.readAsDataURL(file);
});

ui.appUpdateButton.addEventListener("click", () => {
  ui.updatePanel.hidden = !ui.updatePanel.hidden;
});
ui.closeUpdatePanel.addEventListener("click", () => { ui.updatePanel.hidden = true; });
ui.saveUpdateSettings.addEventListener("click", async () => {
  ui.saveUpdateSettings.disabled = true;
  try {
    await saveUpdateSettings();
  } catch (error) {
    ui.updateResult.dataset.kind = "";
    ui.updateResult.textContent = `設定を保存できませんでした: ${error.message}`;
  } finally {
    ui.saveUpdateSettings.disabled = false;
  }
});
ui.checkAppUpdate.addEventListener("click", async () => {
  try {
    await saveUpdateSettings();
    await checkAppUpdate();
  } catch (error) {
    ui.updateResult.dataset.kind = "";
    ui.updateResult.textContent = `更新を確認できませんでした: ${error.message}`;
  }
});
ui.downloadAppUpdate.addEventListener("click", async () => {
  if (!latestAppUpdate?.updateAvailable) return;
  ui.downloadAppUpdate.disabled = true;
  ui.downloadAppUpdate.textContent = "ダウンロード中…";
  try {
    const response = await postJson("/api/update/download", {});
    const data = await response.json();
    ui.updateResult.dataset.kind = "current";
    ui.updateResult.textContent = `v${data.version} を安全にダウンロードしました。\nSHA-256を確認済みです。\n保存先: ${data.path}\n\n${canApplyAppUpdate ? "「再起動して更新を適用」で新しい版へ切り替えられます。" : "開発版では自動切り替えを行いません。Windowsポータブル版では自動適用できます。"}`;
    ui.applyAppUpdate.hidden = !canApplyAppUpdate;
    setStatus(`更新版 v${data.version} をダウンロードしました。現在のバージョンはそのまま動作しています。`, "success");
  } catch (error) {
    ui.updateResult.dataset.kind = "";
    ui.updateResult.textContent = `更新ZIPをダウンロードできませんでした: ${error.message}`;
    setStatus(`更新版のダウンロードに失敗しました: ${error.message}`, "error");
  } finally {
    ui.downloadAppUpdate.disabled = false;
    ui.downloadAppUpdate.textContent = "更新ZIPをダウンロード";
  }
});
ui.applyAppUpdate.addEventListener("click", async () => {
  if (!window.confirm("編集中の内容を保存しましたか？ アプリを終了して新しいバージョンへ切り替えます。")) return;
  ui.applyAppUpdate.disabled = true;
  try {
    const response = await postJson("/api/update/apply", {});
    const data = await response.json();
    ui.updateResult.dataset.kind = "available";
    ui.updateResult.textContent = `v${data.version} を適用しています。\nこの画面はまもなく閉じ、新しいバージョンで開き直します。`;
    setStatus("アプリを再起動して更新を適用しています…", "info");
  } catch (error) {
    ui.applyAppUpdate.disabled = false;
    ui.updateResult.dataset.kind = "";
    ui.updateResult.textContent = `更新を適用できませんでした: ${error.message}`;
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty || !state.originalHtml) return;
  event.preventDefault();
  event.returnValue = "";
});

loadAppInfo();
ui.loginRequired.addEventListener("change", async () => {
  loginReady = false;
  syncLoginControls();
  if (projectStore.project) {
    projectStore.project.loginRequired = ui.loginRequired.checked;
    try { await projectStore.saveProject(); }
    catch (error) { setStatus(`ログイン設定の保存に失敗しました: ${error.message}`, "error"); }
  }
});
ui.loginOpen.addEventListener("click", async () => {
  loginBusy = true;
  loginReady = false;
  syncLoginControls();
  try {
    const response = await postJson("/api/capture/start", { url: ui.projectBaseUrl.value.trim() });
    loginSessionId = (await response.json()).sessionId;
  } catch (error) { setStatus(`ログイン用ブラウザを開けませんでした: ${error.message}`, "error"); }
  finally { loginBusy = false; syncLoginControls(); }
});
async function finishLogin(completed) {
  loginBusy = true;
  syncLoginControls();
  try {
    await postJson(completed ? "/api/login/finish" : "/api/capture/cancel", { sessionId: loginSessionId });
    loginSessionId = "";
    loginReady = completed;
    setStatus(completed ? "ログイン準備が完了しました。検索・一括取得を開始できます。" : "ログイン待機を中止しました。", "success");
  } catch (error) { setStatus(`ログイン準備に失敗しました: ${error.message}`, "error"); }
  finally { loginBusy = false; syncLoginControls(); }
}
ui.loginDone.addEventListener("click", () => finishLogin(true));
ui.loginCancel.addEventListener("click", () => finishLogin(false));
ui.projectBaseUrl.addEventListener("input", () => { loginReady = false; syncLoginControls(); });
ui.manualPageUrl.addEventListener("input", syncProjectControls);
syncLoginControls();
updateGuidance();
showSelection(null);
