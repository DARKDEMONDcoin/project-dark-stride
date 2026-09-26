import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Users, X } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Markdown } from "@/components/app/Markdown";
import { useWorkspace } from "@/lib/data";
import { employeeDirectory, type EmployeeId } from "@/lib/team-knowledge";
import { decideTeamTask, listTeamTasks, runTeamTask } from "@/lib/team-tasks.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/team-tasks")({
  head: () => ({
    meta: [
      { title: "مهام الفريق المشتركة | سهل" },
      { name: "description", content: "هدف واحد ينفّذه عدة موظفين معاً، ثم تعتمد التسليم النهائي بضغطة." },
      { property: "og:title", content: "مهام الفريق المشتركة | سهل" },
      { property: "og:description", content: "هدف واحد ينفّذه عدة موظفين معاً، ثم تعتمد التسليم النهائي بضغطة." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TeamTasksPage,
});

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "قيد التنفيذ", cls: "bg-primary/10 text-primary" },
  awaiting_approval: { label: "بانتظار اعتمادك", cls: "bg-amber/15 text-amber" },
  approved: { label: "معتمدة", cls: "bg-jade/12 text-jade-deep" },
  rejected: { label: "مرفوضة", cls: "bg-secondary text-muted-foreground" },
  error: { label: "تعذّر الإكمال", cls: "bg-coral/15 text-coral" },
};

function TeamTasksPage() {
  const { data: workspace } = useWorkspace();
  const qc = useQueryClient();
  const run = useServerFn(runTeamTask);
  const list = useServerFn(listTeamTasks);
  const decide = useServerFn(decideTeamTask);
  const [goal, setGoal] = useState("");

  const tasks = useQuery({
    queryKey: ["team-tasks", workspace?.id],
    enabled: !!workspace?.id,
    queryFn: () => list({ data: { workspaceId: workspace!.id } }),
  });
  const start = useMutation({
    mutationFn: () => run({ data: { workspaceId: workspace!.id, goal: goal.trim() } }),
    onSuccess: () => {
      setGoal("");
      qc.invalidateQueries({ queryKey: ["team-tasks"] });
    },
  });
  const decision = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected" }) => decide({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-tasks"] }),
  });

  return (
    <AppShell title="مهام الفريق المشتركة">
      <div className="mx-auto max-w-3xl space-y-6 p-4" dir="rtl">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <Users className="size-5 text-primary" /> هدف واحد، فريق كامل
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            اكتب الهدف، وسيقسّمه الفريق بينهم: كل موظف ينفّذ جزءه ويبني على عمل زميله، ثم تعتمد التسليم النهائي مرة واحدة. لا يُنشر أو يُرسل شيء بدون موافقتك.
          </p>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            placeholder="مثال: جهّزوا حملة إطلاق منتجنا الجديد: بحث سريع، مقال، ثلاثة منشورات، وتصور للتصميم."
            className="w-full rounded-xl border border-border bg-background p-3 text-sm"
          />
          <button
            onClick={() => start.mutate()}
            disabled={!workspace || goal.trim().length < 8 || start.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
            {start.isPending ? "الفريق يعمل الآن… قد يستغرق دقيقة" : "ابدأ المهمة"}
          </button>
          {start.error ? <p className="mt-2 text-sm text-coral">{(start.error as Error).message}</p> : null}
        </section>

        {tasks.isLoading ? <Loader2 className="mx-auto size-5 animate-spin" /> : null}
        {(tasks.data ?? []).map((t) => {
          const st = STATUS[t.status] ?? STATUS["running"]!;
          const steps = [...t.team_task_steps].sort((a, b) => a.position - b.position);
          return (
            <article key={t.id} className="space-y-3 rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{t.goal}</h3>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", st.cls)}>{st.label}</span>
              </div>
              <ol className="space-y-2">
                {steps.map((s) => {
                  const e = employeeDirectory[s.employee_id as EmployeeId];
                  return (
                    <li key={s.id} className="rounded-xl bg-secondary/50 p-3 text-sm">
                      <div className="font-medium">
                        {s.position + 1}. {e?.name ?? s.employee_id}
                        <span className="ms-2 text-xs text-muted-foreground">
                          {s.status === "done" ? "أنجز" : s.status === "running" ? "يعمل…" : "بالانتظار"}
                        </span>
                      </div>
                      <p className="text-muted-foreground">{s.instruction}</p>
                      {s.output ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-primary">عرض مخرج {e?.name}</summary>
                          <div className="mt-2"><Markdown body={s.output} /></div>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {t.final_output ? (
                <div className="rounded-xl border border-border p-4">
                  <div className="mb-2 text-sm font-semibold">التسليم النهائي</div>
                  <Markdown body={t.final_output} />
                </div>
              ) : null}
              {t.status === "awaiting_approval" ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => decision.mutate({ id: t.id, decision: "approved" })}
                    className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  >
                    <Check className="size-4" /> اعتمد
                  </button>
                  <button
                    onClick={() => decision.mutate({ id: t.id, decision: "rejected" })}
                    className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-1.5 text-sm"
                  >
                    <X className="size-4" /> ارفض
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
