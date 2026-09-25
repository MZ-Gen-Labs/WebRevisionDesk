export function projectPageKey(page) {
  return page?.id || page?.url || "";
}

export function isActionTargetPage(page, {
  selectedProjectKeys = new Set(),
  selectedProjectUrls = new Set(),
  focusedProjectKey = "",
  focusedProjectUrl = "",
} = {}) {
  if (!page) return false;
  const key = projectPageKey(page);
  if (page.id) {
    return selectedProjectKeys.has(key) || key === focusedProjectKey;
  }
  return (
    selectedProjectKeys.has(key) ||
    selectedProjectUrls.has(page.url) ||
    key === focusedProjectKey ||
    page.url === focusedProjectUrl
  );
}

export function filterActionTargetPages(listed = [], selectionState = {}) {
  return listed.filter((page) => isActionTargetPage(page, selectionState));
}

export function getPageSavedStatusText(page, { unavailable = false } = {}) {
  if (!page?.saved) return "";
  if (unavailable) return "保存データを開けません・削除可能";
  return `保存済み・変更 ${page.changeCount ?? 0}件`;
}

export function getPageCheckStatusText(page) {
  if (!page?.saved || !page?.checkStatus) return "";
  switch (page.checkStatus) {
    case "same":
      return "公開版と同じ";
    case "changed":
      return page.updateDecision === "kept"
        ? "公開版に更新あり・現在版を維持"
        : "公開版に更新あり";
    case "error":
      return "公開版の確認失敗";
    default:
      return "";
  }
}

export function getPageUncapturedStatusText(page, {
  activeCaptureUrl = "",
  queuedCaptureUrls = new Set(),
} = {}) {
  if (page?.saved) return "";
  if (activeCaptureUrl === page?.url) return "画像・ページを取得中";
  if (queuedCaptureUrls.has(page?.url)) return "優先取得待ち";
  return "未取得・クリックして画像とページを取得";
}

export function renderPageBadges(page, {
  unavailable = false,
  activeCaptureUrl = "",
  queuedCaptureUrls = new Set(),
  document = globalThis.document,
} = {}) {
  const badges = document.createElement("div");
  badges.className = "page-badges";

  const status = document.createElement("span");
  status.className = "page-status";
  status.textContent = page.saved
    ? getPageSavedStatusText(page, { unavailable })
    : getPageUncapturedStatusText(page, { activeCaptureUrl, queuedCaptureUrls });
  badges.append(status);

  const checkText = getPageCheckStatusText(page);
  if (checkText) {
    const checkBadge = document.createElement("span");
    checkBadge.className = `page-check-status ${page.checkStatus}`;
    checkBadge.textContent = checkText;
    badges.append(checkBadge);
  }

  const resourceFailureCount = Array.isArray(page.resourceFailures) ? page.resourceFailures.length : 0;
  if (page.saved && resourceFailureCount > 0) {
    const failures = document.createElement("span");
    failures.className = "page-resource-failures";
    failures.textContent = `⚠ 取り込み失敗 ${resourceFailureCount}件`;
    failures.title = "画像・CSSなど、関連ファイルの取得に失敗した件数です。ページを開くと詳細を確認できます。";
    badges.append(failures);
  }

  return badges;
}
