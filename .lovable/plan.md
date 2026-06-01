
# Mobilní vyúčtování TeamCity

Aplikace v TanStack Start + Lovable Cloud, která nahradí původní PHP zadání. Jediný sdílený login, upload XML faktury, párování telefonních čísel s klienty přes Google Sheets, generování PDF a import pohledávky + odeslání e-mailu přes CF-control API.

## Uživatelské toky

1. **Login** — `/login`, jediný sdílený účet (email + heslo) vytvořený přes Lovable Cloud Auth. Všechny ostatní stránky jsou za `_authenticated` layoutem.
2. **Upload faktury** — `/upload`: drag-and-drop XML, náhled rozparsovaných dat (čísla, paušály, ostatní provoz, součty), tabulka spárování s klienty (číslo → ID klienta z Google Sheets). Tlačítka „Uložit", „Vygenerovat PDF", „Importovat do CF-control + odeslat e-mail".
3. **Historie** — `/invoices`: seznam zpracovaných XML faktur (číslo, datum, počet SIM, celková částka, stav importu). Detail `/invoices/$id` s rozpisem SIM + odkazem na PDF + log CF-control volání.

## Datový model (Lovable Cloud / Postgres)

- `invoices` — id, xml_number, supplier, issued_at, total_amount, total_with_vat, currency, uploaded_at, pdf_storage_path, raw_xml (text), status (uploaded / imported / failed).
- `invoice_lines` — id, invoice_id, phone_number, total, pausal, other_traffic, raw_json (jsonb pro plný detail SIM).
- `customer_invoices` — id, invoice_id, cf_control_client_id, total_amount, pdf_storage_path, cf_status (pending / sent / error), cf_error, cf_receivable_id, email_sent_at. Agreguje řádky se stejným klientem.
- Storage bucket `invoice-pdfs` (private) pro PDF.
- RLS: všechny tabulky jen pro `authenticated` (jediný účet).

## Server logika (`createServerFn` + jeden server route)

- `parseInvoiceXml.functions.ts` — přijme raw XML, vrátí strukturovaný JSON (hlavička + pole SIM s phone/total/pausal/ostatní provoz). Použije `fast-xml-parser`.
- `fetchSheetMapping.functions.ts` — stáhne live CSV z Google Sheets přes `gviz/tq?tqx=out:csv&sheet=mob%20sim%207%2F2024`, vrátí mapu `phone → client_id` (sloupec C → D). Volá se při každém uploadu.
- `saveInvoice.functions.ts` — uloží `invoices` + `invoice_lines`, agreguje po klientech do `customer_invoices`.
- `generateInvoicePdf.functions.ts` — vygeneruje PDF (souhrnné za celou XML fakturu i per-klient) pomocí `pdf-lib` (Worker-kompatibilní), uloží do Storage.
- `importToCfControl.functions.ts` — pro daný `customer_invoices` řádek zavolá CF-control REST API (Bearer `CF_CONTROL_API_KEY`), vytvoří pohledávku, pak zavolá endpoint pro odeslání e-mailu klientovi. Loguje výsledek do `cf_status` / `cf_error`.
- `/api/pdf/$id` server route — autorizovaný download PDF z bucketu.

## Sekrety (vyžádám přes `add_secret` v build módu)

- `CF_CONTROL_API_KEY` — Bearer token.
- `CF_CONTROL_API_BASE_URL` — base URL API (např. `https://app.cf-control.cz/api/v2`).

## UI komponenty (shadcn)

- Login form, app shell s sidebarem (Upload / Historie / Odhlásit).
- Upload: `Dropzone`, parser preview table, mapping table s indikací „nenalezený klient", action buttons.
- Historie: `Table` s filtrem, badge stavu, dialog s detailem.

## Otevřené body, které vyřešíme za chodu

- Přesný tvar CF-control endpointů pro „pohledávka" a „e-mail klientovi" — vezmu z odkazované Bitbucket dokumentace při implementaci; pokud bude payload nejasný, vyžádám si ukázkový request.
- Pokud Google Sheet není veřejně čitelný přes CSV export, přepneme na Google Sheets connector (per-OAuth) — řešíme až kdyby fetch selhal.
