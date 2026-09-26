import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Square, Volume2 } from "lucide-react";

import { speakText } from "@/lib/voice.functions";

export function ListenButton({ workspaceId, text }: { workspaceId: string; text: string }) {
  const speak = useServerFn(speakText);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "playing" | "error">("idle");

  const play = async () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    try {
      if (!urlRef.current) {
        setState("busy");
        const r = await speak({ data: { workspaceId, text } });
        const bin = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
        urlRef.current = URL.createObjectURL(new Blob([bin], { type: r.mime }));
      }
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = urlRef.current;
      a.onended = () => setState("idle");
      await a.play();
      setState("playing");
    } catch {
      setState("error");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void play()}
      disabled={state === "busy"}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-60"
      aria-label="استمع للرد"
    >
      {state === "busy" ? <Loader2 className="size-3.5 animate-spin" /> : state === "playing" ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
      {state === "playing" ? "إيقاف" : state === "error" ? "تعذّر التشغيل — أعد المحاولة" : "استمع"}
    </button>
  );
}
