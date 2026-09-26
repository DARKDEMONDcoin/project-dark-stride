CREATE TABLE public.telegram_onboarding (
  chat_id text PRIMARY KEY,
  step text NOT NULL DEFAULT 'welcome',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  tg_name text,
  tg_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_onboarding TO service_role;
ALTER TABLE public.telegram_onboarding ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER telegram_onboarding_updated BEFORE UPDATE ON public.telegram_onboarding FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();