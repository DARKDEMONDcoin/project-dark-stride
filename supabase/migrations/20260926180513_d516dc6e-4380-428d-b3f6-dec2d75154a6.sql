CREATE TABLE public.team_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  final_output text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.team_task_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_task_id uuid NOT NULL REFERENCES public.team_tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  position int NOT NULL,
  employee_id text NOT NULL,
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  output text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_tasks TO authenticated;
GRANT ALL ON public.team_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_task_steps TO authenticated;
GRANT ALL ON public.team_task_steps TO service_role;
ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_task_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages team tasks" ON public.team_tasks FOR ALL TO authenticated
  USING (public.owns_workspace(workspace_id)) WITH CHECK (public.owns_workspace(workspace_id));
CREATE POLICY "owner manages team task steps" ON public.team_task_steps FOR ALL TO authenticated
  USING (public.owns_workspace(workspace_id)) WITH CHECK (public.owns_workspace(workspace_id));
CREATE INDEX team_task_steps_task_idx ON public.team_task_steps(team_task_id, position);
CREATE TRIGGER team_tasks_updated_at BEFORE UPDATE ON public.team_tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();