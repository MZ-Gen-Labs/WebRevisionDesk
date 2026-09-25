import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  projectPageKey,
  isActionTargetPage,
  filterActionTargetPages,
  getPageSavedStatusText,
  getPageCheckStatusText,
  getPageUncapturedStatusText,
  renderPageBadges,
} from "../../src/project-pages-ui.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const document = dom.window.document;

test("projectPageKey returns page.id when available, otherwise page.url", () => {
  assert.equal(projectPageKey({ id: "p1", url: "https://example.com/page" }), "p1");
  assert.equal(projectPageKey({ url: "https://example.com/page" }), "https://example.com/page");
  assert.equal(projectPageKey(null), "");
});

test("Issue #50: actionTargetPages isolates duplicated variant pages sharing the same URL", () => {
  const original = { id: "page-1", url: "https://example.com/about", title: "About", saved: true, changeCount: 0 };
  const variantA = { id: "page-1_A", url: "https://example.com/about", title: "About (_A)", saved: true, changeCount: 1 };
  const uncaptured = { url: "https://example.com/contact", title: "Contact", saved: false };
  const listed = [original, variantA, uncaptured];

  // 1. 元ページのみ選択時: 元ページ1件のみが対象になり、_A は巻き込まれない
  const originalSelectedState = {
    selectedProjectKeys: new Set(["page-1"]),
    selectedProjectUrls: new Set(),
    focusedProjectKey: "page-1",
    focusedProjectUrl: "",
  };
  const originalTargets = filterActionTargetPages(listed, originalSelectedState);
  assert.deepEqual(originalTargets, [original]);
  assert.equal(originalTargets.filter((p) => p.saved).length, 1);

  // 2. 複製版 _A のみ選択時: _A 1件のみが対象になり、元ページは巻き込まれない
  const variantSelectedState = {
    selectedProjectKeys: new Set(["page-1_A"]),
    selectedProjectUrls: new Set(),
    focusedProjectKey: "page-1_A",
    focusedProjectUrl: "",
  };
  const variantTargets = filterActionTargetPages(listed, variantSelectedState);
  assert.deepEqual(variantTargets, [variantA]);
  assert.equal(variantTargets.filter((p) => p.saved).length, 1);

  // 3. 両方選択時: 2件が対象になり、複製ボタンが無効条件（length !== 1）を満たす
  const bothSelectedState = {
    selectedProjectKeys: new Set(["page-1", "page-1_A"]),
    selectedProjectUrls: new Set(),
    focusedProjectKey: "page-1_A",
    focusedProjectUrl: "",
  };
  const bothTargets = filterActionTargetPages(listed, bothSelectedState);
  assert.deepEqual(bothTargets, [original, variantA]);
  assert.equal(bothTargets.filter((p) => p.saved).length, 2);

  // 4. 万一 selectedProjectUrls や focusedProjectUrl に URL が残っていても、保存済みページは巻き込まれない
  const staleUrlState = {
    selectedProjectKeys: new Set(["page-1"]),
    selectedProjectUrls: new Set(["https://example.com/about"]),
    focusedProjectKey: "page-1",
    focusedProjectUrl: "https://example.com/about",
  };
  const staleUrlTargets = filterActionTargetPages(listed, staleUrlState);
  assert.deepEqual(staleUrlTargets, [original]);

  // 5. IDのない未取得ページは URL で正しく対象になる
  const uncapturedSelectedState = {
    selectedProjectKeys: new Set(["https://example.com/contact"]),
    selectedProjectUrls: new Set(["https://example.com/contact"]),
    focusedProjectKey: "https://example.com/contact",
    focusedProjectUrl: "https://example.com/contact",
  };
  const uncapturedTargets = filterActionTargetPages(listed, uncapturedSelectedState);
  assert.deepEqual(uncapturedTargets, [uncaptured]);
});

test("Issue #51: saved status and diff check results are independently displayed", () => {
  // 1. チェック未実施の保存済みページ
  const uncheckedPage = { id: "p1", url: "https://example.com/p1", saved: true, changeCount: 0 };
  assert.equal(getPageSavedStatusText(uncheckedPage), "保存済み・変更 0件");
  assert.equal(getPageCheckStatusText(uncheckedPage), "");

  const badgesUnchecked = renderPageBadges(uncheckedPage, { document });
  assert.equal(badgesUnchecked.querySelector(".page-status").textContent, "保存済み・変更 0件");
  assert.equal(badgesUnchecked.querySelector(".page-check-status"), null);

  // 2. 「公開版と同じ」（same）の保存済みページ: 保存済み・変更件数が消えないこと
  const samePage = { id: "p2", url: "https://example.com/p2", saved: true, changeCount: 0, checkStatus: "same" };
  assert.equal(getPageSavedStatusText(samePage), "保存済み・変更 0件");
  assert.equal(getPageCheckStatusText(samePage), "公開版と同じ");

  const badgesSame = renderPageBadges(samePage, { document });
  assert.equal(badgesSame.querySelector(".page-status").textContent, "保存済み・変更 0件");
  const sameBadge = badgesSame.querySelector(".page-check-status");
  assert.ok(sameBadge, "check status badge should exist");
  assert.equal(sameBadge.textContent, "公開版と同じ");
  assert.ok(sameBadge.classList.contains("same"));

  // 3. 「公開版に更新あり」（changed）の保存済みページ
  const changedPage = { id: "p3", url: "https://example.com/p3", saved: true, changeCount: 3, checkStatus: "changed" };
  assert.equal(getPageSavedStatusText(changedPage), "保存済み・変更 3件");
  assert.equal(getPageCheckStatusText(changedPage), "公開版に更新あり");

  const badgesChanged = renderPageBadges(changedPage, { document });
  assert.equal(badgesChanged.querySelector(".page-status").textContent, "保存済み・変更 3件");
  const changedBadge = badgesChanged.querySelector(".page-check-status");
  assert.ok(changedBadge);
  assert.equal(changedBadge.textContent, "公開版に更新あり");
  assert.ok(changedBadge.classList.contains("changed"));

  // 4. 「公開版に更新あり・現在版を維持」（kept）
  const keptPage = { id: "p4", url: "https://example.com/p4", saved: true, changeCount: 2, checkStatus: "changed", updateDecision: "kept" };
  assert.equal(getPageCheckStatusText(keptPage), "公開版に更新あり・現在版を維持");

  // 5. 「公開版の確認失敗」（error）
  const errorPage = { id: "p5", url: "https://example.com/p5", saved: true, changeCount: 1, checkStatus: "error" };
  assert.equal(getPageSavedStatusText(errorPage), "保存済み・変更 1件");
  assert.equal(getPageCheckStatusText(errorPage), "公開版の確認失敗");

  const badgesError = renderPageBadges(errorPage, { document });
  assert.equal(badgesError.querySelector(".page-status").textContent, "保存済み・変更 1件");
  const errorBadge = badgesError.querySelector(".page-check-status");
  assert.ok(errorBadge);
  assert.equal(errorBadge.textContent, "公開版の確認失敗");
  assert.ok(errorBadge.classList.contains("error"));

  // 6. 保存データ利用不可
  const unavailablePage = { id: "p6", url: "https://example.com/p6", saved: true, changeCount: 0 };
  const badgesUnavailable = renderPageBadges(unavailablePage, { unavailable: true, document });
  assert.equal(badgesUnavailable.querySelector(".page-status").textContent, "保存データを開けません・削除可能");

  // 7. 未取得ページ: 保存済みと誤表示されないこと
  const uncapturedPage = { url: "https://example.com/uncaptured", saved: false };
  assert.equal(getPageSavedStatusText(uncapturedPage), "");
  assert.equal(getPageUncapturedStatusText(uncapturedPage), "未取得・クリックして画像とページを取得");

  const badgesUncaptured = renderPageBadges(uncapturedPage, { document });
  assert.equal(badgesUncaptured.querySelector(".page-status").textContent, "未取得・クリックして画像とページを取得");
  assert.equal(badgesUncaptured.querySelector(".page-check-status"), null);

  // 8. 同一URLの元ページと複製版でそれぞれの状態が区別できること
  const original = { id: "page-1", url: "https://example.com/item", saved: true, changeCount: 0, checkStatus: "same" };
  const variant = { id: "page-1_A", url: "https://example.com/item", saved: true, changeCount: 2 };
  const badgesOriginal = renderPageBadges(original, { document });
  const badgesVariant = renderPageBadges(variant, { document });

  assert.equal(badgesOriginal.querySelector(".page-status").textContent, "保存済み・変更 0件");
  assert.equal(badgesOriginal.querySelector(".page-check-status")?.textContent, "公開版と同じ");
  assert.equal(badgesVariant.querySelector(".page-status").textContent, "保存済み・変更 2件");
  assert.equal(badgesVariant.querySelector(".page-check-status"), null);
});
