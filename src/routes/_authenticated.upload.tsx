import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { processInvoiceUpload } from "@/lib/invoice/invoices.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({
    meta: [
      { title: "Nahrát XML faktury" },
      { name: "description", content: "Hromadné nahrání XML faktur od mobilního operátora." },
    ],
  }),
  component: UploadPage,
});

type Result =
  | { name: string; status: "pending" }
  | { name: string; status: "processing" }
  | { name: string; status: "ok"; invoiceId: string; lineCount: number; customerCount: number }
  | { name: string; status: "error"; error: string };

function UploadPage() {
  const navigate = useNavigate();
  const processFn = useServerFn(processInvoiceUpload);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fileList = inputRef.current?.files;
    if (!fileList || fileList.length === 0) {
      toast.error("Vyberte alespoň jeden XML soubor.");
      return;
    }
    const files = Array.from(fileList);
    setBusy(true);
    setResults(files.map((f) => ({ name: f.name, status: "pending" })));

    let okCount = 0;
    let errCount = 0;
    let lastOkId: string | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setResults((prev) => prev.map((r, idx) => (idx === i ? { name: file.name, status: "processing" } : r)));
      try {
        const text = await file.text();
        const res = await processFn({ data: { xml: text } });
        lastOkId = res.invoiceId;
        okCount++;
        setResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  name: file.name,
                  status: "ok",
                  invoiceId: res.invoiceId,
                  lineCount: res.lineCount,
                  customerCount: res.customerCount,
                }
              : r,
          ),
        );
      } catch (e) {
        errCount++;
        const msg = e instanceof Error ? e.message : "Zpracování selhalo";
        setResults((prev) =>
          prev.map((r, idx) => (idx === i ? { name: file.name, status: "error", error: msg } : r)),
        );
      }
    }

    setBusy(false);

    if (files.length === 1 && okCount === 1 && lastOkId) {
      navigate({ to: "/invoices/$id", params: { id: lastOkId } });
      return;
    }
    if (okCount > 0) toast.success(`Zpracováno ${okCount} z ${files.length} faktur.`);
    if (errCount > 0) toast.error(`${errCount} faktur selhalo.`);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Nahrát XML faktury</CardTitle>
          <CardDescription>
            Vyberte jeden nebo více XML souborů od operátora (lze přidržet Ctrl/Cmd nebo Shift při výběru,
            nebo přetáhnout celou složku). Soubory se zpracují postupně – pro každý se načte mapování
            z Google Sheets, uloží faktura a vygenerují PDF pro každého klienta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="xml">XML soubory</Label>
              <Input
                id="xml"
                ref={inputRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                multiple
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {busy ? "Zpracovávám…" : "Nahrát a zpracovat"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Průběh ({results.filter((r) => r.status === "ok").length} / {results.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {results.map((r, idx) => (
                <li key={idx} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                  <div className="mt-0.5">
                    {r.status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {r.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                    {r.status === "processing" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {r.status === "pending" && <div className="h-4 w-4 rounded-full border" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{r.name}</p>
                    {r.status === "ok" && (
                      <p className="text-xs text-muted-foreground">
                        {r.lineCount} SIM · {r.customerCount} klientů ·{" "}
                        <Link to="/invoices/$id" params={{ id: r.invoiceId }} className="underline">
                          otevřít detail
                        </Link>
                      </p>
                    )}
                    {r.status === "error" && (
                      <p className="text-xs text-destructive">{r.error}</p>
                    )}
                    {r.status === "processing" && (
                      <p className="text-xs text-muted-foreground">Zpracovávám…</p>
                    )}
                    {r.status === "pending" && (
                      <p className="text-xs text-muted-foreground">Čeká ve frontě</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
