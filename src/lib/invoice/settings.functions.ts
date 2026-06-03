import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadSheetConfig,
  fetchSheetMappingWith,
  parseSpreadsheetIdFromUrlOrId,
  type SheetConfig,
} from "./sheet.server";

export const getSheetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const config = await loadSheetConfig();
    return { config };
  });

const SaveSchema = z.object({
  spreadsheet_id_or_url: z.string().min(5).max(500),
  sheet_name: z.string().min(1).max(200),
  phone_column: z.number().int().min(0).max(50),
  client_id_column: z.number().int().min(0).max(50),
  name_column: z.number().int().min(0).max(50),
});

export const saveSheetSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(SaveSchema)
  .handler(async ({ data }) => {
    const config: SheetConfig = {
      spreadsheet_id: parseSpreadsheetIdFromUrlOrId(data.spreadsheet_id_or_url),
      sheet_name: data.sheet_name,
      phone_column: data.phone_column,
      client_id_column: data.client_id_column,
      name_column: data.name_column,
    };
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "google_sheet", value: JSON.parse(JSON.stringify(config)), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { config };
  });

export const testSheetSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(SaveSchema.partial().optional())
  .handler(async ({ data }) => {
    const stored = await loadSheetConfig();
    const config: SheetConfig = data
      ? {
          spreadsheet_id: data.spreadsheet_id_or_url
            ? parseSpreadsheetIdFromUrlOrId(data.spreadsheet_id_or_url)
            : stored.spreadsheet_id,
          sheet_name: data.sheet_name ?? stored.sheet_name,
          phone_column: data.phone_column ?? stored.phone_column,
          client_id_column: data.client_id_column ?? stored.client_id_column,
          name_column: data.name_column ?? stored.name_column,
        }
      : stored;
    try {
      const result = await fetchSheetMappingWith(config);
      const samples = Array.from(result.byPhone.entries())
        .slice(0, 5)
        .map(([phone, clientId]) => ({
          phone,
          clientId,
          name: result.byPhoneName.get(phone) ?? "",
        }));
      return {
        ok: true as const,
        mappingCount: result.byPhone.size,
        nameCount: result.byPhoneName.size,
        totalRows: result.rowCount,
        headerRow: result.sampleHeader,
        samples,
        config,
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        config,
      };
    }
  });
