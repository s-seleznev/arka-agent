import "server-only";

import { getAuthorizedFieldRegistry } from "./registry";
import { queryAnimals } from "./queries";
import { type FieldRegistry, requireFarmField } from "./fields";
import type { AnimalRow, ReportViewState } from "./types";

const PAGE_SIZE = 200;
const MAX_ROWS = 100_000;
const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_PRINT_ROWS = 10_000;
const MAX_PRINT_BYTES = 25 * 1024 * 1024;

export class FarmExportError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function csvCell(value: unknown, protectFormula = true) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (protectFormula && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(columns: string[], registry: FieldRegistry, row: AnimalRow) {
  return (
    columns
      .map((id) => {
        const field = requireFarmField(id, registry);
        const formatted = formatValue(row[id], field.type);
        const numeric = field.type === "number" && typeof row[id] === "number";
        return csvCell(formatted, !numeric);
      })
      .join(",") + "\r\n"
  );
}

function formatValue(
  value: unknown,
  type?: "boolean" | "date" | "number" | "text"
) {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean" || typeof value === "boolean")
    return value ? "Да" : "Нет";
  if (type === "date") {
    const date = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date))
      return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  }
  if (type === "number" && typeof value === "number")
    return value.toLocaleString("ru-RU");
  return String(value);
}

function html(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function exportColumns(view: ReportViewState) {
  return Array.from(new Set(["primaryIdentifier", ...view.columns]));
}

async function collectRows(
  view: ReportViewState,
  userId: string,
  maxRows = MAX_ROWS,
  maxBytes?: number
) {
  const registry = await getAuthorizedFieldRegistry(
    userId,
    view.ruleContext?.asOf
  );
  const columns = exportColumns(view);
  let cursor: string | null = null;
  let snapshot: string | undefined;
  const rows: AnimalRow[] = [];
  let bytes = maxBytes
    ? Buffer.byteLength(
        `\uFEFF${columns.map((id) => csvCell(requireFarmField(id, registry).label)).join(",")}\r\n`,
        "utf8"
      )
    : 0;
  const group = view.groupBy[0];
  const exportSort = group
    ? [group, ...view.sort.filter((rule) => rule.field !== group.field)].slice(
        0,
        5
      )
    : view.sort;
  for (;;) {
    const page = await queryAnimals({
      columns,
      cursor,
      filters: view.filters,
      // Exports flatten groups, while the leading group sort keeps their order.
      groupBy: [],
      limit: PAGE_SIZE,
      revision: view.revision,
      ruleContext: view.ruleContext,
      sort: exportSort,
      userId,
      viewId: view.id,
    });
    snapshot ??= page.snapshot;
    rows.push(...page.rows);
    if (maxBytes) {
      bytes += page.rows.reduce(
        (total, row) =>
          total + Buffer.byteLength(csvLine(columns, registry, row), "utf8"),
        0
      );
      if (bytes > maxBytes)
        throw new FarmExportError("EXPORT_TOO_LARGE", { maxBytes });
    }
    if (rows.length > maxRows) {
      throw new FarmExportError(
        maxRows === MAX_PRINT_ROWS
          ? "EXPORT_PRINT_TOO_LARGE"
          : "EXPORT_TOO_LARGE",
        {
          maxRows,
          ...(maxRows === MAX_PRINT_ROWS ? { csvFallback: true } : {}),
        }
      );
    }
    if (page.end) return { columns, registry, rows, snapshot, asOf: page.asOf };
    cursor = page.nextCursor;
    if (!cursor) throw new FarmExportError("EXPORT_CURSOR_MISSING");
  }
}

export async function buildCsvExport(view: ReportViewState, userId: string) {
  const { columns, registry, rows, snapshot, asOf } = await collectRows(
    view,
    userId,
    MAX_ROWS,
    MAX_CSV_BYTES
  );
  const header = columns
    .map((id) => csvCell(requireFarmField(id, registry).label))
    .join(",");
  const chunks = [`\uFEFF${header}\r\n`];
  let bytes = Buffer.byteLength(chunks[0], "utf8");
  for (const row of rows) {
    const line = csvLine(columns, registry, row);
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes > MAX_CSV_BYTES)
      throw new FarmExportError("EXPORT_TOO_LARGE", {
        maxBytes: MAX_CSV_BYTES,
      });
    chunks.push(line);
  }
  return {
    body: chunks.join(""),
    filename: `arka-view-${view.id}.csv`,
    rows: rows.length,
    snapshot,
    asOf,
  };
}

export async function buildPrintExport(view: ReportViewState, userId: string) {
  const result = await collectRows(
    view,
    userId,
    MAX_PRINT_ROWS,
    MAX_PRINT_BYTES
  );
  const title = "Таблица животных";
  const bands = [] as string[];
  for (let offset = 0; offset < result.columns.length; offset += 5) {
    const bandColumns =
      offset === 0
        ? result.columns.slice(0, 6)
        : [result.columns[0], ...result.columns.slice(offset + 1, offset + 6)];
    if (bandColumns.length === 1 && offset > 0) break;
    const bandLabels = bandColumns.map((id) =>
      requireFarmField(id, result.registry)
    );
    const bandBody = result.rows
      .map(
        (row) =>
          `<tr>${bandColumns.map((id, i) => `<td>${html(formatValue(row[id], bandLabels[i].type))}</td>`).join("")}</tr>`
      )
      .join("");
    const range = bandColumns
      .slice(1)
      .map((id) => requireFarmField(id, result.registry).label)
      .join(" · ");
    bands.push(
      `<section class="band"><h2>Номер · ${html(range)}</h2><table><thead><tr>${bandLabels.map((field) => `<th>${html(field.label)}</th>`).join("")}</tr></thead><tbody>${bandBody}</tbody></table></section>`
    );
  }
  const metadata = `Строк: ${result.rows.length} · Срез: ${result.asOf ? formatValue(result.asOf, "date") : "текущий"}`;
  const htmlDocument = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(title)}</title><style>
@page{size:landscape;margin:12mm 8mm}*{box-sizing:border-box}body{font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a;margin:0}header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}h1{font-size:18px;margin:0 0 4px}.meta{color:#5d6875}button{font:inherit;padding:6px 12px;border:1px solid #aeb7c2;border-radius:5px;background:#fff;cursor:pointer}.band{break-before:page;page-break-before:always}.band:first-of-type{break-before:auto;page-break-before:auto}.band h2{font-size:11px;margin:0 0 5px;color:#5d6875}table{border-collapse:collapse;width:100%;table-layout:auto;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #cbd2d9;padding:4px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef1f4;font-weight:650}tbody tr:nth-child(even){background:#fafbfc}th:first-child,td:first-child{position:sticky;left:0;background:inherit;font-weight:600;white-space:nowrap}@media print{button{display:none}header{margin-bottom:7px}}
</style></head><body><header><div><h1>${html(title)}</h1><div class="meta">${html(metadata)} · Revision ${view.revision}</div></div><button type="button" onclick="window.print()">Печать</button></header>${bands.join('<div class="band-gap"></div>')}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));</script></body></html>`;
  if (Buffer.byteLength(htmlDocument, "utf8") > MAX_PRINT_BYTES) {
    throw new FarmExportError("EXPORT_PRINT_TOO_LARGE", {
      maxBytes: MAX_PRINT_BYTES,
      csvFallback: true,
    });
  }
  return {
    body: htmlDocument,
    filename: `arka-view-${view.id}.html`,
    rows: result.rows.length,
    snapshot: result.snapshot,
    asOf: result.asOf,
  };
}
