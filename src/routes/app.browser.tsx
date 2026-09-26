import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Globe, Loader2, Plus, ShieldCheck, X } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Markdown } from "@/components/app/Markdown";
import { useWorkspace } from "@/lib/data";
import { compareSitesTask, runBrowserTask } from "@/lib/employee-actions.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/browser")({
  head: () => ({
    meta: [
      { title: "المتصفح المنفّذ | سهل" },
      { name: "description", content: "مهام تصفح متعددة الخطوات ومقارنات بين المواقع بأمان كامل وموافقتك." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BrowserPage,
});

type Mode = "task" | "compare";

const STATUS: Record<string, { label: string; cls: string }> = {
  done: { label: "اكتملت", cls: "bg-jade/12 text-jade-deep" },
  needs_approval: { label: "توقفت لطلب موافقتك", cls: "bg-amber/15 text-amber" },
  handoff: { label: "بانتظار تدخّلك", cls: "bg-primary/10 text-primary" },
  max_steps: { label: "انتهت الخطوات", cls: "bg-secondary text-muted-foreground" },
  error: { label: "تعذّر التنفيذ", cls: "bg-coral/15 text-coral" },
};

const ACTION_LABEL: Record<string, string> = {
  navigate: "فتح صفحة",
  click: "ضغط",
  type: "كتابة",
  scroll: "تمرير",
  back: "رجوع",
  done: "النتيجة",
  handoff: "تسليم لك",
  error: "خطأ",
};

const PURCHASE_INTENT = /اشتر|شراء|احجز|حجز|اطلب|ادفع|buy|book|order|checkout/i;

function BrowserPage() {
  const { data: workspace } = useWorkspace();
  const runTask = useServerFn(runBrowserTask);
  const runCompare = useServerFn(compareSitesTask);
  const [mode, setMode] = useState<Mode>("task");
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [urls, setUrls] = useState<string[]>(["", ""]);

  const task = useMutation({
    mutationFn: (resumeSessionId?: string) =>
      runTask({
        data: {
          workspaceId: workspace!.id,
          goal: goal.trim(),
          startUrl: startUrl.trim() || undefined,
          resumeSessionId,
        },
      }),
  });
  const compare = useMutation({
    mutationFn: () =>
      runCompare({
        data: { workspaceId: workspace!.id, goal: goal.trim(), urls: urls.map((u) => u.trim()).filter(Boolean) },
      }),
  });

  const busy = task.isPending || compare.isPending;
  const canRun =
    Boolean(workspace?.id) && goal.trim().length >= 5 && (mode === "task" || urls.filter((u) => u.trim()).length >= 2);
  const error = (task.error ?? compare.error) as Error | null;

  return (
    <AppShell
      title="المتصفح المنفّذ"
      lead="قارن الخيارات من مواقعها الأصلية، وراجع الأسعار والتفاصيل قبل أن تتخذ قرارك."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <section className="space-y-4 rounded-3xl border border-border bg-card p-5">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1 text-sm font-bold">
            {(["task", "compare"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn("rounded-xl py-2", mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {m === "task" ? "مهمة متعددة الخطوات" : "مقارنة بين مواقع"}
              </button>
            ))}
          </div>

          <label className="block text-sm font-bold">
            {mode === "task" ? "ما المطلوب؟" : "ماذا نقارن؟"}
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              placeholder={
                mode === "task"
                  ? "مثال: هات أفضل سيارة عائلية تناسب ميزانيتي في الرياض، وقارنها بالبدائل وجهّز روابط الشراء؛ أنا أكمل الدفع بنفسي."
                  : "مثال: قارن ثلاثة فنادق قريبة من وسط دبي: السعر، تقييم النزلاء، سياسة الإلغاء ورابط الحجز؛ أنا أؤكد الحجز بنفسي."
              }
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm font-normal"
            />
          </label>

          {mode === "task" ? (
            <label className="block text-sm font-bold">
              رابط البداية (اختياري)
              <input
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                dir="ltr"
                placeholder="https://"
                className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm font-normal"
              />
            </label>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-bold">روابط المواقع (2–5)</p>
              {urls.map((u, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={u}
                    onChange={(e) => setUrls((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                    dir="ltr"
                    placeholder="https://"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm"
                  />
                  {urls.length > 2 ? (
                    <button
                      type="button"
                      aria-label="حذف الرابط"
                      onClick={() => setUrls((l) => l.filter((_, j) => j !== i))}
                      className="grid size-10 shrink-0 place-items-center rounded-xl border border-border hover:bg-secondary"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}
              {urls.length < 5 ? (
                <button
                  type="button"
                  onClick={() => setUrls((l) => [...l, ""])}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-primary"
                >
                  <Plus className="size-3.5" /> رابط آخر
                </button>
              ) : null}
            </div>
          )}

          <button
            type="button"
            disabled={!canRun || busy}
            onClick={() => (mode === "task" ? task.mutate(undefined) : compare.mutate())}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3 text-sm font-bold text-background disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
            {busy ? "يعمل الآن… قد يستغرق دقيقة" : "ابدأ"}
          </button>

          <p className="flex items-start gap-2 rounded-2xl bg-secondary/60 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-jade-deep" />
            لا دفع، ولا إرسال نماذج، ولا تسجيل حسابات، ولا كتابة كلمات مرور. أي تعليمات مكتوبة داخل المواقع تُتجاهل تماماً.
          </p>
        </section>

        <section className="min-w-0 space-y-4">
          {error ? (
            <div className="rounded-3xl border border-coral/30 bg-coral/10 p-4 text-sm">{error.message}</div>
          ) : null}

          {mode === "task" && task.data ? (
            <>
              <div className="rounded-3xl border border-border bg-card p-5">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-bold",
                    STATUS[task.data.status]?.cls,
                  )}
                >
                  {STATUS[task.data.status]?.label}
                </span>
                <Markdown body={task.data.answer} className="mt-3" />
                {task.data.status === "handoff" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {task.data.liveViewUrl ? (
                      <a
                        href={task.data.liveViewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-bold hover:bg-secondary"
                      >
                        <ExternalLink className="size-3.5" /> افتح الشاشة الحيّة
                      </a>
                    ) : null}
                    {task.data.sessionId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => task.mutate(task.data!.sessionId!)}
                        className="rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background disabled:opacity-50"
                      >
                        أكملت — تابع المهمة
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {PURCHASE_INTENT.test(goal) && task.data.status !== "handoff" && task.data.steps.at(-1)?.url ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-amber/30 bg-amber/10 p-4 text-sm">
                  <p className="font-bold">جهّزنا لك الصفحة — الدفع والتأكيد النهائي بيدك وحدك.</p>
                  <a
                    href={task.data.steps.at(-1)!.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background"
                  >
                    <ExternalLink className="size-3.5" /> افتح الصفحة وأكمل بنفسك
                  </a>
                </div>
              ) : null}
              <ol className="space-y-3">
                {task.data.steps.map((s) => (
                  <li key={s.n} className="flex gap-3 rounded-3xl border border-border bg-card p-3">
                    {s.screenshotUrl ? (
                      <a href={s.screenshotUrl} target="_blank" rel="noreferrer" className="shrink-0">
                        <img
                          src={s.screenshotUrl}
                          alt={`لقطة الخطوة ${s.n}`}
                          loading="lazy"
                          className="h-20 w-32 rounded-xl border border-border object-cover object-top"
                        />
                      </a>
                    ) : null}
                    <div className="min-w-0 text-sm">
                      <p className="font-bold">
                        الخطوة {s.n} · {ACTION_LABEL[s.action] ?? s.action}
                      </p>
                      <p className="text-muted-foreground">{s.note}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {s.url}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {mode === "compare" && compare.data ? (
            <div className="rounded-3xl border border-border bg-card p-5">
              <Markdown body={compare.data.answer} />
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {compare.data.sources.map((s) => (
                  <li key={s.url} className="rounded-2xl border border-border p-2 text-xs">
                    {s.screenshotUrl ? (
                      <img src={s.screenshotUrl} alt={s.title} loading="lazy" className="mb-2 h-24 w-full rounded-xl object-cover object-top" />
                    ) : null}
                    <a href={s.url} target="_blank" rel="noreferrer" className="font-bold text-primary">
                      {s.title}
                    </a>
                    {!s.ok ? <span className="ms-2 text-coral">تعذّرت القراءة</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!task.data && !compare.data && !error ? (
            <div className="rounded-3xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
              اكتب المطلوب واضغط «ابدأ». سترى هنا كل خطوة مع لقطة شاشتها، ثم النتيجة بمصادرها.
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
