const TYPE_LABELS = {
  "text-change": "テキスト変更",
  "link-change": "リンク変更",
  "alt-change": "画像alt変更",
  "image-change": "画像差し替え",
  "class-change": "CSS class変更",
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
      <h2>${escapeHtml(changeLabel(change.type))}</h2>
      <p class="target">対象: <code>${escapeHtml(change.target)}</code></p>
      ${changeContent(change)}
    </article>`).join("");

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fileName)} 修正指示</title><style>
:root{font-family:system-ui,sans-serif;color:#20202b;background:#f3f4f7}*{box-sizing:border-box}body{margin:0}header{padding:40px max(5vw,24px);color:#fff;background:#252552}main{max-width:1100px;margin:auto;padding:32px 24px}.summary{margin-top:-20px;margin-bottom:28px;padding:18px 22px;border-radius:12px;background:#fff;box-shadow:0 8px 25px #20202b18}.change{margin:18px 0;padding:24px;border:1px solid #dddfea;border-radius:14px;background:#fff}.change-number{color:#5b5bd6;font-size:13px;font-weight:800;text-transform:uppercase}.change h2{margin:.3rem 0}.target{color:#666}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:18px}.before,.after{overflow:auto;padding:18px;border-radius:10px}.before{border:1px solid #efb6b6;background:#fff4f4}.after{border:1px solid #a9dbbf;background:#f1fbf5}.single{margin-top:14px}.comparison h3,.single h3{margin-top:0;font-size:14px}.comparison img{display:block;max-width:100%;max-height:320px;margin:auto}.comparison pre,.single pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.empty{padding:50px;text-align:center;color:#777;background:#fff;border-radius:12px}@media(max-width:700px){.comparison{grid-template-columns:1fr}}
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

function addLabel(element, label, kind = "change") {
  element.classList.add("wr-redline-target", `wr-redline-${kind}`);
  const labels = element.getAttribute("data-wr-label");
  const combinedLabel = labels ? `${labels} / ${label}` : label;
  element.setAttribute("data-wr-label", combinedLabel);
  let badge = [...element.children].find((child) => child.classList.contains("wr-redline-label"));
  if (!badge) {
    badge = element.ownerDocument.createElement("span");
    badge.className = "wr-redline-label";
    element.prepend(badge);
  }
  badge.textContent = combinedLabel;
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

function createTextRedline(doc, element, before, after) {
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
  addLabel(element, "文章変更", "text");
}

function createImageRedline(doc, image, change) {
  const wrapper = doc.createElement("span");
  wrapper.className = "wr-image-comparison wr-redline-target wr-redline-image";
  wrapper.setAttribute("data-wr-label", "画像変更");
  const badge = doc.createElement("span");
  badge.className = "wr-redline-label";
  badge.textContent = "画像変更";
  const oldBox = doc.createElement("span");
  const newBox = doc.createElement("span");
  oldBox.className = "wr-image-before";
  newBox.className = "wr-image-after";
  oldBox.innerHTML = "<b>変更前</b>";
  newBox.innerHTML = "<b>変更後</b>";
  const oldImage = image.cloneNode(false);
  oldImage.setAttribute("src", change.before);
  oldImage.removeAttribute(EDITOR_ID_ATTR);
  const newImage = image.cloneNode(false);
  newImage.setAttribute("src", change.after);
  newImage.removeAttribute(EDITOR_ID_ATTR);
  oldBox.append(oldImage);
  newBox.append(newImage);
  wrapper.append(badge, oldBox, newBox);
  image.replaceWith(wrapper);
}

export function createRedlineReport(modifiedHtml, changes, fileName) {
  const doc = new DOMParser().parseFromString(modifiedHtml, "text/html");
  disableActiveContent(doc);

  const textChanges = new Map();
  changes.filter((change) => change.type === "text-change" && change.elementId).forEach((change) => {
    const existing = textChanges.get(change.elementId);
    textChanges.set(change.elementId, {
      before: existing?.before ?? change.before,
      after: change.after,
    });
  });
  textChanges.forEach((change, id) => {
    const element = doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(id)}"]`);
    if (element) createTextRedline(doc, element, change.before, change.after);
  });

  changes.filter((change) => change.type !== "text-change").forEach((change) => {
    let element = change.elementId
      ? doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(change.elementId)}"]`)
      : null;
    if (change.type === "element-delete") {
      const parent = change.parentId
        ? doc.querySelector(`[${EDITOR_ID_ATTR}="${CSS.escape(change.parentId)}"]`)
        : doc.body;
      if (!parent || !change.before) return;
      const template = doc.createElement("template");
      template.innerHTML = change.before;
      element = template.content.firstElementChild;
      if (!element) return;
      element.removeAttribute(EDITOR_ID_ATTR);
      addLabel(element, "削除", "delete");
      const reference = parent.children[Math.max(0, change.index)] ?? null;
      parent.insertBefore(element, reference);
      return;
    }
    if (!element) return;
    if (change.type === "image-change" && element.tagName === "IMG") {
      createImageRedline(doc, element, change);
      return;
    }
    const labels = {
      "element-add": ["追加", "add"],
      "element-move": ["移動", "move"],
      "link-change": [`リンク変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "alt-change": [`alt変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
      "class-change": [`class変更: ${change.before || "（なし）"} → ${change.after || "（なし）"}`, "attribute"],
    };
    const [label, kind] = labels[change.type] ?? [changeLabel(change.type), "change"];
    addLabel(element, label, kind);
  });

  const style = doc.createElement("style");
  style.textContent = `
    del{color:#a52020;background:#ffe4e4;text-decoration-thickness:2px}
    ins{display:inline;color:#08733f;background:#dff7e9;text-decoration:none;border-bottom:2px solid #19a260}
    del+ins{margin-left:.35em}
    .wr-redline-target{position:relative!important;outline:3px solid #d5a216!important;outline-offset:3px!important}
    .wr-redline-label{display:inline-block!important;position:relative!important;z-index:2147483647!important;width:max-content!important;max-width:100%!important;margin:2px .55em 4px 2px!important;padding:3px 8px!important;border-radius:5px!important;color:#fff!important;background:#9a7010!important;font:700 12px/1.5 system-ui,sans-serif!important;vertical-align:middle!important;white-space:normal!important;text-decoration:none!important}
    .wr-redline-add{outline-color:#15975a!important}.wr-redline-add>.wr-redline-label{background:#08733f!important}
    .wr-redline-delete{opacity:.72!important;outline-color:#cc3434!important;text-decoration:line-through!important}.wr-redline-delete>.wr-redline-label{background:#a52020!important}
    .wr-redline-move{outline-color:#3578d4!important}.wr-redline-move>.wr-redline-label{background:#245da9!important}
    .wr-redline-text{outline-color:#a65a20!important}.wr-redline-text>.wr-redline-label{background:#8d4918!important}
    .wr-image-comparison{display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important;padding:12px!important;margin:28px 0 12px!important;background:#fff!important}
    .wr-image-comparison>.wr-redline-label{grid-column:1/-1!important;justify-self:start!important}
    .wr-image-comparison>span{display:grid!important;gap:6px!important;align-content:start!important}.wr-image-comparison img{display:block!important;max-width:100%!important;height:auto!important}.wr-image-before{opacity:.7!important}.wr-image-before img{filter:grayscale(.45)!important}
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
