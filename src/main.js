import { PageEditor } from "./editor.js";
import { cleanHtmlString, downloadBlob, downloadHtml, EDITOR_CLASS, EDITOR_ID_ATTR, sanitizeImportedHtml } from "./html.js";
import { changeLabel, createRedlineReport, downloadDiffReport, downloadRedlineReport } from "./diff-report.js";
import { createProjectPackages, createProjectPackagesAsync, downloadProjectPackage } from "./project-package.js";
import { desktopFileSystemAvailable, saveDesktopOutput } from "./desktop-file-system.js";
import {
  DEFAULT_SEARCH_REPLACE_RULE,
  MAX_SEARCH_REPLACE_RULES,
  findTextMatches,
  normalizeSearchReplaceRule,
  validateSearchReplaceRule,
} from "./search-replace.js";
import { pagePathForUrl, ProjectStore } from "./project-storage.js";
import { comparePageHtml } from "./page-comparison.js";
import { appFetch } from "./runtime-api.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  loginRequired: $("#login-required"), loginOpen: $("#login-open"), loginDone: $("#login-done"),
  loginCancel: $("#login-cancel"), loginState: $("#login-state"),
  file: $("#html-file"), htmlImportButton: $("#html-import-button"), frame: $("#page-frame"), empty: $("#empty-state"), status: $("#status"),
  fileName: $("#file-name"), badge: $("#mode-badge"), original: $("#show-original"),
  modified: $("#show-modified"), redline: $("#show-redline"), undo: $("#undo"), redo: $("#redo"), reset: $("#reset"),
  searchReplace: $("#search-replace"), download: $("#download"),
  downloadDiff: $("#download-diff"),
  downloadRedline: $("#download-redline"),
  downloadPackage: $("#download-package"),
  fields: $("#inspector-fields"), label: $("#element-label"), text: $("#text-value"),
  link: $("#link-value"), removeImageLink: $("#remove-image-link"), alt: $("#alt-value"), image: $("#image-file"), imageUrl: $("#image-url-value"),
  inlineLinkTools: $("#inline-link-tools"), inlineLinkSelection: $("#inline-link-selection"),
  inlineLinkUrl: $("#inline-link-url"), applyInlineLink: $("#apply-inline-link"), removeInlineLink: $("#remove-inline-link"),
  classes: $("#class-value"), classOptions: $("#class-options"), saveSelectedImage: $("#save-selected-image"), before: $("#move-before"),
  after: $("#move-after"), selectParent: $("#select-parent-element"), returnChild: $("#return-child-element"), delete: $("#delete-element"),
  copyElement: $("#copy-element"), pasteBefore: $("#paste-before-element"), pasteAfter: $("#paste-after-element"),
  historyCount: $("#history-count"), historyList: $("#history-list"), clearHistory: $("#clear-history"),
  manualPageUrl: $("#manual-page-url"), addProjectUrl: $("#add-project-url"),
  captureSessionActions: $("#capture-session-actions"), finishCapture: $("#capture-current-page"),
  cancelCapture: $("#cancel-capture"), captureState: $("#capture-state"),
  selectProjectFolder: $("#select-project-folder"), projectName: $("#project-name"),
  recentProjects: $("#recent-projects"), recentProjectList: $("#recent-project-list"),
  projectBaseUrl: $("#project-base-url"), saveProjectPage: $("#save-project-page"),
  crawlProjectPages: $("#crawl-project-pages"),
  projectState: $("#project-state"), projectPages: $("#project-pages"), projectPageCount: $("#project-page-count"),
  showProjectList: $("#show-project-list"), showHeadingOutline: $("#show-heading-outline"),
  projectListPanel: $("#project-list-panel"), headingOutlinePanel: $("#heading-outline-panel"),
  headingOutline: $("#heading-outline"), headingCount: $("#heading-count"),
  selectAllProjectPages: $("#select-all-project-pages"), clearProjectSelection: $("#clear-project-selection"),
  batchCapturePages: $("#batch-capture-pages"),
  checkProjectPages: $("#check-project-pages"), resetProjectPages: $("#reset-project-pages"),
  deleteProjectPages: $("#delete-project-pages"), batchProgress: $("#batch-progress"),
  appVersion: $("#app-version"),
  saveState: $("#save-state"), selectionHelp: $("#selection-help"),
  pageStructurePanel: $("#page-structure-panel"), pageTitle: $("#page-title-value"),
  pageDescription: $("#page-description-value"), pageH1: $("#page-h1-value"),
  tableCreateTools: $("#table-create-tools"), tableRowCount: $("#table-row-count"),
  tableColumnCount: $("#table-column-count"), tableHeaderRow: $("#table-header-row"),
  insertTable: $("#insert-table"), tableEditTools: $("#table-edit-tools"),
  tableSelectionState: $("#table-selection-state"),
  addTableRowBefore: $("#add-table-row-before"), addTableRow: $("#add-table-row"),
  moveTableRowUp: $("#move-table-row-up"), moveTableRowDown: $("#move-table-row-down"),
  deleteTableRow: $("#delete-table-row"),
  addTableColumnBefore: $("#add-table-column-before"), addTableColumn: $("#add-table-column"),
  moveTableColumnLeft: $("#move-table-column-left"), moveTableColumnRight: $("#move-table-column-right"),
  deleteTableColumn: $("#delete-table-column"),
  toggleCellType: $("#toggle-cell-type"), toggleFirstColumnHeader: $("#toggle-first-column-header"),
  tableAlignLeft: $("#table-align-left"), tableAlignCenter: $("#table-align-center"), tableAlignRight: $("#table-align-right"),
  mergeCellRight: $("#merge-cell-right"), mergeCellDown: $("#merge-cell-down"), splitCell: $("#split-cell"),
  deleteTable: $("#delete-table"),
  importPreviewPage: $("#import-preview-page"), refreshPreview: $("#refresh-preview"),
  screenshotPreview: $("#screenshot-preview"), screenshotPreviewImage: $("#screenshot-preview-image"),
  resourceFailures: $("#resource-failures"), resourceFailureList: $("#resource-failure-list"),
  advancedMode: $("#advanced-mode"), inspector: $(".inspector"),
  workspace: $("#workspace"), projectSidebar: $(".project-sidebar"), projectSidebarResizer: $("#project-sidebar-resizer"),
  packageDialog: $("#package-dialog"), packageTargetSummary: $("#package-target-summary"),
  confirmPackageDownload: $("#confirm-package-download"),
  searchReplaceDialog: $("#search-replace-dialog"), searchReplaceConfig: $("#search-replace-config"),
  searchReplaceDragHandle: $("#search-replace-drag-handle"),
  searchReplaceReview: $("#search-replace-review"), searchRuleList: $("#search-rule-list"),
  searchReplaceOverview: $("#search-replace-overview"), searchOverviewSummary: $("#search-overview-summary"),
  searchOverviewRules: $("#search-overview-rules"), previewAllSearchRules: $("#preview-all-search-rules"),
  backSearchOverviewSettings: $("#back-search-overview-settings"),
  startSearchReplaceFromOverview: $("#start-search-replace-from-overview"),
  searchReplaceEmpty: $("#search-replace-empty"), searchEmptyCount: $("#search-empty-count"),
  searchEmptySummary: $("#search-empty-summary"), backSearchSettings: $("#back-search-settings"),
  addSearchRule: $("#add-search-rule"),
  exportSearchRules: $("#export-search-rules"), importSearchRules: $("#import-search-rules"),
  searchRulesFile: $("#search-rules-file"),
  saveSearchRules: $("#save-search-rules"), startSearchReplace: $("#start-search-replace"),
  searchReviewRule: $("#search-review-rule"), searchReviewProgress: $("#search-review-progress"),
  searchReviewContext: $("#search-review-context"), searchReviewBefore: $("#search-review-before"),
  searchReviewAfter: $("#search-review-after"), skipSearchMatch: $("#skip-search-match"),
  replaceSearchMatch: $("#replace-search-match"), replaceAllSearchRule: $("#replace-all-search-rule"),
  stopSearchReplace: $("#stop-search-replace"),
};

const state = {
  fileName: "page.html", originalHtml: "", modifiedHtml: "", mode: "modified", viewMode: "modified", changes: [], redoChanges: [],
  sourceUrl: "", activeProjectPageId: "", dirty: false, previewOnly: false, previewObjectUrl: "",
  focusedProjectUrl: "",
  projectSelectionAnchorUrl: "",
  selectedProjectUrls: new Set(), batchRunning: false, queuedCaptureUrls: new Set(), activeCaptureUrl: "",
  unavailableProjectUrls: new Set(),
  resourceFailures: [],
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
const projectStore = new ProjectStore();
const SIDEBAR_WIDTH_KEY = "web-revision-project-sidebar-width";
const PACKAGE_FILE_SELECTION_KEY = "web-revision-package-file-selection";
const SEARCH_REPLACE_RULES_KEY = "web-revision-search-replace-rules";
const AUTO_SAVE_DELAY_MS = 1200;
let editRevision = 0;
let autoSaveTimer = 0;
let autoSavePromise = Promise.resolve();
let autoSaveInProgress = false;
let autoSaveError = null;
let searchReplaceRules = [];
let searchReplaceSession = null;

function canAutoSaveCurrentPage() {
  return Boolean(projectStore.project && state.originalHtml && state.activeProjectPageId && !state.previewOnly);
}

function queueProjectSave({ quiet = true, force = false } = {}) {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = 0;
  }
  autoSavePromise = autoSavePromise.catch(() => {}).then(async () => {
    if ((!state.dirty && !force) || !canAutoSaveCurrentPage()) return null;
    autoSaveInProgress = true;
    autoSaveError = null;
    updateGuidance();
    try {
      return await saveCurrentToProject({ quiet });
    } catch (error) {
      autoSaveError = error;
      updateGuidance();
      if (quiet) setStatus(`自動保存に失敗しました: ${error.message}`, "error");
      throw error;
    } finally {
      autoSaveInProgress = false;
      updateGuidance();
    }
  });
  return autoSavePromise;
}

function scheduleAutoSave() {
  if (!canAutoSaveCurrentPage()) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = 0;
    void queueProjectSave().catch(() => {});
  }, AUTO_SAVE_DELAY_MS);
}

function markDirtyAndScheduleAutoSave() {
  editRevision += 1;
  state.dirty = true;
  autoSaveError = null;
  updateGuidance();
  scheduleAutoSave();
}

async function flushAutoSave({ force = false, quiet = true } = {}) {
  return queueProjectSave({ force, quiet });
}

function setProjectSidebarWidth(width, { persist = true } = {}) {
  const normalized = Math.round(Math.min(480, Math.max(160, width)));
  ui.workspace.style.setProperty("--project-sidebar-width", `${normalized}px`);
  ui.projectSidebarResizer.setAttribute("aria-valuenow", String(normalized));
  if (persist) localStorage.setItem(SIDEBAR_WIDTH_KEY, String(normalized));
}

function initializeProjectSidebarResize() {
  const savedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (Number.isFinite(savedWidth) && savedWidth > 0) setProjectSidebarWidth(savedWidth, { persist: false });
  else ui.projectSidebarResizer.setAttribute("aria-valuenow", String(Math.round(ui.projectSidebar.getBoundingClientRect().width)));

  ui.projectSidebarResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = ui.projectSidebar.getBoundingClientRect().width;
    ui.workspace.classList.add("resizing-sidebar");
    ui.projectSidebarResizer.setPointerCapture(event.pointerId);
    const move = (moveEvent) => setProjectSidebarWidth(startWidth + moveEvent.clientX - startX, { persist: false });
    const finish = () => {
      ui.workspace.classList.remove("resizing-sidebar");
      ui.projectSidebarResizer.removeEventListener("pointermove", move);
      ui.projectSidebarResizer.removeEventListener("pointerup", finish);
      ui.projectSidebarResizer.removeEventListener("pointercancel", finish);
      setProjectSidebarWidth(ui.projectSidebar.getBoundingClientRect().width);
    };
    ui.projectSidebarResizer.addEventListener("pointermove", move);
    ui.projectSidebarResizer.addEventListener("pointerup", finish);
    ui.projectSidebarResizer.addEventListener("pointercancel", finish);
  });
  ui.projectSidebarResizer.addEventListener("keydown", (event) => {
    const current = ui.projectSidebar.getBoundingClientRect().width;
    const next = event.key === "ArrowLeft" ? current - 20
      : event.key === "ArrowRight" ? current + 20
        : event.key === "Home" ? 160
          : event.key === "End" ? 480
            : null;
    if (next === null) return;
    event.preventDefault();
    setProjectSidebarWidth(next);
  });
  ui.projectSidebarResizer.addEventListener("dblclick", () => setProjectSidebarWidth(210));
}

function positionSearchReplaceDialog(left, top) {
  if (!ui.searchReplaceDialog.open) return;
  const rect = ui.searchReplaceDialog.getBoundingClientRect();
  const edge = 12;
  const normalizedLeft = Math.min(Math.max(edge, left), Math.max(edge, window.innerWidth - rect.width - edge));
  const normalizedTop = Math.min(Math.max(edge, top), Math.max(edge, window.innerHeight - rect.height - edge));
  Object.assign(ui.searchReplaceDialog.style, {
    margin: "0",
    left: `${Math.round(normalizedLeft)}px`,
    top: `${Math.round(normalizedTop)}px`,
    right: "auto",
    bottom: "auto",
  });
}

function centerSearchReplaceDialog() {
  if (!ui.searchReplaceDialog.open) return;
  const rect = ui.searchReplaceDialog.getBoundingClientRect();
  positionSearchReplaceDialog((window.innerWidth - rect.width) / 2, (window.innerHeight - rect.height) / 2);
}

function keepSearchReplaceDialogOnScreen() {
  if (!ui.searchReplaceDialog.open) return;
  const rect = ui.searchReplaceDialog.getBoundingClientRect();
  positionSearchReplaceDialog(rect.left, rect.top);
}

function positionSearchReplaceDialogAwayFrom(target) {
  if (!ui.searchReplaceDialog.open || !target) return;
  const dialog = ui.searchReplaceDialog.getBoundingClientRect();
  const edge = 12;
  const gap = 18;
  const maxLeft = Math.max(edge, window.innerWidth - dialog.width - edge);
  const maxTop = Math.max(edge, window.innerHeight - dialog.height - edge);
  const targetCenterX = (target.left + target.right) / 2;
  const targetCenterY = (target.top + target.bottom) / 2;
  const slots = [
    { id: "top-left", left: edge, top: edge },
    { id: "top-right", left: maxLeft, top: edge },
    { id: "bottom-left", left: edge, top: maxTop },
    { id: "bottom-right", left: maxLeft, top: maxTop },
  ];
  const expanded = {
    left: target.left - gap, top: target.top - gap,
    right: target.right + gap, bottom: target.bottom + gap,
  };
  const overlapArea = ({ left, top }) => {
    const right = left + dialog.width;
    const bottom = top + dialog.height;
    const overlapWidth = Math.max(0, Math.min(right, expanded.right) - Math.max(left, expanded.left));
    const overlapHeight = Math.max(0, Math.min(bottom, expanded.bottom) - Math.max(top, expanded.top));
    return overlapWidth * overlapHeight;
  };
  const previous = slots.find((slot) => slot.id === searchReplaceSession?.dialogPlacement);
  // 同じ位置の候補でウィンドウが行き来しないよう、重ならない限り前回位置を維持する。
  if (previous && overlapArea(previous) === 0) {
    positionSearchReplaceDialog(previous.left, previous.top);
    return;
  }
  const score = ({ left, top }) => {
    const distance = (left + dialog.width / 2 - targetCenterX) ** 2 + (top + dialog.height / 2 - targetCenterY) ** 2;
    return overlapArea({ left, top }) * 1_000_000 - distance;
  };
  const best = slots.sort((a, b) => score(a) - score(b))[0];
  if (searchReplaceSession) searchReplaceSession.dialogPlacement = best.id;
  positionSearchReplaceDialog(best.left, best.top);
}

function autoPositionSearchReplaceDialog(node, match) {
  const expected = searchReplaceSession?.current;
  const update = () => {
    if (!expected || searchReplaceSession?.current !== expected) return;
    positionSearchReplaceDialogAwayFrom(editor.getTextMatchViewportRect(node, match.index, match.length));
  };
  requestAnimationFrame(update);
  // 初回候補ではダイアログの横幅が縮小中なので、遷移完了後にも補正する。
  setTimeout(update, 180);
}

function initializeSearchReplaceDialogMovement() {
  ui.searchReplaceDragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    const rect = ui.searchReplaceDialog.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    ui.searchReplaceDialog.classList.add("dragging");
    ui.searchReplaceDragHandle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => positionSearchReplaceDialog(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
    const finish = () => {
      ui.searchReplaceDialog.classList.remove("dragging");
      ui.searchReplaceDragHandle.removeEventListener("pointermove", move);
      ui.searchReplaceDragHandle.removeEventListener("pointerup", finish);
      ui.searchReplaceDragHandle.removeEventListener("pointercancel", finish);
    };
    ui.searchReplaceDragHandle.addEventListener("pointermove", move);
    ui.searchReplaceDragHandle.addEventListener("pointerup", finish);
    ui.searchReplaceDragHandle.addEventListener("pointercancel", finish);
  });
  ui.searchReplaceDragHandle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const rect = ui.searchReplaceDialog.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 10;
    const horizontal = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const vertical = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    positionSearchReplaceDialog(rect.left + horizontal, rect.top + vertical);
  });
  window.addEventListener("resize", keepSearchReplaceDialogOnScreen);
}

function relaySearchDialogWheel(event) {
  if (!ui.searchReplaceDialog.open || (!ui.searchReplaceDialog.classList.contains("reviewing")
    && !ui.searchReplaceDialog.classList.contains("overviewing"))) return;
  const frameRect = ui.frame.getBoundingClientRect();
  const overFrame = event.clientX >= frameRect.left && event.clientX <= frameRect.right
    && event.clientY >= frameRect.top && event.clientY <= frameRect.bottom;
  const dialogRect = ui.searchReplaceDialog.getBoundingClientRect();
  const overDialog = event.clientX >= dialogRect.left && event.clientX <= dialogRect.right
    && event.clientY >= dialogRect.top && event.clientY <= dialogRect.bottom;
  if (!overFrame || overDialog) return;
  event.preventDefault();
  editor.scrollBy(event.deltaX, event.deltaY);
}

window.addEventListener("wheel", relaySearchDialogWheel, { capture: true, passive: false });

async function loadAppInfo() {
  try {
    const response = await appFetch("/api/app-info", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    ui.appVersion.textContent = `v${data.version}`;
    ui.appVersion.title = `アプリのバージョン: v${data.version}`;
  } catch (error) {
    ui.appVersion.textContent = "v--";
    console.warn("App information could not be loaded:", error);
  }
}
function recordChange(change) {
  if (change.type === "element-delete") {
    const removedElementIds = new Set(change.removedElementIds || [change.elementId]);
    const cancelsAddition = state.changes.some((item) => item.type === "element-add" && removedElementIds.has(item.elementId));
    if (cancelsAddition) {
      state.changes = state.changes.filter((item) => !removedElementIds.has(item.elementId));
      return "cancelled-add-delete";
    }
  }
  if (change.type !== "element-move") {
    state.changes.push(change);
    return "added";
  }
  const parentMoveIndexes = state.changes
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === "element-move" && item.parentId === change.parentId)
    .map(({ index }) => index);
  const firstParentMove = parentMoveIndexes.length ? state.changes[parentMoveIndexes[0]] : null;
  const originalOrder = firstParentMove?.parentOrderBefore;
  const finalOrder = change.parentOrderAfter;
  if (Array.isArray(originalOrder) && Array.isArray(finalOrder)
    && originalOrder.length === finalOrder.length
    && originalOrder.every((elementId, index) => elementId === finalOrder[index])) {
    for (const index of parentMoveIndexes.toReversed()) state.changes.splice(index, 1);
    return "cancelled-move";
  }
  const previousIndex = state.changes.findLastIndex((item) => item.type === "element-move"
    && item.elementId === change.elementId
    && item.parentId === change.parentId);
  if (previousIndex < 0) {
    state.changes.push(change);
    return "added";
  }
  const previous = state.changes.splice(previousIndex, 1)[0];
  const merged = {
    ...previous,
    after: change.after,
    toIndex: change.toIndex,
    timestamp: change.timestamp,
  };
  if (merged.fromIndex === merged.toIndex) return "cancelled-move";
  state.changes.push(merged);
  return "merged";
}

function changesFromOriginal() {
  if (!state.changes.length || !state.modifiedHtml) return structuredClone(state.changes);
  const doc = new DOMParser().parseFromString(state.modifiedHtml, "text/html");
  const elementsById = new Map(
    [...doc.querySelectorAll(`[${EDITOR_ID_ATTR}]`)]
      .map((element) => [element.getAttribute(EDITOR_ID_ATTR), element]),
  );
  const absorbedIndexes = new Set();
  const normalized = [];

  state.changes.forEach((change, index) => {
    if (absorbedIndexes.has(index)) return;
    if (change.type !== "element-add" || !change.elementId) {
      normalized.push(structuredClone(change));
      return;
    }

    const addedElement = elementsById.get(change.elementId);
    if (!addedElement) {
      normalized.push(structuredClone(change));
      return;
    }
    const addedIds = new Set(
      [addedElement, ...addedElement.querySelectorAll(`[${EDITOR_ID_ATTR}]`)]
        .map((element) => element.getAttribute(EDITOR_ID_ATTR))
        .filter(Boolean),
    );
    state.changes.forEach((candidate, candidateIndex) => {
      if (candidateIndex === index || candidateIndex < index) return;
      if (candidate.type === "table-change") return;
      if (addedIds.has(candidate.elementId) || addedIds.has(candidate.parentId)) absorbedIndexes.add(candidateIndex);
    });
    const parent = addedElement.parentElement;
    normalized.push({
      ...structuredClone(change),
      after: addedElement.outerHTML,
      parentId: parent?.getAttribute(EDITOR_ID_ATTR) || change.parentId,
      index: parent ? [...parent.children].indexOf(addedElement) : change.index,
    });
  });
  return normalized;
}

const editor = new PageEditor(ui.frame, {
  onSelect: showSelection,
  onTextSelection: showInlineLinkSelection,
  onChange: (change) => {
    state.modifiedHtml = editor.getHtml();
    if (change) {
      const result = recordChange(change);
      state.redoChanges = [];
      markDirtyAndScheduleAutoSave();
      renderHistory();
      syncPageStructureFields();
      renderHeadingOutline();
      if (result === "cancelled-move") {
        updateGuidance();
        setStatus("要素を元の位置へ戻したため、移動履歴を取り消しました。", "success");
        return;
      }
      if (result === "cancelled-add-delete") {
        updateGuidance();
        setStatus("追加した要素を削除したため、追加・削除履歴を取り消しました。", "success");
        return;
      }
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
  if (autoSaveInProgress) {
    ui.saveState.textContent = "自動保存中…";
    ui.saveState.className = "save-state dirty";
  } else if (autoSaveError && state.dirty) {
    ui.saveState.textContent = "自動保存失敗";
    ui.saveState.className = "save-state dirty";
  } else if (state.dirty) {
    ui.saveState.textContent = "自動保存待ち";
    ui.saveState.className = "save-state dirty";
  } else {
    ui.saveState.textContent = "自動保存済み";
    ui.saveState.className = "save-state saved";
  }
}

function setStatus(message, kind = "info") {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

function setButtonProcessing(button, processing) {
  if (!button) return;
  if (processing) {
    if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
    button.dataset.idleAriaLabel = button.getAttribute("aria-label") ?? "";
    button.dataset.idleDisabled = button.disabled ? "true" : "false";
    button.setAttribute("aria-label", `${button.dataset.idleText}（処理中）`);
    button.classList.add("is-processing");
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    return;
  }
  if (button.dataset.idleAriaLabel) button.setAttribute("aria-label", button.dataset.idleAriaLabel);
  else button.removeAttribute("aria-label");
  delete button.dataset.idleText;
  delete button.dataset.idleAriaLabel;
  if (button.dataset.idleDisabled !== undefined) button.disabled = button.dataset.idleDisabled === "true";
  delete button.dataset.idleDisabled;
  button.classList.remove("is-processing");
  button.removeAttribute("aria-busy");
}

function setControls(enabled) {
  const changeCount = changesFromOriginal().length;
  [ui.original, ui.reset, ui.download].forEach((button) => { button.disabled = !enabled; });
  ui.modified.disabled = !enabled || state.previewOnly;
  ui.redline.disabled = !enabled || state.previewOnly || changeCount === 0;
  ui.searchReplace.disabled = !enabled || state.previewOnly;
  ui.downloadPackage.disabled = !enabled;
  ui.downloadDiff.disabled = !enabled || changeCount === 0;
  ui.downloadRedline.disabled = !enabled || changeCount === 0;
  ui.pageStructurePanel.hidden = !enabled || state.previewOnly;
  ui.insertTable.disabled = !enabled || state.previewOnly || state.mode !== "modified";
  ui.pageTitle.disabled = ui.pageDescription.disabled = ui.pageH1.disabled = !enabled || state.previewOnly || state.mode !== "modified";
  ui.showHeadingOutline.disabled = !enabled || state.previewOnly;
  syncTableToolsVisibility();
  updateUndoControls();
  syncProjectControls();
}

function syncTableToolsVisibility(tableContext = editor.getTableContext()) {
  const available = Boolean(state.originalHtml) && !state.previewOnly;
  const tableSelected = state.mode === "modified" && Boolean(tableContext);
  ui.tableCreateTools.hidden = !available || !ui.advancedMode.checked;
  ui.tableEditTools.hidden = !available || !tableSelected;
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
  const selected = actionTargetPages(listed);
  ui.selectAllProjectPages.disabled = state.batchRunning || listed.length === 0;
  ui.clearProjectSelection.disabled = state.batchRunning || (state.selectedProjectUrls.size === 0 && !state.focusedProjectUrl);
  ui.batchCapturePages.disabled = loginBlocked() || state.batchRunning || selected.length === 0;
  ui.checkProjectPages.disabled = loginBlocked() || state.batchRunning || !selected.some((page) => page.saved);
  ui.resetProjectPages.disabled = state.batchRunning || !selected.some((page) => page.saved);
  ui.deleteProjectPages.disabled = state.batchRunning || selected.length === 0;
  ui.reset.disabled = state.batchRunning || (!state.originalHtml && !selected.some((page) => page.saved));
  ui.downloadPackage.disabled = state.batchRunning || (!state.originalHtml && !selected.some((page) => page.saved));
}

function updateUndoControls() {
  const editable = Boolean(state.originalHtml) && state.mode === "modified";
  ui.undo.disabled = !editable || state.changes.length === 0;
  ui.redo.disabled = !editable || state.redoChanges.length === 0;
}

function renderHistory() {
  const changes = changesFromOriginal();
  ui.historyCount.textContent = String(changes.length);
  ui.clearHistory.disabled = state.changes.length === 0;
  ui.downloadDiff.disabled = !state.originalHtml || changes.length === 0;
  ui.downloadRedline.disabled = !state.originalHtml || changes.length === 0;
  ui.redline.disabled = !state.originalHtml || state.previewOnly || changes.length === 0;
  updateUndoControls();
  updateGuidance();
  if (!changes.length) {
    ui.historyList.innerHTML = '<li class="history-empty">まだ変更はありません。</li>';
    return;
  }
  ui.historyList.replaceChildren(...changes.map((change, index) => {
    const item = document.createElement("li");
    const type = document.createElement("strong");
    const target = document.createElement("span");
    const labelText = change.action ? `${changeLabel(change.type)}（${change.action}）` : changeLabel(change.type);
    type.textContent = `${index + 1}. ${labelText}`;
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
      ? createRedlineReport(state.modifiedHtml, changesFromOriginal(), state.fileName)
      : state.modifiedHtml;
  await editor.load(html, mode === "modified");
  editor.getDocument()?.addEventListener("keydown", handleKeyboardShortcut);
  if (mode === "modified") refreshClassOptions();
  syncPageStructureFields();
  if (mode === "modified") renderHeadingOutline();
  setControls(Boolean(state.originalHtml));
}

function refreshClassOptions() {
  ui.classOptions.replaceChildren(...editor.getClassNames().map((name) => {
    const option = document.createElement("option");
    option.value = name;
    return option;
  }));
}

function syncPageStructureFields() {
  const structure = editor.getPageStructure();
  ui.pageTitle.value = structure.title;
  ui.pageDescription.value = structure.description;
  ui.pageH1.value = structure.primaryHeading;
}

function renderHeadingOutline() {
  const headings = editor.getPageStructure().headings;
  ui.headingCount.textContent = String(headings.length);
  if (!headings.length) {
    ui.headingOutline.innerHTML = '<p class="project-empty">H1〜H3の見出しはありません。</p>';
    return;
  }
  ui.headingOutline.replaceChildren(...headings.map((heading) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = String(heading.level);
    button.dataset.elementId = heading.id;
    const level = document.createElement("span");
    const text = document.createElement("strong");
    level.textContent = `H${heading.level}`;
    text.textContent = heading.text;
    button.append(level, text);
    button.addEventListener("click", async () => {
      if (state.mode !== "modified") await render("modified");
      editor.selectById(heading.id);
    });
    return button;
  }));
  syncHeadingOutlineSelection();
}

function syncHeadingOutlineSelection() {
  const selectedHeading = editor.selected?.closest?.("h1, h2, h3");
  const selectedId = selectedHeading?.getAttribute(EDITOR_ID_ATTR) || "";
  ui.headingOutline.querySelectorAll("button[data-element-id]").forEach((button) => {
    button.classList.toggle("active", button.dataset.elementId === selectedId);
  });
}

function setSidebarPanel(panel) {
  const outline = panel === "outline";
  ui.projectListPanel.hidden = outline;
  ui.headingOutlinePanel.hidden = !outline;
  ui.showProjectList.classList.toggle("active", !outline);
  ui.showHeadingOutline.classList.toggle("active", outline);
  ui.showProjectList.setAttribute("aria-selected", String(!outline));
  ui.showHeadingOutline.setAttribute("aria-selected", String(outline));
}

function selectedImage(element) {
  const ImageType = ui.frame.contentWindow?.HTMLImageElement;
  return ImageType && element instanceof ImageType ? element : null;
}

function showInlineLinkSelection(selection) {
  ui.inlineLinkTools.hidden = !selection;
  if (!selection) {
    ui.inlineLinkSelection.textContent = "文章をダブルクリックして編集状態にし、リンクにする文字を選択してください。";
    ui.inlineLinkUrl.value = "";
    ui.applyInlineLink.disabled = true;
    ui.removeInlineLink.disabled = true;
    return;
  }
  ui.inlineLinkSelection.textContent = `選択中: ${selection.text}`;
  ui.inlineLinkUrl.value = selection.href;
  ui.applyInlineLink.disabled = false;
  ui.removeInlineLink.disabled = !selection.linked;
}

function showSelection(element, selectedElements = element ? [element] : []) {
  syncHeadingOutlineSelection();
  const editable = Boolean(element) && state.mode === "modified";
  ui.fields.disabled = !editable;
  const selectionCount = selectedElements.length;
  const tableContext = selectionCount === 1 ? editor.getTableContext() : null;
  syncTableToolsVisibility(tableContext);
  ui.tableEditTools.hidden = !editable || !tableContext;
  if (tableContext) {
    ui.tableSelectionState.textContent = `表（${tableContext.rowCount}行 × ${tableContext.columnCount}列）を選択中`;
    ui.deleteTableRow.disabled = tableContext.rowCount <= 1;
    ui.deleteTableColumn.disabled = tableContext.columnCount <= 1;
    ui.moveTableRowUp.disabled = tableContext.rowIndex <= 0;
    ui.moveTableRowDown.disabled = tableContext.rowIndex >= tableContext.rowCount - 1;
    ui.moveTableColumnLeft.disabled = tableContext.columnIndex <= 0;
    ui.moveTableColumnRight.disabled = tableContext.columnIndex >= tableContext.columnCount - 1;
    const canSplit = Boolean(tableContext.cell && ((tableContext.cell.colSpan || 1) > 1 || (tableContext.cell.rowSpan || 1) > 1));
    ui.splitCell.disabled = !canSplit;
    ui.toggleCellType.disabled = !tableContext.cell;
    ui.mergeCellRight.disabled = !tableContext.cell;
    ui.mergeCellDown.disabled = !tableContext.cell;
    ui.tableAlignLeft.disabled = !tableContext.cell;
    ui.tableAlignCenter.disabled = !tableContext.cell;
    ui.tableAlignRight.disabled = !tableContext.cell;
  }
  ui.label.textContent = selectionCount > 1 ? `${selectionCount}個の要素を選択` : element ? describeElement(element) : "未選択";
  const fieldVisibility = {
    text: false, link: false, image: false, "image-url": false, alt: false, class: Boolean(element), "inline-link": editor.hasInlineLinkSelection(),
  };
  if (!element) {
    ui.copyElement.disabled = true;
    ui.pasteBefore.disabled = true;
    ui.pasteAfter.disabled = true;
    ui.selectParent.disabled = true;
    ui.returnChild.disabled = true;
    ui.text.value = ui.link.value = ui.alt.value = ui.imageUrl.value = ui.classes.value = "";
    ui.selectionHelp.textContent = state.previewOnly
      ? "一時プレビューです。編集するには「このページを取り込んで編集」を押してください。"
      : state.mode === "redline"
        ? "変更された文章、画像、リンク、追加・削除・移動箇所をページ上で確認できます。"
      : state.mode === "original"
      ? "修正前は参照専用です。「修正後」を押すと編集できます。"
      : "直したい要素をクリックしてください。Ctrl/Cmd+クリックで追加選択、同じ階層ではShift+クリックで範囲選択できます。";
    document.querySelectorAll("[data-editor-field]").forEach((field) => { field.hidden = true; });
    return;
  }
  if (selectionCount > 1) {
    ui.text.value = ui.link.value = ui.alt.value = ui.imageUrl.value = ui.classes.value = "";
    document.querySelectorAll("[data-editor-field]").forEach((field) => { field.hidden = true; });
    ui.copyElement.disabled = !editor.canCopySelection();
    ui.pasteBefore.disabled = true;
    ui.pasteAfter.disabled = true;
    ui.selectParent.disabled = true;
    ui.returnChild.disabled = true;
    ui.before.disabled = true;
    ui.after.disabled = true;
    ui.delete.disabled = false;
    ui.selectionHelp.textContent = "複数選択中です。選択した要素をまとめて削除できます。Ctrl/Cmd+クリックで追加・解除、同じ階層ではShift+クリックで範囲選択できます。";
    return;
  }
  ui.copyElement.disabled = !editor.canCopySelection();
  ui.pasteBefore.disabled = !editor.canPaste();
  ui.pasteAfter.disabled = !editor.canPaste();
  ui.selectParent.disabled = !editor.canSelectParent();
  ui.returnChild.disabled = !editor.canReturnToChild();
  ui.before.disabled = false;
  ui.after.disabled = false;
  ui.delete.disabled = false;
  const classNames = [...element.classList].filter((name) => name !== EDITOR_CLASS);
  const link = element.closest("a");
  const image = selectedImage(element);
  const textEditable = !["IMG", "SCRIPT", "STYLE", "HTML", "HEAD", "BODY"].includes(element.tagName);
  fieldVisibility.text = textEditable;
  fieldVisibility.link = Boolean(link || image);
  fieldVisibility.image = Boolean(image);
  fieldVisibility["image-url"] = Boolean(image);
  fieldVisibility.alt = Boolean(image);
  document.querySelectorAll("[data-editor-field]").forEach((field) => {
    field.hidden = !fieldVisibility[field.dataset.editorField];
  });
  ui.selectionHelp.textContent = image
    ? "画像を選択中です。画像、代替テキスト、リンク先を変更できます。"
    : link
      ? "リンク付きの要素を選択中です。文章とリンク先を変更できます。"
      : textEditable
        ? "文章を変更できます。ページ上でダブルクリックして直接編集することもできます。"
        : "このブロックはコピー、移動、削除ができます。";
  ui.text.value = ["IMG", "SCRIPT", "STYLE", "HTML", "HEAD", "BODY"].includes(element.tagName) ? "" : element.textContent ?? "";
  ui.text.disabled = ["IMG", "SCRIPT", "STYLE", "HTML", "HEAD", "BODY"].includes(element.tagName);
  ui.link.value = link?.getAttribute("href") ?? "";
  ui.link.disabled = !link && !image;
  ui.removeImageLink.hidden = !image || !link;
  ui.alt.value = image?.alt ?? "";
  ui.alt.disabled = !image;
  ui.image.disabled = !image;
  ui.saveSelectedImage.disabled = !image;
  ui.imageUrl.value = image?.getAttribute("src") ?? "";
  ui.imageUrl.disabled = !image;
  ui.classes.value = classNames.join(" ");
}

function describeElement(element) {
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList].filter((name) => name !== EDITOR_CLASS).slice(0, 2);
  return `${element.tagName.toLowerCase()}${id}${classes.map((name) => `.${name}`).join("")}`;
}

async function loadHtml(html, fileName, options = {}) {
  if (!/<(?:!doctype|html|head|body)[\s>]/i.test(html)) throw new Error("HTML文書として認識できませんでした。");
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = 0;
  }
  editRevision += 1;
  autoSaveError = null;
  state.fileName = fileName || "captured-page.html";
  state.originalHtml = html;
  state.modifiedHtml = options.workingHtml || html;
  state.changes = options.changes || [];
  state.redoChanges = [];
  state.sourceUrl = options.sourceUrl ?? sourceUrlFromHtml(html);
  if (state.sourceUrl) state.focusedProjectUrl = state.sourceUrl;
  state.activeProjectPageId = options.activeProjectPageId || "";
  state.dirty = options.dirty ?? true;
  state.previewOnly = options.previewOnly ?? false;
  state.resourceFailures = Array.isArray(options.resourceFailures) ? options.resourceFailures : [];
  clearScreenshotPreview();
  renderResourceFailures();
  renderHistory();
  ui.fileName.textContent = state.fileName;
  ui.empty.hidden = true;
  ui.frame.hidden = false;
  ui.importPreviewPage.hidden = true;
  ui.refreshPreview.hidden = true;
  setControls(true);
  await render(state.previewOnly ? "original" : state.viewMode, { captureCurrent: false });
  renderProjectPages();
  updateGuidance();
  document.querySelector("#setup-panel").open = false;
}

function renderResourceFailures() {
  const failures = state.resourceFailures || [];
  ui.resourceFailures.hidden = failures.length === 0;
  ui.resourceFailureList.replaceChildren(...failures.map((failure) => {
    const item = document.createElement("li");
    item.textContent = `${failure.url || "関連ファイル"}：${failure.reason || "取得できませんでした"}`;
    return item;
  }));
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

function actionTargetPages(listed = listedProjectPages()) {
  return listed.filter((page) => state.selectedProjectUrls.has(page.url) || page.url === state.focusedProjectUrl);
}

function handleProjectPageClick(event, page, listed) {
  const additive = event.ctrlKey || event.metaKey;
  if (event.shiftKey) {
    const anchorUrl = state.projectSelectionAnchorUrl || state.focusedProjectUrl || page.url;
    const anchorIndex = Math.max(0, listed.findIndex((item) => item.url === anchorUrl));
    const targetIndex = listed.findIndex((item) => item.url === page.url);
    if (!additive) state.selectedProjectUrls.clear();
    listed.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
      .forEach((item) => state.selectedProjectUrls.add(item.url));
    state.focusedProjectUrl = page.url;
    renderProjectPages();
    return;
  }
  if (additive) {
    const activeUrl = ui.projectPages.querySelector(".project-page.active")?.dataset.pageUrl || "";
    const previousUrls = new Set([state.focusedProjectUrl, state.projectSelectionAnchorUrl, activeUrl]);
    previousUrls.delete("");
    previousUrls.delete(page.url);
    previousUrls.forEach((url) => state.selectedProjectUrls.add(url));
    if (state.selectedProjectUrls.has(page.url)) state.selectedProjectUrls.delete(page.url);
    else state.selectedProjectUrls.add(page.url);
    state.focusedProjectUrl = page.url;
    state.projectSelectionAnchorUrl = page.url;
    renderProjectPages();
    return;
  }
  state.focusedProjectUrl = page.url;
  state.projectSelectionAnchorUrl = page.url;
  renderProjectPages();
  return page.saved ? openProjectPage(page.id) : previewUncapturedProjectPage(page);
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
      state.focusedProjectUrl = page.url;
      state.projectSelectionAnchorUrl = page.url;
      renderProjectPages();
    });
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pageUrl = page.url;
    button.className = "project-page";
    button.classList.toggle("saved", page.saved);
    button.classList.toggle("changed", page.checkStatus === "changed");
    button.classList.toggle("unavailable", state.unavailableProjectUrls.has(page.url));
    button.classList.toggle("active", page.url === state.focusedProjectUrl);
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
      ? state.unavailableProjectUrls.has(page.url) ? "保存データを開けません・削除可能" : savedStatus
      : state.activeCaptureUrl === page.url
        ? "画像・ページを取得中"
        : state.queuedCaptureUrls.has(page.url)
          ? "優先取得待ち"
          : "未取得・クリックして画像とページを取得";
    button.append(title, path, status);
    button.addEventListener("click", (event) => handleProjectPageClick(event, page, listed));
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
  let resourceFailures = [];
  try { resourceFailures = JSON.parse(decodeURIComponent(response.headers.get("X-Captured-Resource-Failures") || "[]")); } catch {}
  return {
    html,
    fileName: decodeURIComponent(response.headers.get("X-Captured-Filename") || "captured-page.html"),
    url: decodeURIComponent(response.headers.get("X-Captured-Url") || url),
    resourceFailures: Array.isArray(resourceFailures) ? resourceFailures : [],
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
      await loadHtml(captured.html, captured.fileName, { sourceUrl: captured.url, resourceFailures: captured.resourceFailures, dirty: true });
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
  const targets = actionTargetPages().filter((page) => page.saved);
  if (!targets.length) return;
  const message = `${targets.length}ページを未取得状態へ戻します。\n\n原本・編集中・修正後・差分・変更履歴・旧版バックアップが案件フォルダから削除されます。URLは一覧に残ります。続けますか？`;
  if (!window.confirm(message)) return;
  state.batchRunning = true;
  setButtonProcessing(ui.resetProjectPages, true);
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
    setButtonProcessing(ui.resetProjectPages, false);
    renderProjectPages();
    updateBatchControls();
  }
}

async function deleteSelectedProjectPages() {
  const targets = actionTargetPages();
  if (!targets.length) return;
  const savedCount = targets.filter((page) => page.saved).length;
  const knownErrorCount = targets.filter((page) => state.unavailableProjectUrls.has(page.url)).length;
  const folderText = savedCount
    ? `\n\n保存済み${savedCount}ページは、原本・編集中・修正後・差分・変更履歴を実体フォルダから削除します。`
    : "";
  const errorText = knownErrorCount
    ? `\n\n保存データを開けない${knownErrorCount}ページは、実体の状態にかかわらず一覧と案件管理情報から除去します。`
    : "";
  if (!window.confirm(`${targets.length}ページを一覧から削除します。${folderText}${errorText}\n\nこの操作は元に戻せません。続けますか？`)) return;
  state.batchRunning = true;
  setButtonProcessing(ui.deleteProjectPages, true);
  updateBatchControls();
  try {
    const activeDeleted = targets.some((page) => page.id && page.id === state.activeProjectPageId);
    const urls = targets.map((page) => page.url);
    let result;
    try {
      result = await projectStore.deletePages(urls, { force: knownErrorCount > 0 });
    } catch {
      result = await projectStore.deletePages(urls, { force: true });
    }
    result.deletedUrls.forEach((url) => {
      state.selectedProjectUrls.delete(url);
      state.queuedCaptureUrls.delete(url);
      state.unavailableProjectUrls.delete(url);
    });
    targets.forEach((page) => state.unavailableProjectUrls.delete(page.url));
    if (targets.some((page) => page.url === state.focusedProjectUrl)) state.focusedProjectUrl = "";
    if (activeDeleted) clearLoadedPage();
    ui.projectState.textContent = `${projectStore.project.projectName}：保存済み${projectStore.project.pages.length}ページ`;
    const cleanupNote = result.cleanupErrors.length
      ? ` 実体を削除できなかった${result.cleanupErrors.length}ページは管理情報のみ除去しました。`
      : "";
    setStatus(`${targets.length}ページを一覧から削除しました。${cleanupNote}`, "success");
  } catch (error) {
    setStatus(`ページを一覧から削除できませんでした: ${error.message}`, "error");
  } finally {
    state.batchRunning = false;
    setButtonProcessing(ui.deleteProjectPages, false);
    renderProjectPages();
    updateBatchControls();
  }
}

async function processSelectedPages(mode) {
  if (loginBlocked()) return setStatus("先にログインを完了してください。", "error");
  if (captureSessionId) return setStatus("取得用ブラウザを取り込みまたはキャンセルしてから一括処理してください。", "error");
  const selected = actionTargetPages();
  const targets = mode === "check" ? selected.filter((page) => page.saved) : selected;
  if (!targets.length) return;
  state.batchRunning = true;
  const actionButton = mode === "check" ? ui.checkProjectPages : ui.batchCapturePages;
  setButtonProcessing(actionButton, true);
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
          resourceFailures: captured.resourceFailures,
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
  setButtonProcessing(actionButton, false);
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
  state.selectedProjectUrls = new Set(pages.map((page) => page.url));
  state.projectSelectionAnchorUrl = pages[0]?.url || "";
  renderProjectPages();
});
ui.clearProjectSelection.addEventListener("click", () => {
  state.selectedProjectUrls.clear();
  state.focusedProjectUrl = "";
  state.projectSelectionAnchorUrl = "";
  renderProjectPages();
});
ui.batchCapturePages.addEventListener("click", () => processSelectedPages("capture"));
ui.checkProjectPages.addEventListener("click", () => processSelectedPages("check"));
ui.resetProjectPages.addEventListener("click", resetSelectedProjectPages);
ui.deleteProjectPages.addEventListener("click", deleteSelectedProjectPages);

ui.importPreviewPage.addEventListener("click", async () => {
  if (!state.previewOnly || !state.sourceUrl) return;
  setButtonProcessing(ui.importPreviewPage, true);
  ui.refreshPreview.disabled = true;
  try {
    setStatus("編集用HTMLを取得しています…", "info");
    const captured = await captureUrlDirectly(state.sourceUrl);
    await loadHtml(captured.html, captured.fileName, { sourceUrl: captured.url, resourceFailures: captured.resourceFailures, dirty: true });
    await saveCurrentToProject({ quiet: true });
    setStatus("ページを案件フォルダへ取り込みました。中央の画面で編集できます。", "success");
  } catch (error) {
    setStatus(`ページを取り込めませんでした: ${error.message}`, "error");
  } finally {
    setButtonProcessing(ui.importPreviewPage, false);
    ui.importPreviewPage.disabled = false;
    ui.refreshPreview.disabled = false;
  }
});

ui.refreshPreview.addEventListener("click", async () => {
  if (!state.previewOnly || !state.sourceUrl) return;
  setButtonProcessing(ui.refreshPreview, true);
  ui.importPreviewPage.disabled = true;
  try {
    setStatus("最新のスクリーンショットを取得しています…", "info");
    const preview = await captureScreenshot(state.sourceUrl, true);
    showScreenshotPreview(preview);
    setStatus("スクリーンショットを更新しました。", "success");
  } catch (error) {
    setStatus(`スクリーンショットを更新できませんでした: ${error.message}`, "error");
  } finally {
    setButtonProcessing(ui.refreshPreview, false);
    ui.refreshPreview.disabled = false;
    ui.importPreviewPage.disabled = false;
  }
});

async function saveCurrentToProject({ quiet = false } = {}) {
  if (!state.originalHtml) throw new Error("保存するページがありません。");
  const revisionAtStart = editRevision;
  projectStore.setMetadata({
    projectName: ui.projectName.value,
    baseUrl: ui.projectBaseUrl.value,
  });
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  const sourceUrl = state.sourceUrl || ui.manualPageUrl.value.trim();
  if (!sourceUrl) throw new Error("ページURLが不明です。「その他の取り込み」でページURLを指定してください。");
  const saveData = {
    fileName: state.fileName,
    sourceUrl,
    originalHtml: state.originalHtml,
    workingHtml: state.modifiedHtml,
    changes: changesFromOriginal(),
    resourceFailures: state.resourceFailures,
  };
  const page = await projectStore.savePage({
    ...saveData,
  });
  state.sourceUrl = page.url;
  state.activeProjectPageId = page.id;
  state.unavailableProjectUrls.delete(page.url);
  state.dirty = editRevision !== revisionAtStart;
  if (state.dirty) scheduleAutoSave();
  updateGuidance();
  renderProjectPages();
  ui.projectState.textContent = `${projectStore.project.projectName}：${projectStore.project.pages.length}ページ`;
  if (!quiet) setStatus(`案件フォルダの ${page.path} へ保存しました。`, "success");
  return page;
}

async function openProjectPage(pageId) {
  if (pageId === state.activeProjectPageId) return;
  const pageInfo = projectStore.project?.pages.find((page) => page.id === pageId);
  try {
    if (!(await preserveCurrentPage())) return;
    const saved = await projectStore.loadPage(pageId);
    await loadHtml(saved.originalHtml, saved.page.fileName, {
      workingHtml: saved.workingHtml,
      changes: saved.changes,
      resourceFailures: saved.page.resourceFailures,
      sourceUrl: saved.page.url,
      activeProjectPageId: saved.page.id,
      dirty: false,
    });
    ui.manualPageUrl.value = saved.page.url;
    state.unavailableProjectUrls.delete(saved.page.url);
    setStatus(`案件ページ「${saved.page.title}」を開きました。`, "success");
  } catch (error) {
    if (pageInfo?.url) state.unavailableProjectUrls.add(pageInfo.url);
    renderProjectPages();
    setStatus(`案件ページを開けませんでした: ${error.message}`, "error");
  }
}

async function preserveCurrentPage() {
  if (!state.dirty || !state.originalHtml) return true;
  if (!projectStore.project || state.previewOnly) {
    setStatus("現在のページを自動保存できないため、案件を切り替えられません。", "error");
    return false;
  }
  try {
    if (canAutoSaveCurrentPage()) await flushAutoSave({ force: true });
    else await saveCurrentToProject({ quiet: true });
    return !state.dirty;
  } catch (error) {
    setStatus(`自動保存に失敗したため、案件を切り替えませんでした: ${error.message}`, "error");
    return false;
  }
}

function activateProject(project) {
  clearLoadedPage();
  state.activeProjectPageId = "";
  state.focusedProjectUrl = "";
  state.projectSelectionAnchorUrl = "";
  state.unavailableProjectUrls = new Set();
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
}

async function refreshRecentProjects() {
  const projects = await projectStore.listRecentDirectories().catch(() => []);
  ui.recentProjects.hidden = projects.length === 0;
  ui.recentProjectList.replaceChildren(...projects.map((project) => {
    const item = document.createElement("span");
    item.className = "recent-project-item";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "recent-project-open";
    open.textContent = project.name;
    open.title = project.path;
    open.addEventListener("click", async () => {
      try {
        if (!(await preserveCurrentPage())) return;
        activateProject(await projectStore.openRecentDirectory(project.path));
        await refreshRecentProjects();
      } catch (error) {
        setStatus(`最近の案件を開けませんでした: ${error.message}`, "error");
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "recent-project-remove";
    remove.textContent = "履歴削除";
    remove.title = "履歴だけを削除します。案件フォルダは削除しません。";
    remove.addEventListener("click", async () => {
      await projectStore.removeRecentDirectory(project.path);
      await refreshRecentProjects();
    });
    item.append(open, remove);
    return item;
  }));
}

ui.selectProjectFolder.addEventListener("click", async () => {
  try {
    if (!(await preserveCurrentPage())) return;
    const project = await projectStore.selectDirectory();
    activateProject(project);
    await refreshRecentProjects();
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`案件フォルダを開けませんでした: ${error.message}`, "error");
  }
});

ui.saveProjectPage.addEventListener("click", async () => {
  ui.saveProjectPage.disabled = true;
  try {
    await flushAutoSave({ force: true, quiet: false });
  } catch (error) {
    setStatus(`案件フォルダへ保存できませんでした: ${error.message}`, "error");
  } finally {
    syncProjectControls();
  }
});

ui.crawlProjectPages.addEventListener("click", async () => {
  if (loginBlocked()) return setStatus("先にログインを完了してください。", "error");
  setButtonProcessing(ui.crawlProjectPages, true);
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
    setButtonProcessing(ui.crawlProjectPages, false);
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
    const sanitized = sanitizeImportedHtml(html);
    const sourceUrl = sourceUrlFromHtml(sanitized) || ui.manualPageUrl.value.trim();
    if (!sourceUrl) throw new Error("「その他の取り込み」のページURLに、このHTMLの元URLを入力してください。");
    projectStore.setMetadata({ projectName: ui.projectName.value, baseUrl: ui.projectBaseUrl.value });
    pagePathForUrl(sourceUrl, projectStore.project.baseUrl);
    await loadHtml(sanitized, file.name, { sourceUrl, dirty: true });
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
  const response = await appFetch(url, {
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
  setButtonProcessing(ui.finishCapture, true);
  ui.captureState.textContent = "CSS・画像を埋め込んでいます…";
  setStatus("表示中ページを取り込んでいます。ページによっては少し時間がかかります。", "info");
  try {
    if (!(await preserveCurrentPage())) { ui.finishCapture.disabled = false; return; }
    const response = await postJson("/api/capture/finish", { sessionId: captureSessionId });
    const html = await response.text();
    const fileName = decodeURIComponent(response.headers.get("X-Captured-Filename") || "captured-page.html");
    const sourceUrl = decodeURIComponent(response.headers.get("X-Captured-Url") || ui.manualPageUrl.value.trim());
    let resourceFailures = [];
    try { resourceFailures = JSON.parse(decodeURIComponent(response.headers.get("X-Captured-Resource-Failures") || "[]")); } catch {}
    captureSessionId = "";
    await loadHtml(html, fileName, { sourceUrl, resourceFailures, dirty: true });
    if (projectStore.project) await saveCurrentToProject({ quiet: true });
    ui.captureSessionActions.hidden = true;
    setStatus("表示中ページを案件へ取り込みました。編集を開始できます。", "success");
  } catch (error) {
    ui.captureState.textContent = "取り込みに失敗しました";
    setStatus(`ページ取得に失敗しました: ${error.message}`, "error");
  } finally {
    setButtonProcessing(ui.finishCapture, false);
    ui.finishCapture.disabled = !captureSessionId;
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

ui.original.addEventListener("click", () => {
  state.viewMode = "original";
  return render("original");
});
ui.modified.addEventListener("click", () => {
  state.viewMode = "modified";
  return render("modified");
});
ui.redline.addEventListener("click", () => {
  state.viewMode = "redline";
  return render("redline");
});
ui.searchReplace.addEventListener("click", async () => {
  if (state.mode !== "modified") {
    state.viewMode = "modified";
    await render("modified");
  }
  editor.clearSearchHighlight();
  searchReplaceRules = readSearchRulesFromForm();
  renderSearchRules();
  ui.searchReplaceDialog.classList.remove("reviewing", "overviewing");
  ui.searchReplaceConfig.hidden = false;
  ui.searchReplaceOverview.hidden = true;
  ui.searchReplaceReview.hidden = true;
  ui.searchReplaceEmpty.hidden = true;
  searchReplaceSession = null;
  ui.searchReplaceDialog.showModal();
  centerSearchReplaceDialog();
});
ui.addSearchRule.addEventListener("click", () => {
  searchReplaceRules = readSearchRulesFromForm();
  if (searchReplaceRules.length >= MAX_SEARCH_REPLACE_RULES) return;
  searchReplaceRules.push(normalizeSearchReplaceRule({}, searchReplaceRules.length));
  renderSearchRules();
});
ui.exportSearchRules.addEventListener("click", () => {
  exportSearchRulesFile();
});
ui.importSearchRules.addEventListener("click", () => {
  ui.searchRulesFile.click();
});
ui.searchRulesFile.addEventListener("change", () => {
  void importSearchRulesFile(ui.searchRulesFile.files?.[0]);
});
ui.saveSearchRules.addEventListener("click", () => {
  saveSearchRules();
  setStatus(`検索・置換ルールを${searchReplaceRules.length}件保存しました。`, "success");
});
ui.startSearchReplace.addEventListener("click", () => { void startSearchReplace(); });
ui.previewAllSearchRules.addEventListener("click", () => { void previewAllSearchRules(); });
ui.backSearchOverviewSettings.addEventListener("click", () => {
  editor.clearSearchHighlight();
  searchReplaceSession = null;
  ui.searchReplaceDialog.classList.remove("reviewing", "overviewing");
  ui.searchReplaceOverview.hidden = true;
  ui.searchReplaceConfig.hidden = false;
  requestAnimationFrame(keepSearchReplaceDialogOnScreen);
});
ui.startSearchReplaceFromOverview.addEventListener("click", () => {
  const rules = searchReplaceSession?.rules;
  if (!rules?.length) return;
  editor.clearSearchHighlight();
  beginSearchReplaceSession(rules);
});
ui.replaceSearchMatch.addEventListener("click", () => {
  if (!replaceCurrentSearchCandidate()) return;
  findNextSearchCandidate();
});
ui.skipSearchMatch.addEventListener("click", () => {
  const session = searchReplaceSession;
  if (!session?.current) return;
  const { match } = session.current;
  session.skips += 1;
  session.candidates += 1;
  session.offset = match.index + Math.max(1, match.length);
  session.current = null;
  findNextSearchCandidate();
});
ui.replaceAllSearchRule.addEventListener("click", async () => {
  const session = searchReplaceSession;
  if (!session?.current) return;
  const targetRuleIndex = session.ruleIndex;
  setButtonProcessing(ui.replaceAllSearchRule, true);
  try {
    let count = 0;
    while (searchReplaceSession?.current && searchReplaceSession.ruleIndex === targetRuleIndex) {
      replaceCurrentSearchCandidate();
      count += 1;
      if (!findNextSearchCandidate({ show: false })) return;
      if (count % 50 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (searchReplaceSession?.current) showSearchCandidate();
  } finally {
    setButtonProcessing(ui.replaceAllSearchRule, false);
  }
});
ui.stopSearchReplace.addEventListener("click", () => finishSearchReplace(false));
ui.backSearchSettings.addEventListener("click", () => {
  editor.clearSearchHighlight();
  searchReplaceSession = null;
  ui.searchReplaceDialog.classList.remove("reviewing", "overviewing");
  ui.searchReplaceConfig.hidden = false;
  ui.searchReplaceOverview.hidden = true;
  ui.searchReplaceReview.hidden = true;
  ui.searchReplaceEmpty.hidden = true;
  requestAnimationFrame(keepSearchReplaceDialogOnScreen);
});
ui.searchReplaceDialog.addEventListener("close", () => {
  editor.clearSearchHighlight();
  searchReplaceSession = null;
  ui.searchReplaceDialog.classList.remove("reviewing", "overviewing", "dragging");
  ui.searchReplaceConfig.hidden = false;
  ui.searchReplaceOverview.hidden = true;
  ui.searchReplaceReview.hidden = true;
  ui.searchReplaceEmpty.hidden = true;
});
ui.undo.addEventListener("click", () => applyUndoRedo("undo"));
ui.redo.addEventListener("click", () => applyUndoRedo("redo"));
ui.reset.addEventListener("click", async () => {
  const checkedPages = listedProjectPages()
    .filter((page) => page.saved && state.selectedProjectUrls.has(page.url));
  if (checkedPages.length) {
    const message = `チェックした${checkedPages.length}ページのすべての修正を破棄して、それぞれの取得時点へ戻しますか？\n\n取得済みページと一覧は残り、編集内容・変更履歴だけがリセットされます。`;
    if (!window.confirm(message)) return;
    state.batchRunning = true;
    setButtonProcessing(ui.reset, true);
    updateBatchControls();
    try {
      await flushAutoSave();
      const activeReset = checkedPages.some((page) => page.id === state.activeProjectPageId);
      await projectStore.resetPageChanges(checkedPages.map((page) => page.id));
      if (activeReset) {
        const activePage = projectStore.project.pages.find((page) => page.id === state.activeProjectPageId);
        const saved = await projectStore.loadPage(state.activeProjectPageId);
        await loadHtml(saved.originalHtml, activePage.fileName, {
          sourceUrl: activePage.url,
          activeProjectPageId: activePage.id,
          workingHtml: saved.originalHtml,
          changes: [],
          resourceFailures: saved.page?.resourceFailures || [],
          dirty: false,
        });
      }
      renderProjectPages();
      setStatus(`チェックした${checkedPages.length}ページを取得時点へ戻しました。`, "success");
    } catch (error) {
      setStatus(`ページをリセットできませんでした: ${error.message}`, "error");
    } finally {
      state.batchRunning = false;
      setButtonProcessing(ui.reset, false);
      setControls(Boolean(state.originalHtml));
    }
    return;
  }
  if (!window.confirm("現在のページのすべての修正を破棄して、読み込み時点へ戻しますか？")) return;
  state.modifiedHtml = state.originalHtml;
  state.changes = [];
  state.redoChanges = [];
  markDirtyAndScheduleAutoSave();
  renderHistory();
  // リセット直前の編集DOMでoriginalHtmlを再上書きしない。
  await render("modified", { captureCurrent: false });
  setStatus("読み込み時点へ戻しました。", "success");
});
async function saveOutput(blob, suggestedName, filters) {
  if (!desktopFileSystemAvailable()) {
    downloadBlob(blob, suggestedName);
    return true;
  }
  const saved = await saveDesktopOutput(blob, { suggestedName, filters });
  return Boolean(saved);
}

ui.download.addEventListener("click", async () => {
  const html = state.mode === "modified" ? editor.getExportHtml() : cleanHtmlString(state.modifiedHtml);
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  const name = `${state.fileName.replace(/\.(html?|HTML?)$/, "") || "page"}-modified.html`;
  const saved = await saveOutput(new Blob([html], { type: "text/html;charset=utf-8" }), name, [{ name: "HTML", extensions: ["html"] }]);
  setStatus(saved ? "修正後HTMLを保存しました。" : "修正後HTMLの保存をキャンセルしました。", saved ? "success" : "info");
});
ui.downloadRedline.addEventListener("click", async () => {
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  const html = createRedlineReport(state.modifiedHtml, changesFromOriginal(), state.fileName);
  const name = `${state.fileName.replace(/\.(html?|HTML?)$/, "") || "page"}-redline.html`;
  const saved = await saveOutput(new Blob([html], { type: "text/html;charset=utf-8" }), name, [{ name: "HTML", extensions: ["html"] }]);
  setStatus(saved ? "変更箇所ページを保存しました。" : "変更箇所ページの保存をキャンセルしました。", saved ? "success" : "info");
});
ui.downloadDiff.addEventListener("click", async () => {
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  const html = createDiffReport(state.fileName, changesFromOriginal());
  const name = `${state.fileName.replace(/\.(html?|HTML?)$/, "") || "page"}-diff.html`;
  const saved = await saveOutput(new Blob([html], { type: "text/html;charset=utf-8" }), name, [{ name: "HTML", extensions: ["html"] }]);
  setStatus(saved ? "修正内容一覧を保存しました。" : "修正内容一覧の保存をキャンセルしました。", saved ? "success" : "info");
});
function selectedSavedPackagePages() {
  return actionTargetPages().filter((page) => page.saved);
}

function readSearchRulesFromForm() {
  return [...ui.searchRuleList.querySelectorAll(".search-rule")].map((card, index) => normalizeSearchReplaceRule({
    id: card.dataset.ruleId,
    name: card.querySelector('[data-field="name"]').value,
    enabled: card.querySelector('[data-field="enabled"]').checked,
    search: card.querySelector('[data-field="search"]').value,
    replacement: card.querySelector('[data-field="replacement"]').value,
    searchScope: card.querySelector('[data-field="searchScope"]').value,
    searchSelector: card.querySelector('[data-field="searchSelector"]').value,
    useRegex: card.querySelector('[data-field="useRegex"]').checked,
    caseSensitive: card.querySelector('[data-field="caseSensitive"]').checked,
    excludeLinkedText: card.querySelector('[data-field="excludeLinkedText"]').checked,
    excludeBreadcrumbText: card.querySelector('[data-field="excludeBreadcrumbText"]').checked,
    requiredBefore: card.querySelector('[data-field="requiredBefore"]').value,
    requiredMode: card.querySelector('[data-field="requiredMode"]').value,
    requiredBeforeDistance: card.querySelector('[data-field="requiredBeforeDistance"]').value,
    forbiddenBefore: card.querySelector('[data-field="forbiddenBefore"]').value,
    forbiddenMode: card.querySelector('[data-field="forbiddenMode"]').value,
    forbiddenBeforeDistance: card.querySelector('[data-field="forbiddenBeforeDistance"]').value,
    forbiddenAfter: card.querySelector('[data-field="forbiddenAfter"]').value,
    forbiddenAfterMode: card.querySelector('[data-field="forbiddenAfterMode"]').value,
    forbiddenAfterDistance: card.querySelector('[data-field="forbiddenAfterDistance"]').value,
    prefixUsesRegex: card.querySelector('[data-field="prefixUsesRegex"]').checked,
  }, index));
}

function renderSearchRules() {
  ui.searchRuleList.replaceChildren(...searchReplaceRules.map((rule, index) => {
    const card = document.createElement("article");
    card.className = "search-rule";
    card.dataset.ruleId = rule.id;
    card.innerHTML = `
      <div class="search-rule-header">
        <strong>ルール ${index + 1}</strong>
        <label><input data-field="enabled" type="checkbox">使用する</label>
        <input data-field="name" type="text" aria-label="ルール名" placeholder="ルール名">
        <button data-action="up" type="button" title="上へ移動">↑</button>
        <button data-action="down" type="button" title="下へ移動">↓</button>
        <button data-action="remove" class="danger-button" type="button">削除</button>
      </div>
      <div class="search-rule-grid">
        <label>検索文字列／正規表現<input data-field="search" type="text" placeholder="例: 変更前の文字列"></label>
        <label>置換文字列<input data-field="replacement" type="text" placeholder="例: 変更後の文字列"></label>
        <label>検索範囲<select data-field="searchScope"><option value="page">ページ全体</option><option value="article">本文を自動判定</option><option value="selector">CSSセレクターで指定</option></select></label>
        <label>範囲のCSSセレクター<input data-field="searchSelector" type="text" placeholder="例: main .article-body"></label>
        <div class="search-condition-grid">
          <fieldset class="search-condition-card">
            <legend>前に必要な文字列</legend>
            <textarea data-field="requiredBefore" aria-label="前に必要な文字列" placeholder="改行区切り"></textarea>
            <label>条件の組み合わせ<select data-field="requiredMode"><option value="or">いずれか（OR）</option><option value="and">すべて（AND）</option></select></label>
            <label>前方条件との最大間隔<input data-field="requiredBeforeDistance" type="number" min="0" max="500"><small>条件の末尾から検索文字列の先頭まで</small></label>
          </fieldset>
          <fieldset class="search-condition-card">
            <legend>前にあってはならない文字列</legend>
            <textarea data-field="forbiddenBefore" aria-label="前にあってはならない文字列" placeholder="改行区切り"></textarea>
            <label>条件の組み合わせ<select data-field="forbiddenMode"><option value="or">いずれか（OR）</option><option value="and">すべて（AND）</option></select></label>
            <label>前方条件との最大間隔<input data-field="forbiddenBeforeDistance" type="number" min="0" max="500"><small>条件の末尾から検索文字列の先頭まで</small></label>
          </fieldset>
          <fieldset class="search-condition-card">
            <legend>後ろにあってはならない文字列</legend>
            <textarea data-field="forbiddenAfter" aria-label="後ろにあってはならない文字列" placeholder="改行区切り"></textarea>
            <label>条件の組み合わせ<select data-field="forbiddenAfterMode"><option value="or">いずれか（OR）</option><option value="and">すべて（AND）</option></select></label>
            <label>後方条件との最大間隔<input data-field="forbiddenAfterDistance" type="number" min="0" max="500"><small>検索文字列の末尾から条件の先頭まで</small></label>
          </fieldset>
        </div>
        <div class="search-rule-options">
          <label><input data-field="useRegex" type="checkbox">検索に正規表現を使う</label>
          <label><input data-field="caseSensitive" type="checkbox">大文字・小文字を区別</label>
          <label><input data-field="excludeLinkedText" type="checkbox">リンク内の文字を除外</label>
          <label><input data-field="excludeBreadcrumbText" type="checkbox">パンくず内の文字を除外</label>
          <label><input data-field="prefixUsesRegex" type="checkbox">前後条件に正規表現を使う</label>
          <span>置換では <code>$1</code>〜<code>$99</code>、<code>$&amp;</code>を利用できます。</span>
        </div>
      </div>
      <p class="search-rule-error" hidden></p>`;
    card.querySelector('[data-field="enabled"]').checked = rule.enabled;
    card.querySelector('[data-field="name"]').value = rule.name;
    card.querySelector('[data-field="search"]').value = rule.search;
    card.querySelector('[data-field="replacement"]').value = rule.replacement;
    card.querySelector('[data-field="searchScope"]').value = rule.searchScope;
    card.querySelector('[data-field="searchSelector"]').value = rule.searchSelector;
    card.querySelector('[data-field="requiredBefore"]').value = rule.requiredBefore;
    card.querySelector('[data-field="requiredMode"]').value = rule.requiredMode;
    card.querySelector('[data-field="requiredBeforeDistance"]').value = String(rule.requiredBeforeDistance);
    card.querySelector('[data-field="forbiddenBefore"]').value = rule.forbiddenBefore;
    card.querySelector('[data-field="forbiddenMode"]').value = rule.forbiddenMode;
    card.querySelector('[data-field="forbiddenBeforeDistance"]').value = String(rule.forbiddenBeforeDistance);
    card.querySelector('[data-field="forbiddenAfter"]').value = rule.forbiddenAfter;
    card.querySelector('[data-field="forbiddenAfterMode"]').value = rule.forbiddenAfterMode;
    card.querySelector('[data-field="forbiddenAfterDistance"]').value = String(rule.forbiddenAfterDistance);
    card.querySelector('[data-field="useRegex"]').checked = rule.useRegex;
    card.querySelector('[data-field="caseSensitive"]').checked = rule.caseSensitive;
    card.querySelector('[data-field="excludeLinkedText"]').checked = rule.excludeLinkedText;
    card.querySelector('[data-field="excludeBreadcrumbText"]').checked = rule.excludeBreadcrumbText;
    card.querySelector('[data-field="prefixUsesRegex"]').checked = rule.prefixUsesRegex;
    const syncSearchSelector = () => {
      const custom = card.querySelector('[data-field="searchScope"]').value === "selector";
      card.querySelector('[data-field="searchSelector"]').disabled = !custom;
    };
    card.querySelector('[data-field="searchScope"]').addEventListener("change", syncSearchSelector);
    syncSearchSelector();
    card.querySelector('[data-action="up"]').disabled = index === 0;
    card.querySelector('[data-action="down"]').disabled = index === searchReplaceRules.length - 1;
    card.querySelector('[data-action="up"]').addEventListener("click", () => moveSearchRule(index, -1));
    card.querySelector('[data-action="down"]').addEventListener("click", () => moveSearchRule(index, 1));
    card.querySelector('[data-action="remove"]').addEventListener("click", () => {
      searchReplaceRules = readSearchRulesFromForm();
      searchReplaceRules.splice(index, 1);
      renderSearchRules();
    });
    return card;
  }));
  ui.addSearchRule.disabled = searchReplaceRules.length >= MAX_SEARCH_REPLACE_RULES;
}

function moveSearchRule(index, direction) {
  searchReplaceRules = readSearchRulesFromForm();
  const target = index + direction;
  if (target < 0 || target >= searchReplaceRules.length) return;
  [searchReplaceRules[index], searchReplaceRules[target]] = [searchReplaceRules[target], searchReplaceRules[index]];
  renderSearchRules();
}

function saveSearchRules() {
  searchReplaceRules = readSearchRulesFromForm().slice(0, MAX_SEARCH_REPLACE_RULES);
  localStorage.setItem(SEARCH_REPLACE_RULES_KEY, JSON.stringify(searchReplaceRules));
}

function exportSearchRulesFile() {
  saveSearchRules();
  const payload = {
    format: "web-revision-desk-search-rules",
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: searchReplaceRules,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "web-revision-desk-search-rules.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(`検索・置換ルール${searchReplaceRules.length}件をファイルに保存しました。`, "success");
}

async function importSearchRulesFile(file) {
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("ファイルサイズは1MB以下にしてください。");
    const parsed = JSON.parse(await file.text());
    const rules = Array.isArray(parsed) ? parsed : parsed?.rules;
    if (!Array.isArray(rules)) throw new Error("検索・置換ルールのファイルではありません。");
    if (!rules.length) throw new Error("復元できるルールがありません。");
    if (rules.length > MAX_SEARCH_REPLACE_RULES) throw new Error(`ルールは最大${MAX_SEARCH_REPLACE_RULES}件です。`);
    const restored = rules.map((rule, index) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        throw new Error(`ルール${index + 1}の形式が正しくありません。`);
      }
      return normalizeSearchReplaceRule(rule, index);
    });
    searchReplaceRules = restored;
    localStorage.setItem(SEARCH_REPLACE_RULES_KEY, JSON.stringify(searchReplaceRules));
    renderSearchRules();
    setStatus(`ファイルから検索・置換ルール${searchReplaceRules.length}件を復元しました。`, "success");
  } catch (error) {
    setStatus(`検索・置換ルールを復元できませんでした: ${error.message}`, "error");
  } finally {
    ui.searchRulesFile.value = "";
  }
}

function initializeSearchReplace() {
  try {
    const stored = JSON.parse(localStorage.getItem(SEARCH_REPLACE_RULES_KEY) || "[]");
    searchReplaceRules = Array.isArray(stored)
      ? stored.slice(0, MAX_SEARCH_REPLACE_RULES).map(normalizeSearchReplaceRule)
      : [];
  } catch {
    searchReplaceRules = [];
  }
  if (!searchReplaceRules.length) searchReplaceRules = [normalizeSearchReplaceRule(DEFAULT_SEARCH_REPLACE_RULE, 0)];
  renderSearchRules();
}

function overlapsProtectedRange(match, ranges = []) {
  const start = match.index;
  const end = match.index + Math.max(1, match.length);
  return ranges.some((range) => start < range.end && end > range.start);
}

const BREADCRUMB_SELECTOR = [
  '[aria-label*="breadcrumb" i]',
  '[aria-label*="パンくず"]',
  '[class*="breadcrumb" i]',
  '[id*="breadcrumb" i]',
  '[class*="topicpath" i]',
  '[id*="topicpath" i]',
  '[class*="topic-path" i]',
  '[id*="topic-path" i]',
  '[class*="pankuzu" i]',
  '[id*="pankuzu" i]',
  '[itemtype*="BreadcrumbList" i]',
].join(",");

function isBreadcrumbTextNode(node) {
  return Boolean(node.parentElement?.closest(BREADCRUMB_SELECTOR));
}

function applySearchExclusions(matches, node, rule, protectedRangeMap = searchReplaceSession?.protectedRanges) {
  const protectedRanges = protectedRangeMap?.get(node) || [];
  return matches.map((match) => {
    const excludedReasons = [...match.excludedReasons];
    const breadcrumb = isBreadcrumbTextNode(node);
    if (breadcrumb && rule.excludeBreadcrumbText) excludedReasons.push("breadcrumb-text");
    if (!breadcrumb && rule.excludeLinkedText && node.parentElement?.closest("a")) excludedReasons.push("linked-text");
    if (overlapsProtectedRange(match, protectedRanges)) excludedReasons.push("prior-rule");
    if (excludedReasons.length === match.excludedReasons.length) return match;
    return {
      ...match,
      excluded: true,
      excludedReasons,
    };
  });
}

function validateEnabledSearchRules() {
  searchReplaceRules = readSearchRulesFromForm();
  ui.searchRuleList.querySelectorAll(".search-rule-error").forEach((item) => { item.hidden = true; });
  const enabled = searchReplaceRules.filter((rule) => rule.enabled && rule.search);
  if (!enabled.length) {
    setStatus("使用する検索ルールを1件以上設定してください。", "error");
    return null;
  }
  for (const rule of enabled) {
    try {
      validateSearchReplaceRule(rule);
      if (rule.searchScope === "selector") {
        const selector = rule.searchSelector.trim();
        if (!selector) throw new Error("検索範囲のCSSセレクターを入力してください。");
        let matches;
        try { matches = editor.getDocument().querySelectorAll(selector); }
        catch { throw new Error("検索範囲のCSSセレクターが正しくありません。"); }
        if (!matches.length) throw new Error("指定したCSSセレクターに一致する範囲がありません。");
      }
    } catch (error) {
      const card = ui.searchRuleList.querySelector(`[data-rule-id="${CSS.escape(rule.id)}"]`);
      const message = card?.querySelector(".search-rule-error");
      if (message) { message.textContent = `設定エラー: ${error.message}`; message.hidden = false; }
      setStatus(`検索ルール「${rule.name}」を確認してください。`, "error");
      return null;
    }
  }
  saveSearchRules();
  return enabled;
}

function collectSearchRuleOverview(rules) {
  const protectedRanges = new WeakMap();
  const highlighted = [];
  const summaries = [];
  rules.forEach((rule, ruleIndex) => {
    let eligible = 0;
    let excluded = 0;
    for (const node of editor.getSearchTextNodes(rule)) {
      const matches = applySearchExclusions(findTextMatches(node.data, rule), node, rule, protectedRanges);
      for (const match of matches) {
        const item = { ...match, node, ruleIndex, ruleName: rule.name };
        highlighted.push(item);
        if (item.excluded) {
          excluded += 1;
          continue;
        }
        eligible += 1;
        const ranges = protectedRanges.get(node) || [];
        ranges.push({ start: match.index, end: match.index + Math.max(1, match.length) });
        protectedRanges.set(node, ranges);
      }
    }
    summaries.push({ name: rule.name, eligible, excluded });
  });
  return { highlighted, summaries };
}

async function previewAllSearchRules() {
  const enabled = validateEnabledSearchRules();
  if (!enabled) return;
  if (state.mode !== "modified") await render("modified");
  const { highlighted, summaries } = collectSearchRuleOverview(enabled);
  const eligible = summaries.reduce((sum, item) => sum + item.eligible, 0);
  const excluded = summaries.reduce((sum, item) => sum + item.excluded, 0);
  ui.searchOverviewSummary.textContent = `候補 ${eligible}件・除外 ${excluded}件`;
  ui.searchOverviewRules.replaceChildren(...summaries.map((summary) => {
    const row = document.createElement("div");
    row.className = "search-overview-rule";
    const name = document.createElement("strong");
    name.textContent = summary.name;
    const count = document.createElement("span");
    count.textContent = `候補 ${summary.eligible}件・除外 ${summary.excluded}件`;
    row.append(name, count);
    return row;
  }));
  searchReplaceSession = { rules: enabled, overview: true, protectedRanges: new WeakMap() };
  editor.highlightSearchMatches(highlighted, null);
  ui.searchReplaceConfig.hidden = true;
  ui.searchReplaceReview.hidden = true;
  ui.searchReplaceEmpty.hidden = true;
  ui.searchReplaceOverview.hidden = false;
  ui.searchReplaceDialog.classList.add("reviewing", "overviewing");
  setStatus(`全ルールで候補${eligible}件、除外${excluded}件を検出しました。ページをスクロールして確認できます。`, eligible ? "success" : "error");
  requestAnimationFrame(keepSearchReplaceDialogOnScreen);
}

function protectReplacementRange(node, match) {
  const session = searchReplaceSession;
  if (!session) return;
  const replacementLength = match.replacement.length;
  const oldEnd = match.index + match.length;
  const delta = replacementLength - match.length;
  const ranges = (session.protectedRanges.get(node) || []).map((range) => {
    if (range.start >= oldEnd) return { start: range.start + delta, end: range.end + delta };
    return range;
  });
  if (replacementLength > 0) ranges.push({ start: match.index, end: match.index + replacementLength });
  session.protectedRanges.set(node, ranges);
}

function showSearchCandidate() {
  const { rule, match, node } = searchReplaceSession.current;
  const highlightedMatches = (searchReplaceSession.nodes || []).flatMap((textNode) => (
    applySearchExclusions(findTextMatches(textNode.data, rule), textNode, rule).map((item) => ({ ...item, node: textNode }))
  ));
  const eligibleCount = highlightedMatches.filter((item) => !item.excluded).length;
  const excludedCount = highlightedMatches.length - eligibleCount;
  const beforeStart = Math.max(0, match.index - 55);
  const afterEnd = Math.min(node.data.length, match.index + match.length + 55);
  const context = `${beforeStart ? "…" : ""}${node.data.slice(beforeStart, match.index)}【${match.matched}】${node.data.slice(match.index + match.length, afterEnd)}${afterEnd < node.data.length ? "…" : ""}`;
  const scopeLabel = rule.searchScope === "article" ? "本文のみ"
    : rule.searchScope === "selector" ? `範囲: ${rule.searchSelector}` : "ページ全体";
  ui.searchReviewRule.textContent = `${rule.name}（${scopeLabel}）`;
  ui.searchReviewProgress.textContent = `ルール ${searchReplaceSession.ruleIndex + 1}/${searchReplaceSession.rules.length}・候補 ${searchReplaceSession.candidates + 1}・対象 ${eligibleCount}件・除外 ${excludedCount}件`;
  ui.searchReviewContext.textContent = context;
  ui.searchReviewBefore.textContent = match.matched || "（空文字）";
  ui.searchReviewAfter.textContent = match.replacement || "（空文字へ置換）";
  editor.highlightSearchMatches(highlightedMatches, { node, index: match.index, length: match.length });
  autoPositionSearchReplaceDialog(node, match);
}

function finishSearchReplace(completed = true) {
  if (!searchReplaceSession) return;
  const { replacements, skips } = searchReplaceSession;
  searchReplaceSession = null;
  editor.clearSearchHighlight();
  ui.searchReplaceDialog.close();
  setStatus(`${completed ? "検索・置換が完了しました" : "検索・置換を終了しました"}。置換 ${replacements}件、スキップ ${skips}件です。`, "success");
}

function showSearchNoCandidates() {
  const session = searchReplaceSession;
  if (!session) return;
  const pageNodes = editor.getSearchTextNodes({ searchScope: "page" });
  const highlighted = [];
  const counts = { total: 0, outside: 0, linked: 0, breadcrumb: 0, conditions: 0, prior: 0 };
  for (const rule of session.rules) {
    const scopedNodes = new Set(editor.getSearchTextNodes(rule));
    for (const node of pageNodes) {
      for (const rawMatch of findTextMatches(node.data, rule)) {
        const match = applySearchExclusions([rawMatch], node, rule)[0];
        const excludedReasons = [...match.excludedReasons];
        if (!scopedNodes.has(node)) excludedReasons.push("outside-scope");
        const item = {
          ...match,
          node,
          excluded: true,
          excludedReasons: [...new Set(excludedReasons)],
        };
        highlighted.push(item);
        counts.total += 1;
        if (item.excludedReasons.includes("outside-scope")) counts.outside += 1;
        if (item.excludedReasons.includes("linked-text")) counts.linked += 1;
        if (item.excludedReasons.includes("breadcrumb-text")) counts.breadcrumb += 1;
        if (item.excludedReasons.includes("prior-rule")) counts.prior += 1;
        if (item.excludedReasons.some((reason) => ["required-before", "forbidden-before", "forbidden-after"].includes(reason))) counts.conditions += 1;
      }
    }
  }
  editor.highlightSearchMatches(highlighted, null);
  const details = [];
  if (counts.outside) details.push(`検索範囲外 ${counts.outside}件`);
  if (counts.linked) details.push(`リンク内 ${counts.linked}件`);
  if (counts.breadcrumb) details.push(`パンくず内 ${counts.breadcrumb}件`);
  if (counts.conditions) details.push(`前後の条件で除外 ${counts.conditions}件`);
  if (counts.prior) details.push(`上位ルールで処理済み ${counts.prior}件`);
  ui.searchReplaceReview.hidden = true;
  ui.searchReplaceEmpty.hidden = false;
  ui.searchEmptyCount.textContent = `検出 ${counts.total}件`;
  ui.searchEmptySummary.textContent = counts.total
    ? `検索文字は見つかりましたが、すべて対象外です（${details.join("、") || "除外条件に一致"}）。対象外の文字はページ上に赤色で表示しています。`
    : "有効なルールの検索文字は、このページ内に見つかりませんでした。";
  setStatus(counts.total ? `検索文字を${counts.total}件検出しましたが、すべて置換対象外です。` : "検索文字が見つかりませんでした。", "error");
  requestAnimationFrame(keepSearchReplaceDialogOnScreen);
}

function findNextSearchCandidate({ show = true } = {}) {
  const session = searchReplaceSession;
  if (!session) return false;
  while (session.ruleIndex < session.rules.length) {
    if (!session.nodes) {
      session.nodes = editor.getSearchTextNodes(session.rules[session.ruleIndex]);
      session.nodeIndex = 0;
      session.offset = 0;
    }
    while (session.nodeIndex < session.nodes.length) {
      const node = session.nodes[session.nodeIndex];
      if (!node?.isConnected) {
        session.nodeIndex += 1;
        session.offset = 0;
        continue;
      }
      const rule = session.rules[session.ruleIndex];
      const match = applySearchExclusions(
        findTextMatches(node.data, rule, session.offset),
        node,
        rule,
      ).find((item) => !item.excluded) || null;
      if (match) {
        session.current = { node, match, rule: session.rules[session.ruleIndex], ruleIndex: session.ruleIndex };
        if (show) showSearchCandidate();
        return true;
      }
      session.nodeIndex += 1;
      session.offset = 0;
    }
    session.ruleIndex += 1;
    session.nodes = null;
  }
  if (session.candidates === 0 && session.replacements === 0 && session.skips === 0) showSearchNoCandidates();
  else finishSearchReplace(true);
  return false;
}

function replaceCurrentSearchCandidate() {
  const session = searchReplaceSession;
  if (!session?.current) return false;
  const { node, match } = session.current;
  if (!editor.replaceTextNodeMatch(node, match.index, match.length, match.replacement)) return false;
  protectReplacementRange(node, match);
  session.replacements += 1;
  session.candidates += 1;
  session.offset = match.index + Math.max(1, match.replacement.length);
  session.current = null;
  return true;
}

function beginSearchReplaceSession(enabled) {
  searchReplaceSession = {
    rules: enabled, ruleIndex: 0, nodes: null, nodeIndex: 0, offset: 0,
    current: null, candidates: 0, replacements: 0, skips: 0, dialogPlacement: "",
    protectedRanges: new WeakMap(),
  };
  ui.searchReplaceConfig.hidden = true;
  ui.searchReplaceOverview.hidden = true;
  ui.searchReplaceReview.hidden = false;
  ui.searchReplaceEmpty.hidden = true;
  ui.searchReplaceDialog.classList.add("reviewing");
  ui.searchReplaceDialog.classList.remove("overviewing");
  requestAnimationFrame(keepSearchReplaceDialogOnScreen);
  findNextSearchCandidate();
}

async function startSearchReplace() {
  const enabled = validateEnabledSearchRules();
  if (!enabled) return;
  if (state.mode !== "modified") await render("modified");
  beginSearchReplaceSession(enabled);
}

function packageFileInputs() {
  return [...ui.packageDialog.querySelectorAll('input[name="package-file"]')];
}

function savePackageFileSelection() {
  const selected = packageFileInputs().filter((input) => input.checked).map((input) => input.value);
  localStorage.setItem(PACKAGE_FILE_SELECTION_KEY, JSON.stringify(selected));
}

function initializePackageFileSelection() {
  const stored = localStorage.getItem(PACKAGE_FILE_SELECTION_KEY);
  if (stored !== null) {
    try {
      const selected = new Set(JSON.parse(stored));
      packageFileInputs().forEach((input) => { input.checked = selected.has(input.value); });
    } catch {
      localStorage.removeItem(PACKAGE_FILE_SELECTION_KEY);
    }
  }
  packageFileInputs().forEach((input) => input.addEventListener("change", savePackageFileSelection));
}

function showPackageDialog() {
  const selected = selectedSavedPackagePages();
  ui.packageTargetSummary.textContent = selected.length
    ? `チェック済みの保存済みページ ${selected.length}件を、1つのZIPへまとめます。`
    : "現在表示しているページをZIPへ保存します。";
  ui.packageDialog.showModal();
}

async function packagePagesForDownload() {
  if (state.mode === "modified") state.modifiedHtml = editor.getHtml();
  const selected = selectedSavedPackagePages();
  if (!selected.length) {
    if (!state.originalHtml) throw new Error("保存するページがありません。");
    return [{
      fileName: state.fileName,
      originalHtml: state.originalHtml,
      modifiedHtml: state.modifiedHtml,
      changes: changesFromOriginal(),
      sourceUrl: state.sourceUrl,
    }];
  }
  return Promise.all(selected.map(async (page) => {
    if (page.id === state.activeProjectPageId && state.originalHtml) {
      return {
        ...page,
        fileName: state.fileName,
        originalHtml: state.originalHtml,
        modifiedHtml: state.modifiedHtml,
        changes: changesFromOriginal(),
        sourceUrl: state.sourceUrl,
      };
    }
    const saved = await projectStore.loadPage(page.id);
    return {
      ...saved.page,
      originalHtml: saved.originalHtml,
      modifiedHtml: saved.workingHtml,
        changes: saved.changes,
        resourceFailures: saved.page.resourceFailures,
      sourceUrl: saved.page.url,
    };
  }));
}

ui.downloadPackage.addEventListener("click", showPackageDialog);
ui.confirmPackageDownload.addEventListener("click", async () => {
  const files = [...ui.packageDialog.querySelectorAll('input[name="package-file"]:checked')]
    .map((input) => input.value);
  if (!files.length) return setStatus("保存するファイルを1つ以上選択してください。", "error");
  savePackageFileSelection();
  setButtonProcessing(ui.confirmPackageDownload, true);
  try {
    await flushAutoSave();
    const pages = await packagePagesForDownload();
    const packageInput = {
      pages,
      files,
      packageName: pages.length > 1 ? projectStore.project?.projectName || "selected-pages" : undefined,
    };
    const packageName = packageInput.packageName
      ? `${packageInput.packageName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")}-revision-package.zip`
      : pages.length > 1 ? "selected-pages-revision-package.zip" : "page-revision-package.zip";
    const packageBlob = await createProjectPackagesAsync(packageInput);
    const saved = await saveOutput(packageBlob, packageName, [{ name: "ZIP", extensions: ["zip"] }]);
    ui.packageDialog.close();
    setStatus(saved ? `${pages.length}ページ分の選択ファイルを共有用ZIPへ保存しました。` : "共有用ZIPの保存をキャンセルしました。", saved ? "success" : "info");
  } catch (error) {
    setStatus(`共有用ZIPを保存できませんでした: ${error.message}`, "error");
  } finally {
    setButtonProcessing(ui.confirmPackageDownload, false);
    ui.confirmPackageDownload.disabled = false;
  }
});

function applyUndoRedo(direction) {
  if (state.mode !== "modified") return;
  const source = direction === "undo" ? state.changes : state.redoChanges;
  const destination = direction === "undo" ? state.redoChanges : state.changes;
  const change = source.at(-1);
  if (!change) return;
  const group = change.batchId ? source.slice().reverse().filter((item) => item.batchId === change.batchId) : [change];
  const applied = [];
  for (const item of group) {
    if (!editor.applyChange(item, direction)) {
      applied.reverse().forEach((completed) => editor.applyChange(completed, direction === "undo" ? "redo" : "undo"));
      return setStatus("この操作を復元できませんでした。すべてリセットは利用できます。", "error");
    }
    applied.push(item);
  }
  source.splice(source.length - group.length, group.length);
  destination.push(...group);
  if (!applied.length) {
    setStatus("この操作を復元できませんでした。すべてリセットは利用できます。", "error");
    return;
  }
  state.modifiedHtml = editor.getHtml();
  markDirtyAndScheduleAutoSave();
  renderHistory();
  syncPageStructureFields();
  renderHeadingOutline();
  refreshClassOptions();
  setStatus(direction === "undo" ? "直前の編集を元に戻しました。" : "編集をやり直しました。", "success");
}

function isTypingTarget(target) {
  return Boolean(target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName));
}

function moveSidebarSelection(direction) {
  const outlineVisible = !ui.headingOutlinePanel.hidden;
  const buttons = [...(outlineVisible
    ? ui.headingOutline.querySelectorAll("button[data-element-id]")
    : ui.projectPages.querySelectorAll("button.project-page"))];
  if (!buttons.length) return false;
  let currentIndex = outlineVisible
    ? buttons.findIndex((button) => button.classList.contains("active"))
    : buttons.findIndex((button) => button.dataset.pageUrl === state.focusedProjectUrl);
  if (currentIndex < 0) currentIndex = direction > 0 ? -1 : buttons.length;
  const nextIndex = Math.min(buttons.length - 1, Math.max(0, currentIndex + direction));
  if (nextIndex === currentIndex) return true;
  buttons[nextIndex].click();
  buttons[nextIndex].scrollIntoView({ block: "nearest" });
  return true;
}

function handleKeyboardShortcut(event) {
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.code === "Digit1" || event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarPanel("pages");
      return;
    }
    if ((event.code === "Digit2" || event.key === "ArrowRight") && !ui.showHeadingOutline.disabled) {
      event.preventDefault();
      setSidebarPanel("outline");
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (moveSidebarSelection(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
      return;
    }
  }
  if (isTypingTarget(event.target)) return;
  const shortcut = event.metaKey || event.ctrlKey;
  if (!shortcut || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  applyUndoRedo(event.shiftKey ? "redo" : "undo");
}

document.addEventListener("keydown", handleKeyboardShortcut);

ui.text.addEventListener("change", () => editor.updateText(ui.text.value));
ui.link.addEventListener("change", () => editor.updateLink(ui.link.value));
ui.imageUrl.addEventListener("change", () => {
  if (!ui.imageUrl.value.trim()) {
    showSelection(editor.selected, [...editor.selectedElements]);
    return setStatus("画像URLを入力してください。画像を削除する場合は「要素削除」を使用してください。", "error");
  }
  editor.updateImageSource(ui.imageUrl.value);
});
ui.removeImageLink.addEventListener("click", () => {
  if (!editor.updateImageLink("")) return;
  ui.link.value = "";
  setStatus("画像のリンクを削除しました。", "success");
});
ui.applyInlineLink.addEventListener("click", () => {
  if (!ui.inlineLinkUrl.value.trim()) return setStatus("リンク先URLを入力してください。", "error");
  if (editor.applyInlineLink(ui.inlineLinkUrl.value)) setStatus("選択した文字へリンクを設定しました。", "success");
});
ui.removeInlineLink.addEventListener("click", () => {
  if (editor.removeInlineLink()) setStatus("選択した文字のリンクを解除しました。", "success");
});
ui.alt.addEventListener("change", () => editor.updateAlt(ui.alt.value));
ui.pageTitle.addEventListener("change", () => editor.updateDocumentTitle(ui.pageTitle.value));
ui.pageDescription.addEventListener("change", () => editor.updateDocumentDescription(ui.pageDescription.value));
ui.pageH1.addEventListener("change", () => editor.updatePrimaryHeading(ui.pageH1.value));
ui.showProjectList.addEventListener("click", () => setSidebarPanel("pages"));
ui.showHeadingOutline.addEventListener("click", () => setSidebarPanel("outline"));
ui.classes.addEventListener("change", () => {
  editor.updateClasses(ui.classes.value);
  refreshClassOptions();
});
ui.before.addEventListener("click", () => editor.moveBefore());
ui.after.addEventListener("click", () => editor.moveAfter());
ui.insertTable.addEventListener("click", () => {
  const created = editor.insertTable(ui.tableRowCount.value, ui.tableColumnCount.value, { headerRow: ui.tableHeaderRow.checked });
  if (created) setStatus("表を追加しました。セルを選択して文章や行・列を編集できます。", "success");
});
ui.addTableRowBefore.addEventListener("click", () => editor.addTableRow({ position: "before" }));
ui.addTableRow.addEventListener("click", () => editor.addTableRow({ position: "after" }));
ui.moveTableRowUp.addEventListener("click", () => {
  if (!editor.moveTableRow("up")) setStatus("行を上へ移動できませんでした（最上行、または行をまたぐ結合セルがあります）。", "info");
});
ui.moveTableRowDown.addEventListener("click", () => {
  if (!editor.moveTableRow("down")) setStatus("行を下へ移動できませんでした（最下行、または行をまたぐ結合セルがあります）。", "info");
});
ui.deleteTableRow.addEventListener("click", () => {
  if (!editor.deleteTableRow()) setStatus("行を削除できませんでした（これ以上行を削除できません）。", "info");
});

ui.addTableColumnBefore.addEventListener("click", () => editor.addTableColumn({ position: "before" }));
ui.addTableColumn.addEventListener("click", () => editor.addTableColumn({ position: "after" }));
ui.deleteTableColumn.addEventListener("click", () => {
  if (!editor.deleteTableColumn()) setStatus("列を削除できませんでした（列数が1列のみの場合は削除できません）。", "info");
});
ui.moveTableColumnLeft.addEventListener("click", () => {
  if (!editor.moveTableColumn("left")) setStatus("列を左へ移動できませんでした（最左列です）。", "info");
});
ui.moveTableColumnRight.addEventListener("click", () => {
  if (!editor.moveTableColumn("right")) setStatus("列を右へ移動できませんでした（最右列です）。", "info");
});

ui.toggleCellType.addEventListener("click", () => editor.toggleCellType());
ui.toggleFirstColumnHeader.addEventListener("click", () => editor.toggleFirstColumnHeader());
ui.tableAlignLeft.addEventListener("click", () => editor.setCellAlign("left"));
ui.tableAlignCenter.addEventListener("click", () => editor.setCellAlign("center"));
ui.tableAlignRight.addEventListener("click", () => editor.setCellAlign("right"));

ui.mergeCellRight.addEventListener("click", () => {
  if (!editor.mergeCellRight()) setStatus("右のセルと結合できませんでした（右端であるか、行の高さが一致していません）。", "info");
});
ui.mergeCellDown.addEventListener("click", () => {
  if (!editor.mergeCellDown()) setStatus("下のセルと結合できませんでした（下端であるか、列の幅が一致していません）。", "info");
});
ui.splitCell.addEventListener("click", () => {
  if (!editor.splitCell()) setStatus("結合されていないセルです。", "info");
});
ui.deleteTable.addEventListener("click", () => {
  if (window.confirm("選択中の表全体を削除しますか？")) editor.deleteTable();
});
ui.copyElement.addEventListener("click", () => {
  const count = editor.copySelected();
  if (!count) return;
  showSelection(editor.selected, [...editor.selectedElements]);
  setStatus(`${count}個の要素をコピーしました。貼り付け先を選択してください。`, "success");
});
ui.pasteBefore.addEventListener("click", () => editor.pasteBefore());
ui.pasteAfter.addEventListener("click", () => editor.pasteAfter());
ui.selectParent.addEventListener("click", () => editor.selectParent());
ui.returnChild.addEventListener("click", () => editor.returnToChild());
ui.delete.addEventListener("click", () => {
  const count = editor.getSelectionCount();
  if (window.confirm(count > 1 ? `選択した${count}個の要素を削除しますか？` : "選択した要素を削除しますか？")) editor.deleteSelected();
});
ui.clearHistory.addEventListener("click", async () => {
  if (!window.confirm("変更履歴だけを消去しますか？ 編集内容はそのまま残ります。")) return;
  state.changes = [];
  state.redoChanges = [];
  markDirtyAndScheduleAutoSave();
  renderHistory();
  if (state.mode === "redline") await render("modified", { captureCurrent: false });
  setStatus("変更履歴を消去しました。編集内容は維持されています。", "success");
});
ui.advancedMode.addEventListener("change", () => {
  ui.inspector.classList.toggle("show-advanced", ui.advancedMode.checked);
  syncTableToolsVisibility();
});
ui.image.addEventListener("change", () => {
  const file = ui.image.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024 && !window.confirm("画像が10MBを超えています。埋め込みを続けますか？")) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    editor.updateImage(String(reader.result), file.name);
    ui.image.value = "";
  });
  reader.readAsDataURL(file);
});
ui.saveSelectedImage.addEventListener("click", async () => {
  const image = editor.getSelectedImageDetails();
  if (!image?.src) return;
  if (!image.src.startsWith("data:image/")) {
    setStatus("埋め込み済みの画像を選択すると、保存できます。", "info");
    return;
  }
  try {
    const blob = await (await fetch(image.src)).blob();
    const mimeExtensions = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/svg": "svg",
      "image/avif": "avif",
      "image/x-icon": "ico",
      "image/vnd.microsoft.icon": "ico",
      "image/bmp": "bmp",
    };
    const extension = mimeExtensions[blob.type.toLowerCase()]
      || blob.type.split("/")[1]?.split("+")[0]?.replace("jpeg", "jpg")
      || "png";
    const baseName = image.fileName.replace(/\.[a-z0-9]+$/i, "") || "image";
    const saved = await saveOutput(blob, `${baseName}.${extension}`, [{ name: "画像", extensions: [extension] }]);
    setStatus(saved ? "画像を保存しました。" : "画像の保存をキャンセルしました。", saved ? "success" : "info");
  } catch (error) {
    setStatus(`画像を保存できませんでした: ${error.message}`, "error");
  }
});

window.webRevisionFlushAutosave = async () => {
  try {
    await flushAutoSave();
    if (state.dirty && state.originalHtml && !canAutoSaveCurrentPage()) {
      return { ok: true, needsManualSave: true };
    }
    if (state.dirty && state.originalHtml) throw autoSaveError || new Error("未保存の編集内容があります。");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "自動保存に失敗しました。" };
  }
};

window.addEventListener("beforeunload", (event) => {
  if (globalThis.webRevisionDesktop) return;
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
initializeProjectSidebarResize();
initializeSearchReplaceDialogMovement();
initializePackageFileSelection();
initializeSearchReplace();
void refreshRecentProjects();
syncLoginControls();
updateGuidance();
showSelection(null);
