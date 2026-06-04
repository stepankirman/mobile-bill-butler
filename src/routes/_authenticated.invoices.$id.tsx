import { Fragment, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInvoiceDetail,
  getPdfSignedUrl,
  importCustomerInvoice,
} from "@/lib/invoice/invoices.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Send, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({ meta: [{ title: "Detail faktury" }] }),
  component: InvoiceDetailPage,
});

interface PolItem {
  feature?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  total?: number;
  vatRate?: number;
}

const DEFAULT_VAT_RATE = 21;

function normalizeVatRate(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function totalWithVat(total: number, vatRate: number): number {
  return total * (1 + vatRate / 100);
}

function collectRawItems(container: unknown): Array<Record<string, unknown>> {
  if (container == null) return [];
  if (Array.isArray(container)) return container.filter((v): v is Record<string, unknown> => typeof v === "object" && v != null);
  if (typeof container !== "object") return [];
  return Object.entries(container as Record<string, unknown>)
    .filter(([k]) => k.startsWith("item"))
    .map(([, v]) => v)
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v != null);
}

function itemVatRate(item: PolItem, rawItems: Array<Record<string, unknown>>, index: number, fallback: number): number {
  return normalizeVatRate(item.vatRate) ?? normalizeVatRate(rawItems[index]?.DPH_PROCENTA) ?? fallback;
}

function decodeEntities(s: string): string {
  if (!s) return s;
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

function InvoiceDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getInvoiceDetail);
  const signFn = useServerFn(getPdfSignedUrl);
  const importFn = useServerFn(importCustomerInvoice);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => fetchFn({ data: { id } }),
  });

  const importMut = useMutation({
    mutationFn: (customerInvoiceId: string) => importFn({ data: { customerInvoiceId } }),
    onSuccess: () => {
      toast.success("Importováno do CF-control a e-mail odeslán.");
      qc.invalidateQueries({ queryKey: ["invoice", id] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Chyba importu"),
  });

  async function openPdf(path: string | null) {
    if (!path) {
      toast.error("PDF pro tuto položku neexistuje.");
      return;
    }
    // Open the tab synchronously to avoid popup blockers
    const win = window.open("about:blank", "_blank");
    try {
      const { url } = await signFn({ data: { path } });
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const blob = await res.blob();
        const pdfBlob = blob.type === "application/pdf"
          ? blob
          : new Blob([blob], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(pdfBlob);
        if (win) {
          win.location.href = blobUrl;
        } else {
          window.location.href = blobUrl;
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch {
        if (win) win.location.href = url;
        else window.location.href = url;
      }
    } catch (e) {
      if (win) win.close();
      toast.error(e instanceof Error ? e.message : "Nelze otevřít PDF");
    }
  }

  function toggleRow(key: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Načítám…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const { invoice, lines, customers } = data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Faktura {invoice.xml_number}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {invoice.supplier ?? "—"} · vystaveno {invoice.issued_at ?? "—"}
            </p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs text-muted-foreground">Bez DPH</p>
            <p className="text-sm">
              {Number(invoice.total_amount).toFixed(2)} {invoice.currency}
            </p>
            <p className="text-xs text-muted-foreground">DPH</p>
            <p className="text-sm">
              {(Number(invoice.total_with_vat) - Number(invoice.total_amount)).toFixed(2)}{" "}
              {invoice.currency}
            </p>
            <p className="text-xs text-muted-foreground">Celkem s DPH</p>
            <p className="text-2xl font-semibold">
              {Number(invoice.total_with_vat).toFixed(2)} {invoice.currency}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => openPdf(invoice.pdf_storage_path)}>
            <Download className="mr-2 h-4 w-4" /> Souhrnné PDF
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Klienti ({customers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jméno</TableHead>
                <TableHead>CF-control ID</TableHead>
                <TableHead>Telefony</TableHead>
                <TableHead className="text-right">Částka</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.client_name ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {c.cf_control_client_id ?? (
                      <span className="text-destructive">nenamapováno</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{c.phone_numbers.join(", ")}</TableCell>
                  <TableCell className="text-right">
                    {Number(c.total_amount).toFixed(2)} {invoice.currency}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        c.cf_status === "sent"
                          ? "default"
                          : c.cf_status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {c.cf_status}
                    </Badge>
                    {c.cf_error && <p className="mt-1 text-xs text-destructive">{c.cf_error}</p>}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openPdf(c.pdf_storage_path)}
                      disabled={!c.pdf_storage_path}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => importMut.mutate(c.id)}
                      disabled={
                        !c.cf_control_client_id ||
                        c.cf_status === "sent" ||
                        importMut.isPending
                      }
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {c.cf_status === "sent" ? "Odesláno" : "Import + e-mail"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SIM karty / vyúčtování ({lines.length})</CardTitle>
          <p className="text-xs text-muted-foreground">
            Klikněte na řádek pro zobrazení detailu vyúčtování daného čísla.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead className="text-right">Paušál</TableHead>
                <TableHead className="text-right">Ostatní provoz</TableHead>
                <TableHead className="text-right">Celkem bez DPH</TableHead>
                <TableHead className="text-right">Celkem s DPH</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const isOpen = expanded.has(l.id);
                const raw = (l.raw_json ?? {}) as { items?: PolItem[]; raw?: unknown };
                const items: PolItem[] = Array.isArray(raw.items) ? raw.items : [];
                const rawLine = raw.raw as Record<string, unknown> | undefined;
                const rawItems = collectRawItems(rawLine?.POL);
                const lineVatRate = normalizeVatRate(rawLine?.DPH_PROCENTA) ?? DEFAULT_VAT_RATE;
                const totalBase = Number(l.total);
                const totalVat = items.length > 0
                  ? items.reduce((sum, it, i) => sum + totalWithVat(Number(it.total ?? 0), itemVatRate(it, rawItems, i, lineVatRate)), 0)
                  : totalWithVat(totalBase, lineVatRate);
                return (
                  <Fragment key={l.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => toggleRow(l.id)}
                    >
                      <TableCell>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{l.phone_number}</TableCell>
                      <TableCell className="text-right">
                        {Number(l.pausal).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(l.other_traffic).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {totalBase.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {totalVat.toFixed(2)}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell></TableCell>
                        <TableCell colSpan={5}>
                          {items.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2">
                              Žádné detailní položky.
                            </p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Položka</TableHead>
                                  <TableHead>Typ</TableHead>
                                  <TableHead className="text-right">Počet</TableHead>
                                  <TableHead>Jedn.</TableHead>
                                  <TableHead className="text-right">Cena bez DPH</TableHead>
                                  <TableHead className="text-right">DPH</TableHead>
                                  <TableHead className="text-right">Celkem bez DPH</TableHead>
                                  <TableHead className="text-right">Celkem s DPH</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {items.map((it, i) => {
                                  const total = it.total != null ? Number(it.total) : null;
                                  const vatRate = itemVatRate(it, rawItems, i, lineVatRate);
                                  const withVat = total != null ? totalWithVat(total, vatRate) : null;
                                  return (
                                    <TableRow key={i}>
                                      <TableCell className="text-sm">
                                        {decodeEntities(it.description || "") || "—"}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {decodeEntities(it.feature || "") || "—"}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {it.quantity != null
                                          ? Number(it.quantity).toLocaleString("cs-CZ", {
                                              maximumFractionDigits: 3,
                                            })
                                          : "—"}
                                      </TableCell>
                                      <TableCell>{decodeEntities(it.unit || "") || "—"}</TableCell>
                                      <TableCell className="text-right">
                                        {it.unitPrice != null ? Number(it.unitPrice).toFixed(2) : "—"}
                                      </TableCell>
                                      <TableCell className="text-right">{vatRate.toFixed(0)} %</TableCell>
                                      <TableCell className="text-right">
                                        {total != null ? total.toFixed(2) : "—"}
                                      </TableCell>
                                      <TableCell className="text-right font-medium">
                                        {withVat != null ? withVat.toFixed(2) : "—"}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
