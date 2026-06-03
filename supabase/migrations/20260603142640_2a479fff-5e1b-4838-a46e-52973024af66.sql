
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.app_settings (key, value) VALUES (
  'google_sheet',
  '{"spreadsheet_id":"1T8z5q4TLm5kx0ziEldlyN-PKj0HQsQnw4JrbZIE-JuM","sheet_name":"mob sim 7/2024","phone_column":2,"client_id_column":3}'::jsonb
) ON CONFLICT (key) DO NOTHING;
