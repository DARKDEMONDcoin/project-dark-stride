/**
 * غلاف ثابت لكل شاشات المحادثة — الشريط الجانبي والشريط العلوي لا يُعاد بناؤهما
 * عند التنقل بين الموظفين؛ يتغيّر عمود المحادثة الأوسط وحده (تجربة واتساب).
 * الصفحات الداخلية تنشر عنوانها وأزرارها هنا عبر ChatShellMeta و ChatShellActions.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { AppShell } from "@/components/app/AppShell";

type ShellMeta = {
  title: string;
  lead?: string;
  padded?: boolean;
  compactTitle?: boolean;
};

const ShellContext = createContext<{
  setMeta: (meta: ShellMeta) => void;
  slot: HTMLElement | null;
} | null>(null);

export function ChatShellHost({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<ShellMeta>({ title: "المحادثات" });
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <ShellContext.Provider value={{ setMeta, slot }}>
      <AppShell
        title={meta.title}
        {...(meta.lead ? { lead: meta.lead } : {})}
        padded={meta.padded ?? true}
        compactTitle={meta.compactTitle ?? false}
        actions={<span ref={setSlot} className="contents" />}
      >
        {children}
      </AppShell>
    </ShellContext.Provider>
  );
}

/** تنشر الصفحة عنوانها ووصفها في الشريط العلوي الثابت. */
export function ChatShellMeta({ title, lead, padded, compactTitle }: ShellMeta) {
  const ctx = useContext(ShellContext);
  const setMeta = ctx?.setMeta;
  useEffect(() => {
    setMeta?.({
      title,
      ...(lead ? { lead } : {}),
      ...(padded === undefined ? {} : { padded }),
      ...(compactTitle === undefined ? {} : { compactTitle }),
    });
  }, [setMeta, title, lead, padded, compactTitle]);
  return null;
}

/** تعرض أزرار الصفحة داخل الشريط العلوي الثابت بلا إعادة بنائه. */
export function ChatShellActions({ children }: { children: ReactNode }) {
  const ctx = useContext(ShellContext);
  if (!ctx?.slot) return null;
  return createPortal(children, ctx.slot);
}
