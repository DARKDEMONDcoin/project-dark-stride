CREATE TABLE public.employee_policies (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  can_send boolean NOT NULL DEFAULT true,
  can_publish boolean NOT NULL DEFAULT true,
  can_browse boolean NOT NULL DEFAULT true,
  daily_action_cap integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, employee_id)
);
CREATE TABLE public.action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  action_id text NOT NULL,
  provider text,
  status text NOT NULL,
  summary text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_policies TO authenticated;
GRANT ALL ON public.employee_policies TO service_role;
GRANT SELECT ON public.action_audit TO authenticated;
GRANT ALL ON public.action_audit TO service_role;
ALTER TABLE public.employee_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages employee policies" ON public.employee_policies FOR ALL TO authenticated
  USING (public.owns_workspace(workspace_id)) WITH CHECK (public.owns_workspace(workspace_id));
CREATE POLICY "owner reads action audit" ON public.action_audit FOR SELECT TO authenticated
  USING (public.owns_workspace(workspace_id));
CREATE INDEX action_audit_ws_idx ON public.action_audit(workspace_id, created_at DESC);
CREATE TRIGGER employee_policies_updated_at BEFORE UPDATE ON public.employee_policies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();