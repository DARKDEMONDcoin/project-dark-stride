CREATE TABLE public.inbox_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  kind text NOT NULL,
  subject text,
  sender text,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, message_id)
);
GRANT SELECT ON public.inbox_alerts TO authenticated;
GRANT ALL ON public.inbox_alerts TO service_role;
ALTER TABLE public.inbox_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads inbox alerts" ON public.inbox_alerts FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));

INSERT INTO private.cron_tokens (name, token)
VALUES ('inbox-watch', encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT DO NOTHING;

SELECT cron.schedule('inbox-watch-runner', '5 * * * *', $$SELECT private.cron_post('inbox-watch', '/api/public/inbox-watch')$$);