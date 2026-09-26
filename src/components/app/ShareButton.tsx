import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Check, Link2, Loader2 } from "lucide-react";

import { createShareLink, revokeShareLink } from "@/lib/share.functions";

export function ShareButton(props: { workspaceId: string; employeeId?: string; title: string; body: string }) {
  const create = useServerFn(createShareLink);
  const revoke = useServerFn(revokeShareLink);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error" | "revoked">("idle");
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  const go = async () => {
    setState("busy");
    try {
      let l = link;
      if (!l) {
        const r = await create({ data: { ...props, title: props.title.slice(0, 200) } });
        l = { id: r.id, url: `${window.location.origin}/s/${r.token}` };
        setLink(l);
      }
      await navigator.clipboard?.writeText(l.url).catch(() => undefined);
      setState("copied");
    } catch {
      setState("error");
    }
  };

  const stop = async () => {
    if (!link) return;
    setState("busy");
    try {
      await revoke({ data: { id: link.id } });
      setLink(null);
      setState("revoked");
    } catch {
      setState("error");
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => void go()}
        disabled={state === "busy"}
        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-bold transition-colors hover:bg-secondary disabled:opacity-60"
      >
        {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : state === "copied" ? <Check className="size-4" /> : <Link2 className="size-4" />}
        {state === "copied" ? "نُسخ الرابط" : "رابط مشاركة"}
      </button>
      {link ? (
        <>
          <a href={link.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline" dir="ltr">
            {link.url}
          </a>
          <button
            onClick={() => void stop()}
            disabled={state === "busy"}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-bold text-coral hover:bg-secondary disabled:opacity-60"
          >
            <Ban className="size-3.5" /> أوقف المشاركة
          </button>
        </>
      ) : null}
      {state === "revoked" ? <span className="text-xs text-muted-foreground">تم إيقاف الرابط ولن يفتح لأحد</span> : null}
      {state === "error" ? <span className="text-xs text-coral">تعذّر تنفيذ الطلب</span> : null}
    </span>
  );
}
