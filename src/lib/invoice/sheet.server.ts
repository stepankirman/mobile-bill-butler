import { normalizePhone } from "../phone";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface SheetConfig {
  spreadsheet_id: string;
  sheet_name: string;
  phone_column: number; // 0-based
  client_id_column: number; // 0-based
  name_column: number; // 0-based — column containing customer name
}

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  spreadsheet_id: "1T8z5q4TLm5kx0ziEldlyN-PKj0HQsQnw4JrbZIE-JuM",
  sheet_name: "mob sim 7/2024",
  phone_column: 2,
  client_id_column: 3,
  name_column: 4,
};

export interface SheetMapping {
  byPhone: Map<string, string>;
  byPhoneName: Map<string, string>;
  byClientName: Map<string, string>;
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

export async function loadSheetConfig(): Promise<SheetConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "google_sheet")
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<SheetConfig>;
  return {
    spreadsheet_id: v.spreadsheet_id || DEFAULT_SHEET_CONFIG.spreadsheet_id,
    sheet_name: v.sheet_name || DEFAULT_SHEET_CONFIG.sheet_name,
    phone_column: typeof v.phone_column === "number" ? v.phone_column : DEFAULT_SHEET_CONFIG.phone_column,
    client_id_column:
      typeof v.client_id_column === "number" ? v.client_id_column : DEFAULT_SHEET_CONFIG.client_id_column,
    name_column: typeof v.name_column === "number" ? v.name_column : DEFAULT_SHEET_CONFIG.name_column,
  };
}

export function parseSpreadsheetIdFromUrlOrId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}

export async function fetchSheetMappingWith(
  config: SheetConfig,
): Promise<SheetMapping & { rowCount: number; sampleHeader: string[] }> {
  const url = `https://docs.google.com/spreadsheets/d/${config.spreadsheet_id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    config.sheet_name,
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Sheets fetch failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  const byPhone = new Map<string, string>();
  const byPhoneName = new Map<string, string>();
  const byClientName = new Map<string, string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const phone = normalizePhone(r[config.phone_column] ?? "");
    const clientId = String(r[config.client_id_column] ?? "").trim();
    const name = String(r[config.name_column] ?? "").trim();
    if (phone && clientId) byPhone.set(phone, clientId);
    if (phone && name) byPhoneName.set(phone, name);
    if (clientId && name && !byClientName.has(clientId)) byClientName.set(clientId, name);
  }
  return { byPhone, byPhoneName, byClientName, rowCount: rows.length, sampleHeader: rows[0] ?? [] };
}

export async function fetchSheetMapping(): Promise<SheetMapping> {
  const cfg = await loadSheetConfig();
  return fetchSheetMappingWith(cfg);
}
