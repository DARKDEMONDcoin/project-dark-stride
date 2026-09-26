import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, MailWarning, ShieldAlert } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { useWorkspace } from "@/lib/data";
import { saveReplyDraft, scanInbox, type InboxItem } from "@/lib/inbox-watch.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/inbox-watch")({
  head: () => ({
    meta: [
      { title: "رسائل بانتظار ردك | سهل" },
      { name: "description", content: "أمَل تكتشف الرسائل التي لم ترد عليها، وتجهّز الرد، وتحذّرك من الاحتيال." },
      { property: "og:title", content: "رسائل بانتظار ردك | سهل" },
      { property: "og:description", content: "أمَل تكتشف الرسائل التي لم ترد عليها، وتجهّز الرد، وتحذّرك من الاحتيال." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InboxWatchPage,
});

const URG: Record<string, { label: string; cls: string }> = {
  high: { label: "عاجلة", cls: "bg-coral/15 text-coral" },
  normal: { label: "عادية", cls: "bg-secondary text-muted-foreground" },
  low: { label: "غير مهمة", cls: "bg-secondary text-muted-foreground" },
};

function Row({ item, workspaceId }: { item: InboxItem; workspaceId: string }) {
  const save = useServerFn(saveReplyDraft);
  const [reply, setReply] = useState(item.reply);
  const draft = useMutation({
    mutationFn: () =>
      save({ data: { workspaceId, threadId: item.threadId, to: item.from, subject: item.subject, body: reply } }),
  });
  return (
    <article className={cn("space-y-2 rounded-2xl border bg-card p-4", item.scam ? "border-coral" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{item.subject || "(بدون عنوان)"}</div>
          <div className="truncate text-xs text-muted-foreground" dir="auto">{item.from}</div>
        </div>
        {item.scam ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/15 px-2.5 py-1 text-xs text-coral">
            <ShieldAlert className="size-3.5" /> احتيال محتمل
          </span>
        ) : (
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", URG[item.urgency]?.cls)}>{URG[item.urgency]?.label}</span>
        )}
      </div>
      <p className="text-sm">{item.summary}</p>
      {item.scam ? (
        <p className="rounded-xl bg-coral/10 p-3 text-sm text-coral">
          لا تضغط أي رابط ولا ترد. {item.scamReason}
        </p>
      ) : item.needsReply ? (
        <>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={4}
            dir="auto"
            className="w-full rounded-xl border border-border bg-background p-3 text-sm"
          />
          <button
            onClick={() => draft.mutate()}
            disabled={!reply.trim() || draft.isPending || draft.isSuccess}
            className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          >
            {draft.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {draft.isSuccess ? "حُفظت مسودة في Gmail" : "احفظ الرد مسودة في Gmail"}
          </button>
          {draft.error ? <p className="text-xs text-coral">{(draft.error as Error).message}</p> : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">لا تحتاج رداً.</p>
      )}
    </article>
  );
}

function InboxWatchPage() {
  const { data: workspace } = useWorkspace();
  const scan = useServerFn(scanInbox);
  const run = useMutation({ mutationFn: () => scan({ data: { workspaceId: workspace!.id } }) });

  return (
    <AppShell title="رسائل بانتظار ردك">
      <div className="mx-auto max-w-3xl space-y-4 p-4" dir="rtl">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <MailWarning className="size-5 text-primary" /> أمَل تراجع بريدك
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            تبحث في رسائل آخر 4 أيام عن التي لم ترد عليها، وترتبها حسب الأهمية، وتجهّز لك رداً، وتحذّرك من رسائل الاحتيال. لا يُرسل أي رد — يُحفظ مسودة فقط لتراجعه.
          </p>
          <button
            onClick={() => run.mutate()}
            disabled={!workspace || run.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <MailWarning className="size-4" />}
            {run.isPending ? "أمَل تقرأ بريدك…" : "افحص البريد الآن"}
          </button>
          {run.error ? <p className="mt-2 text-sm text-coral">{(run.error as Error).message}</p> : null}
        </section>

        {run.data && !run.data.connected ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm">
            Gmail غير مربوط بعد. <Link to="/app/integrations" className="text-primary underline">اربطه من صفحة التكاملات</Link>.
          </p>
        ) : null}
        {run.data?.connected && run.data.items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm">ممتاز — لا رسائل تنتظر ردك.</p>
        ) : null}
        {workspace && run.data?.items.map((it) => <Row key={it.id} item={it} workspaceId={workspace.id} />)}
      </div>
    </AppShell>
  );
}
