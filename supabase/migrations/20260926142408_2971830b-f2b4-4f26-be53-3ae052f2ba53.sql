DO $$
BEGIN
  INSERT INTO public.app_secrets (name, value, updated_at)
  SELECT name, decrypted_secret, now()
  FROM vault.decrypted_secrets
  WHERE name IN (
    'BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID', 'CREDENTIALS_ENC_KEY',
    'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET', 'LOVABLE_API_KEY', 'LOVABLE_CRON_SECRET',
    'OPENROUTER_API_KEY', 'PAGESPEED_API_KEY', 'TAVILY_API_KEY',
    'TELEGRAM_BOT_TOKEN'
  )
  AND decrypted_secret IS NOT NULL
  AND btrim(decrypted_secret) <> ''
  ON CONFLICT (name) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
END
$$;