import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { processInvoiceUpload } from "@/lib/invoice/invoices.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({
    meta: [
      { title: "Nahrát XML fakturu" },
      { name: "description", content: "Nahrát XML fakturu od mobilního operátora." },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const navigate = useNavigate();
  const processFn = useServerFn(processInvoiceUpload);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      toast.error("Vyberte XML soubor.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const res = await processFn({ data: { xml: text } });
      toast.success(`Faktura zpracována (${res.lineCount} SIM, ${res.customerCount} klientů).`);
      navigate({ to: "/invoices/$id", params: { id: res.invoiceId } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Zpracování selhalo";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nahrát XML fakturu</CardTitle>
        <CardDescription>
          Vyberte XML soubor od operátora (Erbia Mobile / Laudatio). Po nahrání aplikace načte
          mapování telefonních čísel z Google Sheets, uloží fakturu a vygeneruje PDF pro každého
          klienta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="xml">XML soubor</Label>
            <Input id="xml" ref={inputRef} type="file" accept=".xml,text/xml,application/xml" required />
          </div>
          <Button type="submit" disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Zpracovávám…" : "Nahrát a zpracovat"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
