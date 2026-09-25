import { IMAGE_ASSET_NAME_ATTR } from "./html.js";

const TYPE_LABELS = {
  "text-change": "テキスト変更",
  "link-change": "リンク変更",
  "image-link-change": "画像リンク変更",
  "meta-title-change": "Title変更",
  "meta-description-change": "Description変更",
  "inline-link-change": "文章内リンク変更",
  "alt-change": "画像alt変更",
  "image-change": "画像差し替え",
  "class-change": "CSS class変更",
  "table-change": "表の構成変更",
  "element-add": "ブロック追加",
  "element-delete": "要素削除",
  "element-move": "要素移動",
};

export function changeLabel(type) {
  return TYPE_LABELS[type] ?? "変更";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imagePreview(value, label) {
  if (!String(value).startsWith("data:image/")) {
    return `<pre>${escapeHtml(value || "（画像なし）")}</pre>`;
  }
  return `<img src="${escapeHtml(value)}" alt="${escapeHtml(label)}" />`;
}

function changeContent(change) {
  if (change.type === "image-change") {
    return `
      <div class="comparison">
        <div class="before"><h3>変更前</h3>${imagePreview(change.before, "変更前画像")}</div>
        <div class="after"><h3>変更後</h3>${imagePreview(change.after, "変更後画像")}</div>
      </div>`;
  }
  if (change.type === "element-add") {
    return `<div class="after single"><h3>追加内容</h3><pre>${escapeHtml(change.after)}</pre></div>`;
  }
  if (change.type === "element-delete") {
    return `<div class="before single"><h3>削除内容</h3><pre>${escapeHtml(change.before)}</pre></div>`;
  }
  if (change.type === "table-change") {
    const details = [];
    if (change.deletedRowIndex !== undefined) details.push(`削除行: ${change.deletedRowIndex + 1}行目`);
    if (change.addedRowIndex !== undefined) details.push(`追加行: ${change.addedRowIndex + 1}行目`);
    if (change.deletedColIndex !== undefined) details.push(`削除列: ${change.deletedColIndex + 1}列目`);
    if (change.addedColIndex !== undefined) details.push(`追加列: ${change.addedColIndex + 1}列目`);
    if (change.targetRowIndex !== undefined && change.targetColIndex !== undefined) {
      const cellText = change.targetCellText ? `（${change.targetCellText}）` : "";
      details.push(`操作対象: ${change.targetRowIndex + 1}行目・${change.targetColIndex + 1}列目${cellText}`);
    }
    return `<div class="table-summary"><h3>表の変更内容</h3><p>${escapeHtml(change.action || "表の構成を変更")}</p>${details.length ? `<ul>${details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>` : ""}</div>`;
  }
  return `
    <div class="comparison">
      <div class="before"><h3>変更前</h3><pre>${escapeHtml(change.before || "（なし）")}</pre></div>
      <div class="after"><h3>変更後</h3><pre>${escapeHtml(change.after || "（なし）")}</pre></div>
    </div>`;
}

export function createDiffReport(fileName, changes) {
  const items = changes.map((change, index) => `
    <article class="change">
      <div class="change-number">変更 ${index + 1}</div>
      <h2>${escapeHtml(change.action ? `${changeLabel(change.type)}（${change.action}）` : changeLabel(change.type))}</h2>
      <p class="target">対象: <code>${escapeHtml(change.target)}</code></p>
      ${changeContent(change)}
    </article>`).join("");

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fileName)} 修正指示</title><style>
:root{font-family:system-ui,sans-serif;color:#20202b;background:#f3f4f7}*{box-sizing:border-box}body{margin:0}header{padding:40px max(5vw,24px);color:#fff;background:#252552}main{max-width:1100px;margin:auto;padding:32px 24px}.summary{margin-top:-20px;margin-bottom:28px;padding:18px 22px;border-radius:12px;background:#fff;box-shadow:0 8px 25px #20202b18}.change{margin:18px 0;padding:24px;border:1px solid #dddfea;border-radius:14px;background:#fff}.change-number{color:#5b5bd6;font-size:13px;font-weight:800;text-transform:uppercase}.change h2{margin:.3rem 0}.target{color:#666}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:18px}.before,.after{overflow:auto;padding:18px;border-radius:10px}.before{border:1px solid #efb6b6;background:#fff4f4}.after{border:1px solid #a9dbbf;background:#f1fbf5}.single,.table-summary{margin-top:14px}.table-summary{padding:16px 18px;border:1px solid #a9dbbf;border-radius:10px;background:#f1fbf5}.table-summary h3{margin:0 0 8px;font-size:14px}.table-summary p{margin:0}.table-summary ul{margin:8px 0 0;padding-left:1.4em}.comparison h3,.single h3{margin-top:0;font-size:14px}.comparison img{display:block;max-width:100%;max-height:320px;margin:auto}.comparison pre,.single pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.empty{padding:50px;text-align:center;color:#777;background:#fff;border-radius:12px}@media(max-width:700px){.comparison{grid-template-columns:1fr}}
</style></head><body><header><h1>Webサイト修正指示</h1><p>${escapeHtml(fileName)}</p></header><main>
<section class="summary"><strong>変更件数: ${changes.length}件</strong><br><small>生成日時: ${escapeHtml(new Date().toLocaleString("ja-JP"))}</small></section>
${items || '<div class="empty">記録された変更はありません。</div>'}
</main></body></html>`;
}

export function downloadDiffReport(fileName, changes) {
  const html = createDiffReport(fileName, changes);
  const baseName = fileName.replace(/\.(html?|HTML?)$/, "") || "page";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}-diff.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const EDITOR_ID_ATTR = "data-web-revision-id";
const VOID_ELEMENTS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR",
]);
const RESTRICTED_CHILD_ELEMENTS = new Set([
  "UL", "OL", "DL", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "COLGROUP", "SELECT", "OPTGROUP", "PICTURE",
]);
const RESTRICTED_STRUCTURE_ELEMENTS = new Set([
  "UL", "OL", "DL", "THEAD", "TBODY", "TFOOT", "TR", "COLGROUP", "COL", "SELECT", "OPTGROUP", "OPTION", "PICTURE", "SOURCE", "TRACK",
]);
function disableActiveContent(doc) {
  doc.querySelectorAll("script, meta[http-equiv='refresh' i]").forEach((element) => element.remove());
  doc.querySelectorAll("meta[http-equiv='content-security-policy' i]").forEach((element) => element.remove());
  doc.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    });
  });
  doc.querySelectorAll("a[href]").forEach((link) => {
    link.setAttribute("data-original-href", link.getAttribute("href") ?? "");
    link.removeAttribute("href");
  });
}

function sanitizedElementFromHtml(doc, html) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  disableActiveContent(template.content);
  return template.content.firstElementChild;
}

function imageLabelHost(element) {
  const semanticHost = element.closest("figure, a, li, article");
  if (semanticHost) return semanticHost;
  const parent = element.parentElement;
  return parent?.tagName === "PICTURE" ? parent.parentElement : parent;
}

function addSiblingLabel(target, label, kind) {
  let anchor = target;
  while (anchor.parentElement && RESTRICTED_CHILD_ELEMENTS.has(anchor.parentElement.tagName)) {
    anchor = anchor.parentElement;
  }
  const host = anchor.parentElement;
  if (!host) return;

  const labels = target.getAttribute("data-wr-label");
  const combinedLabel = labels ? `${labels} / ${label}` : label;
  target.setAttribute("data-wr-label", combinedLabel);
  const anchorId = target.getAttribute(EDITOR_ID_ATTR)
    || target.getAttribute("data-wr-label-anchor")
    || `label-${Math.random().toString(36).slice(2)}`;
  if (!target.hasAttribute(EDITOR_ID_ATTR)) target.setAttribute("data-wr-label-anchor", anchorId);
  let badge = [...host.children].find((child) => child.getAttribute("data-wr-label-for") === anchorId);
  if (!badge) {
    badge = target.ownerDocument.createElement("span");
    badge.className = "wr-redline-label wr-redline-label-sibling";
    badge.setAttribute("data-wr-label-for", anchorId);
    host.insertBefore(badge, anchor);
  }
  badge.classList.add(`wr-redline-label-${kind}`);
  badge.textContent = combinedLabel;
}

function addDefinitionListLabel(target, label, kind) {
  const labels = target.getAttribute("data-wr-label");
  const combinedLabel = labels ? `${labels} / ${label}` : label;
  target.setAttribute("data-wr-label", combinedLabel);
  let badge = [...target.children].find((child) => child.classList.contains("wr-redline-label-inside"));
  if (!badge) {
    badge = target.ownerDocument.createElement("dt");
    badge.className = "wr-redline-label-inside";
    badge.setAttribute("aria-hidden", "true");
    target.prepend(badge);
  }
  badge.classList.add(`wr-redline-label-${kind}`);
  badge.textContent = combinedLabel;
}

function addInlineSiblingLabel(target, label, kind) {
  let wrapper = target.parentElement?.classList.contains("wr-redline-label-wrapper")
    ? target.parentElement
    : null;
  if (!wrapper) {
    wrapper = target.ownerDocument.createElement("span");
    wrapper.className = "wr-redline-label-wrapper";
    target.replaceWith(wrapper);
    wrapper.append(target);
  }

  const labels = target.getAttribute("data-wr-label");
  const combinedLabel = labels ? `${labels} / ${label}` : label;
  target.setAttribute("data-wr-label", combinedLabel);
  const anchorId = target.getAttribute(EDITOR_ID_ATTR)
    || target.getAttribute("data-wr-label-anchor")
    || `label-${Math.random().toString(36).slice(2)}`;
  if (!target.hasAttribute(EDITOR_ID_ATTR)) target.setAttribute("data-wr-label-anchor", anchorId);
  let badge = [...wrapper.children].find((child) => child.getAttribute("data-wr-label-for") === anchorId);
  if (!badge) {
    badge = target.ownerDocument.createElement("span");
    badge.className = "wr-redline-label wr-redline-label-attached";
    badge.setAttribute("data-wr-label-for", anchorId);
    wrapper.prepend(badge);
  }
  badge.classList.add(`wr-redline-label-${kind}`);
  badge.textContent = combinedLabel;
}

function addLabel(element, label, kind = "change") {
  if (element.tagName === "IMG") {
    element.classList.add("wr-redline-target", `wr-redline-${kind}`);
    const host = imageLabelHost(element);
    if (!host) return element;
    host.classList.add("wr-image-label-host");
    let marker = [...host.children].find((child) => child.classList.contains("wr-image-marker"));
    if (!marker) {
      marker = element.ownerDocument.createElement("span");
      marker.className = "wr-image-marker";
      host.prepend(marker);
    }
    marker.textContent = label;
    marker.title = label;
    return element;
  }
  if (element.tagName === "TABLE") {
    element.classList.add("wr-redline-target", `wr-redline-${kind}`);
    const host = element.parentElement;
    if (!host) return element;
    let tableLabels = [];
    try {
      tableLabels = JSON.parse(element.getAttribute("data-wr-table-labels") || "[]");
    } catch {}
    tableLabels.push(label);
    element.setAttribute("data-wr-table-labels", JSON.stringify(tableLabels));
    const combinedLabel = tableLabels.length === 1
      ? label
      : summarizeTableLabels(tableLabels);
    element.setAttribute("data-wr-label", combinedLabel);
    const markerId = element.getAttribute(EDITOR_ID_ATTR) || `table-${Math.random().toString(36).slice(2)}`;
    if (!element.getAttribute(EDITOR_ID_ATTR)) element.setAttribute(EDITOR_ID_ATTR, markerId);
    let badge = [...host.children].find((child) => child.getAttribute("data-wr-table-label-for") === markerId);
    if (!badge) {
      badge = element.ownerDocument.createElement("span");
      badge.className = "wr-redline-label wr-table-redline-label";
      badge.setAttribute("data-wr-table-label-for", markerId);
      host.insertBefore(badge, element);
    }
    badge.textContent = combinedLabel;
    return element;
  }
  if (element.tagName === "DL") {
    element.classList.add("wr-redline-target", `wr-redline-${kind}`);
    addDefinitionListLabel(element, label, kind);
    return element;
  }
  if (VOID_ELEMENTS.has(element.tagName) || RESTRICTED_STRUCTURE_ELEMENTS.has(element.tagName)) {
    element.classList.add("wr-redline-target", `wr-redline-${kind}`);
    addSiblingLabel(element, label, kind);
    return element;
  }
  const target = element;
  target.classList.add("wr-redline-target", `wr-redline-${kind}`);
  if (["A", "SPAN", "STRONG", "EM", "B", "I", "SMALL", "MARK", "CODE", "S", "U"].includes(target.tagName)) {
    addInlineSiblingLabel(target, label, kind);
    return target;
  }
  const labels = target.getAttribute("data-wr-label");
  const combinedLabel = labels ? `${labels} / ${label}` : label;
  target.setAttribute("data-wr-label", combinedLabel);
  let badge = [...target.children].find((child) => child.classList.contains("wr-redline-label"));
  if (!badge) {
    badge = target.ownerDocument.createElement("span");
    badge.className = "wr-redline-label";
    target.prepend(badge);
  }
  badge.textContent = combinedLabel;
  return target;
}

function summarizeTableLabels(labels) {
  const counts = new Map();
  labels.forEach((label) => {
    const action = String(label).match(/^表の構成変更（([^（]+)(?:（|）)/)?.[1] || "その他";
    counts.set(action, (counts.get(action) || 0) + 1);
  });
  const summary = [...counts].map(([action, count]) => `${action}${count}件`).join("、");
  return `表の構成変更（${summary}）`;
}

function mergeRuns(runs) {
  return runs.reduce((merged, run) => {
    const previous = merged.at(-1);
    if (previous?.type === run.type) previous.text += run.text;
    else merged.push({ ...run });
    return merged;
  }, []);
}

export function diffCharacters(before = "", after = "") {
  const oldChars = [...String(before)];
  const newChars = [...String(after)];
  // 長文での二次元比較によるメモリ増加を避け、共通の前後だけを保持する。
  if (oldChars.length * newChars.length > 300000) {
    let prefix = 0;
    while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < oldChars.length - prefix && suffix < newChars.length - prefix &&
      oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]
    ) suffix++;
    return mergeRuns([
      { type: "equal", text: oldChars.slice(0, prefix).join("") },
      { type: "delete", text: oldChars.slice(prefix, oldChars.length - suffix).join("") },
      { type: "insert", text: newChars.slice(prefix, newChars.length - suffix).join("") },
      { type: "equal", text: oldChars.slice(oldChars.length - suffix).join("") },
    ].filter((run) => run.text));
  }

  const table = Array.from({ length: oldChars.length + 1 }, () => new Uint32Array(newChars.length + 1));
  for (let i = oldChars.length - 1; i >= 0; i--) {
    for (let j = newChars.length - 1; j >= 0; j--) {
      table[i][j] = oldChars[i] === newChars[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const runs = [];
  let i = 0;
  let j = 0;
  while (i < oldChars.length && j < newChars.length) {
    if (oldChars[i] === newChars[j]) {
      runs.push({ type: "equal", text: oldChars[i++] });
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      runs.push({ type: "delete", text: oldChars[i++] });
    } else {
      runs.push({ type: "insert", text: newChars[j++] });
    }
  }
  while (i < oldChars.length) runs.push({ type: "delete", text: oldChars[i++] });
  while (j < newChars.length) runs.push({ type: "insert", text: newChars[j++] });
  return mergeRuns(runs);
}

function applyInlineTextDiff(doc, element, before, after) {
  const runs = diffCharacters(before, after);
  const textNodes = [];
  const walker = doc.createTreeWalker(element, 4); // NodeFilter.SHOW_TEXT
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  if (textNodes.map((node) => node.data).join("") !== String(after)) return false;

  const insertions = [];
  const deletions = [];
  let afterOffset = 0;
  runs.forEach((run) => {
    if (run.type === "equal") {
      afterOffset += [...run.text].length;
    } else if (run.type === "insert") {
      const length = [...run.text].length;
      insertions.push({ start: afterOffset, end: afterOffset + length });
      afterOffset += length;
    } else if (run.type === "delete") {
      deletions.push({ offset: afterOffset, text: run.text });
    }
  });
  if (!insertions.length && !deletions.length) return true;

  let globalStart = 0;
  textNodes.forEach((node, nodeIndex) => {
    const characters = [...node.data];
    const globalEnd = globalStart + characters.length;
    const isLast = nodeIndex === textNodes.length - 1;
    const nodeDeletions = deletions.filter(({ offset }) => (
      offset >= globalStart && (offset < globalEnd || (isLast && offset === globalEnd))
    ));
    const boundaries = new Set([0, characters.length]);
    insertions.forEach(({ start, end }) => {
      if (start > globalStart && start < globalEnd) boundaries.add(start - globalStart);
      if (end > globalStart && end < globalEnd) boundaries.add(end - globalStart);
    });
    nodeDeletions.forEach(({ offset }) => boundaries.add(offset - globalStart));
    const points = [...boundaries].sort((left, right) => left - right);
    const fragment = doc.createDocumentFragment();

    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      nodeDeletions.filter(({ offset }) => offset - globalStart === point).forEach(({ text }) => {
        const marker = doc.createElement("del");
        marker.textContent = text;
        fragment.append(marker);
      });
      const next = points[index + 1];
      if (next === undefined || next <= point) continue;
      const text = characters.slice(point, next).join("");
      const absolutePoint = globalStart + point;
      const inserted = insertions.some(({ start, end }) => absolutePoint >= start && absolutePoint < end);
      if (inserted) {
        const marker = doc.createElement("ins");
        marker.textContent = text;
        fragment.append(marker);
      } else {
        fragment.append(doc.createTextNode(text));
      }
    }
    node.replaceWith(fragment);
    globalStart = globalEnd;
  });
  return true;
}

function createTextRedline(doc, element, before, after) {
  if (element.children.length === 0) {
    element.replaceChildren();
    diffCharacters(before, after).forEach((run) => {
      if (run.type === "equal") {
        element.append(doc.createTextNode(run.text));
        return;
      }
      const marker = doc.createElement(run.type === "delete" ? "del" : "ins");
      marker.textContent = run.text;
      element.append(marker);
    });
  } else if (!applyInlineTextDiff(doc, element, before, after)) {
    const diffPanel = doc.createElement("div");
    diffPanel.className = "wr-redline-text-diff-box";
    const title = doc.createElement("strong");
    title.textContent = "文章変更（文字差分）: ";
    diffPanel.append(title);
    const content = doc.createElement("span");
    diffCharacters(before, after).forEach((run) => {
      if (run.type === "equal") {
        content.append(doc.createTextNode(run.text));
        return;
      }
      const marker = doc.createElement(run.type === "delete" ? "del" : "ins");
      marker.textContent = run.text;
      content.append(marker);
    });
    diffPanel.append(content);
    // A <tr> may only contain table cells.  Put the block inside a cell when
    // the edited element is a table cell, preserving valid table structure.
    if (element.tagName === "TD" || element.tagName === "TH") element.prepend(diffPanel);
    else element.before(diffPanel);
  }
  addLabel(element, "文章変更", "text");
}

function tableDeletionPanel(doc, table) {
  const markerId = table.getAttribute(EDITOR_ID_ATTR) || `table-${Math.random().toString(36).slice(2)}`;
  if (!table.getAttribute(EDITOR_ID_ATTR)) table.setAttribute(EDITOR_ID_ATTR, markerId);
  const selector = `[data-wr-table-deletions-for="${CSS.escape(markerId)}"]`;
  let panel = table.parentElement?.querySelector(`:scope > ${selector}`) || null;
  if (panel) return panel;

  panel = doc.createElement("section");
  panel.className = "wr-table-deletions";
  panel.setAttribute("data-wr-table-deletions-for", markerId);
  const heading = doc.createElement("strong");
  heading.textContent = "表から削除した内容";
  panel.append(heading);
  table.before(panel);
  return panel;
}

function deletedCellTexts(doc, change) {
  if (Array.isArray(change.deletedCellsInfo)) {
    return change.deletedCellsInfo.flatMap((info) => {
      if (info.action !== "deleted") return [];
      if (info.text) return [info.text];
      if (!info.cellHtml) return [];
      const template = doc.createElement("template");
      template.innerHTML = info.cellHtml;
      const cell = template.content.firstElementChild;
      const text = cell?.textContent?.trim();
      return [...(text ? [text] : []), ...describeImages(cell)];
    });
  }
  return Array.isArray(change.deletedColTexts) ? change.deletedColTexts.filter(Boolean) : [];
}

function describeImages(container) {
  if (!container) return [];
  return [...container.querySelectorAll("img")].map((image) => {
    const alt = image.getAttribute("alt")?.trim();
    const assetName = image.getAttribute(IMAGE_ASSET_NAME_ATTR)?.trim();
    const source = image.getAttribute("src")?.trim();
    const sourceName = source && !source.startsWith("data:")
      ? source.split(/[?#]/, 1)[0].split("/").pop()
      : "";
    return `画像: ${alt || assetName || sourceName || "名称なし"}`;
  });
}

function appendTableDeletionSummary(doc, table, change) {
  const isRow = change.deletedRowIndex !== undefined;
  const isColumn = change.deletedColIndex !== undefined;
  if (!isRow && !isColumn) return;

  const panel = tableDeletionPanel(doc, table);
  const item = doc.createElement("article");
  const title = doc.createElement("b");
  const position = isRow ? change.deletedRowIndex + 1 : change.deletedColIndex + 1;
  title.textContent = isRow ? `${position}行目を削除` : `${position}列目を削除`;
  item.append(title);

  let texts = [];
  if (isRow && change.deletedRowHtml) {
    const template = doc.createElement("template");
    template.innerHTML = change.deletedRowHtml;
    texts = [...(template.content.firstElementChild?.cells || [])]
      .flatMap((cell) => {
        const text = cell.textContent.trim();
        return [...(text ? [text] : []), ...describeImages(cell)];
      });
  } else if (isColumn) {
    texts = deletedCellTexts(doc, change);
  }
  if (texts.length) {
    const list = doc.createElement("ul");
    texts.slice(0, 2).forEach((text) => {
      const entry = doc.createElement("li");
      entry.textContent = text;
      list.append(entry);
    });
    item.append(list);
    if (texts.length > 2) {
      const remainder = doc.createElement("span");
      remainder.className = "wr-table-deletions-remainder";
      remainder.textContent = `ほか${texts.length - 2}件`;
      item.append(remainder);
    }
  } else {
    const empty = doc.createElement("span");
    empty.textContent = "（空のセル）";
    item.append(empty);
  }
  panel.append(item);
}

function conciseImageValue(value = "") {
  if (!value) return "（なし）";
  if (String(value).startsWith("data:image/")) {
    const type = String(value).slice(5).split(/[;,]/, 1)[0] || "image";
    return `埋め込み画像（${type}）`;
  }
  return String(value);
}

function imageDownloadName(image, change) {
  const source = String(change.after || image.getAttribute("src") || "");
  const type = source.startsWith("data:image/") ? source.slice(5).split(/[;,]/, 1)[0].toLowerCase() : "";
  const extensions = { jpeg: "jpg", png: "png", gif: "gif", webp: "webp", "svg+xml": "svg", avif: "avif", bmp: "bmp" };
  const fallback = `replacement-image.${extensions[type] || "img"}`;
  return String(change.afterAssetName || image.getAttribute(IMAGE_ASSET_NAME_ATTR) || fallback)
    .split(/[\\/]/).pop()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180) || fallback;
}

function appendImageComparison(doc, container, image, change) {
  const comparison = doc.createElement("div");
  comparison.className = "wr-image-comparison";
  const oldBox = doc.createElement("span");
  const newBox = doc.createElement("span");
  oldBox.className = "wr-image-before";
  newBox.className = "wr-image-after";
  const oldLabel = doc.createElement("b");
  const newLabel = doc.createElement("b");
  oldLabel.textContent = "変更前";
  newLabel.textContent = "変更後";
  const oldImage = doc.createElement("img");
  const newImage = doc.createElement("img");
  oldImage.setAttribute("src", change.before);
  newImage.setAttribute("src", change.after);
  oldImage.setAttribute("alt", "変更前画像");
  newImage.setAttribute("alt", image.getAttribute("alt") || "変更後画像");
  oldBox.append(oldLabel, oldImage);
  newBox.append(newLabel, newImage);
  if (String(change.after).startsWith("data:image/")) {
    const name = imageDownloadName(image, change);
    const download = doc.createElement("a");
    download.className = "wr-image-download";
    download.setAttribute("href", change.after);
    download.setAttribute("download", name);
    download.textContent = `${name} をダウンロード`;
    newBox.append(download);
  }
  comparison.append(oldBox, newBox);
  container.append(comparison);
}

export function createRedlineReport(modifiedHtml, changes, fileName) {
  const doc = new DOMParser().parseFromString(modifiedHtml, "text/html");
  disableActiveContent(doc);

  const metadataTypes = new Set(["meta-title-change", "meta-description-change"]);
  const metadataChanges = new Map();
  changes.filter((change) => metadataTypes.has(change.type)).forEach((change) => {
    const existing = metadataChanges.get(change.type);
    metadataChanges.set(change.type, {
      ...change,
      before: existing?.before ?? change.before,
      after: change.after,
    });
  });
  const visibleMetadataChanges = [...metadataChanges.values()].filter((change) => change.before !== change.after);
  if (visibleMetadataChanges.length) {
    const panel = doc.createElement("section");
    panel.className = "wr-page-info-changes";
    const heading = doc.createElement("strong");
    heading.textContent = "ページ基本情報の変更";
    panel.append(heading);
    visibleMetadataChanges.forEach((change) => {
      const row = doc.createElement("div");
      const label = doc.createElement("b");
      const value = doc.createElement("span");
      label.textContent = changeLabel(change.type);
      value.textContent = `${change.before || "（なし）"} → ${change.after || "（なし）"}`;
      row.append(label, value);
      panel.append(row);
    });
    doc.body.prepend(panel);
  }

  const textChanges = new Map();
  changes.filter((change) => change.type === "text-change" && change.elementId).forEach((change) => {
    const existing = textChanges.get(change.elementId);
    textChanges.set(change.elementId, {
      before: existing?.before ?? change.before,
      after: change.after,
    });
  });
  textChanges.forEach((change, id) => {
    if (change.before === change.after) return;
    const element = doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(id)}"]`);
    if (element) createTextRedline(doc, element, change.before, change.after);
  });

  const imageChangeTypes = new Set(["image-change", "alt-change", "image-link-change", "class-change", "element-move"]);
  const imageGroups = new Map();
  changes.forEach((change) => {
    if (!change.elementId || !imageChangeTypes.has(change.type)) return;
    const image = doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(change.elementId)}"]`);
    if (image?.tagName !== "IMG") return;
    const group = imageGroups.get(change.elementId) || { image, changes: [] };
    group.changes.push(change);
    imageGroups.set(change.elementId, group);
  });
  const handledImageChanges = new Set([...imageGroups.values()].flatMap((group) => group.changes));
  if (imageGroups.size) {
    const panel = doc.createElement("section");
    panel.className = "wr-image-change-summary";
    const panelTitle = doc.createElement("strong");
    panelTitle.textContent = "画像変更一覧";
    panel.append(panelTitle);
    [...imageGroups.values()].forEach((group, index) => {
      const number = index + 1;
      const article = doc.createElement("article");
      const title = doc.createElement("h3");
      title.textContent = `画像変更 ${number}`;
      article.append(title);
      const consolidated = new Map();
      group.changes.forEach((change) => {
        const existing = consolidated.get(change.type);
        consolidated.set(change.type, {
          ...change,
          before: existing?.before ?? change.before,
          after: change.after,
        });
      });
      [...consolidated.values()].filter((change) => change.before !== change.after).forEach((change) => {
        const row = doc.createElement("div");
        const label = doc.createElement("b");
        const value = doc.createElement("span");
        label.textContent = change.type === "image-change" ? "画像URL（src）" : changeLabel(change.type);
        value.textContent = `${conciseImageValue(change.before)} → ${conciseImageValue(change.after)}`;
        row.append(label, value);
        article.append(row);
        if (change.type === "image-change") appendImageComparison(doc, article, group.image, change);
      });
      group.image.classList.add("wr-redline-target", "wr-redline-image");
      const host = imageLabelHost(group.image);
      if (host) {
        host.classList.add("wr-image-label-host");
        const marker = doc.createElement("span");
        marker.className = "wr-image-marker";
        marker.textContent = `画像変更 ${number}`;
        host.prepend(marker);
      }
      panel.append(article);
    });
    doc.body.prepend(panel);
  }

  changes
    .filter((change) => change.type !== "text-change" && !metadataTypes.has(change.type) && !handledImageChanges.has(change))
    .map((change, order) => ({ change, order }))
    .sort((left, right) => {
      if (left.change.type === "element-delete" && right.change.type === "element-delete"
        && left.change.parentId === right.change.parentId) return right.order - left.order;
      return Number(left.change.type === "image-change") - Number(right.change.type === "image-change");
    })
    .map(({ change }) => change)
    .forEach((change) => {
    let element = change.elementId
      ? doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(change.elementId)}"]`)
      : null;
    if (change.type === "element-delete") {
      const parent = change.parentId
        ? doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(change.parentId)}"]`)
        : doc.body;
      if (!parent || !change.before) return;
      element = sanitizedElementFromHtml(doc, change.before);
      if (!element) return;
      element.removeAttribute(EDITOR_ID_ATTR);
      if (element.tagName === "IMG" && parent.tagName !== "PICTURE") {
        const wrapper = doc.createElement("span");
        wrapper.className = "wr-deleted-image";
        wrapper.append(element);
        element = wrapper;
      }
      const reference = parent.children[Math.max(0, change.index)] ?? null;
      parent.insertBefore(element, reference);
      addLabel(element, "削除", "delete");
      return;
    }
    if (!element) return;
    const labels = {
      "element-add": ["追加", "add"],
      "element-move": ["移動", "move"],
      "link-change": [`リンク変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "image-link-change": [`画像リンク変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "inline-link-change": [`文章内リンク: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "alt-change": [`alt変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "class-change": [`class変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "table-change": [change.action ? `表の構成変更（${change.action}）` : "表の構成変更", "change"],
    };
    if (change.type === "table-change") {
      appendTableDeletionSummary(doc, element, change);
      if (Array.isArray(change.addedCellIds) && change.addedCellIds.length > 0) {
        let firstCell = null;
        change.addedCellIds.forEach((id) => {
          const cell = doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(id)}"]`);
          if (cell) {
            cell.classList.add("wr-redline-target", "wr-redline-add", "wr-redline-added-cell");
            cell.style.backgroundColor = "#f0faf4";
            cell.style.border = "2px dashed #15975a";
            if (!firstCell) firstCell = cell;
          }
        });
        if (firstCell) {
          const badge = doc.createElement("span");
          badge.className = "wr-redline-label wr-table-cell-redline-label";
          badge.style.background = "#08733f";
          badge.textContent = change.addedColIndex !== undefined
            ? `追加列（${change.addedColIndex + 1}列目）`
            : `追加行（${change.addedRowIndex !== undefined ? change.addedRowIndex + 1 : 1}行目）`;
          firstCell.prepend(badge);
        }
      }
      if (change.cellId) {
        const cell = doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(change.cellId)}"]`);
        if (cell) {
          addLabel(cell, change.action ? `セル: ${change.action}` : "セル変更", "change");
        }
      }
      const label = change.action ? `表の構成変更（${change.action}）` : "表の構成変更";
      addLabel(element, label, "change");
      return;
    }
    const [label, kind] = labels[change.type] ?? [changeLabel(change.type), "change"];
    addLabel(element, label, kind);
  });

  const style = doc.createElement("style");
  style.textContent = `
    del{color:#a52020;background:#ffe4e4;text-decoration-thickness:2px}
    ins{display:inline;color:#08733f;background:#dff7e9;text-decoration:none;border-bottom:2px solid #19a260}
    del+ins{margin-left:.35em}
    .wr-redline-target{position:relative!important;outline:3px solid #d5a216!important;outline-offset:-3px!important}
    .wr-redline-label-inside{position:absolute!important;z-index:2147483647!important;top:-4px!important;left:0!important;transform:translateY(-100%)!important;display:inline-block!important;width:max-content!important;max-width:100%!important;margin:0!important;padding:3px 8px!important;border-radius:5px!important;color:#fff!important;background:#9a7010!important;box-shadow:0 1px 4px #0004!important;font:700 12px/1.5 system-ui,sans-serif!important;white-space:nowrap!important;text-decoration:none!important;pointer-events:none!important}
    .wr-redline-label-inside.wr-redline-label-add{background:#08733f!important}.wr-redline-label-inside.wr-redline-label-delete{background:#a52020!important}.wr-redline-label-inside.wr-redline-label-move{background:#245da9!important}.wr-redline-label-inside.wr-redline-label-text{background:#8d4918!important}
    .imgTxt .imgTxt_body-around:has(.wr-redline-target){display:flow-root!important;overflow:visible!important}
    .wr-redline-label{display:inline-block!important;position:relative!important;z-index:2147483647!important;width:max-content!important;max-width:100%!important;margin:2px .55em 4px 2px!important;padding:3px 8px!important;border-radius:5px!important;color:#fff!important;background:#9a7010!important;font:700 12px/1.5 system-ui,sans-serif!important;vertical-align:middle!important;white-space:normal!important;text-decoration:none!important}.wr-table-redline-label{display:inline-block!important}
    .wr-redline-label-wrapper{position:relative!important;display:inline-flex!important;flex-direction:column!important;align-items:flex-start!important;width:fit-content!important;max-width:100%!important;vertical-align:baseline!important}
    .wr-redline-label-attached{position:static!important;z-index:2147483647!important;transform:none!important;display:block!important;align-self:flex-start!important;width:max-content!important;max-width:min(80vw,32em)!important;margin:0 0 4px!important;white-space:nowrap!important;pointer-events:none!important}
    .wr-table-cell-redline-label{position:absolute!important;top:0!important;left:0!important;transform:translateY(-100%)!important;margin:0!important;white-space:nowrap!important;pointer-events:none!important}
    .wr-redline-text-diff-box{position:relative!important;z-index:2147483646!important;display:block!important;margin:6px 0!important;padding:8px 12px!important;border:2px solid #a65a20!important;border-radius:6px!important;background:#fff8ec!important;font:13px/1.5 system-ui,sans-serif!important;color:#24242d!important}.wr-redline-text-diff-box>strong{color:#8d4918!important;margin-right:6px!important}
    .wr-page-info-changes{position:relative!important;z-index:2147483646!important;display:grid!important;gap:8px!important;margin:12px!important;padding:14px!important;border:3px solid #a65a20!important;border-radius:8px!important;color:#24242d!important;background:#fff8ec!important;font:14px/1.5 system-ui,sans-serif!important}.wr-page-info-changes>strong{color:#8d4918!important}.wr-page-info-changes>div{display:grid!important;grid-template-columns:minmax(130px,auto) 1fr!important;gap:10px!important}.wr-page-info-changes span{overflow-wrap:anywhere!important}
    .wr-table-deletions{position:relative!important;z-index:2147483646!important;display:grid!important;gap:8px!important;margin:12px 0!important;padding:12px 14px!important;border:2px solid #cc3434!important;border-radius:8px!important;color:#5f1717!important;background:#fff1f1!important;font:13px/1.5 system-ui,sans-serif!important}.wr-table-deletions>strong{font-size:14px!important}.wr-table-deletions>article{display:grid!important;gap:4px!important;padding-top:8px!important;border-top:1px solid #efb1b1!important}.wr-table-deletions>article:first-of-type{padding-top:0!important;border-top:0!important}.wr-table-deletions ul{margin:0!important;padding-left:1.4em!important}.wr-table-deletions li{overflow-wrap:anywhere!important}.wr-table-deletions-remainder{color:#8d4b4b!important;font-weight:700!important}
    .wr-image-change-summary{position:relative!important;z-index:2147483646!important;display:grid!important;gap:12px!important;margin:12px!important;padding:14px!important;border:3px solid #9a7010!important;border-radius:8px!important;color:#24242d!important;background:#fffbed!important;font:14px/1.5 system-ui,sans-serif!important}.wr-image-change-summary>strong{color:#7e5908!important;font-size:16px!important}.wr-image-change-summary>article{display:grid!important;gap:8px!important;padding:12px!important;border:1px solid #dfc574!important;border-radius:7px!important;background:#fff!important}.wr-image-change-summary h3{margin:0!important;color:#7e5908!important;font:800 14px/1.4 system-ui,sans-serif!important}.wr-image-change-summary article>div:not(.wr-image-comparison){display:grid!important;grid-template-columns:minmax(120px,auto) minmax(0,1fr)!important;gap:10px!important}.wr-image-change-summary article>div>span{overflow-wrap:anywhere!important;word-break:break-word!important}
    .wr-image-label-host{position:relative!important}.wr-image-marker{position:absolute!important;z-index:2147483647!important;top:4px!important;left:4px!important;display:inline-block!important;max-width:calc(100% - 8px)!important;padding:3px 7px!important;border-radius:5px!important;color:#fff!important;background:#9a7010!important;box-shadow:0 1px 4px #0004!important;font:700 11px/1.4 system-ui,sans-serif!important;white-space:nowrap!important;text-decoration:none!important;pointer-events:none!important}
    .wr-redline-add{outline-color:#15975a!important}.wr-redline-add>.wr-redline-label{background:#08733f!important}
    .wr-redline-delete{opacity:.72!important;outline-color:#cc3434!important;text-decoration:line-through!important}.wr-redline-delete>.wr-redline-label{background:#a52020!important}
    .wr-redline-label-sibling.wr-redline-label-add{background:#08733f!important}.wr-redline-label-sibling.wr-redline-label-delete{background:#a52020!important}.wr-redline-label-sibling.wr-redline-label-move{background:#245da9!important}.wr-redline-label-sibling.wr-redline-label-text{background:#8d4918!important}
    .wr-deleted-image{display:inline-grid!important;gap:5px!important;max-width:100%!important;margin:24px 4px 8px!important;vertical-align:top!important}.wr-deleted-image>img{display:block!important;max-width:100%!important;height:auto!important}.wr-deleted-image>.wr-redline-label{grid-row:1!important;justify-self:start!important}
    .wr-redline-move{outline-color:#3578d4!important}.wr-redline-move>.wr-redline-label{background:#245da9!important}
    .wr-redline-text{outline-color:#a65a20!important}.wr-redline-text>.wr-redline-label{background:#8d4918!important}
    .wr-image-comparison{display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important;padding:8px!important;margin:0!important;border:1px solid #e1e2ea!important;border-radius:6px!important;background:#f8f9fc!important}
    .wr-image-comparison>span{display:grid!important;gap:6px!important;align-content:start!important}.wr-image-comparison img{display:block!important;max-width:100%!important;max-height:220px!important;width:auto!important;height:auto!important;margin:auto!important;object-fit:contain!important}.wr-image-before{opacity:.75!important}.wr-image-before img{filter:grayscale(.35)!important}
    .wr-redline-added-cell{background-color:#f0faf4!important;border:2px dashed #15975a!important;outline:2px solid #15975a!important}
    .wr-image-download{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:max-content!important;max-width:100%!important;margin:4px auto 0!important;padding:7px 11px!important;border:1px solid #278055!important;border-radius:6px!important;color:#075f38!important;background:#effaf4!important;font:700 12px/1.4 system-ui,sans-serif!important;text-decoration:none!important;overflow-wrap:anywhere!important}.wr-image-download:hover{background:#ddf4e8!important}
  `;
  doc.head.append(style);
  doc.querySelectorAll(`[${EDITOR_ID_ATTR}]`).forEach((element) => element.removeAttribute(EDITOR_ID_ATTR));
  doc.title = `${fileName} 赤入れページ`;
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}

export function downloadRedlineReport(fileName, modifiedHtml, changes) {
  const html = createRedlineReport(modifiedHtml, changes, fileName);
  const baseName = fileName.replace(/\.(html?|HTML?)$/, "") || "page";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}-redline.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
