import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listInvoices } from "@/lib/invoice/invoices.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Historie faktur" }] }),
  component: InvoiceListPage,
});

function InvoiceListPage() {
  const fetchFn = useServerFn(listInvoices);
  const { data, isLoading, error } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => fetchFn(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historie faktur</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Načítám…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && data.invoices.length === 0 && (
          <p className="text-sm text-muted-foreground">Zatím žádná faktura.</p>
        )}
        {data && data.invoices.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo faktury</TableHead>
                <TableHead>Dodavatel</TableHead>
                <TableHead>Vystaveno</TableHead>
                <TableHead className="text-right">Celkem s DPH</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead>Nahráno</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invoices.map((inv) => (
                <TableRow key={inv.id} className="cursor-pointer">
                  <TableCell>
                    <Link to="/invoices/$id" params={{ id: inv.id }} className="font-medium hover:underline">
                      {inv.xml_number}
                    </Link>
                  </TableCell>
                  <TableCell>{inv.supplier ?? "—"}</TableCell>
                  <TableCell>{inv.issued_at ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {Number(inv.total_with_vat).toFixed(2)} {inv.currency}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{inv.status}</Badge>
                  </TableCell>
                  <TableCell>{new Date(inv.uploaded_at).toLocaleString("cs-CZ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
