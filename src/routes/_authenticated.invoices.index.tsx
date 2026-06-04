import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listInvoices,
  deleteInvoices,
  searchInvoices,
} from "@/lib/invoice/invoices.functions";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/invoices/")({
  head: () => ({ meta: [{ title: "Faktury" }] }),
  component: InvoiceListPage,
});

function monthKey(d: string | null): string {
  if (!d) return "—";
  return d.slice(0, 7);
}

function InvoiceListPage() {
  const fetchFn = useServerFn(listInvoices);
  const deleteFn = useServerFn(deleteInvoices);
  const searchFn = useServerFn(searchInvoices);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => fetchFn(),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [monthFilter, setMonthFilter] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<
    | null
    | Array<{
        invoice_id: string;
        xml_number: string;
        issued_at: string | null;
        phone: string;
        client_name: string | null;
        total: number;
      }>
  >(null);

  const allInvoices = data?.invoices ?? [];
  const invoices = useMemo(
    () =>
      monthFilter.size === 0
        ? allInvoices
        : allInvoices.filter((i) => monthFilter.has(monthKey(i.issued_at))),
    [allInvoices, monthFilter],
  );
  const allIds = useMemo(() => invoices.map((i) => i.id), [invoices]);

  const monthSums = useMemo(() => {
    const m = new Map<string, { count: number; sum: number }>();
    for (const i of invoices) {
      const k = monthKey(i.issued_at);
      const cur = m.get(k) ?? { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += Number(i.total_with_vat);
      m.set(k, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [invoices]);

  const allMonths = useMemo(() => {
    const set = new Set<string>();
    for (const i of allInvoices) set.add(monthKey(i.issued_at));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allInvoices]);

  const months = monthSums.map(([m]) => m);
  const grandTotal = invoices.reduce((s, i) => s + Number(i.total_with_vat), 0);
  const allChecked = selected.size > 0 && selected.size === allIds.length;

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(allIds));
  }
  function selectMonth(mk: string) {
    const ids = invoices.filter((i) => monthKey(i.issued_at) === mk).map((i) => i.id);
    setSelected(new Set(ids));
  }

  const delMut = useMutation({
    mutationFn: (ids: string[]) => deleteFn({ data: { ids } }),
    onSuccess: (res) => {
      toast.success(`Smazáno ${res.deleted} faktur`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Chyba mazání"),
  });

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await searchFn({ data: { query: q.trim() } });
      setSearchResults(res.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chyba hledání");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Vyhledávání</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={runSearch} className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Telefonní číslo nebo jméno klienta…"
            />
            <Button type="submit" variant="secondary">
              <Search className="mr-2 h-4 w-4" /> Hledat
            </Button>
            {searchResults && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setQ("");
                  setSearchResults(null);
                }}
              >
                Zrušit
              </Button>
            )}
          </form>
          {searchResults && (
            <div className="mt-4">
              {searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné výsledky.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Faktura</TableHead>
                      <TableHead>Vystaveno</TableHead>
                      <TableHead>Telefon</TableHead>
                      <TableHead>Klient</TableHead>
                      <TableHead className="text-right">Částka</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchResults.map((r, i) => (
                      <TableRow key={`${r.invoice_id}-${r.phone}-${i}`}>
                        <TableCell>
                          <Link
                            to="/invoices/$id"
                            params={{ id: r.invoice_id }}
                            className="font-medium hover:underline"
                          >
                            {r.xml_number}
                          </Link>
                        </TableCell>
                        <TableCell>{r.issued_at ?? "—"}</TableCell>
                        <TableCell>{r.phone}</TableCell>
                        <TableCell>{r.client_name ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {Number(r.total).toFixed(2)} CZK
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {monthSums.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Součty po měsících</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Měsíc</TableHead>
                  <TableHead className="text-right">Počet faktur</TableHead>
                  <TableHead className="text-right">Celkem s DPH</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthSums.map(([m, v]) => (
                  <TableRow key={m}>
                    <TableCell className="font-medium">{m}</TableCell>
                    <TableCell className="text-right">{v.count}</TableCell>
                    <TableCell className="text-right">{v.sum.toFixed(2)} CZK</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Celkem</TableCell>
                  <TableCell className="text-right font-semibold">{invoices.length}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {grandTotal.toFixed(2)} CZK
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-row items-center justify-between gap-4">
            <CardTitle>Faktury</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {months.length > 1 && (
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      selectMonth(e.target.value);
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="">Označit měsíc…</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selected.size === 0 || delMut.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Smazat ({selected.size})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Smazat vybrané faktury?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Bude smazáno {selected.size} faktur včetně všech položek, klientských
                      rozpisů a PDF. Akci nelze vrátit.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                    <AlertDialogAction onClick={() => delMut.mutate(Array.from(selected))}>
                      Smazat
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          {allMonths.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">Filtr měsíců:</span>
              <Button
                type="button"
                size="sm"
                variant={monthFilter.size === 0 ? "default" : "outline"}
                onClick={() => setMonthFilter(new Set())}
              >
                Vše
              </Button>
              {allMonths.map((m) => {
                const active = monthFilter.has(m);
                return (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() =>
                      setMonthFilter((prev) => {
                        const n = new Set(prev);
                        if (n.has(m)) n.delete(m);
                        else n.add(m);
                        return n;
                      })
                    }
                  >
                    {m}
                  </Button>
                );
              })}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Načítám…</p>}
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          {data && invoices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {allInvoices.length === 0
                ? "Zatím žádná faktura."
                : "Žádná faktura nevyhovuje filtru měsíců."}
            </p>
          )}
          {data && invoices.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={toggleAll}
                      aria-label="Označit vše"
                    />
                  </TableHead>
                  <TableHead>Číslo faktury</TableHead>
                  <TableHead>Dodavatel</TableHead>
                  <TableHead>Vystaveno</TableHead>
                  <TableHead className="text-right">Celkem s DPH</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead>Nahráno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} data-state={selected.has(inv.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(inv.id)}
                        onCheckedChange={() => toggle(inv.id)}
                        aria-label={`Označit ${inv.xml_number}`}
                      />
                    </TableCell>
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
    </div>
  );
}
