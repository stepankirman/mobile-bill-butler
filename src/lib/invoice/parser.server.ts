import { XMLParser } from "fast-xml-parser";
import { normalizePhone } from "../phone";

export interface ParsedInvoiceLine {
  phone: string;
  total: number;
  pausal: number;
  otherTraffic: number;
  raw: unknown;
}

export interface ParsedInvoice {
  number: string;
  supplier: string | null;
  issuedAt: string | null;
  totalAmount: number;
  totalWithVat: number;
  currency: string;
  lines: ParsedInvoiceLine[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
});

function asNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Erbia/Laudatio puts per-number details inside DETAIL_CISLO, where each item
// is keyed itemN. fast-xml-parser keeps those as separate object keys, so we
// flatten everything that starts with "item".
function collectItems(container: unknown): unknown[] {
  if (container == null) return [];
  if (Array.isArray(container)) return container;
  if (typeof container !== "object") return [];
  const out: unknown[] = [];
  for (const [k, v] of Object.entries(container as Record<string, unknown>)) {
    if (k.startsWith("item")) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    }
  }
  return out;
}

export function parseInvoiceXml(xml: string): ParsedInvoice {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const invoice = (parsed.invoice ?? parsed) as Record<string, unknown>;
  const head = (invoice.HLAVICKA ?? {}) as Record<string, unknown>;
  const obchodnik = (invoice.OBCHODNIK ?? {}) as Record<string, unknown>;

  const detail = invoice.DETAIL_CISLO;
  const detailItems = collectItems(detail);

  const lines: ParsedInvoiceLine[] = detailItems.map((it) => {
    const item = it as Record<string, unknown>;
    const phone = normalizePhone(item.CISLO as string);
    const total = asNumber(item.CENA_CELKEM);
    const polItems = collectItems(item.POL);
    let pausal = 0;
    let otherTraffic = 0;
    for (const p of polItems) {
      const pol = p as Record<string, unknown>;
      const feature = String(pol.FEATURE ?? "").toUpperCase();
      const price = asNumber(pol.CENA) * asNumber(pol.POCET_JEDNOTEK || 1);
      if (feature === "PAUSAL") pausal += price;
      else otherTraffic += price;
    }
    return { phone, total, pausal, otherTraffic, raw: item };
  });

  return {
    number: String(head.CISLO_FAKTURY ?? ""),
    supplier: (obchodnik.SPOLECNOST as string) ?? null,
    issuedAt: (head.DATUM_VYSTAVENI as string) ?? null,
    totalAmount: asNumber(head.CELKOVA_CASTKA),
    totalWithVat: asNumber(head.CELKOVA_CASTKA_S_DPH),
    currency: "CZK",
    lines,
  };
}
