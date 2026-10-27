import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { badRequest } from './errors';

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

function cellToValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('result' in v) return cellToValue(v.result as ExcelJS.CellValue); // formula
    if ('error' in v) return null;
  }
  return value;
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  // exceljs' typings predate Node's generic Buffer; the runtime accepts any Buffer.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet =
    wb.worksheets.find((s) => s.name.trim().toLowerCase() === 'organisations') ??
    wb.worksheets.find((s) => s.actualRowCount > 1) ??
    wb.worksheets[0];
  if (!sheet) throw badRequest('The workbook has no sheets');
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cellToValue(cell.value) ?? '').trim();
  });
  const rows: Record<string, unknown>[] = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const obj: Record<string, unknown> = {};
    let any = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const v = cellToValue(row.getCell(idx + 1).value);
      if (v !== null && v !== '') any = true;
      obj[h] = v;
    });
    if (any) rows.push(obj);
  }
  return { sheetName: sheet.name, headers: headers.filter(Boolean), rows };
}

function parseCsv(text: string): ParsedSheet {
  const result = Papa.parse<Record<string, unknown>>(
    text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), ''),
    {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    },
  );
  const headers = (result.meta.fields ?? []).filter(Boolean);
  return { sheetName: 'CSV', headers, rows: result.data };
}

export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return parseXlsx(buffer);
  if (lower.endsWith('.csv')) return parseCsv(buffer.toString('utf8'));
  throw badRequest('Upload an .xlsx or .csv file');
}
