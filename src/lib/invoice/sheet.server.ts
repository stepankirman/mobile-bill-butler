import { normalizePhone } from "../phone";

// Public sheet — fetched live on each upload.
const SPREADSHEET_ID = "1T8z5q4TLm5kx0ziEldlyN-PKj0HQsQnw4JrbZIE-JuM";
const SHEET_NAME = "mob sim 7/2024";

export interface SheetMapping {
  // normalized phone -> CF-control client ID
  byPhone: Map<string, string>;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

export async function fetchSheetMapping(): Promise<SheetMapping> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    SHEET_NAME,
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Sheets fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  const byPhone = new Map<string, string>();
  // Column C = phone (index 2), Column D = client ID (index 3). Skip header row.
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const phone = normalizePhone(r[2] ?? "");
    const clientId = String(r[3] ?? "").trim();
    if (phone && clientId) byPhone.set(phone, clientId);
  }
  return { byPhone };
}
