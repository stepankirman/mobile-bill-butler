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
import { Download, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/invoices/$id")({
  head: () => ({ meta: [{ title: "Detail faktury" }] }),
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getInvoiceDetail);
  const signFn = useServerFn(getPdfSignedUrl);
  const importFn = useServerFn(importCustomerInvoice);

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
    if (!path) return;
    try {
      const { url } = await signFn({ data: { path } });
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nelze otevřít PDF");
    }
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
              {(Number(invoice.total_with_vat) - Number(invoice.total_amount)).toFixed(2)} {invoice.currency}
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
                  <TableCell className="font-medium">{c.client_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{c.cf_control_client_id ?? <span className="text-destructive">nenamapováno</span>}</TableCell>
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
                    {c.cf_error && (
                      <p className="mt-1 text-xs text-destructive">{c.cf_error}</p>
                    )}
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
          <CardTitle>SIM karty ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telefon</TableHead>
                <TableHead className="text-right">Paušál</TableHead>
                <TableHead className="text-right">Ostatní provoz</TableHead>
                <TableHead className="text-right">Celkem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.phone_number}</TableCell>
                  <TableCell className="text-right">{Number(l.pausal).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{Number(l.other_traffic).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{Number(l.total).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
