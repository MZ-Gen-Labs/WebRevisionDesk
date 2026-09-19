const api = window.electronFeasibility;
const elements = {
  url: document.querySelector("#target-url"),
  open: document.querySelector("#open-page"),
  show: document.querySelector("#show-page"),
  inspect: document.querySelector("#inspect-page"),
  crawl: document.querySelector("#crawl-pages"),
  limit: document.querySelector("#crawl-limit"),
  save: document.querySelector("#save-artifacts"),
  busy: document.querySelector("#busy"),
  status: document.querySelector("#status"),
  version: document.querySelector("#electron-version"),
  pageResult: document.querySelector("#page-result"),
  crawlResult: document.querySelector("#crawl-result"),
  saveResult: document.querySelector("#save-result"),
  details: document.querySelector("#details"),
};

function setBusy(busy, message) {
  elements.busy.hidden = !busy;
  [elements.open, elements.inspect, elements.crawl, elements.save].forEach((button) => { button.disabled = busy; });
  if (message) setStatus(message);
}

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

function showDetails(value) {
  elements.details.textContent = JSON.stringify(value, null, 2);
}

async function run(action, startMessage) {
  setBusy(true, startMessage);
  try {
    const result = await action();
    setStatus("完了しました。");
    showDetails(result);
    return result;
  } catch (error) {
    setStatus(error.message || "処理に失敗しました。", true);
    showDetails({ error: error.message, stack: error.stack });
    return null;
  } finally {
    setBusy(false);
  }
}

api.onProgress(({ message }) => setStatus(message));

elements.open.addEventListener("click", async () => {
  const result = await run(() => api.openPage(elements.url.value.trim()), "対象ページを開いています…");
  if (result) elements.pageResult.textContent = `${result.title}（リンク ${result.links}件／関連ファイル ${result.resources}件）`;
});
elements.show.addEventListener("click", () => api.showPage().catch((error) => setStatus(error.message, true)));
elements.inspect.addEventListener("click", async () => {
  const result = await run(() => api.inspectPage(), "現在ページを解析しています…");
  if (result) elements.pageResult.textContent = `${result.title}（リンク ${result.links}件／関連ファイル ${result.resources}件）`;
});
elements.crawl.addEventListener("click", async () => {
  const result = await run(() => api.crawl(elements.url.value.trim(), Number(elements.limit.value)), "配下ページを確認しています…");
  if (result) elements.crawlResult.textContent = `${result.pages.length}ページ、エラー ${result.errors.length}件${result.truncated ? "（上限到達）" : ""}`;
});
elements.save.addEventListener("click", async () => {
  const result = await run(() => api.saveArtifacts(), "HTML・画像・診断情報を作成しています…");
  if (result && !result.canceled) elements.saveResult.textContent = result.directory;
  else if (result?.canceled) setStatus("保存をキャンセルしました。");
});

api.getInfo().then((info) => {
  elements.version.textContent = `${info.electron} / Chromium ${info.chrome}`;
  showDetails(info);
}).catch((error) => setStatus(error.message, true));
