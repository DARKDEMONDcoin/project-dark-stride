CREATE OR REPLACE FUNCTION private.tg_on_autopilot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if NEW.paused_reason is not null and OLD.paused_reason is distinct from NEW.paused_reason then
    perform private.telegram_event('autopilot_paused', NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;
DROP TRIGGER IF EXISTS social_autopilot_telegram_notify ON public.social_autopilot;
CREATE TRIGGER social_autopilot_telegram_notify AFTER UPDATE ON public.social_autopilot
FOR EACH ROW EXECUTE FUNCTION private.tg_on_autopilot();