INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('cf_control', jsonb_build_object('base_url','https://demo.cf-control.cz/api/web/v2/','api_key','veyg<!hR]sbG*w:r;NtQ,vh5aQVAT?'), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();