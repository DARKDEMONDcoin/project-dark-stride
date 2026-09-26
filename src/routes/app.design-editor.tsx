import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, ImagePlus, Palette } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";

export const Route = createFileRoute("/app/design-editor")({
  head: () => ({
    meta: [
      { title: "محرر تصميم دانة | سهل" },
      { name: "description", content: "أضف نصاً عربياً صحيحاً فوق صورك بمقاسات السوشيال وحمّل التصميم جاهزاً." },
      { property: "og:title", content: "محرر تصميم دانة | سهل" },
      { property: "og:description", content: "أضف نصاً عربياً صحيحاً فوق صورك بمقاسات السوشيال وحمّل التصميم جاهزاً." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DesignEditor,
});

const SIZES = {
  "مربع 1080×1080": [1080, 1080],
  "عمودي 1080×1350": [1080, 1350],
  "ستوري 1080×1920": [1080, 1920],
  "أفقي 1200×630": [1200, 630],
} as const;
type SizeKey = keyof typeof SIZES;
const FONTS = ["Cairo", "Tajawal", "Almarai"];

function DesignEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState<SizeKey>("مربع 1080×1080");
  const [title, setTitle] = useState("عنوانك هنا");
  const [sub, setSub] = useState("سطر داعم قصير");
  const [cta, setCta] = useState("اطلب الآن");
  const [font, setFont] = useState("Cairo");
  const [textColor, setTextColor] = useState("#ffffff");
  const [accent, setAccent] = useState("#0f766e");
  const [bg, setBg] = useState("#1f2937");
  const [overlay, setOverlay] = useState(45);
  const [pos, setPos] = useState<"top" | "center" | "bottom">("bottom");
  const [titleSize, setTitleSize] = useState(96);

  useEffect(() => {
    const id = "design-editor-fonts";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;800&family=Tajawal:wght@400;800&family=Almarai:wght@400;800&display=swap";
    document.head.appendChild(l);
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const [w, h] = SIZES[size];
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const draw = () => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (img) {
        const s = Math.max(w / img.width, h / img.height);
        ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
        ctx.fillStyle = `rgba(0,0,0,${overlay / 100})`;
        ctx.fillRect(0, 0, w, h);
      }
      const safeTop = size.startsWith("ستوري") ? 250 : 64;
      const safeBottom = size.startsWith("ستوري") ? 350 : 64;
      ctx.direction = "rtl";
      ctx.textAlign = "right";
      const x = w - 64;
      const maxW = w - 128;
      const wrap = (t: string, px: number) => {
        ctx.font = `800 ${px}px ${font}`;
        const lines: string[] = [];
        let line = "";
        for (const word of t.split(/\s+/)) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width > maxW && line) {
            lines.push(line);
            line = word;
          } else line = test;
        }
        if (line) lines.push(line);
        return lines;
      };
      const tLines = title ? wrap(title, titleSize) : [];
      const subPx = Math.round(titleSize * 0.45);
      const sLines = sub ? wrap(sub, subPx) : [];
      const ctaPx = Math.max(40, Math.round(titleSize * 0.42));
      const block = tLines.length * titleSize * 1.5 + sLines.length * subPx * 1.7 + (cta ? ctaPx * 2.4 : 0);
      let y = pos === "top" ? safeTop : pos === "center" ? (h - block) / 2 : h - safeBottom - block;
      ctx.fillStyle = textColor;
      ctx.textBaseline = "top";
      ctx.font = `800 ${titleSize}px ${font}`;
      for (const l of tLines) { ctx.fillText(l, x, y); y += titleSize * 1.5; }
      ctx.font = `400 ${subPx}px ${font}`;
      for (const l of sLines) { ctx.fillText(l, x, y); y += subPx * 1.7; }
      if (cta) {
        ctx.font = `800 ${ctaPx}px ${font}`;
        const bw = ctx.measureText(cta).width + ctaPx * 1.6;
        const bh = ctaPx * 1.8;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(x - bw, y + ctaPx * 0.3, bw, bh, bh / 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(cta, x - ctaPx * 0.8, y + ctaPx * 0.3 + (bh - ctaPx) / 2 - ctaPx * 0.1);
      }
    };
    draw();
    void document.fonts?.load(`800 40px ${font}`).then(draw);
  }, [img, size, title, sub, cta, font, textColor, accent, bg, overlay, pos, titleSize]);

  const onFile = (f?: File) => {
    if (!f) return;
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = URL.createObjectURL(f);
  };

  const download = () => {
    const a = document.createElement("a");
    a.download = "sahl-design.png";
    a.href = canvasRef.current!.toDataURL("image/png");
    a.click();
  };

  const field = "w-full rounded-xl border border-border bg-background p-2 text-sm";
  return (
    <AppShell title="محرر تصميم دانة">
      <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[340px_1fr]" dir="rtl">
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold"><Palette className="size-5 text-primary" /> صمّم فوق صورتك</div>
          <p className="text-muted-foreground">النص العربي يُكتب هنا بخط صحيح بدل الصورة المولّدة، مع المناطق الآمنة لكل مقاس.</p>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border p-3 hover:bg-secondary">
            <ImagePlus className="size-4" /> {img ? "غيّر الصورة" : "ارفع صورة (اختياري)"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <select className={field} value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
            {Object.keys(SIZES).map((k) => <option key={k}>{k}</option>)}
          </select>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان" />
          <input className={field} value={sub} onChange={(e) => setSub(e.target.value)} placeholder="النص الداعم" />
          <input className={field} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="زر الدعوة" />
          <div className="grid grid-cols-2 gap-2">
            <select className={field} value={font} onChange={(e) => setFont(e.target.value)}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className={field} value={pos} onChange={(e) => setPos(e.target.value as typeof pos)}>
              <option value="top">أعلى</option><option value="center">وسط</option><option value="bottom">أسفل</option>
            </select>
          </div>
          <label className="block">حجم العنوان: {titleSize}
            <input type="range" min={48} max={160} value={titleSize} onChange={(e) => setTitleSize(+e.target.value)} className="w-full" />
          </label>
          <label className="block">تعتيم الصورة: {overlay}٪
            <input type="range" min={0} max={80} value={overlay} onChange={(e) => setOverlay(+e.target.value)} className="w-full" />
          </label>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <label>النص<input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-9 w-full" /></label>
            <label>الزر<input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-full" /></label>
            <label>الخلفية<input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-full" /></label>
          </div>
          <button onClick={download} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-medium text-primary-foreground">
            <Download className="size-4" /> حمّل التصميم PNG
          </button>
        </section>
        <div className="flex items-start justify-center rounded-2xl border border-border bg-secondary/40 p-4">
          <canvas ref={canvasRef} className="h-auto max-h-[80vh] w-auto max-w-full rounded-lg shadow" />
        </div>
      </div>
    </AppShell>
  );
}
