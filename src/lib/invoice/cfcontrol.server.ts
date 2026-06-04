// Thin wrapper around the CF-control API. The settings test uses the older v1
// PHP client contract: one endpoint URL, `action` + `settings` query params,
// and the `Cf-API-Authorization` header.

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
    api_key: (process.env.CF_CONTROL_API_KEY || v.api_key || "").trim(),
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

export interface CfTestClient {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
}

export interface CfTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  bodyPreview?: string;
  error?: string;
  message?: string;
  details?: Array<{ key?: string; field?: string; message?: string }>;
  testedPath?: string;
  testedUrl?: string;
  clientsCount?: number;
  clients?: CfTestClient[];
}

function appendCfSetting(query: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendCfSetting(query, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
      appendCfSetting(query, `${key}[${childKey}]`, childValue);
    });
    return;
  }
  query.append(key, String(value));
}

function buildCfControlV1Url(baseUrl: string, action: string, settings: Record<string, unknown>): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const query = new URLSearchParams();
  query.set("action", action);
  Object.entries(settings).forEach(([key, value]) => appendCfSetting(query, `settings[${key}]`, value));
  return `${base}?${query.toString()}`;
}

function parseCfControlV1Input(input?: string): { action: string; settings: Record<string, unknown> } {
  const raw = input?.trim() || "/customer/list";
  const normalized = raw;
  const [actionPart, queryStr] = normalized.split("?", 2);
  const settings: Record<string, unknown> = {};
  if (!input?.trim()) {
    settings.fields = ["id", "contractNumber", "nameFull", "phone", "email", "address", "tarif", "transmitter", "paymentStatus"];
  }

  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    params.forEach((value, key) => {
      const match = key.match(/^settings\[([^\]]+)\]$/);
      settings[match?.[1] ?? key] = value;
    });
  }

  return { action: actionPart || "customer/list", settings };
}

function parseCfControlJson(text: string): unknown | null {
  try {
    return text ? JSON.parse(text.replace(/^\uFEFF/, "").replace("\\xEF\\xBB\\xBF", "")) : null;
  } catch {
    return null;
  }
}

async function cfControlV1Get(url: string, apiKey: string): Promise<{ status: number; statusText: string; text: string }> {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    const res = await fetch(url, { headers: { "Cf-API-Authorization": apiKey } });
    return { status: res.status, statusText: res.statusText, text: await res.text() };
  }

  const client = target.protocol === "https:" ? await import("node:https") : await import("node:http");
  return new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: "GET",
        timeout: 10000,
        headers: {
          Accept: "application/json",
          "User-Agent": "TeamCity-Invoice-App/1.0",
          "Cf-API-Authorization": apiKey,
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            text,
          });
        });
      },
    );
    request.once("timeout", () => {
      request.destroy(new Error("Timeout při volání CF-control API."));
    });
    request.once("error", reject);
    request.end();
  });
}

function extractCfApiErrors(data: unknown): Array<{ key?: string; field?: string; message?: string }> {
  if (!data || typeof data !== "object") return [];
  const error = (data as Record<string, unknown>).error;
  const list = Array.isArray(error) ? error : error && typeof error === "object" ? [error] : [];
  return list.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      key: typeof obj.key === "string" ? obj.key : undefined,
      field: typeof obj.field === "string" ? obj.field : undefined,
      message:
        typeof obj.message === "string"
          ? obj.message
          : typeof obj.text === "string"
            ? obj.text
            : undefined,
    };
  });
}

/**
 * Mirror of the PHP v1 `CfControl\Api->get('customer/list', ['limit' => 10])`:
 * GET `${apiUrl}?action=customer%2Flist&settings%5Blimit%5D=10` with the
 * `Cf-API-Authorization` header, then parse the v1 JSON envelope.
 */
export async function testCfControl(
  override?: Partial<CfControlConfig>,
  customAction?: string,
): Promise<CfTestResult> {
  const stored = await loadCfControlConfig();
  const base = (override?.base_url ?? stored.base_url).trim();
  const key = (override?.api_key ?? stored.api_key).trim();
  if (!base) return { ok: false, error: "Chybí URL." };
  if (!key) return { ok: false, error: "Chybí API klíč." };
  const { action, settings } = parseCfControlV1Input(customAction);
  const url = buildCfControlV1Url(base, action, settings);

  try {
    const res = await cfControlV1Get(url, key);
    const txt = res.text;
    const parsed = parseCfControlJson(txt);

    if (!parsed) {
      return {
        ok: false,
        status: 0,
        statusText: res.statusText,
        bodyPreview: txt.slice(0, 800),
        testedPath: action,
        testedUrl: url,
        error: "transport",
        message: `Odpověď není validní JSON (HTTP ${res.status}).`,
      };
    }

    const env = (parsed ?? {}) as Record<string, unknown>;
    const details = extractCfApiErrors(parsed);
    const result = typeof env.result === "string" ? env.result : undefined;
    const apiOk = res.status >= 200 && res.status < 300 && result !== "CF_API_RESULT_ERROR" && details.length === 0;

    if (apiOk) {
      const list = extractClientList(parsed).slice(0, 10);
      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        bodyPreview: txt.slice(0, 800),
        testedPath: action,
        testedUrl: url,
        clientsCount: list.length,
        clients: list,
      };
    }

    const errorCode = details[0]?.key ?? (typeof env.error === "string" ? env.error : undefined);
    const errorMsg = details[0]?.message ?? (typeof env.message === "string" ? env.message : undefined);

    return {
      ok: false,
      status: res.status,
      statusText: res.statusText,
      bodyPreview: txt.slice(0, 800),
      testedPath: action,
      testedUrl: url,
      error: errorCode ?? `HTTP ${res.status} ${res.statusText}`,
      message: errorMsg,
      details: details.length ? details : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      error: "transport",
      message: e instanceof Error ? e.message : String(e),
      testedPath: action,
      testedUrl: url,
    };
  }
}

function extractClientList(data: unknown): CfTestClient[] {
  if (!data) return [];
  let arr: unknown[] | null = null;
  if (Array.isArray(data)) arr = data;
  else if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["data", "items", "clients", "customers", "results", "rows", "list"]) {
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
      (o.customer_id as string | undefined) ??
      (o.cid as string | undefined) ??
      (o.client_id as string | undefined) ??
      (o.uuid as string | undefined);
    const fn = (o.firstname as string | undefined) ?? (o.first_name as string | undefined) ?? "";
    const ln = (o.lastname as string | undefined) ?? (o.last_name as string | undefined) ?? "";
    const name =
      (o.name as string | undefined) ??
      (o.full_name as string | undefined) ??
      (o.title as string | undefined) ??
      ([fn, ln].filter(Boolean).join(" ").trim() || undefined);
    const phone = (o.phone as string | undefined) ?? (o.mobile as string | undefined);
    const email = o.email as string | undefined;
    return {
      id: id != null ? String(id) : undefined,
      name,
      phone,
      email,
    };
  });
}
