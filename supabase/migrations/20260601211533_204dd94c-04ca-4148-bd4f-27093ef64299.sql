
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  xml_number TEXT NOT NULL,
  supplier TEXT,
  issued_at DATE,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_with_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CZK',
  raw_xml TEXT NOT NULL,
  pdf_storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read invoices" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update invoices" ON public.invoices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete invoices" ON public.invoices FOR DELETE TO authenticated USING (true);

CREATE TABLE public.invoice_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  pausal NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_traffic NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_lines_invoice ON public.invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_phone ON public.invoice_lines(phone_number);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_lines TO authenticated;
GRANT ALL ON public.invoice_lines TO service_role;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all lines" ON public.invoice_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.customer_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  cf_control_client_id TEXT,
  phone_numbers TEXT[] NOT NULL DEFAULT '{}',
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  pdf_storage_path TEXT,
  cf_status TEXT NOT NULL DEFAULT 'pending',
  cf_error TEXT,
  cf_receivable_id TEXT,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_invoices_invoice ON public.customer_invoices(invoice_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_invoices TO authenticated;
GRANT ALL ON public.customer_invoices TO service_role;
ALTER TABLE public.customer_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all customer_invoices" ON public.customer_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_customer_invoices_updated
BEFORE UPDATE ON public.customer_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO storage.buckets (id, name, public) VALUES ('invoice-pdfs', 'invoice-pdfs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "auth read pdfs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'invoice-pdfs');
CREATE POLICY "auth write pdfs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoice-pdfs');
CREATE POLICY "auth update pdfs" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'invoice-pdfs');
CREATE POLICY "auth delete pdfs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'invoice-pdfs');
