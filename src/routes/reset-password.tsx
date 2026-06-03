import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Nové heslo – Mobilní vyúčtování TeamCity" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });

    (async () => {
      // 1) Error v URL (např. expirovaný odkaz)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const search = new URLSearchParams(window.location.search);
      const urlError = hash.get("error_description") || search.get("error_description");
      if (urlError) {
        setError(decodeURIComponent(urlError));
        return;
      }

      // 2) PKCE flow – ?code=...
      const code = search.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError(error.message);
          return;
        }
        setReady(true);
        return;
      }

      // 3) Implicit flow – #access_token=...&refresh_token=...
      const access_token = hash.get("access_token");
      const refresh_token = hash.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) {
          setError(error.message);
          return;
        }
        setReady(true);
        return;
      }

      // 4) Možná už existuje session
      const { data } = await supabase.auth.getSession();
      if (data.session) setReady(true);
      else setError("Odkaz pro obnovení hesla je neplatný nebo vypršel. Vyžádejte si nový.");
    })();

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Heslo musí mít alespoň 6 znaků.");
      return;
    }
    if (password !== password2) {
      setError("Hesla se neshodují.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate({ to: "/upload" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Změna hesla selhala");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nové heslo</CardTitle>
          <CardDescription>
            {ready
              ? "Zadejte nové heslo pro váš účet."
              : "Ověřuji odkaz pro obnovení hesla…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="password">Nové heslo</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={!ready}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password2">Potvrzení hesla</Label>
              <Input
                id="password2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                autoComplete="new-password"
                disabled={!ready}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !ready}>
              {loading ? "Ukládám…" : "Uložit nové heslo"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
