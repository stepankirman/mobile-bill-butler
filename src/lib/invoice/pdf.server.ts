import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ParsedInvoice, ParsedInvoiceLine } from "./parser.server";

// pdf-lib's StandardFonts (WinAnsi) lack many Czech glyphs; we strip diacritics
// to avoid encoding errors. Sufficient for an internal billing summary.
function ascii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export interface InvoicePdfInput {
  invoice: ParsedInvoice;
  clientLabel?: string | null;
  lines: ParsedInvoiceLine[];
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const { invoice, clientLabel, lines } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 40;
  let y = height - margin;

  const draw = (text: string, opts?: { bold?: boolean; size?: number; x?: number }) => {
    const size = opts?.size ?? 10;
    const f = opts?.bold ? fontBold : font;
    page.drawText(ascii(text), {
      x: opts?.x ?? margin,
      y,
      size,
      font: f,
      color: rgb(0, 0, 0),
    });
  };

  draw(`Vyuctovani mobilnich sluzeb`, { bold: true, size: 16 });
  y -= 22;
  draw(`Faktura c. ${invoice.number}`, { bold: true, size: 12 });
  y -= 16;
  if (invoice.supplier) {
    draw(`Dodavatel: ${invoice.supplier}`);
    y -= 14;
  }
  if (invoice.issuedAt) {
    draw(`Datum vystaveni: ${invoice.issuedAt}`);
    y -= 14;
  }
  if (clientLabel) {
    draw(`Klient (CF-control ID): ${clientLabel}`);
    y -= 14;
  }
  y -= 6;
  draw(`Celkem bez DPH: ${fmt(invoice.totalAmount)} ${invoice.currency}`);
  y -= 14;
  draw(`Celkem s DPH: ${fmt(invoice.totalWithVat)} ${invoice.currency}`, { bold: true });
  y -= 24;

  draw(`Rozpis SIM karet`, { bold: true, size: 12 });
  y -= 18;

  // Table header
  const cols = [
    { label: "Cislo", x: margin, w: 110 },
    { label: "Pausal", x: margin + 120, w: 90 },
    { label: "Ostatni provoz", x: margin + 220, w: 120 },
    { label: "Celkem", x: margin + 360, w: 90 },
  ];
  for (const c of cols) {
    page.drawText(ascii(c.label), { x: c.x, y, size: 10, font: fontBold });
  }
  y -= 4;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  y -= 12;

  let sumPausal = 0;
  let sumOther = 0;
  let sumTotal = 0;
  for (const line of lines) {
    if (y < margin + 60) {
      page = doc.addPage([595.28, 841.89]);
      y = page.getSize().height - margin;
    }
    page.drawText(ascii(line.phone || "-"), { x: cols[0].x, y, size: 10, font });
    page.drawText(fmt(line.pausal), { x: cols[1].x, y, size: 10, font });
    page.drawText(fmt(line.otherTraffic), { x: cols[2].x, y, size: 10, font });
    page.drawText(fmt(line.total), { x: cols[3].x, y, size: 10, font });
    sumPausal += line.pausal;
    sumOther += line.otherTraffic;
    sumTotal += line.total;
    y -= 14;
  }

  y -= 6;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.5,
  });
  y -= 14;
  page.drawText("Soucet", { x: cols[0].x, y, size: 10, font: fontBold });
  page.drawText(fmt(sumPausal), { x: cols[1].x, y, size: 10, font: fontBold });
  page.drawText(fmt(sumOther), { x: cols[2].x, y, size: 10, font: fontBold });
  page.drawText(fmt(sumTotal), { x: cols[3].x, y, size: 10, font: fontBold });

  return await doc.save();
}
