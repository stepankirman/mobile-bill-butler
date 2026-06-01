// Thin wrapper around the CF-control REST API. Endpoint paths are configurable
// because the published Bitbucket Api.php exposes several receivable/email
// endpoints; we follow the most common convention (POST /receivables, POST
// /clients/{id}/notify). Adjust if your CF-control instance differs.

function baseUrl(): string {
  const u = process.env.CF_CONTROL_API_BASE_URL;
  if (!u) throw new Error("CF_CONTROL_API_BASE_URL is not set");
  return u.replace(/\/+$/, "");
}

function authHeaders(): HeadersInit {
  const key = process.env.CF_CONTROL_API_KEY;
  if (!key) throw new Error("CF_CONTROL_API_KEY is not set");
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
  const res = await fetch(`${baseUrl()}/receivables`, {
    method: "POST",
    headers: authHeaders(),
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
  const res = await fetch(`${baseUrl()}/clients/${encodeURIComponent(input.clientId)}/notify`, {
    method: "POST",
    headers: authHeaders(),
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
