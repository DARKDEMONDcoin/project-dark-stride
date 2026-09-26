CREATE TABLE public.shared_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  employee_id text,
  title text NOT NULL,
  body text NOT NULL,
  views integer NOT NULL DEFAULT 0,
  revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_outputs TO authenticated;
GRANT ALL ON public.shared_outputs TO service_role;
ALTER TABLE public.shared_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages shared outputs" ON public.shared_outputs FOR ALL TO authenticated
  USING (public.owns_workspace(workspace_id)) WITH CHECK (public.owns_workspace(workspace_id));

CREATE OR REPLACE FUNCTION public.get_shared_output(_token text)
RETURNS TABLE(title text, body text, employee_id text, company text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.shared_outputs s SET views = s.views + 1
   WHERE s.token = _token AND NOT s.revoked AND (s.expires_at IS NULL OR s.expires_at > now());
  RETURN QUERY
  SELECT s.title, s.body, s.employee_id, w.name, s.created_at
    FROM public.shared_outputs s JOIN public.workspaces w ON w.id = s.workspace_id
   WHERE s.token = _token AND NOT s.revoked AND (s.expires_at IS NULL OR s.expires_at > now());
END; $$;
REVOKE ALL ON FUNCTION public.get_shared_output(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_output(text) TO anon, authenticated;