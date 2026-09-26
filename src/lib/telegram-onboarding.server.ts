/**
 * تسجيل مباشر من داخل بوت تيليجرام: حساب سهل كامل (نفس حساب الموقع) بدون فتح الموقع
 * أو نسخ أي كود. الحالة المؤقتة تُحفظ في telegram_onboarding (خادمي فقط).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type Ctx = { admin: Admin; botToken: string; chatId: number };
type Btn = { text: string; callback_data?: string; url?: string };

const INDUSTRIES = ["مطاعم وكافيهات", "متجر إلكتروني", "عقارات", "عيادات وصحة", "تعليم", "خدمات", "تقنية", "عام"];

async function send(ctx: Ctx, text: string, rows?: Btn[][]) {
  const { tg } = await import("./telegram.server");
  await tg(ctx.botToken, "sendMessage", {
    chat_id: ctx.chatId,
    text,
    disable_web_page_preview: true,
    ...(rows ? { reply_markup: { inline_keyboard: rows } } : {}),
  }).catch((e: unknown) => console.error("[tg-onboarding] send failed:", e));
}

async function getState(ctx: Ctx) {
  const { data } = await ctx.admin
    .from("telegram_onboarding")
    .select("step, data, tg_name")
    .eq("chat_id", String(ctx.chatId))
    .maybeSingle();
  return data as { step: string; data: Record<string, string>; tg_name: string | null } | null;
}

async function setState(ctx: Ctx, step: string, data: Record<string, string>, tgName?: string) {
  await ctx.admin.from("telegram_onboarding").upsert(
    {
      chat_id: String(ctx.chatId),
      step,
      data,
      ...(tgName ? { tg_name: tgName.slice(0, 80) } : {}),
    },
    { onConflict: "chat_id" },
  );
}

async function clearState(ctx: Ctx) {
  await ctx.admin.from("telegram_onboarding").delete().eq("chat_id", String(ctx.chatId));
}

async function welcome(ctx: Ctx, firstName?: string) {
  await setState(ctx, "welcome", {}, firstName);
  await send(
    ctx,
    [
      `أهلاً بك${firstName ? ` يا ${firstName}` : ""} في سهل 👋`,
      "",
      "هنا يعمل معك فريق من 6 موظفين بالذكاء الاصطناعي، كل واحد متخصص في جزء من شغلك:",
      "",
      "📱 سِراج — السوشيال ميديا",
      "🔎 نور — المحتوى والسيو",
      "🎨 دانة — التصميم والهوية",
      "💼 سالم — المبيعات والعملاء",
      "📅 أمَل — التنظيم والمساعدة التنفيذية",
      "📊 آدم — البيانات والإعلانات",
      "",
      "اكتب طلبك مباشرة، مثل:",
      "«يا نور، ابحثي عن أهم كلمات يبحث عنها عملائي»",
      "«يا سِراج، جهّز لي منشوراً عن المنتج الجديد»",
      "«يا أمَل، رتّبي لي مهامي هذا الأسبوع»",
      "",
      "ستراجع أي خطوة حساسة قبل تنفيذها، وكل شيء سيظل متزامناً مع حسابك على موقع سهل.",
    ].join("\n"),
    [
      [{ text: "🚀 ابدأ مجاناً", callback_data: "ob:new" }],
      [{ text: "🔗 لدي حساب بالفعل", callback_data: "ob:have" }],
    ],
  );
}

async function askName(ctx: Ctx, data: Record<string, string>, tgName?: string | null) {
  await setState(ctx, "name", data);
  await send(
    ctx,
    "الخطوة ١ من ٤ — ما اسمك الكريم؟",
    tgName ? [[{ text: `استخدم «${tgName}»`, callback_data: "ob:name:tg" }]] : undefined,
  );
}

async function askCompany(ctx: Ctx, data: Record<string, string>) {
  await setState(ctx, "company", data);
  await send(ctx, `تشرّفنا يا ${data["full_name"]} 🌿\nالخطوة ٢ من ٤ — ما اسم نشاطك أو شركتك؟`);
}

async function askIndustry(ctx: Ctx, data: Record<string, string>) {
  await setState(ctx, "industry", data);
  const rows: Btn[][] = [];
  for (let i = 0; i < INDUSTRIES.length; i += 2) {
    rows.push(
      INDUSTRIES.slice(i, i + 2).map((x, j) => ({ text: x, callback_data: `ob:ind:${i + j}` })),
    );
  }
  await send(ctx, "الخطوة ٣ من ٤ — ما مجال نشاطك؟ اختر أو اكتبه بنفسك:", rows);
}

async function askEmail(ctx: Ctx, data: Record<string, string>) {
  await setState(ctx, "email", data);
  await send(
    ctx,
    "الخطوة ٤ من ٤ — بريدك الإلكتروني؟\n(للدخول لنفس الحساب من الموقع لاحقاً — لن نرسل لك رسائل مزعجة)",
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function randomPassword() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("") + "Aa1!";
}

async function createAccount(ctx: Ctx, data: Record<string, string>) {
  const { admin } = ctx;
  const email = data["email"]!.toLowerCase();
  await send(ctx, "⏳ لحظات… نجهّز مساحة عملك وفريقك.");

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: {
      full_name: data["full_name"],
      company: data["company"],
      industry: data["industry"] ?? "عام",
      signup_source: "telegram",
    },
  });
  if (error || !created.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    await setState(ctx, "email", data);
    await send(
      ctx,
      exists
        ? "هذا البريد مسجّل في سهل بالفعل. اكتب بريداً آخر، أو اربط حسابك الحالي بضغطة:"
        : `تعذّر إنشاء الحساب: ${(error?.message ?? "").slice(0, 150)}\nاكتب بريدك مرة أخرى.`,
      exists ? [[{ text: "🔗 ربط حسابي الحالي", callback_data: "ob:have" }]] : undefined,
    );
    return;
  }

  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", created.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!ws) {
    await send(ctx, "تم إنشاء الحساب لكن تعذّر تجهيز مساحة العمل. جرّب /start مرة أخرى بعد قليل.");
    return;
  }

  const { ensureCommandLink, publicOrigin } = await import("./telegram.server");
  await ensureCommandLink(admin, ws.id, String(ctx.chatId), data["full_name"] ?? "تيليجرام");
  await clearState(ctx);

  let loginUrl = `${publicOrigin()}/auth`;
  try {
    const { data: link } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${publicOrigin()}/` },
    });
    if (link?.properties?.action_link) loginUrl = link.properties.action_link;
  } catch {
    /* رابط الدخول اختياري */
  }

  await send(
    ctx,
    [
      `🎉 أهلاً بك في سهل يا ${data["full_name"]}!`,
      `مساحة «${data["company"]}» جاهزة، والفريق كله تحت أمرك من هنا مباشرة.`,
      "",
      "جرّب الآن أي طلب، مثلاً:",
      "• «يا سِراج اكتب ٣ بوستات إنستجرام لعرض الأسبوع»",
      "• «يا نور اكتب مقال سيو عن …»",
      "• «يا دانا صمّم بوستر لافتتاح الفرع»",
      "",
      "💡 نصيحة: اربط حساباتك (إنستجرام، جيميل…) من /menu ← التكاملات ليبدأ الفريق بالنشر فعلياً.",
    ].join("\n"),
    [
      [{ text: "📋 افتح القائمة الرئيسية", callback_data: "m" }],
      [{ text: "🌐 افتح لوحتك على الموقع (دخول تلقائي)", url: loginUrl }],
    ],
  );
}

async function explainHave(ctx: Ctx) {
  const { publicOrigin } = await import("./telegram.server");
  await setState(ctx, "have", {});
  await send(
    ctx,
    [
      "لربط حسابك الحالي بضغطة واحدة:",
      "١) افتح سهل ← الإعدادات ← تيليجرام",
      "٢) اضغط «اربط تيليجرام بضغطة» — سيفتح البوت ويتم الربط تلقائياً.",
      "",
      "أو أرسل هنا كود الربط المكوّن من ٦ رموز إن كان معك.",
    ].join("\n"),
    [
      [{ text: "🌐 فتح إعدادات تيليجرام في سهل", url: `${publicOrigin()}/app/settings` }],
      [{ text: "↩️ رجوع", callback_data: "ob:back" }],
    ],
  );
}

/** ربط المحادثة بكود (من رابط /start أو مكتوب يدوياً). يعيد true عند النجاح. */
export async function redeemLinkCode(ctx: Ctx, raw: string): Promise<"ok" | "invalid"> {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { admin } = ctx;
  const { data: row } = await admin
    .from("command_link_codes")
    .select("code, workspace_id, role, label, expires_at, used_at")
    .eq("code", code)
    .eq("channel", "telegram")
    .maybeSingle();
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return "invalid";
  await admin.from("command_links").upsert(
    {
      workspace_id: row.workspace_id,
      channel: "telegram",
      external_id: String(ctx.chatId),
      role: row.role,
      label: row.label,
      status: "active",
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "channel,external_id" },
  );
  await admin.from("command_link_codes").update({ used_at: new Date().toISOString() }).eq("code", row.code);
  await clearState(ctx);
  await send(
    ctx,
    [
      "✅ تم ربط تيليجرام بحسابك في سهل — كل شيء متزامن الآن مع الموقع.",
      "اكتب طلبك مباشرة، مثال: «يا سِراج اكتب بوست عن عرض نهاية الأسبوع».",
    ].join("\n"),
    [[{ text: "📋 افتح القائمة الرئيسية", callback_data: "m" }]],
  );
  return "ok";
}

/** رسالة نصية من محادثة غير مربوطة. */
export async function handleOnboardingMessage(ctx: Ctx, text: string, firstName?: string) {
  const t = text.trim();
  if (t.startsWith("/start")) {
    const payload = t.slice(6).trim();
    if (payload && (await redeemLinkCode(ctx, payload)) === "ok") return;
    if (payload) await send(ctx, "رابط الربط انتهت صلاحيته — لا مشكلة، يمكنك البدء من هنا:");
    return welcome(ctx, firstName);
  }

  const state = await getState(ctx);
  const data = state?.data ?? {};
  const step = state?.step ?? "";

  if (/^[A-Za-z0-9]{6}$/.test(t) && (step === "" || step === "welcome" || step === "have")) {
    if ((await redeemLinkCode(ctx, t)) === "ok") return;
    if (step === "have") return send(ctx, "الكود غير صحيح أو انتهت صلاحيته. أنشئ كوداً جديداً من الموقع.");
  }

  if (/^\/(cancel|الغاء|إلغاء)/.test(t)) {
    await clearState(ctx);
    return welcome(ctx, firstName);
  }

  switch (step) {
    case "name":
      if (t.length < 2 || t.length > 60) return send(ctx, "اكتب اسمك (من ٢ إلى ٦٠ حرفاً).");
      return askCompany(ctx, { ...data, full_name: t });
    case "company":
      if (t.length < 2 || t.length > 80) return send(ctx, "اكتب اسم النشاط (من ٢ إلى ٨٠ حرفاً).");
      return askIndustry(ctx, { ...data, company: t });
    case "industry":
      return askEmail(ctx, { ...data, industry: t.slice(0, 60) });
    case "email":
      if (!EMAIL_RE.test(t)) return send(ctx, "البريد غير صحيح، اكتبه بهذا الشكل: name@example.com");
      return createAccount(ctx, { ...data, email: t });
    default:
      return welcome(ctx, firstName);
  }
}

/** ضغطة زر ob:* من محادثة غير مربوطة. يعيد نص تنبيه قصير اختياري. */
export async function handleOnboardingCallback(ctx: Ctx, cbData: string): Promise<string | undefined> {
  const state = await getState(ctx);
  const data = state?.data ?? {};
  if (cbData === "ob:new") {
    await askName(ctx, {}, state?.tg_name);
    return;
  }
  if (cbData === "ob:have") {
    await explainHave(ctx);
    return;
  }
  if (cbData === "ob:back") {
    await welcome(ctx, state?.tg_name ?? undefined);
    return;
  }
  if (cbData === "ob:name:tg" && state?.tg_name) {
    await askCompany(ctx, { ...data, full_name: state.tg_name });
    return;
  }
  if (cbData.startsWith("ob:ind:") && state?.step === "industry") {
    const ind = INDUSTRIES[Number(cbData.slice(7))] ?? "عام";
    await askEmail(ctx, { ...data, industry: ind });
    return;
  }
  if (!cbData.startsWith("ob:")) {
    await welcome(ctx, state?.tg_name ?? undefined);
    return "أنشئ حسابك أولاً — أقل من دقيقة.";
  }
  return;
}
