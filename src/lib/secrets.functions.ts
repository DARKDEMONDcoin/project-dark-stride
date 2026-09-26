/** فحص آمن لحالة مفاتيح المنصة؛ لا يعيد قيمها إلى المتصفح. */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const KNOWN_SECRETS = [
  { name: "GEMINI_API_KEY", label: "Gemini (كتابة وتحليل ذكي)" },
  { name: "OPENROUTER_API_KEY", label: "OpenRouter (بديل احتياطي للذكاء)" },
  { name: "GOOGLE_OAUTH_CLIENT_ID", label: "Google OAuth — المعرّف" },
  { name: "GOOGLE_OAUTH_CLIENT_SECRET", label: "Google OAuth — السر" },
  { name: "PIPEDREAM_CLIENT_ID", label: "Pipedream — المعرّف" },
  { name: "PIPEDREAM_CLIENT_SECRET", label: "Pipedream — السر" },
  { name: "PIPEDREAM_PROJECT_ID", label: "Pipedream — المشروع" },
  { name: "PIPEDREAM_ENVIRONMENT", label: "Pipedream — البيئة" },
  { name: "PIPEDREAM_WEBHOOK_SECRET", label: "Pipedream — سر الويبهوك" },
  {
    name: "PIPEDREAM_OAUTH_APP_FACEBOOK",
    label: "تطبيق ميتا الخاص بكم (OAuth Client ID في Pipedream) — لازم لنشر فيسبوك",
  },
  {
    name: "PIPEDREAM_OAUTH_APP_INSTAGRAM",
    label: "تطبيق ميتا الخاص بكم — لازم لنشر إنستجرام",
  },
] as const;

/** يعيد الأسماء والحالة فقط؛ لا يعيد أي جزء من قيم المفاتيح إلى المتصفح. */
export const listSecrets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getSecrets } = await import("./secrets.server");
    const names = KNOWN_SECRETS.map((item) => item.name);
    const values = await getSecrets(names);
    const stored = KNOWN_SECRETS.filter((item) => Boolean(values[item.name])).map((item) => ({
      name: item.name,
      preview: "محفوظ بأمان",
      updatedAt: null,
    }));
    const storedNames = new Set(stored.map((s) => s.name));

    return {
      stored,
      missing: KNOWN_SECRETS.filter((k) => !storedNames.has(k.name)).map((k) => ({ ...k })),
    };
  });

/** اختبار عملي: هل الذكاء الاصطناعي يردّ بالمفاتيح المحفوظة الآن؟ */
export const testAiProviders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { providerKeys } = await import("./provider-keys.server");
    const keys = await providerKeys();
    if (!keys.gemini && !keys.openrouter) {
      return { ok: false, message: "لا يوجد مفتاح ذكاء اصطناعي مضبوط في مفاتيح المنصة." };
    }
    try {
      const { freeChat } = await import("./nour-research.server");
      const reply = await freeChat("", [{ role: "user", content: "قل: تم" }], {
        maxTokens: 16,
        race: false,
      });
      return { ok: true, message: `المزوّد يعمل ✅ — الرد: ${reply.slice(0, 60)}` };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });
