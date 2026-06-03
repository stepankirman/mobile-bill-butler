import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseInvoiceXml } from "./parser.server";
import { fetchSheetMapping } from "./sheet.server";
import { renderInvoicePdf } from "./pdf.server";
import { createReceivable, notifyClient } from "./cfcontrol.server";

const PDF_BUCKET = "invoice-pdfs";

async function uploadPdf(path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(PDF_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
}

export const processInvoiceUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      xml: z.string().min(20).max(10_000_000),
    }),
  )
  .handler(async ({ data, context }) => {
    const parsed = parseInvoiceXml(data.xml);
    if (!parsed.number) throw new Error("Z XML se nepodařilo přečíst číslo faktury.");

    const mapping = await fetchSheetMapping();

    // Group lines by CF-control client id (unmapped numbers go under empty key).
    const groups = new Map<string, typeof parsed.lines>();
    for (const line of parsed.lines) {
      const clientId = mapping.byPhone.get(line.phone) ?? "";
      const arr = groups.get(clientId) ?? [];
      arr.push(line);
      groups.set(clientId, arr);
    }

    // Insert invoice header
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("invoices")
      .insert({
        xml_number: parsed.number,
        supplier: parsed.supplier,
        issued_at: parsed.issuedAt,
        total_amount: parsed.totalAmount,
        total_with_vat: parsed.totalWithVat,
        currency: parsed.currency,
        raw_xml: data.xml,
        status: "uploaded",
        uploaded_by: context.userId,
      })
      .select()
      .single();
    if (invErr || !inv) throw new Error(invErr?.message ?? "Insert invoice failed");

    // Insert invoice_lines (raw_json keeps full POL detail incl. items).
    const lineRows = parsed.lines.map((l) => ({
      invoice_id: inv.id,
      phone_number: l.phone,
      pausal: l.pausal,
      other_traffic: l.otherTraffic,
      total: l.total,
      raw_json: JSON.parse(JSON.stringify({ items: l.items, raw: l.raw })),
    }));
    if (lineRows.length > 0) {
      const { error: linesErr } = await supabaseAdmin.from("invoice_lines").insert(lineRows);
      if (linesErr) throw new Error(linesErr.message);
    }

    // Generate master PDF
    const masterPdf = await renderInvoicePdf({
      invoice: parsed,
      clientLabel: null,
      clientName: parsed.customer.fullName,
      lines: parsed.lines,
    });
    const masterPath = `${inv.id}/master.pdf`;
    await uploadPdf(masterPath, masterPdf);
    await supabaseAdmin.from("invoices").update({ pdf_storage_path: masterPath }).eq("id", inv.id);

    // Generate per-client PDFs and customer_invoices rows
    const customerRows: Array<{
      invoice_id: string;
      cf_control_client_id: string | null;
      client_name: string | null;
      phone_numbers: string[];
      total_amount: number;
      pdf_storage_path: string;
      cf_status: string;
      cf_error: string | null;
    }> = [];
    let idx = 0;
    for (const [clientId, lines] of groups) {
      idx += 1;
      const total = lines.reduce((s, l) => s + l.total, 0);
      // Resolve client name: by clientId, otherwise from first phone, else XML customer.
      let clientName: string | null = null;
      if (clientId) clientName = mapping.byClientName.get(clientId) ?? null;
      if (!clientName) {
        for (const l of lines) {
          const n = mapping.byPhoneName.get(l.phone);
          if (n) { clientName = n; break; }
        }
      }
      if (!clientName) clientName = parsed.customer.fullName;

      const pdfBytes = await renderInvoicePdf({
        invoice: parsed,
        clientLabel: clientId || "(nenalezený klient)",
        clientName,
        lines,
      });
      const path = `${inv.id}/customer-${idx}.pdf`;
      await uploadPdf(path, pdfBytes);
      customerRows.push({
        invoice_id: inv.id,
        cf_control_client_id: clientId || null,
        client_name: clientName,
        phone_numbers: lines.map((l) => l.phone),
        total_amount: total,
        pdf_storage_path: path,
        cf_status: clientId ? "pending" : "unmapped",
        cf_error: clientId ? null : "Telefonní číslo nenalezeno v Google Sheets",
      });
    }
    if (customerRows.length > 0) {
      const { error: ciErr } = await supabaseAdmin.from("customer_invoices").insert(customerRows);
      if (ciErr) throw new Error(ciErr.message);
    }

    return { invoiceId: inv.id, lineCount: parsed.lines.length, customerCount: customerRows.length };
  });

export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("invoices")
      .select(
        "id, xml_number, supplier, issued_at, total_with_vat, currency, status, uploaded_at, pdf_storage_path",
      )
      .order("uploaded_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { invoices: data ?? [] };
  });

export const getInvoiceDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ data: inv, error: invErr }, { data: lines, error: lErr }, { data: customers, error: cErr }] =
      await Promise.all([
        supabaseAdmin.from("invoices").select("*").eq("id", data.id).maybeSingle(),
        supabaseAdmin.from("invoice_lines").select("*").eq("invoice_id", data.id).order("phone_number"),
        supabaseAdmin
          .from("customer_invoices")
          .select("*")
          .eq("invoice_id", data.id)
          .order("created_at"),
      ]);
    if (invErr) throw new Error(invErr.message);
    if (lErr) throw new Error(lErr.message);
    if (cErr) throw new Error(cErr.message);
    if (!inv) throw new Error("Faktura nenalezena");
    return { invoice: inv, lines: lines ?? [], customers: customers ?? [] };
  });

export const getPdfSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ path: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { data: signed, error } = await supabaseAdmin.storage
      .from(PDF_BUCKET)
      .createSignedUrl(data.path, 300);
    if (error || !signed) throw new Error(error?.message ?? "Nelze vytvořit URL");
    return { url: signed.signedUrl };
  });

export const importCustomerInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ customerInvoiceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { data: ci, error } = await supabaseAdmin
      .from("customer_invoices")
      .select("*, invoices(*)")
      .eq("id", data.customerInvoiceId)
      .maybeSingle();
    if (error || !ci) throw new Error(error?.message ?? "Záznam nenalezen");
    if (!ci.cf_control_client_id) throw new Error("Chybí ID klienta v CF-control");

    const inv = (ci as unknown as { invoices: { xml_number: string; currency: string } }).invoices;
    try {
      const { id: receivableId } = await createReceivable({
        clientId: ci.cf_control_client_id,
        amount: Number(ci.total_amount),
        currency: inv.currency,
        description: `Mobilní vyúčtování – faktura ${inv.xml_number}`,
        variableSymbol: inv.xml_number,
      });
      await notifyClient({
        clientId: ci.cf_control_client_id,
        receivableId,
        subject: `Vyúčtování mobilních služeb – ${inv.xml_number}`,
        body: `Dobrý den,\n\nvyúčtování mobilních služeb za období fakturuje částku ${Number(
          ci.total_amount,
        ).toFixed(2)} ${inv.currency}.\n\nDěkujeme.`,
      });
      await supabaseAdmin
        .from("customer_invoices")
        .update({
          cf_status: "sent",
          cf_error: null,
          cf_receivable_id: receivableId,
          email_sent_at: new Date().toISOString(),
        })
        .eq("id", ci.id);
      return { ok: true, receivableId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("customer_invoices")
        .update({ cf_status: "error", cf_error: msg })
        .eq("id", ci.id);
      throw new Error(msg);
    }
  });
