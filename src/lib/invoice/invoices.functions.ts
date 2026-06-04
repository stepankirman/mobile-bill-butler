import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseInvoiceXml } from "./parser.server";
import { fetchSheetMapping } from "./sheet.server";
import { renderInvoicePdf } from "./pdf.server";
import { createReceivable, notifyClient } from "./cfcontrol.server";
import { normalizePhone } from "../phone";

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

function stripDiacritics(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export const searchInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ query: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const q = data.query.trim();
    const qNorm = stripDiacritics(q);
    const digits = q.replace(/\D/g, "");
    const results: Array<{
      invoice_id: string;
      xml_number: string;
      issued_at: string | null;
      phone: string;
      client_name: string | null;
      total: number;
    }> = [];

    if (digits.length >= 3) {
      const { data: lines } = await supabaseAdmin
        .from("invoice_lines")
        .select("invoice_id, phone_number, total")
        .ilike("phone_number", `%${digits}%`)
        .limit(200);
      if (lines && lines.length > 0) {
        const ids = Array.from(new Set(lines.map((l) => l.invoice_id)));
        const { data: invs } = await supabaseAdmin
          .from("invoices")
          .select("id, xml_number, issued_at")
          .in("id", ids);
        const { data: cis } = await supabaseAdmin
          .from("customer_invoices")
          .select("invoice_id, client_name, phone_numbers")
          .in("invoice_id", ids);
        const invMap = new Map((invs ?? []).map((i) => [i.id, i]));
        for (const l of lines) {
          const inv = invMap.get(l.invoice_id);
          if (!inv) continue;
          const ci = (cis ?? []).find(
            (c) => c.invoice_id === l.invoice_id && c.phone_numbers?.includes(l.phone_number),
          );
          results.push({
            invoice_id: l.invoice_id,
            xml_number: inv.xml_number,
            issued_at: inv.issued_at,
            phone: l.phone_number,
            client_name: ci?.client_name ?? null,
            total: Number(l.total),
          });
        }
      }
    }

    // Diacritics-insensitive name search: fetch a wide set then filter in JS.
    const { data: cis } = await supabaseAdmin
      .from("customer_invoices")
      .select("invoice_id, client_name, phone_numbers, total_amount")
      .not("client_name", "is", null)
      .limit(1000);
    const matchedCis = (cis ?? []).filter((c) =>
      stripDiacritics(c.client_name ?? "").includes(qNorm),
    );
    if (matchedCis.length > 0) {
      const ids = Array.from(new Set(matchedCis.map((c) => c.invoice_id)));
      const { data: invs } = await supabaseAdmin
        .from("invoices")
        .select("id, xml_number, issued_at")
        .in("id", ids);
      const invMap = new Map((invs ?? []).map((i) => [i.id, i]));
      for (const c of matchedCis) {
        const inv = invMap.get(c.invoice_id);
        if (!inv) continue;
        results.push({
          invoice_id: c.invoice_id,
          xml_number: inv.xml_number,
          issued_at: inv.issued_at,
          phone: (c.phone_numbers ?? []).join(", "),
          client_name: c.client_name,
          total: Number(c.total_amount),
        });
      }
    }

    const seen = new Set<string>();
    const unique = results.filter((r) => {
      const key = `${r.invoice_id}|${r.phone}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { results: unique };
  });

export const deleteInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
  .handler(async ({ data }) => {
    const [{ data: invs }, { data: cis }] = await Promise.all([
      supabaseAdmin.from("invoices").select("pdf_storage_path").in("id", data.ids),
      supabaseAdmin.from("customer_invoices").select("pdf_storage_path").in("invoice_id", data.ids),
    ]);
    const paths = [
      ...(invs ?? []).map((r) => r.pdf_storage_path).filter((p): p is string => !!p),
      ...(cis ?? []).map((r) => r.pdf_storage_path).filter((p): p is string => !!p),
    ];
    if (paths.length > 0) {
      await supabaseAdmin.storage.from(PDF_BUCKET).remove(paths);
    }
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabaseAdmin.from("invoice_lines").delete().in("invoice_id", data.ids),
      supabaseAdmin.from("customer_invoices").delete().in("invoice_id", data.ids),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    const { error: e3 } = await supabaseAdmin.from("invoices").delete().in("id", data.ids);
    if (e3) throw new Error(e3.message);
    return { deleted: data.ids.length };
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
  .inputValidator(
    z.object({
      customerInvoiceId: z.string().uuid(),
      skipEmail: z.boolean().optional().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const { data: ci, error } = await supabaseAdmin
      .from("customer_invoices")
      .select("*, invoices(*)")
      .eq("id", data.customerInvoiceId)
      .maybeSingle();
    if (error || !ci) throw new Error(error?.message ?? "Záznam nenalezen");

    const inv = (ci as unknown as { invoices: { xml_number: string; currency: string } }).invoices;
    try {
      const mapping = await fetchSheetMapping();
      const phoneNumbers = Array.isArray(ci.phone_numbers)
        ? ci.phone_numbers.map((p) => normalizePhone(String(p))).filter(Boolean)
        : [];
      const freshClientId = phoneNumbers.map((p) => mapping.byPhone.get(p)?.trim()).find(Boolean);
      const hasCurrentSheetRow = phoneNumbers.some(
        (p) => mapping.byPhone.has(p) || mapping.byPhoneName.has(p),
      );
      const storedClientId = String(ci.cf_control_client_id ?? "").trim();
      const clientId = freshClientId ?? (hasCurrentSheetRow ? "" : storedClientId);
      if (!clientId) {
        if (storedClientId && hasCurrentSheetRow) {
          await supabaseAdmin
            .from("customer_invoices")
            .update({ cf_control_client_id: null })
            .eq("id", ci.id);
        }
        throw new Error(
          `Chybí ID klienta v Google Sheets pro telefon ${phoneNumbers.join(", ") || "—"}`,
        );
      }
      if (clientId !== storedClientId) {
        await supabaseAdmin
          .from("customer_invoices")
          .update({ cf_control_client_id: clientId })
          .eq("id", ci.id);
      }
      const { id: receivableId } = await createReceivable({
        clientId,
        amount: Number(ci.total_amount),
        currency: inv.currency,
        description: `Mobilní vyúčtování – faktura ${inv.xml_number}`,
        note: `Číslo původní faktury: ${inv.xml_number}`,
        variableSymbol: inv.xml_number,
      });
      if (!data.skipEmail) {
        await notifyClient({
          clientId,
          receivableId,
          subject: `Vyúčtování mobilních služeb – ${inv.xml_number}`,
          body: `Dobrý den,\n\nvyúčtování mobilních služeb za období fakturuje částku ${Number(
            ci.total_amount,
          ).toFixed(2)} ${inv.currency}.\n\nDěkujeme.`,
        });
      }
      await supabaseAdmin
        .from("customer_invoices")
        .update({
          cf_status: data.skipEmail ? "imported" : "sent",
          cf_error: null,
          cf_receivable_id: receivableId,
          email_sent_at: data.skipEmail ? null : new Date().toISOString(),
        })
        .eq("id", ci.id);
      return { ok: true, receivableId, skipEmail: !!data.skipEmail };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("customer_invoices")
        .update({ cf_status: "error", cf_error: msg })
        .eq("id", ci.id);
      throw new Error(msg);
    }
  });
