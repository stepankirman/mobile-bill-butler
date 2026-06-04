import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ParsedInvoice, ParsedInvoiceLine } from "./parser.server";

function decodeEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// pdf-lib's StandardFonts (WinAnsi) lack many Czech glyphs; strip diacritics.
function ascii(s: string): string {
  return decodeEntities(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(2);
}

export interface InvoicePdfInput {
  invoice: ParsedInvoice;
  clientLabel?: string | null;
  clientName?: string | null;
  lines: ParsedInvoiceLine[];
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const { invoice, clientLabel, clientName, lines } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const margin = 40;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - margin;

  function ensureSpace(needed: number) {
    if (y - needed < margin + 20) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - margin;
    }
  }

  function text(s: string, opts?: { bold?: boolean; size?: number; x?: number; color?: [number, number, number] }) {
    const size = opts?.size ?? 10;
    const f = opts?.bold ? fontBold : font;
    const [r, g, b] = opts?.color ?? [0, 0, 0];
    page.drawText(ascii(s), { x: opts?.x ?? margin, y, size, font: f, color: rgb(r, g, b) });
  }

  // Header
  text("Vyuctovani mobilnich sluzeb", { bold: true, size: 16 });
  y -= 22;
  text(`Faktura c. ${invoice.number}`, { bold: true, size: 12 });
  y -= 16;
  if (invoice.supplier) {
    text(`Dodavatel: ${invoice.supplier}`);
    y -= 14;
  }
  if (invoice.issuedAt) {
    text(`Datum vystaveni: ${invoice.issuedAt}`);
    y -= 14;
  }
  const displayName = clientName || invoice.customer.fullName;
  if (displayName) {
    text(`Klient: ${displayName}`, { bold: true });
    y -= 14;
  }
  if (clientLabel) {
    text(`CF-control ID: ${clientLabel}`);
    y -= 14;
  }

  // Recompute totals for this client (so per-client PDFs are correct).
  const sumBaseClient = lines.reduce((s, l) => s + l.total, 0);
  const vatRate = invoice.vatRate || 21;
  // If we're rendering the master PDF (lines == invoice.lines), use header amounts;
  // otherwise compute VAT from line totals.
  const isMaster = lines.length === invoice.lines.length &&
    Math.abs(sumBaseClient - invoice.totalAmount) < 0.01;
  const baseAmount = isMaster ? invoice.totalAmount : sumBaseClient;
  const vatAmount = isMaster ? invoice.vatAmount : baseAmount * (vatRate / 100);
  const totalWithVat = isMaster ? invoice.totalWithVat : baseAmount + vatAmount;

  y -= 6;
  // VAT summary box
  ensureSpace(70);
  const boxX = margin;
  const boxY = y - 60;
  const boxW = PAGE_W - margin * 2;
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxW,
    height: 60,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
  });
  const labelX = margin + 10;
  const valueX = PAGE_W - margin - 10;
  function rightText(s: string, opts?: { bold?: boolean; size?: number }) {
    const size = opts?.size ?? 10;
    const f = opts?.bold ? fontBold : font;
    const w = f.widthOfTextAtSize(ascii(s), size);
    page.drawText(ascii(s), { x: valueX - w, y, size, font: f });
  }
  y -= 18;
  text("Zaklad dane (bez DPH):", { x: labelX });
  rightText(`${fmt(baseAmount)} ${invoice.currency}`);
  y -= 14;
  text(`DPH ${fmt(vatRate)} %:`, { x: labelX });
  rightText(`${fmt(vatAmount)} ${invoice.currency}`);
  y -= 14;
  text("Celkem k uhrade vc. DPH:", { x: labelX, bold: true, size: 11 });
  rightText(`${fmt(totalWithVat)} ${invoice.currency}`, { bold: true, size: 11 });
  y -= 24;

  // Per-SIM detail with all items
  text(`Rozpis SIM karet (${lines.length})`, { bold: true, size: 12 });
  y -= 16;

  for (const line of lines) {
    ensureSpace(40 + line.items.length * 12);
    // SIM header
    page.drawRectangle({
      x: margin,
      y: y - 14,
      width: PAGE_W - margin * 2,
      height: 16,
      color: rgb(0.95, 0.95, 0.97),
    });
    text(`Telefon: ${line.phone || "-"}`, { bold: true });
    const totLabel = `${fmt(line.total)} ${invoice.currency}`;
    const w = fontBold.widthOfTextAtSize(ascii(totLabel), 10);
    page.drawText(ascii(totLabel), { x: PAGE_W - margin - 10 - w, y, size: 10, font: fontBold });
    y -= 18;

    // Item rows
    const cols = {
      desc: { x: margin + 6, w: 320 },
      qty: { x: margin + 330, w: 55 },
      unit: { x: margin + 388, w: 35 },
      price: { x: margin + 430, w: 50 },
      total: { x: PAGE_W - margin - 10 },
    };
    // Sub-header
    page.drawText("Polozka", { x: cols.desc.x, y, size: 8, font: fontBold });
    page.drawText("Pocet", { x: cols.qty.x, y, size: 8, font: fontBold });
    page.drawText("Jedn.", { x: cols.unit.x, y, size: 8, font: fontBold });
    page.drawText("Cena", { x: cols.price.x, y, size: 8, font: fontBold });
    const totHdr = "Celkem";
    const totHdrW = fontBold.widthOfTextAtSize(totHdr, 8);
    page.drawText(totHdr, { x: cols.total.x - totHdrW, y, size: 8, font: fontBold });
    y -= 10;

    if (line.items.length === 0) {
      page.drawText("(zadne polozky)", { x: cols.desc.x, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
      y -= 12;
    } else {
      for (const it of line.items) {
        ensureSpace(14);
        const desc = it.description || it.feature || "—";
        const truncated = desc.length > 60 ? desc.slice(0, 57) + "..." : desc;
        page.drawText(ascii(truncated), { x: cols.desc.x, y, size: 9, font });
        page.drawText(ascii(fmtQty(it.quantity)), { x: cols.qty.x, y, size: 9, font });
        page.drawText(ascii(it.unit || "—"), { x: cols.unit.x, y, size: 9, font });
        page.drawText(ascii(fmt(it.unitPrice)), { x: cols.price.x, y, size: 9, font });
        const totalStr = fmt(it.total);
        const tw = font.widthOfTextAtSize(totalStr, 9);
        page.drawText(totalStr, { x: cols.total.x - tw, y, size: 9, font });
        y -= 12;
      }
    }
    y -= 8;
  }

  return await doc.save();
}
