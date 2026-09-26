/**
 * شاشات الموقع الإضافية داخل تيليجرام: الإحاطة اليومية، تقويم النشر، الطيار
 * الآلي، ترتيب الكلمات، والزيارات — نفس جداول الموقع ونفس الإجراءات.
 */
import { providerLabel } from "./platforms";
import { publicOrigin } from "./telegram.server";
import { esc, show, type UiCtx } from "./telegram-ui.server";

type Button = { text: string; callback_data?: string; url?: string };
const back = (to = "m"): Button[] => [{ text: "⬅️ رجوع", callback_data: to }, { text: "🏠 القائمة", callback_data: "m" }];
const cut = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
function fmt(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}
const POST_STATUS: Record<string, string> = {
  scheduled: "🗓️ مجدول",
  published: "✅ منشور",
  failed: "⚠️ فشل",
  cancelled: "✖️ ملغي",
  review: "🟡 للمراجعة",
  publishing: "⏳ جارٍ النشر",
};

// ── الإحاطة اليومية (أمَل) ──
export async function viewBriefing(ctx: UiCtx, refresh = false) {
  if (refresh) await show(ctx, "⏳ بجهّز إحاطة النهارده…", []);
  const { ensureTodayBriefing } = await import("./briefing.server");
  const b = await ensureTodayBriefing(ctx.admin, ctx.link.workspace_id, refresh);
  const lines = [
    `<b>☀️ ${esc(b.greeting)}</b>`,
    esc(b.headline),
    "",
    `📊 آخر ٧ أيام: ${b.stats.done7d} مخرج معتمد · ${b.stats.published7d} منشور · ${b.stats.scheduled} مجدول`,
  ];
  if (b.approvals.length) {
    lines.push("", "<b>🟡 بانتظار موافقتك:</b>", ...b.approvals.slice(0, 6).map((a) => `• ${esc(cut(a.title, 70))} — ${esc(a.employee)}`));
  }
  if (b.todayPosts.length) {
    lines.push("", "<b>🗓️ منشورات النهارده:</b>", ...b.todayPosts.slice(0, 6).map((p) => `• ${esc(providerLabel(p.provider))} ${esc(fmt(p.at))} — ${esc(cut(p.title, 60))}`));
  }
  if (b.rankMoves.length) {
    lines.push("", "<b>📈 حركة الترتيب:</b>", ...b.rankMoves.slice(0, 6).map((r) => `• ${esc(r.keyword)}: ${r.from ?? "—"} ← ${r.to ?? "—"} ${r.delta > 0 ? "🔼" : r.delta < 0 ? "🔽" : ""}`));
  }
  if (b.attention.length) lines.push("", "<b>⚠️ محتاج انتباهك:</b>", ...b.attention.slice(0, 5).map((a) => `• ${esc(a)}`));
  if (b.ideas.length) lines.push("", "<b>💡 أفكار النهارده:</b>", ...b.ideas.slice(0, 4).map((i) => `• ${esc(i.title)} — ${esc(cut(i.hook, 90))}`));
  await show(ctx, lines.join("\n"), [
    [{ text: "✅ الموافقات", callback_data: "ap" }, { text: "🗓️ التقويم", callback_data: "zc" }],
    [{ text: "🔄 حدّث الإحاطة", callback_data: "zbr" }],
    back(),
  ]);
}

// ── تقويم/طابور النشر ──
export async function viewCalendar(ctx: UiCtx) {
  const ws = ctx.link.workspace_id;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data } = await ctx.admin
    .from("social_posts")
    .select("id, provider, body, scheduled_at, status")
    .eq("workspace_id", ws)
    .gte("scheduled_at", since)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .limit(12);
  const kb: Button[][] = (data ?? []).map((p) => [
    { text: `${POST_STATUS[p.status]?.slice(0, 2) ?? "•"} ${providerLabel(p.provider)} · ${cut(p.body, 28)}`, callback_data: `zcv:${p.id}` },
  ]);
  kb.push([{ text: "🌐 التقويم الكامل في الموقع", url: `${publicOrigin()}/app/calendar` }]);
  kb.push(back());
  const lines = (data ?? []).map((p) => `${POST_STATUS[p.status] ?? p.status} · <b>${esc(providerLabel(p.provider))}</b> · ${esc(fmt(p.scheduled_at))}\n   ${esc(cut(p.body, 80))}`);
  await show(ctx, ["<b>🗓️ تقويم النشر</b>", lines.length ? lines.join("\n") : "مفيش منشورات مجدولة.", "", "اضغط أي منشور لعرضه أو نشره فوراً أو إلغائه."].join("\n"), kb);
}

async function viewPost(ctx: UiCtx, id: string, note?: string) {
  const { data: p } = await ctx.admin
    .from("social_posts")
    .select("id, provider, body, image_url, scheduled_at, status, last_error, remote_ref, published_at")
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!p) return void (await show(ctx, "المنشور مش موجود.", [back("zc")]));
  const canAct = p.status === "scheduled" || p.status === "failed" || p.status === "review";
  const kb: Button[][] = [];
  if (canAct) kb.push([{ text: "🚀 انشر الآن", callback_data: `zcp:${p.id}` }, { text: "✖️ إلغاء", callback_data: `zcx:${p.id}` }]);
  kb.push(back("zc"));
  await show(
    ctx,
    [
      note ?? "",
      `<b>${esc(providerLabel(p.provider))}</b> · ${POST_STATUS[p.status] ?? esc(p.status)}`,
      `🕒 ${esc(fmt(p.published_at ?? p.scheduled_at))}`,
      p.last_error ? `⚠️ ${esc(cut(p.last_error, 200))}` : "",
      p.image_url ? `🖼️ <a href="${esc(p.image_url)}">الصورة</a>` : "",
      "",
      esc(p.body),
    ]
      .filter((l, i) => l || i > 4)
      .join("\n"),
    kb,
  );
}

async function publishPostNow(ctx: UiCtx, id: string) {
  const ws = ctx.link.workspace_id;
  const { data: claimed } = await ctx.admin
    .from("social_posts")
    .update({ status: "scheduled", scheduled_at: new Date().toISOString(), locked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ws)
    .in("status", ["scheduled", "failed", "review"])
    .select("id")
    .maybeSingle();
  if (!claimed) return "مش متاح للنشر";
  await show(ctx, "⏳ بنشر دلوقتي…", []);
  const { publishQueuedPost } = await import("./social-queue.server");
  const r = await publishQueuedPost(ctx.admin, id);
  await viewPost(ctx, id, r.status === "published" ? "✅ <b>اتنشر.</b>" : `⚠️ <b>${esc(r.error ?? "تعذّر النشر")}</b>`);
  return r.status === "published" ? "اتنشر" : "تعذّر النشر";
}

// ── الطيار الآلي ──
export async function viewAutopilot(ctx: UiCtx) {
  const { data: a } = await ctx.admin.from("social_autopilot").select("*").eq("workspace_id", ctx.link.workspace_id).maybeSingle();
  if (!a) {
    return void (await show(ctx, "<b>🛫 الطيار الآلي</b>\nسِراج يكتب وينشر على حساباتك يومياً في مواعيد ثابتة. اضبطه هنا في دقيقة:", [
      [{ text: "⚙️ اضبط الطيار الآن", callback_data: "zos" }],
      back(),
    ]));
  }
  await show(
    ctx,
    [
      "<b>🛫 الطيار الآلي</b>",
      `الحالة: ${a.active ? "🟢 شغّال" : "⚪ متوقف"}${a.paused_reason ? ` — ${esc(a.paused_reason)}` : ""}`,
      `المنصات: ${esc(a.providers.map(providerLabel).join("، ") || "—")}`,
      `عدد المنشورات يومياً: ${a.posts_per_day} · الوضع: ${a.mode === "auto" ? "نشر تلقائي" : "مراجعة قبل النشر"}`,
      `التشغيلة الجاية: ${esc(fmt(a.next_run_at))}`,
      a.last_run_at ? `آخر تشغيل: ${esc(fmt(a.last_run_at))}${a.last_status ? ` · ${esc(a.last_status)}` : ""}` : "",
      a.brief ? `\n📝 ${esc(cut(a.brief, 300))}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      [{ text: a.active ? "⏸️ إيقاف" : "▶️ تشغيل", callback_data: "zot" }, { text: "⚡ شغّل الآن", callback_data: "zor" }],
      [{ text: "⚙️ تعديل الإعدادات", callback_data: "zos" }],
      back(),
    ],
  );
}

// ── ترتيب الكلمات ──
export async function viewRankings(ctx: UiCtx) {
  const ws = ctx.link.workspace_id;
  const { data: kws } = await ctx.admin
    .from("tracked_keywords")
    .select("id, keyword, domain, last_checked_at")
    .eq("workspace_id", ws)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(15);
  const ids = (kws ?? []).map((k) => k.id);
  const { data: snaps } = ids.length
    ? await ctx.admin.from("rank_snapshots").select("keyword_id, position, captured_at").in("keyword_id", ids).order("captured_at", { ascending: false }).limit(300)
    : { data: [] as { keyword_id: string; position: number | null; captured_at: string }[] };
  const byKw = new Map<string, (number | null)[]>();
  for (const s of snaps ?? []) {
    const arr = byKw.get(s.keyword_id) ?? [];
    if (arr.length < 2) arr.push(s.position);
    byKw.set(s.keyword_id, arr);
  }
  const lines = (kws ?? []).map((k) => {
    const [now, prev] = byKw.get(k.id) ?? [];
    const arrow = now != null && prev != null ? (now < prev ? ` 🔼${prev - now}` : now > prev ? ` 🔽${now - prev}` : " ➖") : "";
    return `• <b>${esc(k.keyword)}</b> — ${now != null ? `#${now}` : "خارج أول ١٠٠"}${arrow}`;
  });
  await show(ctx, ["<b>📈 ترتيب الكلمات في جوجل</b>", lines.length ? lines.join("\n") : "مفيش كلمات متتبعة — اضغط «أضف كلمات».", ""].join("\n"), [
    ...(kws ?? []).slice(0, 8).map((k) => [{ text: `🗑️ ${cut(k.keyword, 30)}`, callback_data: `zkd:${k.id}` }]),
    [{ text: "🔄 حدّث الترتيب", callback_data: "zrr" }, { text: "➕ أضف كلمات", callback_data: "zrk" }],
    [{ text: "🌐 صفحة الترتيب", url: `${publicOrigin()}/app/rankings` }],
    back(),
  ]);
}

// ── زيارات الموقع ──
export async function viewAnalytics(ctx: UiCtx) {
  const ws = ctx.link.workspace_id;
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await ctx.admin.from("site_visits").select("path, source, visitor_hash, created_at").eq("workspace_id", ws).gte("created_at", since).limit(1000);
  const rows = data ?? [];
  const visitors = new Set(rows.map((r) => r.visitor_hash).filter(Boolean)).size;
  const top = (key: "path" | "source") => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = (r[key] as string | null) || (key === "source" ? "مباشر" : "/");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const today = rows.filter((r) => r.created_at >= new Date(Date.now() - 86400_000).toISOString()).length;
  await show(
    ctx,
    [
      "<b>📊 زيارات موقعك — آخر ٧ أيام</b>",
      `👀 ${rows.length} زيارة · 👤 ${visitors} زائر · اليوم: ${today}`,
      "",
      "<b>أكثر الصفحات:</b>",
      ...top("path").map(([k, v]) => `• ${esc(cut(k, 50))} — ${v}`),
      "",
      "<b>المصادر:</b>",
      ...top("source").map(([k, v]) => `• ${esc(k)} — ${v}`),
    ].join("\n"),
    [[{ text: "🌐 التقارير الكاملة", url: `${publicOrigin()}/app` }], back()],
  );
}

/** موجّه أزرار الشاشات الإضافية (البادئة z). يعيد null لو الزر مش تبعها. */
export async function handleExtraCallback(ctx: UiCtx, op: string, a: string): Promise<string | undefined | null> {
  const ws = ctx.link.workspace_id;
  switch (op) {
    case "zb":
      return void (await viewBriefing(ctx));
    case "zbr":
      return void (await viewBriefing(ctx, true));
    case "zc":
      return void (await viewCalendar(ctx));
    case "zcv":
      return void (await viewPost(ctx, a));
    case "zcp":
      return await publishPostNow(ctx, a);
    case "zcx":
      await ctx.admin.from("social_posts").update({ status: "cancelled", locked_at: null }).eq("id", a).eq("workspace_id", ws).in("status", ["scheduled", "failed", "review"]);
      await viewCalendar(ctx);
      return "اتلغى";
    case "zo":
      return void (await viewAutopilot(ctx));
    case "zot": {
      const { data: row } = await ctx.admin.from("social_autopilot").select("id, active").eq("workspace_id", ws).maybeSingle();
      if (row) await ctx.admin.from("social_autopilot").update({ active: !row.active, paused_reason: null }).eq("id", row.id);
      await viewAutopilot(ctx);
      return row ? (row.active ? "اتوقف" : "اتشغّل") : undefined;
    }
    case "zor": {
      const { data: row } = await ctx.admin.from("social_autopilot").select("*").eq("workspace_id", ws).maybeSingle();
      if (!row) return "اضبط الطيار الأول";
      await show(ctx, "⏳ الطيار بيجهّز منشور دلوقتي…", []);
      try {
        const { runAutopilotRow } = await import("./autopilot.server");
        await runAutopilotRow(ctx.admin, row);
        await viewCalendar(ctx);
        return "اتنفّذ";
      } catch (e) {
        await show(ctx, `⚠️ ${esc(e instanceof Error ? e.message : "تعذّر التشغيل")}`, [back("zo")]);
        return;
      }
    }
    case "zr":
      return void (await viewRankings(ctx));
    case "zrr": {
      await show(ctx, "⏳ بفحص الترتيب في جوجل…", []);
      try {
        const [{ data: kws }, { data: gsc }] = await Promise.all([
          ctx.admin.from("tracked_keywords").select("id, keyword, domain, market").eq("workspace_id", ws).eq("active", true).limit(20),
          ctx.admin.from("pipedream_accounts").select("id").eq("workspace_id", ws).eq("provider", "search-console").eq("status", "connected").maybeSingle(),
        ]);
        const { checkRank } = await import("./rank-check.server");
        const now = new Date().toISOString();
        for (const row of kws ?? []) {
          try {
            const r = await checkRank({ workspaceId: ws, keyword: row.keyword, domain: row.domain, market: row.market ?? "EG", gscConnected: Boolean(gsc) });
            await ctx.admin.from("rank_snapshots").insert({
              workspace_id: ws, keyword_id: row.id, position: r.position, url: r.url, captured_at: now, source: r.source,
              clicks: r.clicks ?? null, impressions: r.impressions ?? null, competitors: r.competitors,
            } as never);
            await ctx.admin.from("tracked_keywords").update({ last_checked_at: now }).eq("id", row.id);
            await new Promise((res) => setTimeout(res, 700));
          } catch (e) {
            console.error("[telegram] rank check failed:", e);
          }
        }
      } catch (e) {
        console.error("[telegram] rank refresh failed:", e);
      }
      await viewRankings(ctx);
      return "اتحدّث";
    }
    case "zv":
      return void (await viewAnalytics(ctx));
    default:
      return await handleAccountCallback(ctx, op, a);
  }
}

// ── حسابي: نفس بيانات الملف والعلامة في الموقع (تعديل من الطرفين) ──
const ACCOUNT_FIELDS: Record<string, { label: string; table: "profiles" | "workspaces"; col: string }> = {
  full_name: { label: "الاسم", table: "profiles", col: "full_name" },
  job_title: { label: "المسمى الوظيفي", table: "profiles", col: "job_title" },
  phone: { label: "الهاتف", table: "profiles", col: "phone" },
  name: { label: "اسم النشاط", table: "workspaces", col: "name" },
  industry: { label: "المجال", table: "workspaces", col: "industry" },
  website: { label: "الموقع الإلكتروني", table: "workspaces", col: "website" },
  tone: { label: "نبرة العلامة", table: "workspaces", col: "tone" },
  banned_words: { label: "كلمات ممنوعة (افصلها بفاصلة)", table: "workspaces", col: "banned_words" },
};

async function workspaceOwner(ctx: UiCtx) {
  const { data } = await ctx.admin
    .from("workspaces")
    .select("owner_id, name, industry, website, tone, banned_words")
    .eq("id", ctx.link.workspace_id)
    .maybeSingle();
  return data;
}

export async function viewAccount(ctx: UiCtx, note?: string) {
  const ws = await workspaceOwner(ctx);
  if (!ws) return void (await show(ctx, "مساحة العمل غير موجودة.", [back()]));
  const [{ data: p }, { data: u }] = await Promise.all([
    ctx.admin.from("profiles").select("full_name, job_title, phone").eq("id", ws.owner_id).maybeSingle(),
    ctx.admin.auth.admin.getUserById(ws.owner_id),
  ]);
  const row = (k: string, v: string | null | undefined) => `• ${k}: <b>${esc(v || "—")}</b>`;
  await show(
    ctx,
    [
      note ?? "",
      "<b>👤 حسابي في سهل</b>",
      "نفس الحساب والبيانات على الموقع وتيليجرام — أي تعديل هنا يظهر هناك فوراً والعكس.",
      "",
      row("البريد", u?.user?.email),
      row("الاسم", p?.full_name),
      row("المسمى", p?.job_title),
      row("الهاتف", p?.phone),
      "",
      "<b>🏢 النشاط والعلامة</b>",
      row("اسم النشاط", ws.name),
      row("المجال", ws.industry),
      row("الموقع", ws.website),
      row("النبرة", ws.tone),
      row("كلمات ممنوعة", (ws.banned_words ?? []).join("، ")),
    ].filter((l, i) => i > 0 || l).join("\n"),
    [
      [{ text: "✏️ الاسم", callback_data: "zae:full_name" }, { text: "✏️ المسمى", callback_data: "zae:job_title" }, { text: "✏️ الهاتف", callback_data: "zae:phone" }],
      [{ text: "✏️ اسم النشاط", callback_data: "zae:name" }, { text: "✏️ المجال", callback_data: "zae:industry" }],
      [{ text: "✏️ الموقع", callback_data: "zae:website" }, { text: "✏️ النبرة", callback_data: "zae:tone" }],
      [{ text: "✏️ الكلمات الممنوعة", callback_data: "zae:banned_words" }],
      [{ text: "🔑 ادخل الموقع بضغطة (بدون كلمة سر)", callback_data: "zal" }],
      [{ text: "🔌 فصل تيليجرام عن الحساب", callback_data: "zun" }],
      back(),
    ],
  );
}

async function loginLink(ctx: UiCtx) {
  const ws = await workspaceOwner(ctx);
  if (!ws) return "تعذّر";
  const { data: u } = await ctx.admin.auth.admin.getUserById(ws.owner_id);
  const email = u?.user?.email;
  if (!email) return "مفيش بريد على الحساب";
  const { data, error } = await ctx.admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${publicOrigin()}/app` },
  });
  const url = data?.properties?.action_link;
  if (error || !url) return "تعذّر إنشاء الرابط";
  await show(ctx, "🔑 رابط دخول لمرة واحدة لنفس حسابك على الموقع (صالح لفترة قصيرة، لا تشاركه مع أحد):", [
    [{ text: "🌐 افتح لوحتي في سهل", url }],
    back("za"),
  ]);
  return undefined;
}

/** حفظ قيمة كتبها المستخدم لحقل في حسابي أو كلمة ترتيب جديدة. */
export async function saveExtraText(ctx: UiCtx, kind: string, key: string | undefined, text: string) {
  const v = text.trim();
  if (kind === "kw_add") {
    const ws = await workspaceOwner(ctx);
    const domain = String(ws?.website ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    if (!domain) return void (await show(ctx, "أضف موقعك الإلكتروني أولاً من «حسابي».", [[{ text: "👤 حسابي", callback_data: "za" }], back()]));
    const words = v.split(/[\n،,]/).map((w) => w.trim()).filter(Boolean).slice(0, 10);
    if (words.length) {
      await ctx.admin.from("tracked_keywords").insert(
        words.map((keyword) => ({ workspace_id: ctx.link.workspace_id, keyword: keyword.slice(0, 120), domain, market: "EG" })) as never,
      );
    }
    return void (await viewRankings(ctx));
  }
  if (key === "__ap_brief") {
    await editAutopilot(ctx, "brief", v.slice(0, 4000));
    return void (await viewAutopilotSetup(ctx));
  }
  const f = key ? ACCOUNT_FIELDS[key] : undefined;
  if (!f) return;
  const ws = await workspaceOwner(ctx);
  if (!ws) return;
  const value = f.col === "banned_words" ? v.split(/[\n،,]/).map((w) => w.trim()).filter(Boolean).slice(0, 50) : v.slice(0, 300);
  if (f.table === "profiles") {
    await ctx.admin.from("profiles").update({ [f.col]: value } as never).eq("id", ws.owner_id);
    if (f.col === "full_name") await ctx.admin.auth.admin.updateUserById(ws.owner_id, { user_metadata: { full_name: value } });
  } else {
    await ctx.admin.from("workspaces").update({ [f.col]: value } as never).eq("id", ctx.link.workspace_id);
  }
  await viewAccount(ctx, `✅ اتحفظ «${f.label}» — ظهر على الموقع كمان.\n`);
}

export async function handleAccountCallback(ctx: UiCtx, op: string, a: string): Promise<string | undefined | null> {
  const { writePending } = await import("./telegram-ui.server");
  switch (op) {
    case "za":
      return void (await viewAccount(ctx));
    case "zal":
      return await loginLink(ctx);
    case "zae": {
      const f = ACCOUNT_FIELDS[a];
      if (!f) return null;
      await writePending(ctx.admin, ctx.link, { wait: { kind: "extra_field", id: a } });
      await show(ctx, `✏️ اكتب ${f.label} الجديد:`, [back("za")]);
      return;
    }
    case "zos":
      return void (await viewAutopilotSetup(ctx));
    case "zop":
    case "zon":
    case "zom":
    case "zoi":
    case "zod":
      await editAutopilot(ctx, op, a);
      await viewAutopilotSetup(ctx);
      return "اتحفظ";
    case "zob":
      await writePending(ctx.admin, ctx.link, { wait: { kind: "extra_field", id: "__ap_brief" } });
      await show(ctx, "📝 اكتب لسِراج عن إيه ينشر (المنتجات، العروض، الجمهور، الأسلوب):", [back("zos")]);
      return;
    case "zas": {
      if (!["daily", "weekly", "monthly"].includes(a)) return null;
      const { readPending } = await import("./telegram-ui.server");
      const last = readPending(ctx.link).lastSkill;
      if (!last) return "نفّذ القدرة الأول";
      const { getSkill } = await import("@/data/skills");
      const sk = getSkill(last.id, last.emp);
      const { nextRun } = await import("./automations.functions");
      const tz = "Africa/Cairo";
      const dow = new Date().getDay();
      await ctx.admin.from("automations").insert({
        workspace_id: ctx.link.workspace_id, employee_id: last.emp, skill_id: last.id,
        label: (sk?.title ?? last.id).slice(0, 160), values: last.values, cadence: a,
        day_of_week: dow, hour: 10, timezone: tz, auto_publish: false, active: true,
        next_run_at: nextRun(a as "daily", dow, 10, new Date(), tz).toISOString(),
      } as never);
      await writePending(ctx.admin, ctx.link, { lastSkill: null });
      const { viewAutomations } = await import("./telegram-ui.server");
      await viewAutomations(ctx);
      return "اتجدولت ✅";
    }
    case "zad": {
      await ctx.admin.from("automations").delete().eq("id", a).eq("workspace_id", ctx.link.workspace_id);
      const { viewAutomations } = await import("./telegram-ui.server");
      await viewAutomations(ctx);
      return "اتحذفت";
    }
    case "zkd":
      await ctx.admin.from("tracked_keywords").update({ active: false }).eq("id", a).eq("workspace_id", ctx.link.workspace_id);
      await viewRankings(ctx);
      return "اتشالت";
    case "zun":
      await show(ctx, "متأكد إنك عايز تفصل تيليجرام عن حسابك في سهل؟ حسابك وبياناتك هيفضلوا زي ما هم على الموقع.", [
        [{ text: "✅ أيوه افصل", callback_data: "zuy" }, { text: "↩️ لا", callback_data: "za" }],
      ]);
      return;
    case "zuy":
      await ctx.admin.from("command_links").delete().eq("id", ctx.link.id);
      await show(ctx, "تم الفصل 👋 ابعت /start في أي وقت للربط من جديد أو إنشاء حساب.", []);
      return "اتفصل";
    case "zrk":
      await writePending(ctx.admin, ctx.link, { wait: { kind: "kw_add" } });
      await show(ctx, "اكتب الكلمات المفتاحية اللي عايز نتتبعها (كل كلمة في سطر أو افصلها بفاصلة):", [back("zr")]);
      return;
    default:
      return null;
  }
}

// ── ضبط الطيار الآلي من تيليجرام (نفس صف الموقع social_autopilot) ──
const AP_PROVIDERS = ["instagram", "facebook", "x", "linkedin", "tiktok", "threads"];
const AP_SLOTS: Record<string, string[]> = { "1": ["19:00"], "2": ["12:00", "20:00"], "3": ["10:00", "15:00", "21:00"], "4": ["09:00", "13:00", "17:00", "21:00"] };
const DIALECTS = ["خليجية", "مصرية", "شامية", "فصحى"];

async function autopilotRow(ctx: UiCtx) {
  const ws = ctx.link.workspace_id;
  const { data } = await ctx.admin.from("social_autopilot").select("*").eq("workspace_id", ws).maybeSingle();
  if (data) return data;
  const { data: prof } = await ctx.admin.from("workspaces").select("owner_id").eq("id", ws).maybeSingle();
  const { data: p } = prof ? await ctx.admin.from("profiles").select("dialect").eq("id", prof.owner_id).maybeSingle() : { data: null };
  const { nextRun } = await import("./autopilot.server");
  const slots = AP_SLOTS["1"]!;
  const days = [0, 1, 2, 3, 4, 5, 6];
  const { data: row } = await ctx.admin
    .from("social_autopilot")
    .insert({
      workspace_id: ws, employee_id: "sonny", active: false, providers: [], brief: "",
      dialect: p?.dialect ?? "خليجية", posts_per_day: 1, hours: [19], slots, days,
      timezone: "Asia/Riyadh", mode: "review", with_image: true,
      next_run_at: nextRun({ slots, days, timezone: "Asia/Riyadh" }).toISOString(),
    } as never)
    .select("*")
    .single();
  return row!;
}

async function editAutopilot(ctx: UiCtx, op: string, a: string) {
  const row = await autopilotRow(ctx);
  const patch: Record<string, unknown> = {};
  if (op === "zop") {
    const set = new Set(row.providers);
    if (set.has(a)) set.delete(a); else set.add(a);
    patch["providers"] = [...set];
  } else if (op === "zon" && AP_SLOTS[a]) {
    const { nextRun } = await import("./autopilot.server");
    const slots = AP_SLOTS[a]!;
    Object.assign(patch, {
      slots, posts_per_day: slots.length, hours: slots.map((x) => Number(x.slice(0, 2))),
      next_run_at: nextRun({ slots, days: row.days, timezone: row.timezone }).toISOString(),
    });
  } else if (op === "zom") patch["mode"] = row.mode === "auto" ? "review" : "auto";
  else if (op === "zoi") patch["with_image"] = !row.with_image;
  else if (op === "zod") patch["dialect"] = DIALECTS[(DIALECTS.indexOf(row.dialect) + 1) % DIALECTS.length];
  else if (op === "brief") patch["brief"] = a;
  patch["paused_reason"] = null;
  await ctx.admin.from("social_autopilot").update(patch as never).eq("id", row.id);
}

export async function viewAutopilotSetup(ctx: UiCtx) {
  const r = await autopilotRow(ctx);
  const count = String(r.slots.length);
  await show(
    ctx,
    [
      "<b>⚙️ ضبط الطيار الآلي</b>",
      "نفس إعدادات صفحة الطيار في الموقع — أي تغيير يظهر هناك فوراً.",
      "",
      `المنصات: <b>${esc(r.providers.map(providerLabel).join("، ") || "لم تختر")}</b>`,
      `المواعيد: <b>${esc(r.slots.join(" · "))}</b> (${esc(r.timezone)})`,
      `الوضع: <b>${r.mode === "auto" ? "نشر تلقائي" : "مراجعة قبل النشر"}</b> · صورة: <b>${r.with_image ? "نعم" : "لا"}</b> · اللهجة: <b>${esc(r.dialect)}</b>`,
      `📝 ${esc(cut(r.brief, 200) || "اكتب لسِراج عن إيه ينشر")}`,
    ].join("\n"),
    [
      AP_PROVIDERS.slice(0, 3).map((p) => ({ text: `${r.providers.includes(p) ? "✅" : "▫️"} ${providerLabel(p)}`, callback_data: `zop:${p}` })),
      AP_PROVIDERS.slice(3).map((p) => ({ text: `${r.providers.includes(p) ? "✅" : "▫️"} ${providerLabel(p)}`, callback_data: `zop:${p}` })),
      Object.keys(AP_SLOTS).map((k) => ({ text: `${k === count ? "● " : ""}${k}/يوم`, callback_data: `zon:${k}` })),
      [
        { text: r.mode === "auto" ? "🤖 تلقائي" : "👀 مراجعة", callback_data: "zom" },
        { text: r.with_image ? "🖼️ بصورة" : "📝 بدون صورة", callback_data: "zoi" },
        { text: `🗣️ ${r.dialect}`, callback_data: "zod" },
      ],
      [{ text: "📝 موضوع المنشورات", callback_data: "zob" }],
      [{ text: r.active ? "⏸️ إيقاف" : "▶️ تشغيل الطيار", callback_data: "zot" }, { text: "⬅️ الطيار", callback_data: "zo" }],
    ],
  );
}
