// Thin wrapper around the CF-control REST API. Endpoint paths are configurable
// because the published Bitbucket Api.php exposes several receivable/email
// endpoints; we follow the most common convention (POST /receivables, POST
// /clients/{id}/notify). Adjust if your CF-control instance differs.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface CfControlConfig {
  base_url: string;
  api_key: string;
}

export async function loadCfControlConfig(): Promise<CfControlConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "cf_control")
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<CfControlConfig>;
  return {
    base_url: (v.base_url || process.env.CF_CONTROL_API_BASE_URL || "").trim(),
    api_key: (v.api_key || process.env.CF_CONTROL_API_KEY || "").trim(),
  };
}

async function resolved(): Promise<{ base: string; key: string }> {
  const cfg = await loadCfControlConfig();
  if (!cfg.base_url) throw new Error("CF-control URL není nastavena (Nastavení).");
  if (!cfg.api_key) throw new Error("CF-control API klíč není nastaven (Nastavení).");
  return { base: cfg.base_url.replace(/\/+$/, ""), key: cfg.api_key };
}

function authHeaders(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export interface CreateReceivableInput {
  clientId: string;
  amount: number;
  currency: string;
  description: string;
  variableSymbol?: string;
  dueDate?: string;
}

export async function createReceivable(input: CreateReceivableInput): Promise<{ id: string; raw: unknown }> {
  const { base, key } = await resolved();
  const res = await fetch(`${base}/receivables`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({
      client_id: input.clientId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      variable_symbol: input.variableSymbol,
      due_date: input.dueDate,
    }),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`CF-control createReceivable ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = (json ?? {}) as Record<string, unknown>;
  const id = String(data.id ?? (data.data as Record<string, unknown> | undefined)?.id ?? "");
  return { id, raw: json };
}

export async function notifyClient(input: {
  clientId: string;
  receivableId: string;
  subject: string;
  body: string;
}): Promise<void> {
  const { base, key } = await resolved();
  const res = await fetch(`${base}/clients/${encodeURIComponent(input.clientId)}/notify`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({
      receivable_id: input.receivableId,
      subject: input.subject,
      body: input.body,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CF-control notifyClient ${res.status}: ${text.slice(0, 500)}`);
  }
}

export interface CfTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  bodyPreview?: string;
  error?: string;
  testedPath?: string;
  clientsCount?: number;
  clients?: Array<{ id?: string; name?: string }>;
}

export async function testCfControl(
  override?: Partial<CfControlConfig>,
  customPath?: string,
): Promise<CfTestResult> {
  const stored = await loadCfControlConfig();
  const base = (override?.base_url ?? stored.base_url).trim().replace(/\/+$/, "");
  const key = (override?.api_key ?? stored.api_key).trim();
  if (!base) return { ok: false, error: "Chybí URL." };
  if (!key) return { ok: false, error: "Chybí API klíč." };
  const paths = customPath
    ? [customPath.startsWith("/") ? customPath : `/${customPath}`]
    : [
        "/clients?limit=10",
        "/api/clients?limit=10",
        "/api/v1/clients?limit=10",
        "/v1/clients?limit=10",
      ];
  let lastErr: { status?: number; statusText?: string; bodyPreview?: string; testedPath?: string } | null = null;
  for (const p of paths) {
    try {
      const res = await fetch(`${base}${p}`, { method: "GET", headers: authHeaders(key) });
      const txt = await res.text();
      if (res.ok) {
        let parsed: unknown = null;
        try {
          parsed = txt ? JSON.parse(txt) : null;
        } catch {
          parsed = null;
        }
        const list = extractClientList(parsed).slice(0, 10);
        return {
          ok: true,
          status: res.status,
          statusText: res.statusText,
          bodyPreview: txt.slice(0, 600),
          testedPath: p,
          clientsCount: list.length,
          clients: list,
        };
      }
      lastErr = { status: res.status, statusText: res.statusText, bodyPreview: txt.slice(0, 400), testedPath: p };
      if (res.status === 401 || res.status === 403) break;
    } catch (e) {
      lastErr = { bodyPreview: e instanceof Error ? e.message : String(e), testedPath: p };
    }
  }
  return {
    ok: false,
    ...lastErr,
    error: customPath
      ? `Endpoint ${customPath} nevrátil 2xx.`
      : "Žádný známý endpoint pro výpis klientů nevrátil 2xx. Zadejte konkrétní cestu dle dokumentace.",
  };
}

function extractClientList(data: unknown): Array<{ id?: string; name?: string }> {
  if (!data) return [];
  let arr: unknown[] | null = null;
  if (Array.isArray(data)) arr = data;
  else if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["data", "items", "clients", "results", "rows"]) {
      if (Array.isArray(obj[k])) {
        arr = obj[k] as unknown[];
        break;
      }
    }
  }
  if (!arr) return [];
  return arr.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const id =
      (o.id as string | undefined) ??
      (o.client_id as string | undefined) ??
      (o.uuid as string | undefined);
    const name =
      (o.name as string | undefined) ??
      (o.full_name as string | undefined) ??
      (o.title as string | undefined) ??
      ([o.first_name, o.last_name].filter(Boolean).join(" ") || undefined);
    return { id: id != null ? String(id) : undefined, name };
  });
}

