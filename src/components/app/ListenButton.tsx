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
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[0.7rem] font-bold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
      aria-label="استمع للرد"
    >
      {state === "busy" ? <Loader2 className="size-3 animate-spin" /> : state === "playing" ? <Square className="size-3" /> : <Volume2 className="size-3" />}
      {state === "playing" ? "إيقاف" : state === "error" ? "أعد المحاولة" : "استمع"}
    </button>
  );
}
