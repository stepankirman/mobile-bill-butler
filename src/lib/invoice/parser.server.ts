import { XMLParser } from "fast-xml-parser";
import { normalizePhone } from "../phone";

export interface ParsedPolItem {
  feature: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface ParsedInvoiceLine {
  phone: string;
  total: number;
  pausal: number;
  otherTraffic: number;
  items: ParsedPolItem[];
  raw: unknown;
}

export interface ParsedCustomer {
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
}

export interface ParsedInvoice {
  number: string;
  supplier: string | null;
  issuedAt: string | null;
  totalAmount: number;
  totalWithVat: number;
  vatAmount: number;
  vatRate: number;
  currency: string;
  customer: ParsedCustomer;
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

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function asString(v: unknown): string {
  if (v == null) return "";
  return decodeEntities(String(v).trim());
}

// Erbia/Laudatio puts repeated children inside a parent under keys "item0",
// "item1" ... fast-xml-parser keeps them as separate object keys.
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
  const zakaznik = (invoice.ZAKAZNIK ?? {}) as Record<string, unknown>;

  const detail = invoice.DETAIL_CISLO;
  const detailItems = collectItems(detail);

  const lines: ParsedInvoiceLine[] = detailItems.map((it) => {
    const item = it as Record<string, unknown>;
    const phone = normalizePhone(item.CISLO as string);
    const total = asNumber(item.CENA_CELKEM);
    const polItems = collectItems(item.POL);
    let pausal = 0;
    let otherTraffic = 0;
    const items: ParsedPolItem[] = [];
    for (const p of polItems) {
      const pol = p as Record<string, unknown>;
      const feature = asString(pol.FEATURE).toUpperCase();
      const qty = asNumber(pol.POCET_JEDNOTEK || 1);
      const unitPrice = asNumber(pol.CENA);
      const lineTotal = unitPrice * (qty || 1);
      const description = asString(pol.POPIS);
      const unit = asString(pol.JEDNOTKA);
      items.push({ feature, description, quantity: qty, unit, unitPrice, total: lineTotal });
      if (feature === "PAUSAL") pausal += lineTotal;
      else otherTraffic += lineTotal;
    }
    return { phone, total, pausal, otherTraffic, items, raw: item };
  });

  const firstName = asString(zakaznik.JMENO) || null;
  const lastName = asString(zakaznik.PRIJMENI) || null;
  const company = asString(zakaznik.SPOLECNOST) || null;
  const fullName =
    company || [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  const totalAmount = asNumber(head.CELKOVA_CASTKA);
  const totalWithVat = asNumber(head.CELKOVA_CASTKA_S_DPH);
  const vatRate = asNumber(head.DPH_FINAL);

  return {
    number: String(head.CISLO_FAKTURY ?? ""),
    supplier: (obchodnik.SPOLECNOST as string) ?? null,
    issuedAt: (head.DATUM_VYSTAVENI as string) ?? null,
    totalAmount,
    totalWithVat,
    vatAmount: Math.max(0, totalWithVat - totalAmount),
    vatRate,
    currency: "CZK",
    customer: { company, firstName, lastName, fullName },
    lines,
  };
}
