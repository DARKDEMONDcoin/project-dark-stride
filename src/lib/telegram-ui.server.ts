/**
 * واجهة سهل الكاملة داخل تيليجرام: قوائم وأزرار تفاعلية تعرض وتدير نفس بيانات
 * الموقع بالظبط (نفس الجداول، نفس مساحة العمل) — المحادثات، المهام، الموافقات،
 * التكاملات، المقترحات، القرارات، المعرفة، الأتمتة، والإعدادات.
 * أي تغيير هنا يظهر في الموقع فوراً، وأي تغيير في الموقع يظهر هنا.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { providerLabel } from "./platforms";
import { extractPostMedia } from "./post-format";
import { publicOrigin, tg } from "./telegram.server";
import { TEAM, byId } from "./telegram-format";
import { skillsFor, getSkill } from "@/data/skills";

type Admin = SupabaseClient<Database>;
type Button = { text: string; callback_data?: string; url?: string };
type Kb = Button[][];

export type LinkRow = {
  id: string;
  workspace_id: string;
  active_employee: string | null;
  conversation_ids: Json;
  pending_input: Json | null;
};

export type UiCtx = {
  admin: Admin;
  botToken: string;
  chatId: number;
  link: LinkRow;
  /** رسالة الأزرار التي ضُغطت — نحرّرها بدل إرسال رسالة جديدة. */
  messageId?: number | undefined;
};

export type PendingState = {
  wait?: { kind: "edit_task" | "brain_note" | "reject_reason" | "skill_field" | "extra_field" | "kw_add"; id?: string } | null;
  /** نموذج قدرة قيد التعبئة — نفس قدرات الموقع حرفياً. */
  skill?: { emp: string; id: string; i: number; values: Record<string, string> } | null;
  action?: {
    id: string;
    provider: string;
    label: string;
    values: Record<string, string>;
    employeeId: string;
  } | null;
  quiet?: { id: string; at: number } | null;
  /** آخر قدرة نُفّذت — لتحويلها لجدولة تلقائية بضغطة. */
  lastSkill?: { emp: string; id: string; values: Record<string, string> } | null;
  busyUntil?: number | null;
};

export const esc = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const cut = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const empName = (id: string | null | undefined) => byId(String(id ?? ""))?.name ?? String(id ?? "الفريق");

const STATUS_LABEL: Record<string, string> = {
  running: "⚙️ قيد التنفيذ",
  review: "🟡 بانتظار مراجعتك",
  queued: "⏳ في الانتظار",
  paused: "⏸️ متوقفة",
  done: "✅ منتهية",
  rejected: "✖️ مرفوضة",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

const back = (to = "m"): Button[] => [{ text: "⬅️ رجوع", callback_data: to }, { text: "🏠 القائمة", callback_data: "m" }];

export function readPending(link: LinkRow): PendingState {
  const raw = link.pending_input;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as unknown as PendingState) : {};
}

export async function writePending(admin: Admin, link: LinkRow, patch: Partial<PendingState>) {
  const next = { ...readPending(link), ...patch };
  link.pending_input = next as unknown as Json;
  await admin.from("command_links").update({ pending_input: next as unknown as Json }).eq("id", link.id);
}

/** يعرض شاشة: يحرّر رسالة الأزرار إن وُجدت، وإلا يرسل رسالة جديدة. */
export async function show(ctx: UiCtx, html: string, kb: Kb = []) {
  const text = html.length > 4000 ? `${html.slice(0, 3990)}…` : html;
  const markup = { inline_keyboard: kb };
  if (ctx.messageId) {
    try {
      await tg(ctx.botToken, "editMessageText", {
        chat_id: ctx.chatId,
        message_id: ctx.messageId,
        text,
        parse_mode: "HTML",
        reply_markup: markup,
        link_preview_options: { is_disabled: true },
      });
      return;
    } catch (e) {
      if (e instanceof Error && /not modified/i.test(e.message)) return;
    }
  }
  try {
    await tg(ctx.botToken, "sendMessage", {
      chat_id: ctx.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: markup,
      link_preview_options: { is_disabled: true },
    });
  } catch {
    await tg(ctx.botToken, "sendMessage", { chat_id: ctx.chatId, text: text.replace(/<[^>]+>/g, ""), reply_markup: markup });
  }
}

// ─────────────────────────── الشاشات ───────────────────────────

export async function viewMenu(ctx: UiCtx) {
  const { admin, link } = ctx;
  const ws = link.workspace_id;
  const [{ data: wsRow }, { count: pending }, { count: proposals }] = await Promise.all([
    admin.from("workspaces").select("name").eq("id", ws).maybeSingle(),
    admin.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "review"),
    admin.from("proposals").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "open"),
  ]);
  const active = link.active_employee ? empName(link.active_employee) : "لم تختر بعد";
  await show(
    ctx,
    [
      `<b>🏠 سهل — ${esc(wsRow?.name ?? "مساحة عملك")}</b>`,
      `الموظف الحالي: <b>${esc(active)}</b>`,
      pending ? `🟡 عندك <b>${pending}</b> عنصر بانتظار موافقتك` : "✅ مفيش حاجة بانتظار موافقتك",
      "",
      "اكتب طلبك مباشرة لأي موظف، أو اختر من القائمة:",
    ].join("\n"),
    [
      [{ text: "👥 الفريق", callback_data: "tm" }, { text: "💬 المحادثات", callback_data: "h:0" }],
      [{ text: `✅ الموافقات${pending ? ` (${pending})` : ""}`, callback_data: "ap" }, { text: "📋 المهام", callback_data: "t:all" }],
      [{ text: "🔌 التكاملات", callback_data: "i" }, { text: `💡 المقترحات${proposals ? ` (${proposals})` : ""}`, callback_data: "p" }],
      [{ text: "🧠 المعرفة", callback_data: "b" }, { text: "📌 القرارات", callback_data: "d" }],
      [{ text: "☀️ إحاطة اليوم", callback_data: "zb" }, { text: "🗓️ تقويم النشر", callback_data: "zc" }],
      [{ text: "🛫 الطيار الآلي", callback_data: "zo" }, { text: "📈 ترتيب جوجل", callback_data: "zr" }],
      [{ text: "📊 الزيارات", callback_data: "zv" }, { text: "⏰ الأتمتة", callback_data: "au" }],
      [{ text: "👤 حسابي", callback_data: "za" }, { text: "⚙️ الإعدادات", callback_data: "s" }],
      [{ text: "🌐 افتح سهل", url: `${publicOrigin()}/app` }],
    ],
  );
}

export async function viewTeam(ctx: UiCtx) {
  const rows: Kb = [];
  for (let i = 0; i < TEAM.length; i += 2) {
    rows.push(
      TEAM.slice(i, i + 2).map((m) => ({
        text: `${m.id === ctx.link.active_employee ? "▶️ " : ""}${m.name}`,
        callback_data: `e:${m.id}`,
      })),
    );
  }
  rows.push(back());
  await show(
    ctx,
    [
      "<b>👥 فريقك</b>",
      "اختار الموظف اللي عايز تكلمه، أو اكتب اسمه في أول رسالتك (مثال: «يا نور اكتبي مقال عن…»).",
      "",
      ...TEAM.map((m) => `• <b>${m.name}</b> — /${m.cmd}`),
      "",
      "🎙️ تقدر تبعت صوت، صورة، أو ملف.",
    ].join("\n"),
    rows,
  );
}

async function setEmployee(ctx: UiCtx, emp: string) {
  const m = byId(emp);
  if (!m) return viewTeam(ctx);
  await ctx.admin.from("command_links").update({ active_employee: m.id }).eq("id", ctx.link.id);
  ctx.link.active_employee = m.id;
  await show(ctx, `✅ انت دلوقتي مع <b>${m.name}</b> — ابعت طلبك.`, [
    [{ text: "✨ محادثة جديدة معاه", callback_data: `hn:${m.id}` }, { text: "💬 محادثاته", callback_data: `he:${m.id}:0` }],
    [{ text: `🧰 قدرات ${m.name} (${skillsFor(m.id).length})`, callback_data: `k:${m.id}:0` }],
    back("tm"),
  ]);
}

// ── القدرات: تُقرأ من نفس كتالوج الموقع، فأي قدرة جديدة تظهر هنا تلقائياً ──
const SK_PAGE = 8;
async function viewSkills(ctx: UiCtx, emp: string, page: number) {
  const m = byId(emp);
  const list = skillsFor(emp);
  if (!m || !list.length) return show(ctx, "مفيش قدرات للموظف ده.", [back("tm")]);
  const slice = list.slice(page * SK_PAGE, page * SK_PAGE + SK_PAGE);
  const rows: Kb = slice.map((sk, j) => [{ text: sk.title, callback_data: `ko:${emp}:${page * SK_PAGE + j}` }]);
  const nav: Button[] = [];
  if (page > 0) nav.push({ text: "◀️ السابق", callback_data: `k:${emp}:${page - 1}` });
  if ((page + 1) * SK_PAGE < list.length) nav.push({ text: "التالي ▶️", callback_data: `k:${emp}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push(back(`e:${emp}`));
  await show(ctx, `<b>🧰 قدرات ${esc(m.name)}</b> — ${list.length} قدرة\nاختار قدرة وأنا هسألك عن التفاصيل خطوة بخطوة زي الموقع بالظبط.`, rows);
}

async function askSkillField(ctx: UiCtx) {
  const st = readPending(ctx.link).skill;
  const sk = st ? getSkill(st.id, st.emp) : undefined;
  if (!st || !sk) return viewMenu(ctx);
  // نتخطى الحقول اللي ليها قيمة افتراضية أو اتملت
  while (st.i < sk.fields.length) {
    const f = sk.fields[st.i]!;
    if (st.values[f.name] === undefined) break;
    st.i++;
  }
  if (st.i >= sk.fields.length) return runSkillNow(ctx);
  const f = sk.fields[st.i]!;
  await writePending(ctx.admin, ctx.link, { skill: st, wait: { kind: "skill_field" } });
  const rows: Kb = [];
  if (f.type === "select" && f.options?.length) {
    for (let j = 0; j < f.options.length; j += 2)
      rows.push(f.options.slice(j, j + 2).map((o, k) => ({ text: o, callback_data: `kv:${j + k}` })));
  }
  const ctl: Button[] = [];
  if (f.defaultValue) ctl.push({ text: `افتراضي: ${cut(f.defaultValue, 20)}`, callback_data: "kd" });
  if (!f.required) ctl.push({ text: "⏭️ تخطي", callback_data: "kx" });
  if (ctl.length) rows.push(ctl);
  rows.push([{ text: "✖️ إلغاء", callback_data: "m" }]);
  await show(
    ctx,
    [
      `<b>🧰 ${esc(sk.title)}</b> — ${st.i + 1}/${sk.fields.length}`,
      "",
      `<b>${esc(f.label)}</b>${f.required ? " *" : ""}`,
      f.help ? `<i>${esc(f.help)}</i>` : "",
      f.type === "select" ? "اختار من الأزرار أو اكتب قيمة." : `اكتب ${f.placeholder ? `(مثال: ${esc(f.placeholder)})` : "القيمة"}.`,
    ].filter(Boolean).join("\n"),
    rows,
  );
}

async function startSkill(ctx: UiCtx, emp: string, idx: number) {
  const sk = skillsFor(emp)[idx];
  if (!sk) return viewSkills(ctx, emp, 0);
  await writePending(ctx.admin, ctx.link, { skill: { emp, id: sk.id, i: 0, values: {} } });
  await show(ctx, `<b>🧰 ${esc(sk.title)}</b>\n${esc(sk.summary)}`, []);
  ctx.messageId = undefined;
  await askSkillField(ctx);
}

async function setSkillValue(ctx: UiCtx, value: string | null) {
  const st = readPending(ctx.link).skill;
  const sk = st ? getSkill(st.id, st.emp) : undefined;
  if (!st || !sk) return viewMenu(ctx);
  const f = sk.fields[st.i];
  if (f) st.values[f.name] = value ?? "";
  st.i++;
  await writePending(ctx.admin, ctx.link, { skill: st });
  await askSkillField(ctx);
}

async function runSkillNow(ctx: UiCtx) {
  const st = readPending(ctx.link).skill;
  await writePending(ctx.admin, ctx.link, {
    skill: null,
    wait: null,
    lastSkill: st ? { emp: st.emp, id: st.id, values: st.values } : null,
  });
  const sk = st ? getSkill(st.id, st.emp) : undefined;
  if (!st || !sk) return viewMenu(ctx);
  await show(ctx, `⏳ ${esc(empName(st.emp))} بيشتغل على «${esc(sk.title)}»…`, []);
  const ids = (ctx.link.conversation_ids ?? {}) as Record<string, string>;
  try {
    const { executeSkill } = await import("./nour-run.server");
    const run = await executeSkill(ctx.admin, {
      workspaceId: ctx.link.workspace_id,
      employeeId: st.emp,
      skillId: sk.id,
      values: st.values,
      ...(ids[st.emp] ? { conversationId: ids[st.emp] } : {}),
      origin: "من تيليجرام",
    });
    if (run.taskId) {
      await viewTask(ctx, run.taskId, `✅ <b>خلصت «${esc(sk.title)}».</b>`);
      ctx.messageId = undefined;
      return void (await show(ctx, "⏰ عايز الموظف يعمل دي تلقائياً بانتظام؟", [
        [
          { text: "يومياً", callback_data: "zas:daily" },
          { text: "أسبوعياً", callback_data: "zas:weekly" },
          { text: "شهرياً", callback_data: "zas:monthly" },
        ],
      ]));
    }
    await show(ctx, `✅ <b>${esc(sk.title)}</b>\n\n${esc(cut(String(run.output ?? ""), 3500))}`, [back(`k:${st.emp}:0`)]);
  } catch (e) {
    await show(ctx, `⚠️ ${esc(e instanceof Error ? e.message : "تعذّر التشغيل")}`, [back(`k:${st.emp}:0`)]);
  }
}

// ── المحادثات ──
const PAGE = 8;

export async function viewHistory(ctx: UiCtx, page: number, employee?: string) {
  let q = ctx.admin
    .from("conversations")
    .select("id, employee_id, title, updated_at")
    .eq("workspace_id", ctx.link.workspace_id)
    .order("updated_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE);
  if (employee) q = q.eq("employee_id", employee);
  const { data } = await q;
  const rows = data ?? [];
  const more = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const ids = (ctx.link.conversation_ids ?? {}) as Record<string, string>;
  const kb: Kb = list.map((c) => [
    {
      text: `${Object.values(ids).includes(c.id) ? "▶️ " : ""}${empName(c.employee_id)} · ${cut(c.title, 34)}`,
      callback_data: `hc:${c.id}`,
    },
  ]);
  const nav: Button[] = [];
  const base = employee ? `he:${employee}:` : "h:";
  if (page > 0) nav.push({ text: "« الأحدث", callback_data: `${base}${page - 1}` });
  if (more) nav.push({ text: "الأقدم »", callback_data: `${base}${page + 1}` });
  if (nav.length) kb.push(nav);
  if (employee) kb.push([{ text: `✨ محادثة جديدة مع ${empName(employee)}`, callback_data: `hn:${employee}` }]);
  else {
    const filters: Button[] = TEAM.map((m) => ({ text: m.name, callback_data: `he:${m.id}:0` }));
    kb.push(filters.slice(0, 3), filters.slice(3));
  }
  kb.push(back(employee ? "h:0" : "m"));
  await show(
    ctx,
    [
      `<b>💬 سجل المحادثات${employee ? ` — ${esc(empName(employee))}` : ""}</b>`,
      list.length
        ? "نفس المحادثات اللي في الموقع. افتح أي واحدة عشان تشوفها وتكمّل فيها."
        : "لسه مفيش محادثات هنا.",
    ].join("\n"),
    kb,
  );
}

async function openConversation(ctx: UiCtx, convId: string) {
  const { data: conv } = await ctx.admin
    .from("conversations")
    .select("id, employee_id, title, updated_at")
    .eq("id", convId)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!conv) return show(ctx, "المحادثة دي مش موجودة.", [back("h:0")]);
  const { data: msgs } = await ctx.admin
    .from("messages")
    .select("role, body, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const ids = { ...((ctx.link.conversation_ids ?? {}) as Record<string, string>), [conv.employee_id]: conv.id };
  await ctx.admin
    .from("command_links")
    .update({ conversation_ids: ids, active_employee: conv.employee_id })
    .eq("id", ctx.link.id);
  ctx.link.conversation_ids = ids;
  ctx.link.active_employee = conv.employee_id;
  const lines = (msgs ?? [])
    .reverse()
    .map((m) => `${m.role === "user" ? "👤 <b>انت</b>" : `🤖 <b>${esc(empName(conv.employee_id))}</b>`}: ${esc(cut(m.body.replace(/\[\[[^\]]*\]\]/g, ""), 350))}`);
  await show(
    ctx,
    [
      `<b>💬 ${esc(conv.title)}</b>`,
      `${esc(empName(conv.employee_id))} · ${esc(fmtDate(conv.updated_at))}`,
      "",
      lines.length ? lines.join("\n\n") : "لسه مفيش رسائل.",
      "",
      "✅ المحادثة دي بقت الحالية — اكتب رسالتك وهتكمل فيها (وهتظهر في الموقع كمان).",
    ].join("\n"),
    [
      [{ text: "🌐 افتحها في الموقع", url: `${publicOrigin()}/app/chat/${conv.employee_id}` }],
      back("h:0"),
    ],
  );
}

async function newConversation(ctx: UiCtx, emp: string) {
  const m = byId(emp);
  if (!m) return viewTeam(ctx);
  const { data } = await ctx.admin
    .from("conversations")
    .insert({ workspace_id: ctx.link.workspace_id, employee_id: m.id, title: "محادثة تيليجرام" })
    .select("id")
    .single();
  if (!data) return show(ctx, "تعذّر بدء محادثة جديدة.", [back()]);
  const ids = { ...((ctx.link.conversation_ids ?? {}) as Record<string, string>), [m.id]: data.id };
  await ctx.admin.from("command_links").update({ conversation_ids: ids, active_employee: m.id }).eq("id", ctx.link.id);
  ctx.link.conversation_ids = ids;
  ctx.link.active_employee = m.id;
  await show(ctx, `✨ بدأنا محادثة جديدة مع <b>${m.name}</b> — ابعت طلبك.`, [back("tm")]);
}

// ── المهام والموافقات ──
const TASK_FILTERS: [string, string][] = [
  ["all", "الكل"],
  ["review", "للمراجعة"],
  ["running", "قيد التنفيذ"],
  ["queued", "انتظار"],
  ["done", "منتهية"],
];

export async function viewTasks(ctx: UiCtx, status: string) {
  let q = ctx.admin
    .from("tasks")
    .select("id, employee_id, title, status, created_at")
    .eq("workspace_id", ctx.link.workspace_id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (status !== "all") q = q.eq("status", status);
  const { data } = await q;
  const kb: Kb = (data ?? []).map((t) => [
    { text: `${(STATUS_LABEL[t.status] ?? t.status).split(" ")[0]} ${empName(t.employee_id)} · ${cut(t.title, 32)}`, callback_data: `tv:${t.id}` },
  ]);
  kb.push(TASK_FILTERS.slice(0, 3).map(([k, l]) => ({ text: `${k === status ? "• " : ""}${l}`, callback_data: `t:${k}` })));
  kb.push(TASK_FILTERS.slice(3).map(([k, l]) => ({ text: `${k === status ? "• " : ""}${l}`, callback_data: `t:${k}` })));
  kb.push(back());
  await show(
    ctx,
    [`<b>📋 المهام</b> — ${esc(TASK_FILTERS.find(([k]) => k === status)?.[1] ?? "")}`, data?.length ? "آخر 10 مهام:" : "مفيش مهام هنا."].join("\n"),
    kb,
  );
}

export async function viewTask(ctx: UiCtx, id: string, note?: string) {
  const { data: t } = await ctx.admin
    .from("tasks")
    .select("id, employee_id, title, detail, status, output, channel, scheduled, created_at")
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!t) return show(ctx, "المهمة دي مش موجودة.", [back("t:all")]);
  const kb: Kb = [];
  if (t.status === "review") {
    kb.push([
      { text: "✅ اعتماد", callback_data: `aa:${t.id}` },
      { text: "✏️ تعديل", callback_data: `ae:${t.id}` },
      { text: "✖️ رفض", callback_data: `ar:${t.id}` },
    ]);
  }
  kb.push([{ text: "🌐 افتحها في الموقع", url: `${publicOrigin()}/app/tasks` }]);
  kb.push(back(t.status === "review" ? "ap" : "t:all"));
  const publishable = new Set(["instagram", "facebook", "linkedin", "x", "twitter", "telegram", "pinterest", "youtube"]);
  if (t.output && publishable.has(String(t.channel ?? "").toLowerCase())) {
    const presentation = extractPostMedia(t.output);
    const image = presentation.images[0]?.url;
    const clean = presentation.text;
    if (image && clean.length <= 1024) {
      try {
        await tg(ctx.botToken, "sendPhoto", {
          chat_id: ctx.chatId,
          photo: image,
          caption: esc(clean),
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: kb },
        });
        return;
      } catch (error) {
        console.error("[telegram] task photo failed:", error);
      }
    }
    await show(ctx, clean || "المخرج جاهز للمراجعة.", kb);
    return;
  }
  await show(
    ctx,
    [
      note ? `${note}\n` : "",
      `<b>${esc(t.title)}</b>`,
      `${esc(empName(t.employee_id))} · ${esc(STATUS_LABEL[t.status] ?? t.status)} · ${esc(fmtDate(t.created_at))}`,
      t.scheduled ? `🗓️ ${esc(t.scheduled)}` : "",
      t.detail ? `\n${esc(cut(t.detail, 400))}` : "",
      t.output ? `\n<b>المخرج:</b>\n${esc(cut(t.output, 2600))}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    kb,
  );
}

export async function viewApprovals(ctx: UiCtx) {
  const { data } = await ctx.admin
    .from("tasks")
    .select("id, employee_id, title, created_at")
    .eq("workspace_id", ctx.link.workspace_id)
    .eq("status", "review")
    .order("created_at", { ascending: false })
    .limit(12);
  const pending = readPending(ctx.link).action;
  const kb: Kb = [];
  if (pending) kb.push([{ text: `⚡ إجراء معلّق: ${cut(pending.label, 30)}`, callback_data: "xv" }]);
  for (const t of data ?? []) kb.push([{ text: `${empName(t.employee_id)} · ${cut(t.title, 40)}`, callback_data: `tv:${t.id}` }]);
  if ((data ?? []).length > 1) kb.push([{ text: "✅ اعتماد الكل", callback_data: "aall" }]);
  kb.push(back());
  await show(
    ctx,
    [
      "<b>✅ طابور الموافقات</b>",
      data?.length || pending ? "افتح أي عنصر عشان تراجعه وتعتمده أو تعدّله أو ترفضه." : "مفيش حاجة بانتظارك دلوقتي 👌",
    ].join("\n"),
    kb,
  );
}

const DONE_STEPS = [
  { label: "فهم الطلب", state: "done" },
  { label: "التنفيذ", state: "done" },
  { label: "مراجعتك", state: "done" },
  { label: "النشر", state: "done" },
];

async function decideTask(ctx: UiCtx, id: string, status: "done" | "rejected", reason?: string) {
  const { data: t } = await ctx.admin
    .from("tasks")
    .select("id, employee_id, title, status")
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!t) return false;
  await writePending(ctx.admin, ctx.link, { quiet: { id, at: Date.now() } });
  await ctx.admin
    .from("tasks")
    .update(status === "done" ? { status, steps: DONE_STEPS as unknown as Json } : { status })
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id);
  try {
    const { recordTaskFeedback, buildLearningCandidates } = await import("./learning.server");
    await recordTaskFeedback(ctx.admin, {
      workspaceId: ctx.link.workspace_id,
      taskId: id,
      employeeId: t.employee_id,
      kind: status === "done" ? "approved" : "rejected",
      reason: status === "rejected" ? reason?.trim() || "رفض المالك المخرج" : "اعتمد المالك المخرج دون تعديل",
    });
    await buildLearningCandidates(ctx.admin, ctx.link.workspace_id, t.employee_id);
  } catch (e) {
    console.warn("[telegram-ui] feedback skipped:", e instanceof Error ? e.message : e);
  }
  return true;
}

// ── الإجراء الحقيقي المعلّق من المحادثة ──
export async function viewPendingAction(ctx: UiCtx) {
  const a = readPending(ctx.link).action;
  if (!a) return show(ctx, "مفيش إجراء معلّق.", [back("ap")]);
  const vals = Object.entries(a.values)
    .map(([k, v]) => `• <b>${esc(k)}</b>: ${esc(cut(v, 300))}`)
    .join("\n");
  const card = [
    `<b>⚡ ${esc(a.label)}</b>`,
    `${esc(empName(a.employeeId))} · عبر ${esc(providerLabel(a.provider))}`,
    "",
    vals || "بدون بيانات إضافية.",
    "",
    "ده إجراء حقيقي هيتنفّذ فعلاً على حسابك المربوط. توافق؟",
  ].join("\n");
  const kb: Kb = [[{ text: "✅ نفّذ الآن", callback_data: "xa" }, { text: "✖️ إلغاء", callback_data: "xc" }], back("ap")];
  // لإجراءات المتصفح: لقطة حية للصفحة قبل الموافقة، ليرى المالك بالضبط ما سيُملأ.
  if (a.provider === "browser" && a.values["url"]) {
    try {
      const { browsePage } = await import("./cloud-browser.server");
      const page = await browsePage(a.values["url"], { screenshot: true });
      if (page?.screenshotUrl) {
        const caption = card.length > 1024 ? `${card.slice(0, 1010)}…` : card;
        try {
          await tg(ctx.botToken, "sendPhoto", {
            chat_id: ctx.chatId,
            photo: page.screenshotUrl,
            caption,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: kb },
          });
          return;
        } catch (e) {
          console.error("[telegram-ui] preview photo failed:", e);
        }
      }
    } catch (e) {
      console.warn("[telegram-ui] preview screenshot skipped:", e instanceof Error ? e.message : e);
    }
  }
  await show(ctx, card, kb);
}

async function runPendingAction(ctx: UiCtx) {
  const a = readPending(ctx.link).action;
  if (!a) return show(ctx, "مفيش إجراء معلّق.", [back()]);
  await writePending(ctx.admin, ctx.link, { action: null });
  try {
    const { runEmployeeActionServer } = await import("./employee-actions.server");
    const out = await runEmployeeActionServer(ctx.admin, { workspaceId: ctx.link.workspace_id, actionId: a.id, values: a.values });
    const r = out.result as { submitted?: boolean; filled?: string[]; missed?: string[]; screenshotUrl?: string | null } | null;
    const extra =
      out.provider === "browser" && r
        ? [
            r.filled?.length ? `\nاتملى: ${esc(r.filled.join("، "))}` : "",
            r.missed?.length ? `\nملقتش: ${esc(r.missed.join("، "))}` : "",
            r.submitted ? "\nتم إرسال النموذج." : "\nملأت بدون إرسال.",
            r.screenshotUrl ? `\n<a href="${esc(r.screenshotUrl)}">📸 لقطة الشاشة</a>` : "",
          ].join("")
        : "";
    await show(ctx, `✅ تم تنفيذ «${esc(a.label)}» بنجاح.${extra}`, [back()]);
  } catch (e) {
    await show(ctx, `⚠️ تعذّر تنفيذ «${esc(a.label)}»:\n${esc(e instanceof Error ? e.message : "خطأ غير معروف")}`, [back()]);
  }
}

// ── التكاملات ──
export async function viewIntegrations(ctx: UiCtx, emp?: string) {
  const { data } = await ctx.admin
    .from("integrations")
    .select("provider, employee_id, status, account")
    .eq("workspace_id", ctx.link.workspace_id)
    .order("provider");
  const rows = data ?? [];
  if (!emp) {
    const kb: Kb = [];
    const btns = TEAM.map((m) => {
      const mine = rows.filter((r) => r.employee_id === m.id);
      const on = mine.filter((r) => r.status === "connected").length;
      return { text: `${m.name} (${on}/${mine.length})`, callback_data: `ie:${m.id}` };
    });
    for (let i = 0; i < btns.length; i += 2) kb.push(btns.slice(i, i + 2));
    kb.push([{ text: "🔄 تحديث حالة الربط", callback_data: "is" }]);
    kb.push(back());
    const connected = rows.filter((r) => r.status === "connected");
    return show(
      ctx,
      [
        "<b>🔌 التكاملات</b>",
        connected.length
          ? `المتصل دلوقتي:\n${connected.map((r) => `🟢 ${esc(providerLabel(r.provider))}${r.account ? ` — ${esc(cut(r.account, 30))}` : ""}`).join("\n")}`
          : "لسه مفيش منصات متصلة.",
        "",
        "اختار الموظف عشان تشوف منصاته وتربط أو تفصل:",
      ].join("\n"),
      kb,
    );
  }
  const mine = rows.filter((r) => r.employee_id === emp);
  const kb: Kb = mine.map((r) =>
    r.status === "connected"
      ? [{ text: `🟢 ${providerLabel(r.provider)} — فصل`, callback_data: `id:${r.provider}` }]
      : [{ text: `⚪ ${providerLabel(r.provider)} — ربط`, callback_data: `ic:${r.provider}` }],
  );
  kb.push(back("i"));
  await show(ctx, `<b>🔌 منصات ${esc(empName(emp))}</b>\nاضغط على أي منصة للربط أو الفصل.`, kb);
}

async function connectIntegration(ctx: UiCtx, provider: string) {
  const siteUrl = `${publicOrigin()}/app/integrations`;
  const { pipedreamApp } = await import("@/data/pipedream-apps");
  const app = pipedreamApp(provider);
  if (app) {
    try {
      const { pipedreamConfig, createConnectToken } = await import("./pipedream.server");
      const config = await pipedreamConfig();
      if (config) {
        const origin = publicOrigin();
        const success = `${origin}/app/integrations?pd=connected&provider=${provider}`;
        const failure = `${origin}/app/integrations?pd=failed`;
        const token = await createConnectToken(config, ctx.link.workspace_id, [origin], { success, error: failure });
        const url = new URL(
          token.connect_link_url ?? `https://pipedream.com/_static/connect.html?token=${encodeURIComponent(token.token)}`,
        );
        url.searchParams.set("app", app.slug);
        url.searchParams.set("connectLink", "true");
        url.searchParams.set("success_redirect_uri", success);
        url.searchParams.set("error_redirect_uri", failure);
        return show(
          ctx,
          [
            `<b>🔗 ربط ${esc(providerLabel(provider))}</b>`,
            "1) اضغط «افتح صفحة الربط» وسجّل دخولك في المنصة ووافق على الصلاحيات.",
            "2) ارجع هنا واضغط «✅ خلصت الربط» عشان نتأكد.",
            app.note ? `\nℹ️ ${esc(app.note)}` : "",
            "\nالرابط صالح لفترة محدودة وخاص بمساحة عملك.",
          ].join("\n"),
          [
            [{ text: "🔗 افتح صفحة الربط", url: url.toString() }],
            [{ text: "✅ خلصت الربط", callback_data: "is" }],
            back("i"),
          ],
        );
      }
    } catch (e) {
      console.error("[telegram-ui] connect link failed:", e);
    }
  }
  await show(
    ctx,
    [
      `<b>🔗 ربط ${esc(providerLabel(provider))}</b>`,
      "المنصة دي محتاجة بيانات ربط (رابط موقع/مفتاح) — افتح صفحة التكاملات في سهل وكمّل الربط هناك، وهيظهر هنا فوراً.",
    ].join("\n"),
    [[{ text: "🌐 افتح صفحة التكاملات", url: siteUrl }], [{ text: "🔄 تحديث الحالة", callback_data: "is" }], back("i")],
  );
}

async function disconnectIntegration(ctx: UiCtx, provider: string) {
  const ws = ctx.link.workspace_id;
  const { data: rows } = await ctx.admin
    .from("pipedream_accounts")
    .select("account_id")
    .eq("workspace_id", ws)
    .eq("provider", provider);
  if (rows?.length) {
    try {
      const { pipedreamConfig, deleteAccount } = await import("./pipedream.server");
      const config = await pipedreamConfig();
      if (config) for (const r of rows) await deleteAccount(config, r.account_id).catch(() => null);
    } catch {
      /* نكمل الفصل محلياً */
    }
    await ctx.admin.from("pipedream_accounts").delete().eq("workspace_id", ws).eq("provider", provider);
  }
  if (provider === "facebook" || provider === "instagram") {
    await ctx.admin.from("meta_connections").update({ status: "disconnected" }).eq("workspace_id", ws);
  }
  if (provider !== "telegram") {
    await ctx.admin.from("integration_credentials").delete().eq("workspace_id", ws).eq("provider", provider);
  }
  await ctx.admin.from("integrations").update({ status: "disconnected", account: null }).eq("workspace_id", ws).eq("provider", provider);
}

async function syncIntegrations(ctx: UiCtx): Promise<string> {
  const ws = ctx.link.workspace_id;
  try {
    const { pipedreamConfig, listAccounts, accountUsable } = await import("./pipedream.server");
    const { pipedreamApps } = await import("@/data/pipedream-apps");
    const config = await pipedreamConfig();
    if (!config) return "";
    const accounts = await listAccounts(config, ws);
    const map = new Map(pipedreamApps.map((a) => [a.slug, a.provider]));
    const seen: string[] = [];
    for (const account of accounts) {
      const slug = typeof account.app === "string" ? account.app : (account.app?.name_slug ?? "");
      const provider = map.get(slug);
      if (!provider) continue;
      const usable = accountUsable(account);
      seen.push(provider);
      await ctx.admin.from("pipedream_accounts").upsert(
        {
          workspace_id: ws,
          provider,
          app_slug: slug,
          account_id: account.id,
          account_name: account.name ?? null,
          status: usable ? "connected" : "error",
          healthy: usable,
          last_error: null,
        },
        { onConflict: "workspace_id,provider,account_id" },
      );
      await ctx.admin
        .from("integrations")
        .update({ status: usable ? "connected" : "error", account: account.name ?? slug })
        .eq("workspace_id", ws)
        .eq("provider", provider);
    }
    return seen.length ? `✅ المتصل عبر الربط الآمن: ${seen.map(providerLabel).join("، ")}` : "لسه مفيش ربط جديد اكتمل.";
  } catch (e) {
    console.error("[telegram-ui] sync failed:", e);
    return "⚠️ تعذّر تحديث الحالة دلوقتي — جرب تاني بعد دقيقة.";
  }
}

// ── المقترحات ──
export async function viewProposals(ctx: UiCtx) {
  const { data } = await ctx.admin
    .from("proposals")
    .select("id, employee_id, title, reason, impact, status")
    .eq("workspace_id", ctx.link.workspace_id)
    .eq("status", "open")
    .order("priority", { ascending: true })
    .limit(8);
  const kb: Kb = (data ?? []).map((p) => [{ text: `💡 ${empName(p.employee_id)} · ${cut(p.title, 40)}`, callback_data: `pv:${p.id}` }]);
  kb.push(back());
  await show(ctx, `<b>💡 مقترحات الفريق</b>\n${data?.length ? "مبادرات جاهزة للتنفيذ بضغطة:" : "مفيش مقترحات جديدة دلوقتي."}`, kb);
}

async function viewProposal(ctx: UiCtx, id: string) {
  const { data: p } = await ctx.admin
    .from("proposals")
    .select("id, employee_id, title, reason, impact, status")
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!p) return show(ctx, "المقترح ده مش موجود.", [back("p")]);
  await show(
    ctx,
    [`<b>💡 ${esc(p.title)}</b>`, esc(empName(p.employee_id)), "", esc(cut(p.reason, 900)), p.impact ? `\n📈 ${esc(cut(p.impact, 300))}` : ""].join("\n"),
    p.status === "open"
      ? [[{ text: "🚀 نفّذ", callback_data: `pa:${p.id}` }, { text: "🙈 تجاهل", callback_data: `pd:${p.id}` }], back("p")]
      : [back("p")],
  );
}

// ── القرارات ──
export async function viewDecisions(ctx: UiCtx) {
  const { data } = await ctx.admin
    .from("decisions")
    .select("id, employee_id, title, status")
    .eq("workspace_id", ctx.link.workspace_id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(10);
  const kb: Kb = (data ?? []).map((d) => [{ text: `📌 ${cut(d.title, 44)}`, callback_data: `dv:${d.id}` }]);
  kb.push(back());
  await show(ctx, `<b>📌 القرارات المتفق عليها</b>\n${data?.length ? "الفريق بيلتزم بيها في كل شغله:" : "لسه مفيش قرارات مسجّلة."}`, kb);
}

async function viewDecision(ctx: UiCtx, id: string) {
  const { data: d } = await ctx.admin
    .from("decisions")
    .select("id, employee_id, title, decision, rationale, created_at")
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!d) return show(ctx, "القرار ده مش موجود.", [back("d")]);
  await show(
    ctx,
    [`<b>📌 ${esc(d.title)}</b>`, `${esc(empName(d.employee_id))} · ${esc(fmtDate(d.created_at))}`, "", esc(cut(d.decision, 1500)), d.rationale ? `\n💭 ${esc(cut(d.rationale, 500))}` : ""].join("\n"),
    [[{ text: "🗄️ أرشفة", callback_data: `dx:${d.id}` }], back("d")],
  );
}

// ── المعرفة ──
export async function viewBrain(ctx: UiCtx) {
  const { data } = await ctx.admin
    .from("brain_items")
    .select("id, kind, title")
    .eq("workspace_id", ctx.link.workspace_id)
    .order("created_at", { ascending: false })
    .limit(12);
  const kb: Kb = (data ?? []).map((b) => [{ text: `🧠 ${cut(b.title, 46)}`, callback_data: `bv:${b.id}` }]);
  kb.push([{ text: "➕ أضف ملاحظة", callback_data: "bn" }]);
  kb.push(back());
  await show(ctx, "<b>🧠 معرفة الشركة</b>\nكل ما هنا بيستخدمه الفريق في كل رد.", kb);
}

async function viewBrainItem(ctx: UiCtx, id: string) {
  const { data: b } = await ctx.admin
    .from("brain_items")
    .select("id, title, body, meta, used_by")
    .eq("id", id)
    .eq("workspace_id", ctx.link.workspace_id)
    .maybeSingle();
  if (!b) return show(ctx, "العنصر ده مش موجود.", [back("b")]);
  await show(
    ctx,
    [`<b>🧠 ${esc(b.title)}</b>`, b.meta ? esc(b.meta) : "", "", esc(cut(b.body, 2500)), b.used_by?.length ? `\n👥 ${b.used_by.map(empName).join("، ")}` : ""].join("\n"),
    [[{ text: "🗑️ حذف", callback_data: `bx:${b.id}` }], back("b")],
  );
}

// ── الأتمتة ──
export async function viewAutomations(ctx: UiCtx) {
  const { data } = await ctx.admin
    .from("automations")
    .select("id, employee_id, label, active, cadence, next_run_at, last_status")
    .eq("workspace_id", ctx.link.workspace_id)
    .order("created_at", { ascending: false })
    .limit(10);
  const kb: Kb = [];
  for (const a of data ?? []) {
    kb.push([
      { text: `${a.active ? "🟢" : "⚪"} ${cut(a.label, 30)}`, callback_data: `at:${a.id}` },
      { text: "▶️ شغّل", callback_data: `ag:${a.id}` },
      { text: "🗑️", callback_data: `zad:${a.id}` },
    ]);
  }
  kb.push([{ text: "➕ جدولة جديدة من قدرات الموظفين", callback_data: "tm" }]);
  kb.push(back());
  const lines = (data ?? []).map(
    (a) => `${a.active ? "🟢" : "⚪"} <b>${esc(cut(a.label, 50))}</b> — ${esc(empName(a.employee_id))} · التالي: ${esc(fmtDate(a.next_run_at))}${a.last_status ? ` · آخر حالة: ${esc(a.last_status)}` : ""}`,
  );
  await show(
    ctx,
    ["<b>⏰ الأتمتة</b>", lines.length ? lines.join("\n") : "مفيش جدولات لسه.", "", "اضغط الاسم للتشغيل/الإيقاف، «شغّل» للتنفيذ الفوري، أو 🗑️ للحذف.\nلجدولة جديدة: شغّل أي قدرة لموظف ثم اختر «يومياً/أسبوعياً/شهرياً»."].join("\n"),
    kb,
  );
}

// ── الإعدادات ──
const PREFS: [string, string][] = [
  ["approval_ready", "مهمة جاهزة للمراجعة"],
  ["publishing_failed", "فشل النشر"],
  ["integration_disconnected", "انقطاع تكامل"],
  ["task_digest", "مقترحات جديدة"],
  ["weekly_summary", "الملخص الأسبوعي"],
];

async function ownerId(ctx: UiCtx) {
  const { data } = await ctx.admin.from("workspaces").select("owner_id").eq("id", ctx.link.workspace_id).maybeSingle();
  return data?.owner_id ?? null;
}

export async function loadPrefs(admin: Admin, userId: string) {
  const { data } = await admin.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

export async function viewSettings(ctx: UiCtx) {
  const uid = await ownerId(ctx);
  const prefs = uid ? await loadPrefs(ctx.admin, uid) : null;
  const val = (k: string) => (prefs ? Boolean((prefs as Record<string, unknown>)[k]) : true);
  const kb: Kb = PREFS.map(([k, l]) => [{ text: `${val(k) ? "🔔" : "🔕"} ${l}`, callback_data: `st:${k}` }]);
  kb.push([{ text: "🌐 إعدادات الحساب في الموقع", url: `${publicOrigin()}/app/settings` }]);
  kb.push(back());
  await show(
    ctx,
    [
      "<b>⚙️ الإعدادات والتنبيهات</b>",
      "التنبيهات دي بتوصلك هنا على تيليجرام فوراً، وهي نفس إعدادات الموقع.",
      prefs?.timezone ? `🕒 المنطقة الزمنية: ${esc(prefs.timezone)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    kb,
  );
}

async function togglePref(ctx: UiCtx, key: string) {
  if (!PREFS.some(([k]) => k === key)) return;
  const uid = await ownerId(ctx);
  if (!uid) return;
  const prefs = await loadPrefs(ctx.admin, uid);
  const current = prefs ? Boolean((prefs as Record<string, unknown>)[key]) : true;
  await ctx.admin
    .from("notification_preferences")
    .upsert({ user_id: uid, [key]: !current } as Database["public"]["Tables"]["notification_preferences"]["Insert"], { onConflict: "user_id" });
}

// ─────────────────────────── موجّه الأزرار ───────────────────────────

export async function handleCallback(ctx: UiCtx, data: string): Promise<string | undefined> {
  const [op, a = "", b = ""] = data.split(":");
  const ws = ctx.link.workspace_id;
  switch (op) {
    case "m":
      await writePending(ctx.admin, ctx.link, { wait: null });
      return void (await viewMenu(ctx));
    case "tm":
      return void (await viewTeam(ctx));
    case "e":
      return void (await setEmployee(ctx, a));
    case "h":
      return void (await viewHistory(ctx, Number(a) || 0));
    case "he":
      return void (await viewHistory(ctx, Number(b) || 0, a));
    case "hc":
      return void (await openConversation(ctx, a));
    case "hn":
      return void (await newConversation(ctx, a));
    case "k":
      return void (await viewSkills(ctx, a, Number(b) || 0));
    case "ko":
      return void (await startSkill(ctx, a, Number(b) || 0));
    case "kv": {
      const st = readPending(ctx.link).skill;
      const f = st ? getSkill(st.id, st.emp)?.fields[st.i] : undefined;
      return void (await setSkillValue(ctx, f?.options?.[Number(a)] ?? ""));
    }
    case "kd": {
      const st = readPending(ctx.link).skill;
      const f = st ? getSkill(st.id, st.emp)?.fields[st.i] : undefined;
      return void (await setSkillValue(ctx, f?.defaultValue ?? ""));
    }
    case "kx":
      return void (await setSkillValue(ctx, ""));
    case "t":
      return void (await viewTasks(ctx, a || "all"));
    case "tv":
      return void (await viewTask(ctx, a));
    case "ap":
      return void (await viewApprovals(ctx));
    case "aa": {
      const ok = await decideTask(ctx, a, "done");
      await viewTask(ctx, a, ok ? "✅ <b>اتعتمدت.</b>" : undefined);
      return ok ? "اتعتمدت ✅" : "مش موجودة";
    }
    case "aall": {
      const { data: rows } = await ctx.admin.from("tasks").select("id").eq("workspace_id", ws).eq("status", "review").limit(50);
      for (const r of rows ?? []) await decideTask(ctx, r.id, "done");
      await viewApprovals(ctx);
      return `اتعتمد ${rows?.length ?? 0} عنصر`;
    }
    case "ar":
      await writePending(ctx.admin, ctx.link, { wait: { kind: "reject_reason", id: a } });
      await show(ctx, "✖️ اكتب سبب الرفض عشان الموظف يتعلم (أو اضغط «رفض بدون سبب»):", [
        [{ text: "رفض بدون سبب", callback_data: `ary:${a}` }],
        back(`tv:${a}`),
      ]);
      return;
    case "ary":
      await writePending(ctx.admin, ctx.link, { wait: null });
      await decideTask(ctx, a, "rejected");
      await viewTask(ctx, a, "✖️ <b>اترفضت.</b>");
      return "اترفضت";
    case "ae":
      await writePending(ctx.admin, ctx.link, { wait: { kind: "edit_task", id: a } });
      await show(ctx, "✏️ ابعت النص المعدّل كامل في رسالة، وهحفظه مكان المخرج الحالي (وهيظهر في الموقع).", [back(`tv:${a}`)]);
      return;
    case "xv":
      return void (await viewPendingAction(ctx));
    case "xa":
      return void (await runPendingAction(ctx));
    case "xc":
      await writePending(ctx.admin, ctx.link, { action: null });
      await show(ctx, "اتلغى الإجراء.", [back()]);
      return;
    case "i":
      return void (await viewIntegrations(ctx));
    case "ie":
      return void (await viewIntegrations(ctx, a));
    case "ic":
      return void (await connectIntegration(ctx, a));
    case "id":
      await show(ctx, `متأكد إنك عايز تفصل <b>${esc(providerLabel(a))}</b>؟ الموظفين مش هيقدروا يستخدموه لحد ما تربطه تاني.`, [
        [{ text: "نعم، افصل", callback_data: `idy:${a}` }, { text: "لا", callback_data: "i" }],
      ]);
      return;
    case "idy":
      await disconnectIntegration(ctx, a);
      await viewIntegrations(ctx);
      return `اتفصل ${providerLabel(a)}`;
    case "is": {
      const note = await syncIntegrations(ctx);
      await viewIntegrations(ctx);
      return note.slice(0, 190) || "اتحدّثت";
    }
    case "p":
      return void (await viewProposals(ctx));
    case "pv":
      return void (await viewProposal(ctx, a));
    case "pa": {
      await show(ctx, "⏳ الفريق بينفّذ المقترح…", []);
      try {
        const { acceptProposal } = await import("./proactive.server");
        const res = await acceptProposal(ctx.admin, { workspaceId: ws, proposalId: a });
        if (res.taskId) return void (await viewTask(ctx, res.taskId, `🚀 <b>اتنفّذ:</b> ${esc(res.title)}`));
        await show(ctx, `🚀 اتنفّذ: ${esc(res.title)}`, [back("p")]);
      } catch (e) {
        await show(ctx, `⚠️ ${esc(e instanceof Error ? e.message : "تعذّر التنفيذ")}`, [back("p")]);
      }
      return;
    }
    case "pd":
      await ctx.admin.from("proposals").update({ status: "dismissed" }).eq("id", a).eq("workspace_id", ws);
      await viewProposals(ctx);
      return "اتجاهل";
    case "d":
      return void (await viewDecisions(ctx));
    case "dv":
      return void (await viewDecision(ctx, a));
    case "dx":
      await ctx.admin.from("decisions").update({ status: "archived" }).eq("id", a).eq("workspace_id", ws);
      await viewDecisions(ctx);
      return "اتأرشف";
    case "b":
      return void (await viewBrain(ctx));
    case "bv":
      return void (await viewBrainItem(ctx, a));
    case "bx":
      await ctx.admin.from("brain_items").delete().eq("id", a).eq("workspace_id", ws);
      await viewBrain(ctx);
      return "اتحذف";
    case "bn":
      await writePending(ctx.admin, ctx.link, { wait: { kind: "brain_note" } });
      await show(ctx, "➕ ابعت الملاحظة في رسالة (السطر الأول = العنوان، والباقي = التفاصيل).", [back("b")]);
      return;
    case "au":
      return void (await viewAutomations(ctx));
    case "at": {
      const { data: row } = await ctx.admin.from("automations").select("active").eq("id", a).eq("workspace_id", ws).maybeSingle();
      if (row) await ctx.admin.from("automations").update({ active: !row.active }).eq("id", a).eq("workspace_id", ws);
      await viewAutomations(ctx);
      return row ? (row.active ? "اتوقفت" : "اتفعّلت") : undefined;
    }
    case "ag": {
      const { data: row } = await ctx.admin.from("automations").select("*").eq("id", a).eq("workspace_id", ws).maybeSingle();
      if (!row) return "مش موجودة";
      await show(ctx, `⏳ بشغّل «${esc(row.label)}» دلوقتي…`, []);
      try {
        const { executeSkill } = await import("./nour-run.server");
        const run = await executeSkill(ctx.admin, {
          workspaceId: ws,
          employeeId: row.employee_id,
          skillId: row.skill_id,
          values: (row.values as Record<string, string> | null) ?? {},
          origin: "تشغيل يدوي من تيليجرام",
        });
        await ctx.admin.from("automations").update({ last_run_at: new Date().toISOString(), last_status: "نجح" }).eq("id", a);
        if (run.taskId) return void (await viewTask(ctx, run.taskId, "✅ <b>اتنفّذت الجدولة.</b>"));
        await show(ctx, "✅ اتنفّذت الجدولة.", [back("au")]);
      } catch (e) {
        await ctx.admin.from("automations").update({ last_run_at: new Date().toISOString(), last_status: "فشل" }).eq("id", a);
        await show(ctx, `⚠️ ${esc(e instanceof Error ? e.message : "تعذّر التشغيل")}`, [back("au")]);
      }
      return;
    }
    case "s":
      return void (await viewSettings(ctx));
    case "st":
      await togglePref(ctx, a);
      await viewSettings(ctx);
      return "اتحفظ";
    default: {
      if (op && op.startsWith("z")) {
        const { handleExtraCallback } = await import("./telegram-ui-extra.server");
        const r = await handleExtraCallback(ctx, op, a);
        if (r !== null) return r;
      }
      await viewMenu(ctx);
      return undefined;
    }
  }
}

/** رد نصي ينتظره البوت (تعديل مخرج، ملاحظة معرفة، سبب رفض). يعيد true لو استُهلك. */
export async function handlePendingText(ctx: UiCtx, text: string): Promise<boolean> {
  const wait = readPending(ctx.link).wait;
  if (!wait || !text.trim()) return false;
  if (wait.kind === "skill_field") {
    ctx.messageId = undefined;
    await setSkillValue(ctx, text.trim());
    return true;
  }
  await writePending(ctx.admin, ctx.link, { wait: null });
  const ws = ctx.link.workspace_id;
  if (wait.kind === "extra_field" || wait.kind === "kw_add") {
    ctx.messageId = undefined;
    const { saveExtraText } = await import("./telegram-ui-extra.server");
    await saveExtraText(ctx, wait.kind, wait.id, text);
    return true;
  }
  if (wait.kind === "brain_note") {
    const [first, ...rest] = text.trim().split("\n");
    await ctx.admin.from("brain_items").insert({
      workspace_id: ws,
      kind: "note",
      title: cut(first, 120) || "ملاحظة",
      body: rest.join("\n").trim() || text.trim(),
      meta: "ملاحظة · من تيليجرام",
      used_by: TEAM.map((m) => m.id),
    });
    await viewBrain(ctx);
    return true;
  }
  if (wait.kind === "edit_task" && wait.id) {
    const { data: t } = await ctx.admin
      .from("tasks")
      .select("id, employee_id, output")
      .eq("id", wait.id)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!t) return false;
    await ctx.admin.from("tasks").update({ output: text.trim() }).eq("id", t.id);
    try {
      const { recordTaskFeedback } = await import("./learning.server");
      await recordTaskFeedback(ctx.admin, {
        workspaceId: ws,
        taskId: t.id,
        employeeId: t.employee_id,
        kind: "edited",
        reason: "عدّل المالك المخرج من تيليجرام",
        originalText: t.output ?? "",
        editedText: text.trim(),
      });
    } catch {
      /* التعلم اختياري */
    }
    await viewTask(ctx, t.id, "✏️ <b>اتحفظ التعديل.</b> تقدر تعتمده دلوقتي.");
    return true;
  }
  if (wait.kind === "reject_reason" && wait.id) {
    await decideTask(ctx, wait.id, "rejected", text);
    await viewTask(ctx, wait.id, "✖️ <b>اترفضت، والموظف هيتعلم من ملاحظتك.</b>");
    return true;
  }
  return false;
}

export const BOT_COMMANDS = [
  { command: "menu", description: "القائمة الرئيسية" },
  { command: "team", description: "الفريق واختيار موظف" },
  { command: "history", description: "سجل المحادثات" },
  { command: "new", description: "محادثة جديدة مع الموظف الحالي" },
  { command: "approvals", description: "الموافقات المعلّقة" },
  { command: "tasks", description: "المهام" },
  { command: "skills", description: "قدرات الموظف الحالي" },
  { command: "integrations", description: "التكاملات والربط" },
  { command: "proposals", description: "مقترحات الفريق" },
  { command: "decisions", description: "القرارات" },
  { command: "brain", description: "معرفة الشركة" },
  { command: "automations", description: "الأتمتة" },
  { command: "briefing", description: "إحاطة اليوم" },
  { command: "calendar", description: "تقويم النشر" },
  { command: "autopilot", description: "الطيار الآلي" },
  { command: "rankings", description: "ترتيب الكلمات في جوجل" },
  { command: "analytics", description: "زيارات الموقع" },
  { command: "account", description: "حسابي وبيانات النشاط" },
  { command: "login", description: "دخول الموقع بضغطة" },
  { command: "settings", description: "الإعدادات والتنبيهات" },
  { command: "siraj", description: "سِراج — السوشيال" },
  { command: "nour", description: "نور — المحتوى والسيو" },
  { command: "dana", description: "دانة — التصميم" },
  { command: "adam", description: "آدم — التحليلات والإعلانات" },
  { command: "eva", description: "أمَل — المساعدة التنفيذية" },
  { command: "sam", description: "سالم — المبيعات" },
];

/** أوامر القوائم النصية → الشاشة المقابلة. */
export async function handleMenuCommand(ctx: UiCtx, command: string): Promise<boolean> {
  const map: Record<string, () => Promise<unknown>> = {
    menu: () => viewMenu(ctx),
    start: () => viewMenu(ctx),
    help: () => viewMenu(ctx),
    team: () => viewTeam(ctx),
    history: () => viewHistory(ctx, 0),
    tasks: () => viewTasks(ctx, "all"),
    approvals: () => viewApprovals(ctx),
    integrations: () => viewIntegrations(ctx),
    proposals: () => viewProposals(ctx),
    decisions: () => viewDecisions(ctx),
    brain: () => viewBrain(ctx),
    automations: () => viewAutomations(ctx),
    settings: () => viewSettings(ctx),
    briefing: () => import("./telegram-ui-extra.server").then((m) => m.viewBriefing(ctx)),
    calendar: () => import("./telegram-ui-extra.server").then((m) => m.viewCalendar(ctx)),
    autopilot: () => import("./telegram-ui-extra.server").then((m) => m.viewAutopilot(ctx)),
    rankings: () => import("./telegram-ui-extra.server").then((m) => m.viewRankings(ctx)),
    account: () => import("./telegram-ui-extra.server").then((m) => m.viewAccount(ctx)),
    login: () => import("./telegram-ui-extra.server").then((m) => m.handleAccountCallback(ctx, "zal", "")),
    analytics: () => import("./telegram-ui-extra.server").then((m) => m.viewAnalytics(ctx)),
    skills: () => (ctx.link.active_employee ? viewSkills(ctx, ctx.link.active_employee, 0) : viewTeam(ctx)),
  };
  const fn = map[command];
  if (!fn) return false;
  await fn();
  return true;
}
