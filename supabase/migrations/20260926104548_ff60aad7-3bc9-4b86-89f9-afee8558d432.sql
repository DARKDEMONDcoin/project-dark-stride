CREATE OR REPLACE FUNCTION private.tg_on_social_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if NEW.status = 'failed' and OLD.status is distinct from 'failed' then
    perform private.telegram_event('publishing_failed', NEW.workspace_id, NEW.id);
  elsif NEW.status = 'published' and OLD.status is distinct from 'published' then
    perform private.telegram_event('post_published', NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;

CREATE OR REPLACE FUNCTION private.tg_on_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  perform private.telegram_event('decision_new', NEW.workspace_id, NEW.id);
  return NEW;
end; $$;
DROP TRIGGER IF EXISTS decisions_telegram_notify ON public.decisions;
CREATE TRIGGER decisions_telegram_notify AFTER INSERT ON public.decisions
FOR EACH ROW EXECUTE FUNCTION private.tg_on_decision();

CREATE OR REPLACE FUNCTION private.tg_on_brain_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if coalesce(NEW.meta, '') not like '%تيليجرام%' then
    perform private.telegram_event('brain_new', NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;
DROP TRIGGER IF EXISTS brain_items_telegram_notify ON public.brain_items;
CREATE TRIGGER brain_items_telegram_notify AFTER INSERT ON public.brain_items
FOR EACH ROW EXECUTE FUNCTION private.tg_on_brain_item();

CREATE OR REPLACE FUNCTION private.tg_on_briefing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if TG_OP = 'INSERT' then
    perform private.telegram_event('briefing_ready', NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;
DROP TRIGGER IF EXISTS briefings_telegram_notify ON public.briefings;
CREATE TRIGGER briefings_telegram_notify AFTER INSERT ON public.briefings
FOR EACH ROW EXECUTE FUNCTION private.tg_on_briefing();