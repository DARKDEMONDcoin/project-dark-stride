import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Link2, Loader2 } from "lucide-react";

import { createShareLink } from "@/lib/share.functions";

export function ShareButton(props: { workspaceId: string; employeeId?: string; title: string; body: string }) {
  const create = useServerFn(createShareLink);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);

  const go = async () => {
    setState("busy");
    try {
      let link = url;
      if (!link) {
        const r = await create({ data: { ...props, title: props.title.slice(0, 200) } });
        link = `${window.location.origin}/s/${r.token}`;
        setUrl(link);
      }
      await navigator.clipboard?.writeText(link).catch(() => undefined);
      setState("copied");
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
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline" dir="ltr">
          {url}
        </a>
      ) : null}
      {state === "error" ? <span className="text-xs text-coral">تعذّر إنشاء الرابط</span> : null}
    </span>
  );
}
