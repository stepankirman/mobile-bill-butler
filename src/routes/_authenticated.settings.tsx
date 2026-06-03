import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSheetSettings, saveSheetSettings, testSheetSettings } from "@/lib/invoice/settings.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Save, TestTube } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Nastavení" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const getFn = useServerFn(getSheetSettings);
  const saveFn = useServerFn(saveSheetSettings);
  const testFn = useServerFn(testSheetSettings);

  const { data, isLoading } = useQuery({ queryKey: ["sheet-settings"], queryFn: () => getFn() });

  const [url, setUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [phoneCol, setPhoneCol] = useState(2);
  const [clientCol, setClientCol] = useState(3);

  useEffect(() => {
    if (data?.config) {
      setUrl(data.config.spreadsheet_id);
      setSheetName(data.config.sheet_name);
      setPhoneCol(data.config.phone_column);
      setClientCol(data.config.client_id_column);
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          spreadsheet_id_or_url: url,
          sheet_name: sheetName,
          phone_column: phoneCol,
          client_id_column: clientCol,
        },
      }),
    onSuccess: () => toast.success("Nastavení uloženo."),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Chyba"),
  });

  const testMut = useMutation({
    mutationFn: () =>
      testFn({
        data: {
          spreadsheet_id_or_url: url,
          sheet_name: sheetName,
          phone_column: phoneCol,
          client_id_column: clientCol,
        },
      }),
  });

  const sheetUrl = url
    ? `https://docs.google.com/spreadsheets/d/${url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? url}/edit`
    : "";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Google Sheets – mapování telefon → klient</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="url">Odkaz na Google Sheets (nebo jen ID)</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                />
                <p className="text-xs text-muted-foreground">
                  Sheet musí být veřejně čitelný („Kdokoli s odkazem – Prohlížející").
                  {sheetUrl && (
                    <>
                      {" "}
                      <a href={sheetUrl} target="_blank" rel="noreferrer" className="underline">
                        Otevřít sheet
                      </a>
                    </>
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sheet">Název listu (tab)</Label>
                <Input id="sheet" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phoneCol">Sloupec s telefonem (0 = A, 1 = B, 2 = C…)</Label>
                  <Input
                    id="phoneCol"
                    type="number"
                    min={0}
                    value={phoneCol}
                    onChange={(e) => setPhoneCol(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientCol">Sloupec s ID klienta</Label>
                  <Input
                    id="clientCol"
                    type="number"
                    min={0}
                    value={clientCol}
                    onChange={(e) => setClientCol(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                  {saveMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Uložit
                </Button>
                <Button variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
                  {testMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <TestTube className="mr-2 h-4 w-4" />
                  )}
                  Otestovat načtení
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {testMut.data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Výsledek testu
              {testMut.data.ok ? (
                <Badge>OK</Badge>
              ) : (
                <Badge variant="destructive">Chyba</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {testMut.data.ok ? (
              <>
                <p>
                  Načteno <strong>{testMut.data.totalRows}</strong> řádků, z toho{" "}
                  <strong>{testMut.data.mappingCount}</strong> validních mapování (telefon → ID klienta).
                </p>
                <div>
                  <p className="font-medium">Hlavička listu:</p>
                  <p className="text-xs text-muted-foreground">
                    {testMut.data.headerRow.map((h, i) => `${String.fromCharCode(65 + i)}: ${h || "—"}`).join("  ·  ")}
                  </p>
                </div>
                <div>
                  <p className="font-medium">Ukázka mapování (prvních 5):</p>
                  {testMut.data.samples.length === 0 ? (
                    <p className="text-destructive">
                      Žádné řádky se nenamapovaly – zkontrolujte čísla sloupců a obsah listu.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 font-mono text-xs">
                      {testMut.data.samples.map((s) => (
                        <li key={s.phone}>
                          {s.phone} → {s.clientId}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-destructive">{testMut.data.error}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
