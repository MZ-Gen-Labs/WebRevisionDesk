import {
  EDITOR_CLASS,
  EDITOR_ID_ATTR,
  EDITOR_STYLE_ID,
  IMAGE_ASSET_NAME_ATTR,
  collectClassNames,
  normalizeClasses,
  serializeDocument,
} from "./html.js";

const TEXT_BLOCKLIST = new Set([
  "HTML", "HEAD", "BODY", "SCRIPT", "STYLE", "LINK", "META", "IMG", "VIDEO", "AUDIO", "IFRAME", "CANVAS", "SVG",
]);
const STRUCTURE_ELEMENTS = new Set(["HTML", "HEAD", "BODY"]);
const SEARCH_HIGHLIGHTS = {
  all: "web-revision-search-all",
  excluded: "web-revision-search-excluded",
  current: "web-revision-search-current",
};
const ARTICLE_BODY_SELECTORS = [
  "[itemprop='articleBody']", ".article-body", ".article-content", ".entry-content", ".post-content",
  ".main-content", ".main-contents", "#main-content", "#main-contents", ".layoutArea_main",
  ".layout-area-main", ".page-main", ".contents-main", "#contents",
];
const ARTICLE_CONTAINER_SELECTORS = ["article", "main", "[role='main']", "#main", "#content", ".content"];
const IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/gif", "gif"],
  ["image/webp", "webp"], ["image/svg+xml", "svg"], ["image/avif", "avif"], ["image/bmp", "bmp"],
]);

function safeImageAssetName(value, source = "") {
  let name = String(value || "").split(/[\\/]/).pop() || "";
  if (!name && source && !source.startsWith("data:")) {
    try { name = decodeURIComponent(new URL(source, "https://web-revision.invalid/").pathname.split("/").pop() || ""); }
    catch {}
  }
  if (!name && source.startsWith("data:")) {
    const mime = source.slice(5).split(/[;,]/, 1)[0].toLowerCase();
    name = `replacement-image.${IMAGE_EXTENSIONS.get(mime) || "img"}`;
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^\.+/, "").trim().slice(0, 180);
  return name || "replacement-image.img";
}

export function buildTableGrid(table) {
  const rows = [...table.rows];
  const rowCount = rows.length;
  const grid = [];
  let maxCols = 0;

  for (let r = 0; r < rowCount; r++) {
    if (!grid[r]) grid[r] = [];
    const row = rows[r];
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r][c]) c++;
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          const targetR = r + dr;
          const targetC = c + dc;
          if (!grid[targetR]) grid[targetR] = [];
          grid[targetR][targetC] = {
            cell,
            row: r,
            col: c,
            rowSpan,
            colSpan,
            isOrigin: dr === 0 && dc === 0,
          };
          if (targetC + 1 > maxCols) maxCols = targetC + 1;
        }
      }
      c += colSpan;
    }
    if (c > maxCols) maxCols = c;
  }
  return { grid, rowCount, colCount: maxCols, rows };
}

function copyCellStyle(source, target) {
  if (!source || !target) return;
  if (source.className) {
    const classes = [...source.classList].filter((c) => c !== EDITOR_CLASS);
    if (classes.length) target.className = classes.join(" ");
  }
  const stylesToCopy = [
    "backgroundColor", "color", "borderColor", "borderStyle", "borderWidth",
    "borderTop", "borderRight", "borderBottom", "borderLeft",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "textAlign", "verticalAlign", "fontSize", "fontWeight", "fontFamily",
  ];
  for (const prop of stylesToCopy) {
    if (source.style[prop]) {
      target.style[prop] = source.style[prop];
    }
  }
}

export class PageEditor {
  constructor(frame, callbacks = {}) {
    this.frame = frame;
    this.callbacks = callbacks;
    this.selected = null;
    this.selectedElements = new Set();
    this.selectionAnchor = null;
    this.editable = false;
    this.loaded = false;
    this.editingSnapshot = null;
    this.nextElementId = 1;
    this.elementClipboard = [];
    this.selectionNavigation = [];
    this.inlineLinkSelection = null;
  }

  load(html, editable) {
    this.clearSearchHighlight();
    this.editable = editable;
    this.selected = null;
    this.selectedElements = new Set();
    this.selectionAnchor = null;
    this.selectionNavigation = [];
    this.inlineLinkSelection = null;
    this.callbacks.onTextSelection?.(null);
    this.loaded = false;
    return new Promise((resolve) => {
      const onLoad = () => {
        this.frame.removeEventListener("load", onLoad);
        this.#prepareDocument();
        this.loaded = true;
        resolve();
      };
      // srcdoc設定前からloadを待つと、iframe生成直後のabout:blankを
      // 読込完了と誤認するブラウザがあるため、設定後に登録する。
      this.frame.srcdoc = html;
      this.frame.addEventListener("load", onLoad);
    });
  }

  unload() {
    this.clearSearchHighlight();
    this.clearSelection();
    this.editable = false;
    this.loaded = false;
    this.editingSnapshot = null;
    this.frame.srcdoc = "";
  }

  #prepareDocument() {
    const doc = this.frame.contentDocument;
    if (!doc) return;
    const FrameElement = doc.defaultView?.Element;
    const FrameHTMLElement = doc.defaultView?.HTMLElement;
    this.#ensureElementIds(doc);
    doc.getElementById(EDITOR_STYLE_ID)?.remove();
    const style = doc.createElement("style");
    style.id = EDITOR_STYLE_ID;
    style.textContent = `
      .${EDITOR_CLASS} { outline: 3px solid #5b5bd6 !important; outline-offset: 2px !important; }
      ::highlight(${SEARCH_HIGHLIGHTS.all}) {
        color: #2a2200;
        background: #fff0a8;
      }
      ::highlight(${SEARCH_HIGHLIGHTS.excluded}) {
        color: #711c16;
        background: #ffd4d0;
        text-decoration: line-through #b42318 2px;
      }
      ::highlight(${SEARCH_HIGHLIGHTS.current}) {
        color: #201000;
        background: #ffad33;
        text-decoration: underline #c43e00 4px;
      }
      [contenteditable="true"] { cursor: text !important; }
    `;
    doc.head?.append(style);

    doc.addEventListener("click", (event) => {
      const element = FrameElement && event.target instanceof FrameElement ? event.target : null;
      if (!element) return;
      const link = element.closest("a");
      if (link?.matches(".wr-image-download[download]")) return;
      if (link) event.preventDefault();
      if (!this.editable) return;
      if (element.closest('[contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      this.select(element, {
        additive: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      });
    }, true);

    const captureTextSelection = () => queueMicrotask(() => this.#captureInlineLinkSelection());
    doc.addEventListener("mouseup", captureTextSelection);
    doc.addEventListener("keyup", captureTextSelection);

    doc.addEventListener("dblclick", (event) => {
      if (!this.editable) return;
      const element = FrameHTMLElement && event.target instanceof FrameHTMLElement ? event.target : null;
      if (!element || TEXT_BLOCKLIST.has(element.tagName)) return;
      event.preventDefault();
      this.select(element);
      this.editingSnapshot = { element, before: element.textContent ?? "", beforeHtml: element.innerHTML };
      element.contentEditable = "true";
      element.focus();
    }, true);

    doc.addEventListener("focusout", (event) => {
      const element = FrameHTMLElement && event.target instanceof FrameHTMLElement ? event.target : null;
      if (element?.isContentEditable) {
        element.removeAttribute("contenteditable");
        const before = this.editingSnapshot?.element === element ? this.editingSnapshot.before : "";
        const after = element.textContent ?? "";
        const beforeHtml = this.editingSnapshot?.beforeHtml;
        this.editingSnapshot = null;
        if (before !== after || beforeHtml !== element.innerHTML) this.#emitChange("text-change", element, before, after, { beforeHtml, afterHtml: element.innerHTML });
        this.#notifySelection();
      }
    }, true);
  }

  #notifySelection() {
    this.callbacks.onSelect?.(this.selected, [...this.selectedElements]);
  }

  #clearInlineLinkSelection() {
    this.inlineLinkSelection = null;
    this.callbacks.onTextSelection?.(null);
  }

  #captureInlineLinkSelection() {
    const doc = this.getDocument();
    const selection = doc?.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
      this.#clearInlineLinkSelection();
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    if (!startElement || !endElement || !doc.body.contains(startElement) || !doc.body.contains(endElement)) {
      this.#clearInlineLinkSelection();
      return;
    }
    const commonNode = range.commonAncestorContainer;
    const commonElement = commonNode.nodeType === 1 ? commonNode : commonNode.parentElement;
    let container = this.selected?.contains(startElement) && this.selected.contains(endElement)
      ? this.selected
      : commonElement;
    if (container?.tagName === "A") container = container.parentElement;
    if (!container || STRUCTURE_ELEMENTS.has(container.tagName)) {
      this.#clearInlineLinkSelection();
      return;
    }
    const startLink = startElement.closest("a");
    const endLink = endElement.closest("a");
    const link = startLink && startLink === endLink ? startLink : null;
    this.inlineLinkSelection = { range: range.cloneRange(), container, link };
    this.callbacks.onTextSelection?.({
      text: selection.toString(),
      href: link?.getAttribute("href") || "",
      linked: Boolean(link),
    });
  }

  #replaceSelection(elements, primary = elements.at(-1) ?? null) {
    this.selectedElements.forEach((selected) => selected.classList.remove(EDITOR_CLASS));
    this.selectedElements = new Set(elements.filter((element) => element?.isConnected));
    this.selectedElements.forEach((selected) => selected.classList.add(EDITOR_CLASS));
    this.selected = this.selectedElements.has(primary) ? primary : [...this.selectedElements].at(-1) ?? null;
    this.#notifySelection();
  }

  select(element, { additive = false, range = false, preserveNavigation = false } = {}) {
    if (!preserveNavigation) this.selectionNavigation = [];
    this.#clearInlineLinkSelection();
    if (!element) return this.clearSelection();
    if (range && this.selectionAnchor?.isConnected && this.selectionAnchor.parentElement === element.parentElement) {
      const siblings = [...element.parentElement.children];
      const start = siblings.indexOf(this.selectionAnchor);
      const end = siblings.indexOf(element);
      const ranged = siblings.slice(Math.min(start, end), Math.max(start, end) + 1);
      const elements = additive ? [...new Set([...this.selectedElements, ...ranged])] : ranged;
      this.#replaceSelection(elements, element);
      return;
    }
    if (additive) {
      const elements = new Set(this.selectedElements);
      if (elements.has(element)) elements.delete(element);
      else elements.add(element);
      this.selectionAnchor = element;
      this.#replaceSelection([...elements], elements.has(element) ? element : [...elements].at(-1));
      return;
    }
    this.selectionAnchor = element;
    this.#replaceSelection([element], element);
  }

  clearSelection() {
    this.selectedElements.forEach((element) => {
      element.classList.remove(EDITOR_CLASS);
      element.removeAttribute("contenteditable");
    });
    this.selectedElements.clear();
    this.selected = null;
    this.selectionAnchor = null;
    this.selectionNavigation = [];
    this.#clearInlineLinkSelection();
    this.#notifySelection();
  }

  getDocument() {
    return this.frame.contentDocument;
  }

  getSearchTextNodes({ searchScope = "page", searchSelector = "" } = {}) {
    const doc = this.getDocument();
    const win = this.frame.contentWindow;
    if (!doc?.body || !win) return [];
    let roots = [doc.body];
    if (searchScope === "selector") {
      const selector = String(searchSelector || "").trim();
      if (!selector) throw new Error("検索範囲のCSSセレクターを入力してください。");
      try { roots = [...doc.querySelectorAll(selector)]; }
      catch { throw new Error("検索範囲のCSSセレクターが正しくありません。"); }
      if (!roots.length) throw new Error("指定したCSSセレクターに一致する範囲がありません。");
    } else if (searchScope === "article") {
      const specific = [...doc.querySelectorAll(ARTICLE_BODY_SELECTORS.join(","))];
      const containers = specific.length ? specific : [...doc.querySelectorAll(ARTICLE_CONTAINER_SELECTORS.join(","))];
      roots = containers.length ? containers : [doc.body];
    }
    const blocked = "script, style, noscript, textarea, select, option, template, [hidden], [aria-hidden='true']";
    const articleChrome = "header, nav, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo']";
    const nodes = [];
    const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.data.trim() || parent.closest(blocked) || !roots.some((root) => root.contains(node))) continue;
      if (searchScope === "article" && parent.closest(articleChrome)) continue;
      const style = win.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") continue;
      nodes.push(node);
    }
    return nodes;
  }

  selectTextNodeContainer(node) {
    const element = node?.parentElement;
    if (!element?.isConnected) return false;
    this.select(element);
    element.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }

  clearSearchHighlight() {
    const registry = this.frame.contentWindow?.CSS?.highlights;
    Object.values(SEARCH_HIGHLIGHTS).forEach((name) => registry?.delete(name));
  }

  highlightSearchMatches(matches, current) {
    this.clearSearchHighlight();
    const doc = this.getDocument();
    const win = this.frame.contentWindow;
    const connectedMatches = matches.filter((item) => item?.node?.isConnected);
    if (!doc || !win || (!connectedMatches.length && !current?.node?.isConnected)) return false;
    const makeRange = ({ node, index, length }) => {
      if (!node?.isConnected || index < 0 || length <= 0) return null;
      const range = doc.createRange();
      range.setStart(node, Math.min(index, node.data.length));
      range.setEnd(node, Math.min(index + length, node.data.length));
      return range;
    };
    if (win.CSS?.highlights && win.Highlight) {
      const regularRanges = connectedMatches.filter((item) => !item.excluded).map(makeRange).filter(Boolean);
      const excludedRanges = connectedMatches.filter((item) => item.excluded).map(makeRange).filter(Boolean);
      const currentRange = current ? makeRange(current) : null;
      if (regularRanges.length) win.CSS.highlights.set(SEARCH_HIGHLIGHTS.all, new win.Highlight(...regularRanges));
      if (excludedRanges.length) win.CSS.highlights.set(SEARCH_HIGHLIGHTS.excluded, new win.Highlight(...excludedRanges));
      if (currentRange) {
        const active = new win.Highlight(currentRange);
        active.priority = 10;
        win.CSS.highlights.set(SEARCH_HIGHLIGHTS.current, active);
      }
    } else {
      const range = current ? makeRange(current) : null;
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      if (range) selection?.addRange(range);
    }
    return current?.node?.isConnected ? this.selectTextNodeContainer(current.node) : true;
  }

  highlightTextMatch(node, index, length) {
    const current = { node, index, length, excluded: false };
    return this.highlightSearchMatches([current], current);
  }

  getTextMatchViewportRect(node, index, length) {
    const doc = this.getDocument();
    if (!doc || !node?.isConnected) return null;
    const frameRect = this.frame.getBoundingClientRect();
    let matchRect;
    if (length > 0) {
      const range = doc.createRange();
      range.setStart(node, Math.min(index, node.data.length));
      range.setEnd(node, Math.min(index + length, node.data.length));
      matchRect = range.getBoundingClientRect();
    } else {
      matchRect = node.parentElement?.getBoundingClientRect();
    }
    if (!matchRect) return null;
    return {
      left: frameRect.left + matchRect.left,
      top: frameRect.top + matchRect.top,
      right: frameRect.left + matchRect.right,
      bottom: frameRect.top + matchRect.bottom,
      width: matchRect.width,
      height: matchRect.height,
    };
  }

  scrollBy(left, top) {
    this.frame.contentWindow?.scrollBy({ left, top, behavior: "auto" });
  }

  replaceTextNodeMatch(node, index, length, replacement) {
    const element = node?.parentElement;
    if (!element?.isConnected || index < 0 || length < 0) return false;
    const before = element.textContent ?? "";
    const beforeHtml = element.innerHTML;
    node.data = `${node.data.slice(0, index)}${replacement}${node.data.slice(index + length)}`;
    const after = element.textContent ?? "";
    if (before === after && beforeHtml === element.innerHTML) return false;
    this.#emitChange("text-change", element, before, after, { beforeHtml, afterHtml: element.innerHTML });
    this.select(element);
    return true;
  }

  getHtml() {
    if (!this.loaded || !this.getDocument()) return "";
    return serializeDocument(this.getDocument(), { keepEditorIds: true });
  }

  getExportHtml() {
    if (!this.loaded || !this.getDocument()) return "";
    return serializeDocument(this.getDocument());
  }

  hasLoadedDocument() {
    return this.loaded;
  }

  getPageStructure() {
    const doc = this.getDocument();
    if (!this.loaded || !doc) return { title: "", description: "", primaryHeading: "", headings: [] };
    const headings = [...doc.querySelectorAll("h1, h2, h3")].map((element) => ({
      id: this.#ensureElementId(element),
      level: Number(element.tagName.slice(1)),
      text: (element.textContent || "").replace(/\s+/g, " ").trim() || "（空の見出し）",
    }));
    return {
      title: doc.title || "",
      description: doc.querySelector('meta[name="description" i]')?.getAttribute("content") || "",
      primaryHeading: doc.querySelector("h1")?.textContent || "",
      headings,
    };
  }

  selectById(elementId) {
    const element = this.#findByEditorId(elementId);
    if (!element) return false;
    this.select(element);
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  updateDocumentTitle(value) {
    const doc = this.getDocument();
    if (!doc) return false;
    const before = doc.title || "";
    const after = value.trim();
    if (before === after) return false;
    doc.title = after;
    this.callbacks.onChange?.({
      type: "meta-title-change", target: "head > title", elementId: "", before, after,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  updateDocumentDescription(value) {
    const doc = this.getDocument();
    if (!doc) return false;
    let meta = doc.querySelector('meta[name="description" i]');
    const before = meta?.getAttribute("content") || "";
    const after = value.trim();
    if (before === after) return false;
    if (after) {
      if (!meta) {
        meta = doc.createElement("meta");
        meta.setAttribute("name", "description");
        doc.head.append(meta);
      }
      meta.setAttribute("content", after);
    } else {
      meta?.remove();
    }
    this.callbacks.onChange?.({
      type: "meta-description-change", target: 'head > meta[name="description"]', elementId: "", before, after,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  updatePrimaryHeading(value) {
    const doc = this.getDocument();
    if (!doc) return false;
    let heading = doc.querySelector("h1");
    const after = value.trim();
    if (!heading) {
      if (!after) return false;
      heading = doc.createElement("h1");
      heading.textContent = after;
      const parent = doc.querySelector("main") || doc.body;
      parent.prepend(heading);
      this.#emitChange("element-add", heading, "", this.#cleanOuterHtml(heading), {
        action: "page-heading",
        parentId: this.#ensureElementId(parent),
        index: 0,
      });
      return true;
    }
    const before = heading.textContent || "";
    if (before === after) return false;
    const beforeHtml = heading.innerHTML;
    heading.textContent = after;
    this.#emitChange("text-change", heading, before, after, { beforeHtml, afterHtml: heading.innerHTML });
    return true;
  }

  getTableContext() {
    const table = this.selected?.closest?.("table");
    if (!table) return null;
    const { grid, rowCount, colCount, rows } = buildTableGrid(table);
    const selectedCell = this.selected?.closest?.("th, td");
    const row = selectedCell?.closest("tr") || this.selected?.closest?.("tr") || rows[0] || null;
    const cells = row ? [...row.cells] : [];
    const cell = selectedCell && cells.includes(selectedCell) ? selectedCell : cells[0] || null;

    let logicalRow = row ? rows.indexOf(row) : 0;
    let logicalCol = 0;
    let cellInfo = null;

    if (cell && grid[logicalRow]) {
      for (let c = 0; c < colCount; c++) {
        if (grid[logicalRow][c]?.cell === cell) {
          logicalCol = c;
          cellInfo = grid[logicalRow][c];
          break;
        }
      }
    }

    return {
      table,
      row,
      cell,
      cellInfo,
      rowIndex: logicalRow,
      columnIndex: logicalCol,
      rowCount,
      columnCount: colCount,
      hasComplexStructure: rows.some((item) => [...item.cells].some((itemCell) => itemCell.colSpan !== 1 || itemCell.rowSpan !== 1))
        || new Set(rows.map((item) => item.cells.length)).size > 1,
      grid,
    };
  }

  insertTable(rowCount = 3, columnCount = 3, { headerRow = true } = {}) {
    const doc = this.getDocument();
    if (!doc || !this.editable) return false;
    const rows = Math.max(1, Math.min(50, Number(rowCount) || 1));
    const columns = Math.max(1, Math.min(20, Number(columnCount) || 1));
    const table = doc.createElement("table");
    table.setAttribute("border", "1");
    table.style.borderCollapse = "collapse";
    table.style.width = "100%";
    if (headerRow) {
      const thead = table.createTHead();
      const row = thead.insertRow();
      for (let column = 0; column < columns; column += 1) {
        const cell = doc.createElement("th");
        cell.textContent = `見出し${column + 1}`;
        cell.style.padding = ".45em";
        row.append(cell);
      }
    }
    const body = table.createTBody();
    const bodyRows = Math.max(headerRow ? rows - 1 : rows, headerRow && rows === 1 ? 0 : 1);
    for (let rowIndex = 0; rowIndex < bodyRows; rowIndex += 1) {
      const row = body.insertRow();
      for (let column = 0; column < columns; column += 1) {
        const cell = row.insertCell();
        cell.textContent = `セル${rowIndex + 1}-${column + 1}`;
        cell.style.padding = ".45em";
      }
    }
    this.#assignNewIds(table);
    const selectedTable = this.selected?.closest?.("table");
    const target = selectedTable || (this.selected && !STRUCTURE_ELEMENTS.has(this.selected.tagName) ? this.selected : null);
    const parent = target?.parentElement || doc.querySelector("main") || doc.body;
    if (!parent) return false;
    if (target) target.after(table);
    else parent.append(table);
    const change = {
      type: "element-add",
      target: this.#describe(table),
      elementId: this.#ensureElementId(table),
      parentId: this.#ensureElementId(parent),
      index: [...parent.children].indexOf(table),
      before: "",
      after: this.#cleanOuterHtml(table),
      action: "table",
      timestamp: new Date().toISOString(),
    };
    this.select(table.querySelector("th, td") || table);
    this.callbacks.onChange?.(change);
    return true;
  }

  addTableRow({ position = "after" } = {}) {
    const actionLabel = position === "before" ? "行追加（上）" : "行追加（下）";
    return this.#changeTable(actionLabel, (context, setDetails) => {
      const { grid, rowCount, colCount, rows } = buildTableGrid(context.table);
      const doc = this.getDocument();
      const insertAtRow = position === "before"
        ? context.rowIndex
        : context.rowIndex + (context.cellInfo?.rowSpan || 1);

      const refRow = rows[context.rowIndex] || rows[0];
      let section = refRow?.parentElement;
      if (!section || section.tagName === "THEAD") section = context.table.tBodies[0] || context.table.createTBody();

      const newRow = doc.createElement("tr");
      const modifiedSpans = new Set();
      const addedCells = [];

      for (let c = 0; c < colCount; c++) {
        const topEntry = insertAtRow > 0 ? grid[insertAtRow - 1]?.[c] : null;
        const bottomEntry = insertAtRow < rowCount ? grid[insertAtRow]?.[c] : null;

        if (topEntry && bottomEntry && topEntry.cell === bottomEntry.cell) {
          if (!modifiedSpans.has(topEntry.cell)) {
            topEntry.cell.rowSpan = (topEntry.cell.rowSpan || 1) + 1;
            modifiedSpans.add(topEntry.cell);
          }
          c += (topEntry.colSpan - 1);
          continue;
        }

        const refEntry = (position === "before" ? bottomEntry || topEntry : topEntry || bottomEntry) || null;
        const refCell = refEntry?.cell || null;
        const isHeader = refCell?.tagName === "TH";
        const newCell = doc.createElement(isHeader ? "th" : "td");
        newCell.textContent = isHeader ? "見出し" : "セル";
        newCell.style.padding = ".45em";
        if (refCell) copyCellStyle(refCell, newCell);
        newRow.append(newCell);
        this.#ensureElementId(newCell);
        addedCells.push(newCell);

        if (refEntry && refEntry.colSpan > 1) {
          c += (refEntry.colSpan - 1);
        }
      }

      if (position === "before") {
        if (refRow && refRow.parentElement === section) refRow.before(newRow);
        else section.prepend(newRow);
      } else {
        if (refRow && refRow.parentElement === section) refRow.after(newRow);
        else section.append(newRow);
      }

      const actionName = `${actionLabel}（${insertAtRow + 1}行目）`;
      setDetails?.({
        action: actionName,
        addedRowIndex: insertAtRow,
        addedRowId: this.#ensureElementId(newRow),
        addedCellIds: addedCells.map((c) => this.#ensureElementId(c)),
        cellId: null,
      });

      return addedCells[0] || newRow;
    });
  }

  deleteTableRow() {
    const context = this.getTableContext();
    if (!context?.row || context.rowCount <= 1) return false;
    return this.#changeTable("行削除", (current, setDetails) => {
      const { grid, rowCount, colCount, rows } = buildTableGrid(current.table);
      const targetRowIndex = current.rowIndex;
      const targetRow = current.row;
      const nextRow = targetRowIndex + 1 < rowCount ? rows[targetRowIndex + 1] : null;
      const prevRow = targetRowIndex > 0 ? rows[targetRowIndex - 1] : null;

      const rowTextSummary = [...targetRow.cells]
        .map((c) => c.textContent.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" / ");
      const rowSnippet = rowTextSummary ? `：「${rowTextSummary.slice(0, 15)}」` : "";
      const actionName = `行削除（${targetRowIndex + 1}行目${rowSnippet}）`;
      const deletedRowHtml = this.#cleanOuterHtml(targetRow);

      setDetails?.({
        action: actionName,
        deletedRowIndex: targetRowIndex,
        deletedRowHtml,
        cellId: null,
      });

      const modifiedSpans = new Set();

      for (let c = 0; c < colCount; c++) {
        const entry = grid[targetRowIndex]?.[c];
        if (!entry) continue;

        if (entry.rowSpan > 1) {
          if (!modifiedSpans.has(entry.cell)) {
            modifiedSpans.add(entry.cell);

            if (entry.row === targetRowIndex) {
              // この行から始まって下へ伸びているセルは nextRow へ移動して rowSpan を減らす
              if (nextRow) {
                entry.cell.rowSpan -= 1;
                let inserted = false;
                for (let prevC = c - 1; prevC >= 0; prevC--) {
                  const prevEntry = grid[targetRowIndex + 1]?.[prevC];
                  if (prevEntry && prevEntry.cell.parentElement === nextRow) {
                    prevEntry.cell.after(entry.cell);
                    inserted = true;
                    break;
                  }
                }
                if (!inserted) {
                  nextRow.prepend(entry.cell);
                }
              }
            } else {
              // 上の行から始まってこの行をまたぐセルは単に rowSpan を減らす
              entry.cell.rowSpan -= 1;
            }
          }
        }
      }

      const replacementRow = nextRow || prevRow;
      const fallbackEntry = grid[replacementRow === nextRow ? targetRowIndex + 1 : targetRowIndex - 1]?.[current.columnIndex];
      const selected = fallbackEntry?.cell || replacementRow?.cells[0] || current.table;

      targetRow.remove();
      return selected;
    });
  }

  moveTableRow(direction) {
    const context = this.getTableContext();
    if (!context?.row || context.rowCount <= 1) return false;
    const { grid, rowCount, colCount, rows } = buildTableGrid(context.table);
    const r = context.rowIndex;
    if (direction === "up" && r === 0) return false;
    if (direction === "down" && r === rowCount - 1) return false;

    const otherR = direction === "up" ? r - 1 : r + 1;
    const currentRow = rows[r];
    const targetRow = rows[otherR];
    if (!currentRow || !targetRow) return false;
    if (currentRow.parentElement !== targetRow.parentElement) return false;

    const topR = Math.min(r, otherR);
    const bottomR = Math.max(r, otherR);
    const originCellsToMove = [];

    for (let c = 0; c < colCount; c++) {
      const topEntry = grid[topR]?.[c];
      const bottomEntry = grid[bottomR]?.[c];
      if (!topEntry || !bottomEntry) continue;

      if (topEntry.cell === bottomEntry.cell) {
        if (topEntry.isOrigin && !originCellsToMove.includes(topEntry.cell)) {
          originCellsToMove.push(topEntry.cell);
        }
      } else {
        if (topEntry.rowSpan > 1 && topEntry.row < topR) return false;
        if (bottomEntry.rowSpan > 1 && bottomEntry.row + bottomEntry.rowSpan - 1 > bottomR) return false;
      }
    }

    const actionName = direction === "up" ? "行を上へ移動" : "行を下へ移動";
    return this.#changeTable(actionName, (current, setDetails) => {
      const topRow = rows[topR];
      const bottomRow = rows[bottomR];

      originCellsToMove.forEach((cell) => {
        bottomRow.prepend(cell);
      });

      bottomRow.after(topRow);

      setDetails?.({
        action: `${actionName}（${r + 1}行目 → ${otherR + 1}行目）`,
        cellId: null,
      });

      const selectedCell = current.cell && current.row.contains(current.cell)
        ? current.cell
        : current.row.cells[Math.min(current.columnIndex, Math.max(0, current.row.cells.length - 1))] || current.row;
      return selectedCell;
    });
  }

  moveTableColumn(direction) {
    const context = this.getTableContext();
    if (!context || context.columnCount <= 1) return false;
    const { grid, rowCount, colCount } = buildTableGrid(context.table);
    const c = context.columnIndex;
    if (direction === "left" && c === 0) return false;
    if (direction === "right" && c >= colCount - 1) return false;

    const otherC = direction === "left" ? c - 1 : c + (context.cellInfo?.colSpan || 1);
    if (otherC < 0 || otherC >= colCount) return false;

    const leftC = Math.min(c, otherC);
    const rightC = Math.max(c, otherC);

    const actionName = direction === "left" ? "列を左へ移動" : "列を右へ移動";
    return this.#changeTable(actionName, (current, setDetails) => {
      for (let r = 0; r < rowCount; r++) {
        const entryLeft = grid[r]?.[leftC];
        const entryRight = grid[r]?.[rightC];
        if (!entryLeft || !entryRight) continue;
        if (entryLeft.cell === entryRight.cell) continue;

        const cellLeft = entryLeft.cell;
        const cellRight = entryRight.cell;

        cellLeft.before(cellRight);
      }

      setDetails?.({
        action: `${actionName}（${c + 1}列目 → ${otherC + 1}列目）`,
        cellId: null,
      });

      return context.cell?.isConnected ? context.cell : current.table;
    });
  }

  addTableColumn({ position = "after" } = {}) {
    const actionLabel = position === "before" ? "列追加（左）" : "列追加（右）";
    return this.#changeTable(actionLabel, (context, setDetails) => {
      const { grid, rowCount, colCount, rows } = buildTableGrid(context.table);
      const doc = this.getDocument();
      const insertAtCol = position === "before"
        ? context.columnIndex
        : context.columnIndex + (context.cellInfo?.colSpan || 1);

      let selected = null;
      const modifiedSpans = new Set();
      const addedCells = [];

      for (let r = 0; r < rowCount; r++) {
        const row = rows[r];
        const leftEntry = insertAtCol > 0 ? grid[r]?.[insertAtCol - 1] : null;
        const rightEntry = insertAtCol < colCount ? grid[r]?.[insertAtCol] : null;

        if (leftEntry && rightEntry && leftEntry.cell === rightEntry.cell) {
          if (!modifiedSpans.has(leftEntry.cell)) {
            leftEntry.cell.colSpan = (leftEntry.cell.colSpan || 1) + 1;
            modifiedSpans.add(leftEntry.cell);
          }
          if (r === context.rowIndex) selected = leftEntry.cell;
          continue;
        }

        const refEntry = (position === "before" ? rightEntry || leftEntry : leftEntry || rightEntry) || null;
        const refCell = refEntry?.cell || row.cells[0] || null;
        const isHeader = refCell?.tagName === "TH" || row.parentElement?.tagName === "THEAD";
        const newCell = doc.createElement(isHeader ? "th" : "td");
        newCell.textContent = isHeader ? "見出し" : "セル";
        newCell.style.padding = ".45em";
        if (refCell) copyCellStyle(refCell, newCell);

        if (insertAtCol === 0) {
          row.prepend(newCell);
        } else if (leftEntry) {
          leftEntry.cell.after(newCell);
        } else if (rightEntry) {
          rightEntry.cell.before(newCell);
        } else {
          row.append(newCell);
        }

        this.#ensureElementId(newCell);
        addedCells.push(newCell);

        if (r === context.rowIndex) selected = newCell;
      }

      const actionName = `${actionLabel}（${insertAtCol + 1}列目）`;
      setDetails?.({
        action: actionName,
        addedColIndex: insertAtCol,
        addedCellIds: addedCells.map((c) => this.#ensureElementId(c)),
        cellId: null,
      });

      return selected || context.table;
    });
  }

  deleteTableColumn() {
    const context = this.getTableContext();
    if (!context || context.columnCount <= 1) return false;
    return this.#changeTable("列削除", (current, setDetails) => {
      const { grid, rowCount } = buildTableGrid(current.table);
      const targetCol = current.columnIndex;
      let selected = null;
      const deletedCellsInfo = [];
      const colTexts = [];

      for (let r = 0; r < rowCount; r++) {
        const entry = grid[r]?.[targetCol];
        if (!entry) {
          deletedCellsInfo.push({ action: "none" });
          continue;
        }

        if (entry.colSpan > 1) {
          deletedCellsInfo.push({
            action: "shrink",
            cellId: entry.cell.getAttribute(EDITOR_ID_ATTR) || entry.cell.id,
            originalColSpan: entry.colSpan,
            isOrigin: entry.isOrigin,
          });
          if (entry.isOrigin) {
            colTexts.push(entry.cell.textContent?.trim() || "");
          }
        } else if (entry.rowSpan > 1 && !entry.isOrigin) {
          deletedCellsInfo.push({
            action: "spanned",
          });
        } else {
          deletedCellsInfo.push({
            action: "deleted",
            cellHtml: this.#cleanOuterHtml(entry.cell),
            text: entry.cell.textContent?.trim() || "",
          });
          colTexts.push(entry.cell.textContent?.trim() || "");
        }
      }

      const colTextSummary = colTexts.filter(Boolean).slice(0, 3).join(" / ");
      const colSnippet = colTextSummary ? `：「${colTextSummary.slice(0, 15)}」` : "";
      const actionName = `列削除（${targetCol + 1}列目${colSnippet}）`;

      setDetails?.({
        action: actionName,
        deletedColIndex: targetCol,
        deletedColTexts: colTexts,
        deletedCellsInfo,
        cellId: null,
      });

      const modifiedCells = new Set();
      for (let r = 0; r < rowCount; r++) {
        const entry = grid[r]?.[targetCol];
        if (!entry) continue;

        if (entry.colSpan > 1) {
          if (!modifiedCells.has(entry.cell)) {
            entry.cell.colSpan -= 1;
            modifiedCells.add(entry.cell);
          }
          if (r === current.rowIndex) selected = entry.cell;
        } else {
          const cell = entry.cell;
          if (r === current.rowIndex) {
            const fallbackEntry = (targetCol > 0 ? grid[r]?.[targetCol - 1] : grid[r]?.[targetCol + 1]) || null;
            selected = fallbackEntry?.cell || current.table;
          }
          cell.remove();
        }
      }

      return selected || current.table;
    });
  }

  toggleCellType() {
    const context = this.getTableContext();
    if (!context?.cell) return false;
    return this.#changeTable("見出し切替", (current) => {
      const oldCell = current.cell;
      const newTag = oldCell.tagName === "TH" ? "td" : "th";
      const newCell = oldCell.ownerDocument.createElement(newTag);
      for (const attr of oldCell.attributes) {
        newCell.setAttribute(attr.name, attr.value);
      }
      newCell.append(...oldCell.childNodes);
      oldCell.replaceWith(newCell);
      return newCell;
    });
  }

  setCellAlign(align) {
    const context = this.getTableContext();
    if (!context?.cell) return false;
    return this.#changeTable(`文字配置（${align}）`, (current) => {
      current.cell.style.textAlign = align;
      return current.cell;
    });
  }

  toggleFirstColumnHeader() {
    const context = this.getTableContext();
    if (!context?.table) return false;
    return this.#changeTable("1列目見出し切替", (current) => {
      const { grid, rowCount } = buildTableGrid(current.table);
      const firstColCells = [];
      for (let r = 0; r < rowCount; r++) {
        const cell = grid[r]?.[0]?.cell;
        if (cell && !firstColCells.includes(cell)) firstColCells.push(cell);
      }
      const allTh = firstColCells.every((c) => c.tagName === "TH");
      const targetTag = allTh ? "td" : "th";
      let primary = null;
      for (const oldCell of firstColCells) {
        if (oldCell.tagName.toLowerCase() === targetTag) continue;
        const newCell = oldCell.ownerDocument.createElement(targetTag);
        for (const attr of oldCell.attributes) newCell.setAttribute(attr.name, attr.value);
        newCell.append(...oldCell.childNodes);
        oldCell.replaceWith(newCell);
        if (oldCell === current.cell) primary = newCell;
      }
      return primary || current.table;
    });
  }

  mergeCellRight() {
    const context = this.getTableContext();
    if (!context?.cell) return false;
    const { grid, colCount } = buildTableGrid(context.table);
    const r = context.rowIndex;
    const c = context.columnIndex;
    const currentEntry = grid[r]?.[c];
    if (!currentEntry) return false;
    const rightCol = currentEntry.col + currentEntry.colSpan;
    if (rightCol >= colCount) return false;
    const rightEntry = grid[r]?.[rightCol];
    if (!rightEntry || !rightEntry.isOrigin) return false;
    if (rightEntry.rowSpan !== currentEntry.rowSpan) return false;

    return this.#changeTable("セル結合（右）", () => {
      const leftCell = currentEntry.cell;
      const rightCell = rightEntry.cell;
      leftCell.colSpan = currentEntry.colSpan + rightEntry.colSpan;
      if (rightCell.textContent.trim()) {
        leftCell.append(leftCell.ownerDocument.createTextNode(" "), ...rightCell.childNodes);
      }
      rightCell.remove();
      return leftCell;
    });
  }

  mergeCellDown() {
    const context = this.getTableContext();
    if (!context?.cell) return false;
    const { grid, rowCount } = buildTableGrid(context.table);
    const r = context.rowIndex;
    const c = context.columnIndex;
    const currentEntry = grid[r]?.[c];
    if (!currentEntry) return false;
    const downRow = currentEntry.row + currentEntry.rowSpan;
    if (downRow >= rowCount) return false;
    const downEntry = grid[downRow]?.[c];
    if (!downEntry || !downEntry.isOrigin) return false;
    if (downEntry.colSpan !== currentEntry.colSpan) return false;

    return this.#changeTable("セル結合（下）", () => {
      const topCell = currentEntry.cell;
      const bottomCell = downEntry.cell;
      topCell.rowSpan = currentEntry.rowSpan + downEntry.rowSpan;
      if (bottomCell.textContent.trim()) {
        topCell.append(topCell.ownerDocument.createTextNode(" "), ...bottomCell.childNodes);
      }
      bottomCell.remove();
      return topCell;
    });
  }

  splitCell() {
    const context = this.getTableContext();
    if (!context?.cell) return false;
    const cell = context.cell;
    const colSpan = cell.colSpan || 1;
    const rowSpan = cell.rowSpan || 1;
    if (colSpan <= 1 && rowSpan <= 1) return false;

    return this.#changeTable("セル分割", (current) => {
      const { grid } = buildTableGrid(current.table);
      const startR = current.rowIndex;
      const startC = current.columnIndex;
      const targetCell = current.cell;
      const doc = targetCell.ownerDocument;

      targetCell.colSpan = 1;
      targetCell.rowSpan = 1;

      for (let dr = 0; dr < rowSpan; dr++) {
        const r = startR + dr;
        const row = current.table.rows[r];
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          const c = startC + dc;
          const newCell = doc.createElement(targetCell.tagName.toLowerCase());
          newCell.textContent = "";
          newCell.style.padding = ".45em";
          copyCellStyle(targetCell, newCell);

          let inserted = false;
          for (let checkC = c - 1; checkC >= 0; checkC--) {
            const prevEntry = grid[r]?.[checkC];
            if (prevEntry && prevEntry.cell !== targetCell && prevEntry.cell.parentElement === row) {
              prevEntry.cell.after(newCell);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            if (dr === 0) targetCell.after(newCell);
            else row.prepend(newCell);
          }
        }
      }

      return targetCell;
    });
  }

  deleteTable() {
    const context = this.getTableContext();
    if (!context) return false;
    this.select(context.table);
    return this.deleteSelected();
  }

  getSelectionCount() {
    return this.selectedElements.size;
  }

  getSelectedImageDetails() {
    const image = this.selected?.tagName === "IMG" ? this.selected : this.selected?.querySelector?.("img");
    if (!image) return null;
    return {
      src: image.getAttribute("src") || "",
      fileName: image.getAttribute(IMAGE_ASSET_NAME_ATTR) || "image",
    };
  }

  hasClipboard() {
    return this.elementClipboard.length > 0;
  }

  canCopySelection() {
    return [...this.selectedElements].some((element) => !STRUCTURE_ELEMENTS.has(element.tagName));
  }

  copySelected() {
    const copied = [...this.selectedElements]
      .filter((element) => !STRUCTURE_ELEMENTS.has(element.tagName))
      .filter((element, _index, elements) => !elements.some((other) => other !== element && other.contains(element)))
      .map((element) => this.#cleanOuterHtml(element));
    if (!copied.length) return 0;
    this.elementClipboard = copied;
    return copied.length;
  }

  canPaste() {
    return this.hasClipboard()
      && this.selectedElements.size === 1
      && Boolean(this.selected?.parentElement)
      && !STRUCTURE_ELEMENTS.has(this.selected.tagName);
  }

  pasteBefore() {
    return this.#paste("before");
  }

  pasteAfter() {
    return this.#paste("after");
  }

  canSelectParent() {
    return this.selectedElements.size === 1
      && Boolean(this.selected?.parentElement)
      && this.selected.parentElement.tagName !== "HTML";
  }

  selectParent() {
    if (!this.canSelectParent()) return false;
    this.selectionNavigation.push(this.selected);
    this.select(this.selected.parentElement, { preserveNavigation: true });
    return true;
  }

  canReturnToChild() {
    return this.selectedElements.size === 1
      && this.selectionNavigation.some((element) => element?.isConnected);
  }

  returnToChild() {
    while (this.selectionNavigation.length) {
      const child = this.selectionNavigation.pop();
      if (!child?.isConnected) continue;
      this.select(child, { preserveNavigation: true });
      return true;
    }
    return false;
  }

  #paste(position) {
    if (!this.canPaste()) return 0;
    const target = this.selected;
    const parent = target.parentElement;
    const reference = position === "before" ? target : target.nextElementSibling;
    const pasted = this.elementClipboard
      .map((html) => this.#elementFromHtml(html))
      .filter(Boolean);
    if (!pasted.length) return 0;
    pasted.forEach((element) => {
      this.#assignNewIds(element);
      this.#dedupeHtmlIds(element);
      parent.insertBefore(element, reference);
    });
    const batchId = pasted.length > 1 ? crypto.randomUUID() : "";
    const changes = pasted.map((element) => ({
      type: "element-add",
      target: this.#describe(element),
      elementId: this.#ensureElementId(element),
      parentId: this.#ensureElementId(parent),
      index: [...parent.children].indexOf(element),
      before: "",
      after: this.#cleanOuterHtml(element),
      action: "paste",
      batchId,
      timestamp: new Date().toISOString(),
    }));
    this.#replaceSelection(pasted, pasted.at(-1));
    changes.forEach((change) => this.callbacks.onChange?.(change));
    return pasted.length;
  }

  getClassNames() {
    return this.getDocument() ? collectClassNames(this.getDocument()) : [];
  }

  #ensureElementIds(doc) {
    let maxId = 0;
    doc.querySelectorAll("body, body *").forEach((element) => {
      const current = element.getAttribute(EDITOR_ID_ATTR);
      const numericId = current?.match(/^wr-(\d+)$/)?.[1];
      if (numericId) maxId = Math.max(maxId, Number(numericId));
    });
    this.nextElementId = maxId + 1;
    doc.querySelectorAll("body, body *").forEach((element) => this.#ensureElementId(element));
  }

  #ensureElementId(element) {
    if (!element.hasAttribute(EDITOR_ID_ATTR)) {
      element.setAttribute(EDITOR_ID_ATTR, `wr-${this.nextElementId++}`);
    }
    return element.getAttribute(EDITOR_ID_ATTR);
  }

  #assignNewIds(root) {
    [root, ...root.querySelectorAll("*")].forEach((element) => {
      element.setAttribute(EDITOR_ID_ATTR, `wr-${this.nextElementId++}`);
    });
  }

  #findByEditorId(id) {
    if (!id) return null;
    const escape = this.frame.contentWindow?.CSS?.escape ?? ((value) => String(value).replaceAll('"', '\\"'));
    return this.getDocument()?.querySelector(`[${EDITOR_ID_ATTR}="${escape(id)}"]`) ?? null;
  }

  #elementFromHtml(html) {
    const doc = this.getDocument();
    if (!doc || !html) return null;
    const template = doc.createElement("template");
    template.innerHTML = html;
    const element = template.content.firstElementChild;
    if (!element) return null;
    element.classList.remove(EDITOR_CLASS);
    element.removeAttribute("contenteditable");
    element.querySelectorAll?.(`.${EDITOR_CLASS}, [contenteditable]`).forEach((child) => {
      child.classList.remove(EDITOR_CLASS);
      child.removeAttribute("contenteditable");
    });
    return element;
  }

  #cleanOuterHtml(element) {
    const clone = element.cloneNode(true);
    clone.classList.remove(EDITOR_CLASS);
    clone.removeAttribute("contenteditable");
    clone.querySelectorAll?.(`.${EDITOR_CLASS}, [contenteditable]`).forEach((child) => {
      child.classList.remove(EDITOR_CLASS);
      child.removeAttribute("contenteditable");
    });
    return clone.outerHTML;
  }

  #changeTable(actionOrMutator, maybeMutator) {
    const action = typeof actionOrMutator === "string" ? actionOrMutator : "";
    const mutator = typeof actionOrMutator === "function" ? actionOrMutator : maybeMutator;
    const context = this.getTableContext();
    if (!context || !this.editable || !mutator) return false;
    const before = this.#cleanOuterHtml(context.table);
    const detailsOverride = {};
    const selection = mutator(context, (details) => {
      if (details && typeof details === "object") Object.assign(detailsOverride, details);
    });
    this.#assignNewIdsToMissing(context.table);
    const after = this.#cleanOuterHtml(context.table);
    if (before === after) return false;
    const cellElement = selection?.closest?.("th, td") || (selection?.tagName === "TH" || selection?.tagName === "TD" ? selection : null) || context.cell?.closest?.("th, td") || null;
    const resolvedCellId = detailsOverride.cellId !== undefined
      ? detailsOverride.cellId
      : (cellElement && context.table.contains(cellElement) ? this.#ensureElementId(cellElement) : null);
    this.#emitChange("table-change", context.table, before, after, {
      action: detailsOverride.action || action,
      cellId: resolvedCellId,
      beforeHtml: before,
      afterHtml: after,
      ...detailsOverride,
    });
    this.select(selection?.isConnected ? selection : context.table);
    return true;
  }

  #assignNewIdsToMissing(root) {
    [root, ...root.querySelectorAll("*")].forEach((element) => this.#ensureElementId(element));
  }

  #dedupeHtmlIds(root) {
    const doc = this.getDocument();
    if (!doc) return;
    const elementsWithId = [];
    if (root.id) elementsWithId.push(root);
    if (root.querySelectorAll) elementsWithId.push(...root.querySelectorAll("[id]"));

    elementsWithId.forEach((element) => {
      const origId = element.id;
      if (!origId) return;
      const existing = doc.querySelectorAll(`[id="${CSS.escape(origId)}"]`);
      const isDuplicate = [...existing].some((el) => el !== element && !root.contains(el));
      if (isDuplicate) {
        let counter = 1;
        let candidate = `${origId}-copy`;
        while (doc.getElementById(candidate) || root.querySelector?.(`[id="${CSS.escape(candidate)}"]`)) {
          counter += 1;
          candidate = `${origId}-copy-${counter}`;
        }
        element.id = candidate;
      }
    });
  }

  #describe(element) {
    const id = element.id ? `#${element.id}` : "";
    const classes = [...element.classList]
      .filter((name) => name !== EDITOR_CLASS)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 45);
    return `${element.tagName.toLowerCase()}${id}${classes}${text ? `「${text}」` : ""}`;
  }

  #emitChange(type, element, before, after, details = {}) {
    this.callbacks.onChange?.({
      type,
      target: this.#describe(element),
      elementId: this.#ensureElementId(element),
      before,
      after,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }

  updateText(value) {
    if (!this.selected || TEXT_BLOCKLIST.has(this.selected.tagName)) return false;
    const before = this.selected.textContent ?? "";
    if (before === value) return false;
    const beforeHtml = this.selected.innerHTML;
    this.selected.textContent = value;
    this.#emitChange("text-change", this.selected, before, value, { beforeHtml, afterHtml: this.selected.innerHTML });
    return true;
  }

  updateLink(value) {
    if (this.selected instanceof this.frame.contentWindow.HTMLImageElement) {
      return this.updateImageLink(value);
    }
    const link = this.selected?.closest("a");
    if (!link) return false;
    const before = link.getAttribute("href") ?? "";
    const after = value.trim();
    if (before === after) return false;
    after ? link.setAttribute("href", after) : link.removeAttribute("href");
    this.#emitChange("link-change", link, before, after);
    return true;
  }

  updateImageLink(value) {
    const ImageType = this.frame.contentWindow?.HTMLImageElement;
    if (!ImageType || !(this.selected instanceof ImageType)) return false;
    const image = this.selected;
    let link = image.closest("a");
    const before = link?.getAttribute("href") ?? "";
    const beforeAttributes = link
      ? Object.fromEntries([...link.attributes].map((attr) => [attr.name, attr.value]))
      : null;
    const after = value.trim();
    if (before === after && Boolean(link) === Boolean(after)) return false;

    if (after && link) {
      link.setAttribute("href", after);
    } else if (after) {
      link = image.ownerDocument.createElement("a");
      link.setAttribute("href", after);
      image.replaceWith(link);
      link.append(image);
      this.#ensureElementId(link);
    } else if (link) {
      link.replaceWith(image);
    }
    const afterAttributes = after && link
      ? Object.fromEntries([...link.attributes].map((attr) => [attr.name, attr.value]))
      : null;
    this.#emitChange("image-link-change", image, before, after, {
      beforeAttributes,
      afterAttributes,
    });
    this.select(image);
    return true;
  }

  hasInlineLinkSelection() {
    return Boolean(this.inlineLinkSelection?.range && this.inlineLinkSelection.container?.isConnected);
  }

  applyInlineLink(value) {
    const context = this.inlineLinkSelection;
    const href = value.trim();
    if (!href || !this.hasInlineLinkSelection()) return false;
    const { range, container, link } = context;
    const selectedText = range.toString();
    const beforeHtml = container.innerHTML;
    const before = link?.getAttribute("href") || "";
    if (link) {
      link.setAttribute("href", href);
    } else {
      const doc = this.getDocument();
      const wrapper = doc.createElement("a");
      wrapper.setAttribute("href", href);
      const fragment = range.extractContents();
      fragment.querySelectorAll?.("a").forEach((nestedLink) => nestedLink.replaceWith(...nestedLink.childNodes));
      wrapper.append(fragment);
      range.insertNode(wrapper);
      this.#ensureElementId(wrapper);
    }
    this.#emitChange("inline-link-change", container, before, href, {
      beforeHtml,
      afterHtml: container.innerHTML,
      selectedText,
    });
    this.select(container);
    return true;
  }

  removeInlineLink() {
    const context = this.inlineLinkSelection;
    if (!context?.link || !this.hasInlineLinkSelection()) return false;
    const { container, link } = context;
    const beforeHtml = container.innerHTML;
    const before = link.getAttribute("href") || "";
    link.replaceWith(...link.childNodes);
    this.#emitChange("inline-link-change", container, before, "", {
      beforeHtml,
      afterHtml: container.innerHTML,
      selectedText: context.range.toString(),
    });
    this.select(container);
    return true;
  }

  updateAlt(value) {
    if (!(this.selected instanceof this.frame.contentWindow.HTMLImageElement)) return false;
    const before = this.selected.alt;
    if (before === value) return false;
    this.selected.alt = value;
    this.#emitChange("alt-change", this.selected, before, value);
    return true;
  }

  updateImage(dataUrl, fileName = "") {
    return this.updateImageSource(dataUrl, { assetName: fileName });
  }

  updateImageSource(value, { assetName = "" } = {}) {
    if (!(this.selected instanceof this.frame.contentWindow.HTMLImageElement)) return false;
    const before = this.selected.getAttribute("src") ?? "";
    const after = value.trim();
    if (!after) return false;
    const beforeSrcset = this.selected.getAttribute("srcset") ?? "";
    const beforeAssetName = this.selected.getAttribute(IMAGE_ASSET_NAME_ATTR) ?? "";
    const afterAssetName = safeImageAssetName(assetName, after);
    if (before === after && beforeAssetName === afterAssetName) return false;
    this.selected.setAttribute("src", after);
    this.selected.removeAttribute("srcset");
    this.selected.setAttribute(IMAGE_ASSET_NAME_ATTR, afterAssetName);
    this.#emitChange("image-change", this.selected, before, after, {
      beforeAlt: this.selected.alt,
      afterAlt: this.selected.alt,
      beforeSrcset,
      afterSrcset: "",
      beforeAssetName,
      afterAssetName,
    });
    return true;
  }

  updateClasses(value) {
    if (!this.selected) return false;
    const before = [...this.selected.classList].filter((name) => name !== EDITOR_CLASS).join(" ");
    const classes = normalizeClasses(value).filter((name) => name !== EDITOR_CLASS);
    const after = classes.join(" ");
    if (before === after) return false;
    this.selected.className = classes.join(" ");
    this.selected.classList.add(EDITOR_CLASS);
    this.#emitChange("class-change", this.selected, before, after);
    return true;
  }

  moveBefore() {
    const previous = this.selected?.previousElementSibling;
    if (!this.selected || !previous || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const parent = this.selected.parentElement;
    const parentOrderBefore = [...parent.children].map((element) => this.#ensureElementId(element));
    const fromIndex = [...parent.children].indexOf(this.selected);
    const before = `直前: ${this.#describe(previous)}`;
    this.selected.parentElement.insertBefore(this.selected, previous);
    const toIndex = [...parent.children].indexOf(this.selected);
    const after = this.selected.nextElementSibling ? `直後: ${this.#describe(this.selected.nextElementSibling)}` : "先頭へ移動";
    this.#emitChange("element-move", this.selected, before, after, {
      parentId: this.#ensureElementId(parent), fromIndex, toIndex,
      parentOrderBefore,
      parentOrderAfter: [...parent.children].map((element) => this.#ensureElementId(element)),
    });
    return true;
  }

  moveAfter() {
    const next = this.selected?.nextElementSibling;
    if (!this.selected || !next || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const parent = this.selected.parentElement;
    const parentOrderBefore = [...parent.children].map((element) => this.#ensureElementId(element));
    const fromIndex = [...parent.children].indexOf(this.selected);
    const before = `直後: ${this.#describe(next)}`;
    next.after(this.selected);
    const toIndex = [...parent.children].indexOf(this.selected);
    const after = this.selected.previousElementSibling ? `直前: ${this.#describe(this.selected.previousElementSibling)}` : "末尾へ移動";
    this.#emitChange("element-move", this.selected, before, after, {
      parentId: this.#ensureElementId(parent), fromIndex, toIndex,
      parentOrderBefore,
      parentOrderAfter: [...parent.children].map((element) => this.#ensureElementId(element)),
    });
    return true;
  }

  duplicateSelected() {
    if (!this.selected || STRUCTURE_ELEMENTS.has(this.selected.tagName)) return false;
    const source = this.selected;
    const clone = source.cloneNode(true);
    this.#assignNewIds(clone);
    this.#dedupeHtmlIds(clone);
    clone.classList.remove(EDITOR_CLASS);
    clone.removeAttribute("contenteditable");
    clone.querySelectorAll?.(`.${EDITOR_CLASS}, [contenteditable]`).forEach((element) => {
      element.classList.remove(EDITOR_CLASS);
      element.removeAttribute("contenteditable");
    });
    source.after(clone);
    this.#emitChange("element-add", clone, "", clone.outerHTML, {
      action: "duplicate",
      parentId: this.#ensureElementId(clone.parentElement),
      index: [...clone.parentElement.children].indexOf(clone),
    });
    this.select(clone);
    return true;
  }

  deleteSelected() {
    const removedElements = [...this.selectedElements]
      .filter((element) => !STRUCTURE_ELEMENTS.has(element.tagName))
      .filter((element, _index, elements) => !elements.some((other) => other !== element && other.contains(element)))
      .sort((left, right) => {
        const position = left.compareDocumentPosition(right);
        return position & left.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    if (!removedElements.length) return false;
    const batchId = removedElements.length > 1 ? crypto.randomUUID() : "";
    const changes = removedElements.map((removed) => ({
      type: "element-delete",
      target: this.#describe(removed),
      elementId: this.#ensureElementId(removed),
      removedElementIds: [removed, ...removed.querySelectorAll("*")].map((element) => this.#ensureElementId(element)),
      parentId: removed.parentElement ? this.#ensureElementId(removed.parentElement) : "",
      nextSiblingId: removed.nextElementSibling ? this.#ensureElementId(removed.nextElementSibling) : "",
      index: removed.parentElement ? [...removed.parentElement.children].indexOf(removed) : -1,
      before: this.#cleanOuterHtml(removed),
      after: "",
      batchId,
      timestamp: new Date().toISOString(),
    }));
    this.selectedElements.forEach((element) => element.classList.remove(EDITOR_CLASS));
    this.selectedElements.clear();
    this.selected = null;
    this.selectionAnchor = null;
    removedElements.forEach((element) => element.remove());
    this.#notifySelection();
    changes.forEach((change) => this.callbacks.onChange?.(change));
    return true;
  }

  applyChange(change, direction) {
    if (!change || !["undo", "redo"].includes(direction)) return false;
    const undo = direction === "undo";
    const value = undo ? change.before : change.after;
    let element = this.#findByEditorId(change.elementId);

    if (change.type === "meta-title-change") {
      const doc = this.getDocument();
      if (!doc) return false;
      doc.title = value;
      return true;
    }
    if (change.type === "meta-description-change") {
      const doc = this.getDocument();
      if (!doc) return false;
      let meta = doc.querySelector('meta[name="description" i]');
      if (value) {
        if (!meta) {
          meta = doc.createElement("meta");
          meta.setAttribute("name", "description");
          doc.head.append(meta);
        }
        meta.setAttribute("content", value);
      } else {
        meta?.remove();
      }
      return true;
    }

    if (change.type === "element-add") {
      if (undo) {
        if (!element) return false;
        element.remove();
        this.clearSelection();
        return true;
      }
      const parent = this.#findByEditorId(change.parentId);
      element = this.#elementFromHtml(change.after);
      if (!parent || !element) return false;
      parent.insertBefore(element, parent.children[change.index] ?? null);
      this.select(element);
      return true;
    }

    if (change.type === "element-delete") {
      if (!undo) {
        if (!element) return false;
        element.remove();
        this.clearSelection();
        return true;
      }
      const parent = this.#findByEditorId(change.parentId);
      element = this.#elementFromHtml(change.before);
      if (!parent || !element) return false;
      const nextSibling = change.nextSiblingId ? this.#findByEditorId(change.nextSiblingId) : null;
      parent.insertBefore(element, nextSibling ?? parent.children[change.index] ?? null);
      this.select(element);
      return true;
    }

    if (change.type === "table-change") {
      if (!element) return false;
      const replacement = this.#elementFromHtml(undo ? change.before : change.after);
      if (!replacement) return false;
      element.replaceWith(replacement);
      this.select(replacement.querySelector("th, td") || replacement);
      return true;
    }

    if (!element) return false;
    if (change.type === "element-move") {
      const parent = this.#findByEditorId(change.parentId) ?? element.parentElement;
      if (!parent) return false;
      const index = undo ? change.fromIndex : change.toIndex;
      element.remove();
      parent.insertBefore(element, parent.children[index] ?? null);
    } else if (change.type === "text-change" || change.type === "inline-link-change") {
      const html = undo ? change.beforeHtml : change.afterHtml;
      if (typeof html === "string") element.innerHTML = html;
      else element.textContent = value;
    } else if (change.type === "link-change") {
      value ? element.setAttribute("href", value) : element.removeAttribute("href");
    } else if (change.type === "image-link-change") {
      let link = element.closest("a");
      const targetAttrs = undo ? change.beforeAttributes : change.afterAttributes;
      if (value) {
        if (!link) {
          link = element.ownerDocument.createElement("a");
          element.replaceWith(link);
          link.append(element);
          this.#ensureElementId(link);
        }
        if (targetAttrs) {
          [...link.attributes].forEach((attr) => {
            if (attr.name !== EDITOR_ID_ATTR) link.removeAttribute(attr.name);
          });
          Object.entries(targetAttrs).forEach(([name, val]) => {
            if (name !== EDITOR_ID_ATTR) link.setAttribute(name, val);
          });
        }
        link.setAttribute("href", value);
      } else if (link) {
        link.replaceWith(element);
      }
    } else if (change.type === "alt-change") {
      element.setAttribute("alt", value);
    } else if (change.type === "image-change") {
      element.setAttribute("src", value);
      const srcset = undo ? change.beforeSrcset : change.afterSrcset;
      srcset ? element.setAttribute("srcset", srcset) : element.removeAttribute("srcset");
      const assetName = undo ? change.beforeAssetName : change.afterAssetName;
      assetName ? element.setAttribute(IMAGE_ASSET_NAME_ATTR, assetName) : element.removeAttribute(IMAGE_ASSET_NAME_ATTR);
    } else if (change.type === "class-change") {
      element.className = value;
    } else {
      return false;
    }
    this.select(element);
    return true;
  }
}
