// Thin wrapper around the CF-control API. The settings test uses the older v1
// PHP client contract: one endpoint URL, `action` + `settings` query params,
// and the `Cf-API-Authorization` header.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface CfControlConfig {
  base_url: string;
  api_key: string;
  invoice_number_queue: number;
}

export async function loadCfControlConfig(): Promise<CfControlConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "cf_control")
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<CfControlConfig>;
  const q = Number(v.invoice_number_queue ?? process.env.CF_CONTROL_INVOICE_QUEUE ?? 1);
  return {
    base_url: (v.base_url || process.env.CF_CONTROL_API_BASE_URL || "").trim(),
    api_key: (process.env.CF_CONTROL_API_KEY || v.api_key || "").trim(),
    invoice_number_queue: Number.isFinite(q) && q > 0 ? q : 1,
  };
}

async function resolved(): Promise<{ base: string; key: string; queue: number }> {
  const cfg = await loadCfControlConfig();
  if (!cfg.base_url) throw new Error("CF-control URL není nastavena (Nastavení).");
  if (!cfg.api_key) throw new Error("CF-control API klíč není nastaven (Nastavení).");
  return { base: cfg.base_url.replace(/\/+$/, ""), key: cfg.api_key, queue: cfg.invoice_number_queue };
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
  note?: string;
  variableSymbol?: string;
  dueDate?: string;
}

/**
 * Mirrors PHP `$api->post('insertInvoice', [...])` against the v1 API:
 * POST `${apiUrl}?action=insertInvoice` with form-urlencoded data fields
 * and the `Cf-API-Authorization` header.
 */
export async function createReceivable(input: CreateReceivableInput): Promise<{ id: string; raw: unknown }> {
  const { base, key, queue } = await resolved();
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();

  const customerIdNum = Number(String(input.clientId).trim());
  if (!Number.isInteger(customerIdNum) || customerIdNum <= 0) {
    throw new Error(`CF-control insertInvoice: customerId musí být číslo (dostal jsem "${input.clientId}")`);
  }

  // Pole pro položku slož z popisu + (volitelně) variabilního symbolu a poznámky,
  // protože v1 insertInvoice nepodporuje top-level note/variableSymbol.
  const itemDescription = [input.note, input.variableSymbol ? `VS: ${input.variableSymbol}` : null]
    .filter(Boolean)
    .join(" • ");

  const payload: Record<string, unknown> = {
    customerId: customerIdNum,
    invoiceNumberQueue: Number(queue) || 1,
    invoiceNumberCount: 6,
    invoiceNumber: 1,
    date: `${dd}.${mm}.${yyyy}`,
    paymentType: "bank",
    maturity: 14,
    priceType: 1,
    items: [
      {
        name: input.description,
        ...(itemDescription ? { description: itemDescription } : {}),
        amount: 1,
        unit: "ks",
        price: input.amount,
        sale: 0,
        saleInPrice: 0,
      },
    ],
  };

  const url = buildCfControlV1Url(base, "insertInvoice", {});
  const res = await cfControlV1Post(url, key, payload);
  const parsed = parseCfControlJson(res.text);
  const env = (parsed ?? {}) as Record<string, unknown>;
  const errors = extractCfApiErrors(parsed);
  const result = typeof env.result === "string" ? env.result : undefined;
  const apiOk = res.status >= 200 && res.status < 300 && result !== "CF_API_RESULT_ERROR" && errors.length === 0;
  if (!apiOk) {
    const msg = errors[0]?.message ?? `HTTP ${res.status}: ${res.text.slice(0, 400)}`;
    throw new Error(`CF-control insertInvoice: ${msg}`);
  }
  const data = (env.data ?? {}) as Record<string, unknown>;
  const id = String(data.invoiceId ?? data.id ?? data.invoice_id ?? "");
  return { id, raw: parsed };
}


export async function notifyClient(_input: {
  clientId: string;
  receivableId: string;
  subject: string;
  body: string;
}): Promise<void> {
  // CF-control v1 API nemá v dokumentaci doložený endpoint pro odeslání e-mailu
  // klientovi z aplikace mimo standardní upozornění na fakturu. Pro nyní je
  // odeslání faktury (insertInvoice) zároveň zaúčtováním v CF-control;
  // e-mailovou notifikaci řeší CF-control sám podle nastavení šablon.
  return;
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
  const raw = (input?.trim() || "getTarifList").replace(/^\/+/, "");
  const [actionPart, queryStr] = raw.split("?", 2);
  const settings: Record<string, unknown> = {};
  if (actionPart === "getTarifList") {
    settings.tarifDataType = "minimal";
  }

  if (queryStr) {
    const params = new URLSearchParams(queryStr);
    params.forEach((value, key) => {
      const match = key.match(/^settings\[([^\]]+)\]$/);
      settings[match?.[1] ?? key] = value;
    });
  }

  return { action: actionPart || "getTarifList", settings };
}

function parseCfControlJson(text: string): unknown | null {
  try {
    return text ? JSON.parse(text.replace(/^\uFEFF/, "").replace("\\xEF\\xBB\\xBF", "")) : null;
  } catch {
    return null;
  }
}

function dechunk(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const nl = body.indexOf("\r\n", i);
    if (nl === -1) break;
    const sizeHex = body.slice(i, nl).split(";")[0].trim();
    const size = parseInt(sizeHex, 16);
    if (!Number.isFinite(size) || size <= 0) break;
    i = nl + 2;
    out += body.slice(i, i + size);
    i += size + 2;
  }
  return out || body;
}


async function cfControlV1Get(url: string, apiKey: string): Promise<{ status: number; statusText: string; text: string }> {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    const res = await fetch(url, { headers: { "Cf-API-Authorization": apiKey } });
    return { status: res.status, statusText: res.statusText, text: await res.text() };
  }

  const { connect } = await import("node:tls");
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.hostname, port: Number(target.port || 443), servername: target.hostname });
    const chunks: Buffer[] = [];
    socket.setTimeout(10000);
    socket.once("secureConnect", () => {
      socket.write(
        [
          `GET ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.host}`,
          "User-Agent: TeamCity-Invoice-App/1.0",
          "Accept: application/json",
          `Cf-API-Authorization: ${apiKey}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("timeout", () => {
      socket.destroy(new Error("Timeout při volání CF-control API."));
    });
    socket.once("error", reject);
    socket.once("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const [head = "", ...bodyParts] = raw.split("\r\n\r\n");
      const headLines = head.split("\r\n");
      const statusLine = headLines[0] ?? "";
      const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*(.*)$/);
      const isChunked = headLines
        .slice(1)
        .some((l) => /^transfer-encoding:\s*chunked/i.test(l));
      let body = bodyParts.join("\r\n\r\n");
      if (isChunked) body = dechunk(body);
      resolve({
        status: match ? Number(match[1]) : 0,
        statusText: match?.[2] ?? "",
        text: body,
      });
    });
  });
}

function phpFormEncodeKey(key: string): string {
  // PHP/cURL-style form names keep square brackets readable: items[0][name].
  // Some older PHP backends parse this more reliably than %5B/%5D names.
  return encodeURIComponent(key).replace(/%5B/g, "[").replace(/%5D/g, "]");
}

function flattenFormFields(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          out.push(...flattenFormFields(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${phpFormEncodeKey(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      out.push(...flattenFormFields(v as Record<string, unknown>, key));
    } else {
      out.push(`${phpFormEncodeKey(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function cfControlV1Post(
  url: string,
  apiKey: string,
  data: Record<string, unknown>,
): Promise<{ status: number; statusText: string; text: string }> {
  // PHP klient posílá druhý argument `$api->post('insertInvoice', [...])`
  // jako přímá POST pole (`customerId`, `items[0][name]`, ...). Neobalovat
  // pod `data[...]`, CF-control pak `customerId` vyhodnotí jako chybně zadaný.
  const body = flattenFormFields(data).join("&");
  const target = new URL(url);
  if (target.protocol !== "https:") {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Cf-API-Authorization": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return { status: res.status, statusText: res.statusText, text: await res.text() };
  }

  const { connect } = await import("node:tls");
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.hostname, port: Number(target.port || 443), servername: target.hostname });
    const chunks: Buffer[] = [];
    socket.setTimeout(15000);
    socket.once("secureConnect", () => {
      socket.write(
        [
          `POST ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.host}`,
          "User-Agent: TeamCity-Invoice-App/1.0",
          "Accept: application/json",
          `Cf-API-Authorization: ${apiKey}`,
          "Content-Type: application/x-www-form-urlencoded",
          `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
          "Connection: close",
          "",
          body,
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("timeout", () => {
      socket.destroy(new Error("Timeout při volání CF-control API."));
    });
    socket.once("error", reject);
    socket.once("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const [head = "", ...bodyParts] = raw.split("\r\n\r\n");
      const headLines = head.split("\r\n");
      const statusLine = headLines[0] ?? "";
      const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)\s*(.*)$/);
      const isChunked = headLines
        .slice(1)
        .some((l) => /^transfer-encoding:\s*chunked/i.test(l));
      let respBody = bodyParts.join("\r\n\r\n");
      if (isChunked) respBody = dechunk(respBody);
      resolve({
        status: match ? Number(match[1]) : 0,
        statusText: match?.[2] ?? "",
        text: respBody,
      });
    });
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
