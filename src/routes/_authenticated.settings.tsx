import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSheetSettings, saveSheetSettings, testSheetSettings, getCfControlSettings, saveCfControlSettings, testCfControlSettings } from "@/lib/invoice/settings.functions";
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
  const getCfFn = useServerFn(getCfControlSettings);
  const saveCfFn = useServerFn(saveCfControlSettings);
  const testCfFn = useServerFn(testCfControlSettings);

  const { data, isLoading } = useQuery({ queryKey: ["sheet-settings"], queryFn: () => getFn() });
  const { data: cfData, isLoading: cfLoading, refetch: refetchCf } = useQuery({
    queryKey: ["cf-control-settings"],
    queryFn: () => getCfFn(),
  });

  const [cfUrl, setCfUrl] = useState("");
  const [cfKey, setCfKey] = useState("");

  useEffect(() => {
    if (cfData) setCfUrl(cfData.base_url ?? "");
  }, [cfData]);

  const saveCfMut = useMutation({
    mutationFn: () => saveCfFn({ data: { base_url: cfUrl, api_key: cfKey } }),
    onSuccess: () => {
      toast.success("CF-control nastavení uloženo.");
      setCfKey("");
      refetchCf();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Chyba"),
  });

  const [cfTestPath, setCfTestPath] = useState("");
  const testCfMut = useMutation({
    mutationFn: () =>
      testCfFn({
        data: {
          base_url: cfUrl || undefined,
          api_key: cfKey || undefined,
          test_path: cfTestPath || undefined,
        },
      }),
  });

  const [url, setUrl] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [phoneCol, setPhoneCol] = useState(2);
  const [clientCol, setClientCol] = useState(3);
  const [nameCol, setNameCol] = useState(4);

  useEffect(() => {
    if (data?.config) {
      setUrl(data.config.spreadsheet_id);
      setSheetName(data.config.sheet_name);
      setPhoneCol(data.config.phone_column);
      setClientCol(data.config.client_id_column);
      setNameCol(data.config.name_column);
    }
  }, [data]);

  const payload = () => ({
    spreadsheet_id_or_url: url,
    sheet_name: sheetName,
    phone_column: phoneCol,
    client_id_column: clientCol,
    name_column: nameCol,
  });

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: payload() }),
    onSuccess: () => toast.success("Nastavení uloženo."),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Chyba"),
  });

  const testMut = useMutation({ mutationFn: () => testFn({ data: payload() }) });

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
                  Sheet musí být veřejně čitelný („Kdokoli s odkazem – Prohlížející“).
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

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phoneCol">Telefon (0=A, 1=B, 2=C…)</Label>
                  <Input id="phoneCol" type="number" min={0} value={phoneCol}
                    onChange={(e) => setPhoneCol(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientCol">ID klienta</Label>
                  <Input id="clientCol" type="number" min={0} value={clientCol}
                    onChange={(e) => setClientCol(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nameCol">Jméno klienta</Label>
                  <Input id="nameCol" type="number" min={0} value={nameCol}
                    onChange={(e) => setNameCol(Number(e.target.value))} />
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
              {testMut.data.ok ? <Badge>OK</Badge> : <Badge variant="destructive">Chyba</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {testMut.data.ok ? (
              <>
                <p>
                  Načteno <strong>{testMut.data.totalRows}</strong> řádků, z toho{" "}
                  <strong>{testMut.data.mappingCount}</strong> mapování telefon → ID a{" "}
                  <strong>{testMut.data.nameCount}</strong> jmen.
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
                          {s.phone} → {s.clientId} {s.name && <span className="text-muted-foreground">({s.name})</span>}
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

      <Card>
        <CardHeader>
          <CardTitle>CF-control API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {cfLoading ? (
            <p className="text-sm text-muted-foreground">Načítám…</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="cfUrl">Základní URL API</Label>
                <Input
                  id="cfUrl"
                  value={cfUrl}
                  onChange={(e) => setCfUrl(e.target.value)}
                  placeholder="https://demo.cf-control.cz/api/web/v2"
                />
                <p className="text-xs text-muted-foreground">
                  Např. <code>https://&lt;instance&gt;.cf-control.cz/api/web/v2</code>. Bez koncového lomítka.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cfKey">API klíč</Label>
                <Input
                  id="cfKey"
                  type="password"
                  value={cfKey}
                  onChange={(e) => setCfKey(e.target.value)}
                  placeholder={cfData?.has_api_key ? "•••• (uložen) – nechte prázdné pro zachování" : "Vložte API klíč"}
                  autoComplete="new-password"
                />
                {cfData?.has_api_key && (
                  <p className="text-xs text-muted-foreground">
                    Uložený klíč: <span className="font-mono">{cfData.api_key_masked}</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cfTestPath">Testovací cesta (volitelné)</Label>
                <Input
                  id="cfTestPath"
                  value={cfTestPath}
                  onChange={(e) => setCfTestPath(e.target.value)}
                  placeholder="/api/receivables?limit=1"
                />
                <p className="text-xs text-muted-foreground">
                  Pokud necháte prázdné, vyzkouší se několik běžných GET endpointů.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={() => saveCfMut.mutate()} disabled={saveCfMut.isPending || !cfUrl.trim()}>
                  {saveCfMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Uložit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testCfMut.mutate()}
                  disabled={testCfMut.isPending || (!cfUrl.trim() && !cfData?.base_url)}
                >
                  {testCfMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <TestTube className="mr-2 h-4 w-4" />
                  )}
                  Otestovat připojení
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {testCfMut.data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Výsledek testu CF-control
              {testCfMut.data.ok ? <Badge>OK</Badge> : <Badge variant="destructive">Chyba</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {testCfMut.data.ok ? (
              <>
                <p>
                  Připojení v pořádku. HTTP <strong>{testCfMut.data.status}</strong>{" "}
                  {testCfMut.data.statusText}. {testCfMut.data.testedPath && <span className="text-muted-foreground">(cesta: <code>{testCfMut.data.testedPath}</code>)</span>}
                </p>
                {typeof testCfMut.data.clientsCount === "number" && (
                  <p>
                    Načteno <strong>{testCfMut.data.clientsCount}</strong> klientů.
                  </p>
                )}
                {testCfMut.data.clients && testCfMut.data.clients.length > 0 && (
                  <ul className="mt-1 space-y-1 font-mono text-xs">
                    {testCfMut.data.clients.map((c, i) => (
                      <li key={`${c.id ?? i}`}>
                        {c.id ?? "—"} {c.name && <span className="text-muted-foreground">({c.name})</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {testCfMut.data.bodyPreview && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Odpověď serveru (raw)</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                      {testCfMut.data.bodyPreview}
                    </pre>
                  </details>
                )}
              </>
            ) : (
              <>
                <p className="text-destructive">{testCfMut.data.error}</p>
                {testCfMut.data.status !== undefined && (
                  <p>
                    HTTP <strong>{testCfMut.data.status}</strong> {testCfMut.data.statusText} {testCfMut.data.testedPath && <span className="text-muted-foreground">(cesta: <code>{testCfMut.data.testedPath}</code>)</span>}
                  </p>
                )}
                {testCfMut.data.bodyPreview && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                    {testCfMut.data.bodyPreview}
                  </pre>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
