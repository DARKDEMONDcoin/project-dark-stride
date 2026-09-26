import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { useWorkspace } from "@/lib/data";
import { employeeDirectory, type EmployeeId } from "@/lib/team-knowledge";
import { forgetItem, getTrustOverview, savePolicy } from "@/lib/trust.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/trust")({
  head: () => ({
    meta: [
      { title: "الثقة والصلاحيات | سهل" },
      { name: "description", content: "ما يعرفه الفريق عنك، وما يُسمح لكل موظف بفعله، وسجل كامل لكل إجراء." },
      { property: "og:title", content: "الثقة والصلاحيات | سهل" },
      { property: "og:description", content: "ما يعرفه الفريق عنك، وما يُسمح لكل موظف بفعله، وسجل كامل لكل إجراء." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrustPage,
});

type Tab = "profile" | "permissions" | "log";
const IDS = Object.keys(employeeDirectory) as EmployeeId[];
const nameOf = (id: string) => employeeDirectory[id as EmployeeId]?.name ?? id;
type Pol = { enabled: boolean; can_send: boolean; can_publish: boolean; can_browse: boolean; daily_action_cap: number };
const DEF: Pol = { enabled: true, can_send: true, can_publish: true, can_browse: true, daily_action_cap: 50 };

function PolicyRow({ id, initial, workspaceId }: { id: EmployeeId; initial: Pol; workspaceId: string }) {
  const save = useServerFn(savePolicy);
  const qc = useQueryClient();
  const [p, setP] = useState<Pol>(initial);
  useEffect(() => setP(initial), [initial]);
  const m = useMutation({
    mutationFn: (next: Pol) => save({ data: { workspaceId, employeeId: id, ...next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trust"] }),
  });
  const update = (patch: Partial<Pol>) => {
    const next = { ...p, ...patch };
    setP(next);
    m.mutate(next);
  };
  const Toggle = ({ k, label }: { k: "enabled" | "can_send" | "can_publish" | "can_browse"; label: string }) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={p[k]} onChange={(e) => update({ [k]: e.target.checked })} className="size-4 accent-primary" />
      {label}
    </label>
  );
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", !p.enabled && "opacity-70")}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-semibold">{employeeDirectory[id].name}</div>
          <div className="text-xs text-muted-foreground">{employeeDirectory[id].role}</div>
        </div>
        {m.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Toggle k="enabled" label="مفعّل" />
        <Toggle k="can_send" label="يرسل رسائل وإيميلات" />
        <Toggle k="can_publish" label="ينشر محتوى" />
        <Toggle k="can_browse" label="يتصفح ويعبّئ نماذج" />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        حد أقصى يومي للإجراءات:
        <input
          type="number"
          min={0}
          max={1000}
          value={p.daily_action_cap}
          onChange={(e) => setP({ ...p, daily_action_cap: Number(e.target.value) })}
          onBlur={() => m.mutate(p)}
          className="w-20 rounded-lg border border-border bg-background px-2 py-1"
        />
      </label>
    </div>
  );
}

function TrustPage() {
  const { data: workspace } = useWorkspace();
  const qc = useQueryClient();
  const load = useServerFn(getTrustOverview);
  const forget = useServerFn(forgetItem);
  const [tab, setTab] = useState<Tab>("profile");
  const q = useQuery({
    queryKey: ["trust", workspace?.id],
    enabled: !!workspace?.id,
    queryFn: () => load({ data: { workspaceId: workspace!.id } }),
  });
  const del = useMutation({
    mutationFn: (v: { kind: "memory" | "decision"; id: string }) => forget({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trust"] }),
  });

  return (
    <AppShell title="الثقة والصلاحيات">
      <div className="mx-auto max-w-3xl space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-primary" /> أنت المتحكم دائماً
        </div>
        <div className="flex gap-2">
          {([
            ["profile", "ما يعرفه الفريق عنك"],
            ["permissions", "صلاحيات الموظفين"],
            ["log", "سجل الإجراءات"],
          ] as [Tab, string][]).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn("rounded-xl px-3 py-1.5 text-sm", tab === k ? "bg-primary text-primary-foreground" : "border border-border")}
            >
              {l}
            </button>
          ))}
        </div>

        {q.isLoading || !q.data || !workspace ? <Loader2 className="mx-auto size-5 animate-spin" /> : null}

        {q.data && tab === "profile" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              كل ما تعلّمه الفريق من محادثاتك: قراراتك وتفضيلاتك. احذف أي شيء لم يعد صحيحاً وسيتوقف الفريق عن استخدامه فوراً.
            </p>
            {q.data.decisions.length + q.data.memories.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-4 text-sm">لا شيء محفوظ بعد.</p>
            ) : null}
            {q.data.decisions.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-3">
                <div className="text-sm">
                  <div className="font-medium">{d.title}</div>
                  <div className="text-muted-foreground">{d.decision}</div>
                  <div className="text-xs text-muted-foreground">سجّله: {nameOf(d.employee_id)}</div>
                </div>
                <button onClick={() => del.mutate({ kind: "decision", id: d.id })} aria-label="احذف" className="text-muted-foreground hover:text-coral">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {q.data.memories.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-3">
                <div className="text-sm">
                  <div>🧠 {m.content}</div>
                  {m.employee_id ? <div className="text-xs text-muted-foreground">تعلّمه: {nameOf(m.employee_id)}</div> : null}
                </div>
                <button onClick={() => del.mutate({ kind: "memory", id: m.id })} aria-label="احذف" className="text-muted-foreground hover:text-coral">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {q.data && workspace && tab === "permissions" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              حدّد ما يُسمح لكل موظف بفعله. حتى مع السماح، لا يُنفَّذ أي إرسال أو نشر أو دفع إلا بعد موافقتك.
            </p>
            {IDS.map((id) => {
              const row = q.data.policies.find((p) => p.employee_id === id);
              return <PolicyRow key={id} id={id} workspaceId={workspace.id} initial={row ? { ...DEF, ...row } : DEF} />;
            })}
          </div>
        ) : null}

        {q.data && tab === "log" ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">كل إجراء حقيقي نفّذه الفريق، مع وقته ونتيجته.</p>
            {q.data.audit.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-4 text-sm">لم يُنفَّذ أي إجراء بعد.</p>
            ) : null}
            {q.data.audit.map((a) => (
              <div key={a.id} className="rounded-2xl border border-border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {nameOf(a.employee_id)} · {a.action_id}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", a.status === "done" ? "bg-jade/12 text-jade-deep" : "bg-coral/15 text-coral")}>
                    {a.status === "done" ? "نُفّذ" : "فشل"}
                  </span>
                </div>
                {a.summary ? <div className="text-muted-foreground" dir="auto">{a.summary}</div> : null}
                {a.detail ? <div className="text-xs text-coral">{a.detail}</div> : null}
                <div className="text-xs text-muted-foreground" dir="ltr">{new Date(a.created_at).toLocaleString("ar")}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
