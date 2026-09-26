ALTER TABLE public.command_links
  ADD COLUMN IF NOT EXISTS pending_input jsonb;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';

INSERT INTO private.cron_tokens (name, token)
VALUES ('telegram-notify', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION private.telegram_event(_kind text, _workspace_id uuid, _ref uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'private', 'public', 'extensions'
AS $$
declare t text;
begin
  if not exists (select 1 from public.command_links where channel = 'telegram' and status = 'active' and workspace_id = _workspace_id) then
    return;
  end if;
  select token into t from private.cron_tokens where name = 'telegram-notify';
  if t is null then return; end if;
  perform net.http_post(
    url := private.app_base_url() || '/api/public/telegram-notify',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', t),
    body := jsonb_build_object('kind', _kind, 'workspace_id', _workspace_id, 'ref', _ref),
    timeout_milliseconds := 30000);
exception when others then
  return;
end; $$;

CREATE OR REPLACE FUNCTION private.tg_on_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if NEW.status = 'review' and (TG_OP = 'INSERT' or OLD.status is distinct from 'review') then
    perform private.telegram_event('approval_ready', NEW.workspace_id, NEW.id);
  elsif TG_OP = 'UPDATE' and OLD.status = 'review' and NEW.status in ('done','rejected') then
    perform private.telegram_event('task_' || NEW.status, NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;
CREATE TRIGGER tasks_telegram_notify AFTER INSERT OR UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION private.tg_on_task();

CREATE OR REPLACE FUNCTION private.tg_on_social_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if NEW.status = 'failed' and OLD.status is distinct from 'failed' then
    perform private.telegram_event('publishing_failed', NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;
CREATE TRIGGER social_posts_telegram_notify AFTER UPDATE OF status ON public.social_posts
FOR EACH ROW EXECUTE FUNCTION private.tg_on_social_post();

CREATE OR REPLACE FUNCTION private.tg_on_integration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  if OLD.status = 'connected' and NEW.status is distinct from 'connected' then
    perform private.telegram_event('integration_disconnected', NEW.workspace_id, NEW.id);
  elsif NEW.status = 'connected' and OLD.status is distinct from 'connected' then
    perform private.telegram_event('integration_connected', NEW.workspace_id, NEW.id);
  end if;
  return NEW;
end; $$;
CREATE TRIGGER integrations_telegram_notify AFTER UPDATE OF status ON public.integrations
FOR EACH ROW EXECUTE FUNCTION private.tg_on_integration();

CREATE OR REPLACE FUNCTION private.tg_on_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'private','public' AS $$
begin
  perform private.telegram_event('proposal_new', NEW.workspace_id, NEW.id);
  return NEW;
end; $$;
CREATE TRIGGER proposals_telegram_notify AFTER INSERT ON public.proposals
FOR EACH ROW EXECUTE FUNCTION private.tg_on_proposal();