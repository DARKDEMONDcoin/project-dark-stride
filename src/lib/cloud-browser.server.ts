/**
 * متصفح سحابي مشترك لكل الموظفين (Browserbase عبر CDP مباشر — بلا Playwright،
 * لأن الخادم لا يشغّل Chromium محلياً).
 *
 * المرحلة الحالية: قراءة المواقع الديناميكية كما يراها المستخدم + لقطة شاشة.
 * أي إجراء حساس (دفع/حجز/إرسال نموذج/تسجيل) لا يُنفَّذ آلياً: يُصنَّف "high"
 * ويتوقف عند طلب موافقة المالك.
 */
import { getSecrets } from "./secrets.server";

const BB = "https://api.browserbase.com/v1";

export type BrowserRisk = "low" | "medium" | "high";

/** يصنّف نية الطلب: القراءة آمنة، الإرسال/الدفع يحتاج موافقة. */
export function classifyBrowserRisk(request: string): BrowserRisk {
  const t = request.toLowerCase();
  if (/(ادفع|دفع|اشتري|اشترِ|شراء|احجز|حجز|اطلب لي|checkout|pay|buy|purchase|book|order)/i.test(t)) return "high";
  if (/(سجّل|سجل لي|اشترك|ارسل النموذج|املأ|submit|sign ?up|register|apply)/i.test(t)) return "medium";
  return "low";
}

type Cdp = {
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>;
  close: () => void;
};

function connectCdp(url: string): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
    const timer = setTimeout(() => reject(new Error("cdp connect timeout")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({
        send: (method, params = {}, sessionId) =>
          new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
            setTimeout(() => {
              if (pending.delete(mid)) rej(new Error(`cdp timeout: ${method}`));
            }, 30_000);
          }),
        close: () => {
          try { ws.close(); } catch { /* ignore */ }
        },
      });
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (typeof msg.id !== "number") return;
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message ?? "cdp error"));
        else p.res(msg.result);
      } catch { /* ignore */ }
    });
    ws.addEventListener("error", () => reject(new Error("cdp socket error")));
  });
}

export type BrowsedPage = { url: string; title: string; text: string; screenshotUrl: string | null };

async function uploadShot(base64: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `browser/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const up = await supabaseAdmin.storage.from("nour-media").upload(path, bytes, { contentType: "image/jpeg" });
    if (up.error) return null;
    const signed = await supabaseAdmin.storage.from("nour-media").createSignedUrl(path, 60 * 60 * 24 * 7);
    return signed.data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** يفتح الرابط في متصفح سحابي حقيقي ويعيد النص المعروض ولقطة شاشة. للقراءة فقط. */
export async function browsePage(url: string, opts: { screenshot?: boolean } = {}): Promise<BrowsedPage | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const s = await getSecrets(["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] as const).catch(() => null);
  const apiKey = s?.BROWSERBASE_API_KEY;
  const projectId = s?.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  const created = await fetch(`${BB}/sessions`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, timeout: 120 }),
  });
  if (!created.ok) {
    console.warn("[browser] session create failed", created.status);
    return null;
  }
  const session = (await created.json()) as { id: string; connectUrl: string };
  let cdp: Cdp | null = null;
  try {
    cdp = await connectCdp(session.connectUrl);
    const { targetInfos } = await cdp.send("Target.getTargets");
    let targetId = (targetInfos as { type: string; targetId: string }[]).find((t) => t.type === "page")?.targetId;
    if (!targetId) targetId = (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Page.navigate", { url }, sessionId);
    // انتظار تحميل المحتوى الديناميكي.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 750));
      const st = await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, sessionId);
      if (st?.result?.value === "complete" && i >= 3) break;
    }
    const ev = await cdp.send(
      "Runtime.evaluate",
      { expression: "JSON.stringify({t:document.title,u:location.href,x:(document.body&&document.body.innerText)||''})", returnByValue: true },
      sessionId,
    );
    const parsed = JSON.parse(ev?.result?.value ?? "{}") as { t?: string; u?: string; x?: string };
    let screenshotUrl: string | null = null;
    if (opts.screenshot) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }, sessionId).catch(() => null);
      if (shot?.data) screenshotUrl = await uploadShot(shot.data);
    }
    const text = (parsed.x ?? "").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 50) return null;
    return { url: parsed.u ?? url, title: parsed.t || url, text: text.slice(0, 20_000), screenshotUrl };
  } catch (e) {
    console.warn("[browser] failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    cdp?.close();
    await fetch(`${BB}/sessions/${session.id}`, {
      method: "POST",
      headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    }).catch(() => null);
  }
}

export type FillResult = { url: string; submitted: boolean; blocked?: string; filled: string[]; missed: string[]; screenshotUrl: string | null; pageText: string };

/**
 * يملأ نموذجاً على موقع خارجي (بعد موافقة المالك فقط — يُستدعى من مسار الإجراءات المعتمدة).
 * حماية ثابتة: إن وُجدت حقول بطاقة دفع لا يُرسل شيء أبداً، ويعيد لقطة للمالك ليكمل بنفسه.
 * `fields`: سطر لكل حقل بصيغة «اسم الحقل = القيمة».
 */
export async function fillForm(url: string, fields: string, opts: { submit: boolean }): Promise<FillResult> {
  if (!/^https?:\/\//i.test(url)) throw new Error("رابط غير صالح.");
  const s = await getSecrets(["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] as const);
  const apiKey = s.BROWSERBASE_API_KEY;
  const projectId = s.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) throw new Error("المتصفح السحابي غير مهيأ.");
  const pairs = fields
    .split(/\n|؛|;/)
    .map((l) => l.split(/[=:]/))
    .filter((p) => p.length >= 2 && p[0]!.trim())
    .map((p) => [p[0]!.trim(), p.slice(1).join(":").trim()] as [string, string]);

  const created = await fetch(`${BB}/sessions`, {
    method: "POST",
    headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, timeout: 180 }),
  });
  if (!created.ok) throw new Error("تعذّر فتح المتصفح السحابي الآن.");
  const session = (await created.json()) as { id: string; connectUrl: string };
  let cdp: Cdp | null = null;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    cdp = await connectCdp(session.connectUrl);
    const { targetInfos } = await cdp.send("Target.getTargets");
    let targetId = (targetInfos as { type: string; targetId: string }[]).find((t) => t.type === "page")?.targetId;
    if (!targetId) targetId = (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const evalJs = async (expression: string) =>
      (await cdp!.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Page.navigate", { url }, sessionId);
    await wait(4000);

    const fillScript = `(() => {
      const pairs = ${JSON.stringify(pairs)};
      const norm = (t) => (t || '').toString().trim().toLowerCase();
      const els = [...document.querySelectorAll('input, textarea, select')].filter(e => e.type !== 'hidden');
      const cardField = els.some(e => /cc-|card|cvc|cvv/i.test((e.autocomplete||'') + ' ' + (e.name||'') + ' ' + (e.id||'')));
      if (cardField) return { blocked: 'payment', filled: [], missed: pairs.map(p => p[0]) };
      const labelOf = (e) => {
        const l = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]');
        return [e.name, e.id, e.placeholder, e.getAttribute('aria-label'), l && l.innerText, e.closest('label') && e.closest('label').innerText].map(norm).join(' | ');
      };
      const filled = [], missed = [];
      for (const [k, v] of pairs) {
        const key = norm(k);
        const el = els.find(e => labelOf(e).includes(key));
        if (!el) { missed.push(k); continue; }
        if (el.tagName === 'SELECT') {
          const o = [...el.options].find(o => norm(o.text).includes(norm(v)) || norm(o.value) === norm(v));
          if (o) el.value = o.value; else { missed.push(k); continue; }
        } else if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = /^(1|yes|true|نعم)$/i.test(v);
        } else {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push(k);
      }
      return { filled, missed };
    })()`;
    const r = (await evalJs(fillScript)) as { blocked?: string; filled: string[]; missed: string[] };
    let submitted = false;
    let blocked = r.blocked;
    if (!blocked && opts.submit && r.filled.length) {
      const clicked = await evalJs(`(() => {
        const txt = (b) => (b.innerText || b.value || '').toLowerCase();
        const btns = [...document.querySelectorAll('button, input[type=submit]')];
        if (btns.some(b => /(pay|buy now|place order|ادفع|إتمام الشراء|تأكيد الدفع)/i.test(txt(b)))) return 'payment';
        const b = btns.find(b => b.type === 'submit') || btns.find(b => /(submit|send|sign up|register|continue|إرسال|تسجيل|متابعة)/i.test(txt(b)));
        if (!b) return 'none';
        b.click(); return 'ok';
      })()`);
      if (clicked === "payment") blocked = "payment";
      else if (clicked === "ok") { submitted = true; await wait(4000); }
    }
    const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }, sessionId).catch(() => null);
    const screenshotUrl = shot?.data ? await uploadShot(shot.data) : null;
    const after = (await evalJs("JSON.stringify({u:location.href,x:(document.body&&document.body.innerText||'').slice(0,1500)})")) as string;
    const p = JSON.parse(after || "{}") as { u?: string; x?: string };
    return { url: p.u ?? url, submitted, ...(blocked ? { blocked } : {}), filled: r.filled, missed: r.missed, screenshotUrl, pageText: p.x ?? "" };
  } finally {
    cdp?.close();
    await fetch(`${BB}/sessions/${session.id}`, {
      method: "POST",
      headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
    }).catch(() => null);
  }
}
