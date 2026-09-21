function labelForCell(row, col, { headerRows, hasFirstColumnHeader }) {
  if (row < headerRows) return `COL_${String(col).padStart(2, "0")}`;
  if (hasFirstColumnHeader && col === 0) return `ROW_HDR_${String(row).padStart(2, "0")}`;
  return `VAL_R${String(row).padStart(2, "0")}_C${String(col).padStart(2, "0")}`;
}

/**
 * Builds a neutral, coordinate-labelled table fixture for table-operation tests.
 * Merge coordinates are zero-based and include their origin cell.
 */
export function generateAbstractTableHtml({
  rows = 6,
  cols = 5,
  headerRows = 1,
  merges = [],
  hasFirstColumnHeader = true,
  tableId = "abstract-grid",
} = {}) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError("rows and cols must be positive integers");
  }
  if (!Number.isInteger(headerRows) || headerRows < 0 || headerRows > rows) {
    throw new RangeError("headerRows must be between 0 and rows");
  }

  const occupied = Array.from({ length: rows }, () => Array(cols).fill(null));
  const mergeAt = new Map();
  for (const merge of merges) {
    const { row, col, rowSpan = 1, colSpan = 1, label } = merge;
    if (![row, col, rowSpan, colSpan].every(Number.isInteger) || row < 0 || col < 0 || rowSpan < 1 || colSpan < 1 || row + rowSpan > rows || col + colSpan > cols) {
      throw new RangeError("merge must fit within the table using positive integer coordinates");
    }
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) {
        if (occupied[r][c]) throw new RangeError("merges must not overlap");
        occupied[r][c] = { row, col };
      }
    }
    mergeAt.set(`${row}:${col}`, { rowSpan, colSpan, label });
  }

  const renderRow = (row) => {
    const cells = [];
    for (let col = 0; col < cols; col++) {
      const owner = occupied[row][col];
      if (owner && (owner.row !== row || owner.col !== col)) continue;
      const merge = mergeAt.get(`${row}:${col}`) || {};
      const tag = row < headerRows || (hasFirstColumnHeader && col === 0) ? "th" : "td";
      const defaultLabel = merge.rowSpan > 1 && merge.colSpan > 1
        ? `SPAN_BOX_R${row}-${row + merge.rowSpan - 1}_C${col}-${col + merge.colSpan - 1}`
        : merge.rowSpan > 1
          ? `SPAN_V_R${row}-${row + merge.rowSpan - 1}_C${col}`
          : merge.colSpan > 1
            ? `SPAN_H_R${row}_C${col}-${col + merge.colSpan - 1}`
            : labelForCell(row, col, { headerRows, hasFirstColumnHeader });
      const spans = `${merge.rowSpan > 1 ? ` rowspan="${merge.rowSpan}"` : ""}${merge.colSpan > 1 ? ` colspan="${merge.colSpan}"` : ""}`;
      cells.push(`<${tag}${spans}>${merge.label || defaultLabel}</${tag}>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  };

  const head = headerRows ? `<thead>${Array.from({ length: headerRows }, (_, row) => renderRow(row)).join("")}</thead>` : "";
  const body = headerRows < rows ? `<tbody>${Array.from({ length: rows - headerRows }, (_, index) => renderRow(index + headerRows)).join("")}</tbody>` : "";
  return `<table id="${tableId}">${head}${body}</table>`;
}
