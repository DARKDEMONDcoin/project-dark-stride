/**
 * عرض نتيجة دور الموظف (runEmployeeTurn) على تيليجرام بنفس مخرجات الموقع:
 * النص كاملاً، الصور (المولّدة + صور الرد)، كل المهام الجاهزة بأزرارها،
 * الإجراء المعلّق، وطلب الربط. يُستخدم لرسائل تيليجرام ولمرآة شات الموقع.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { extractPostMedia } from "./post-format";
import { tg } from "./telegram.server";
import { markdownToTelegramHtml, splitForTelegram } from "./telegram-format";

type Admin = SupabaseClient<Database>;

const ROLES: Record<string, string> = {
  sonny: "مدير السوشيال ميديا",
  eva: "المساعدة التنفيذية",
  sam: "مسؤول المبيعات",
  nour: "المحتوى والسيو",
  dana: "التصميم والهوية",
  adam: "البيانات والحملات",
};

export type TurnResultLike = {
  reply?: string;
  imageUrl?: string | null;
  createdTaskId?: string | null;
  needsConnection?: unknown;
  action?: { id: string; provider: string; label: string; values: Record<string, string> } | null;
  sources?: { title: string; url: string }[];
};

export async function sendMarkdown(botToken: string, chatId: number, markdown: string) {
  const html = markdownToTelegramHtml(markdown);
  for (const part of splitForTelegram(html)) {
    try {
      await tg(botToken, "sendMessage", {
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch {
      await tg(botToken, "sendMessage", { chat_id: chatId, text: part.replace(/<[^>]+>/g, "") });
    }
  }
}

async function sendImages(botToken: string, chatId: number, images: { url: string; alt: string }[], caption?: string) {
  if (!images.length) return;
  if (images.length === 1) {
    const html = caption ? markdownToTelegramHtml(caption).slice(0, 1024) : undefined;
    await tg(botToken, "sendPhoto", {
      chat_id: chatId,
      photo: images[0]!.url,
      caption: html || images[0]!.alt.slice(0, 900) || undefined,
      ...(html ? { parse_mode: "HTML" } : {}),
    });
    return;
  }
  for (let i = 0; i < images.length; i += 10) {
    const group = images.slice(i, i + 10).map((img, index) => ({
      type: "photo",
      media: img.url,
      ...(i === 0 && index === 0 && caption
        ? { caption: markdownToTelegramHtml(caption).slice(0, 1024), parse_mode: "HTML" }
        : img.alt
          ? { caption: img.alt.slice(0, 900) }
          : {}),
    }));
    await tg(botToken, "sendMediaGroup", { chat_id: chatId, media: group }).catch(async () => {
      for (const img of images.slice(i, i + 10)) {
        await tg(botToken, "sendPhoto", { chat_id: chatId, photo: img.url }).catch(() => null);
      }
    });
  }
}

export async function deliverTurn(
  admin: Admin,
  opts: {
    botToken: string;
    chatId: number;
    link: import("./telegram-ui.server").LinkRow;
    workspaceId: string;
    employeeId: string;
    employeeName: string;
    startedAt: string;
    result: TurnResultLike;
    header?: string;
  },
) {
  const { botToken, chatId, result } = opts;
  const ui = await import("./telegram-ui.server");
  const ctx = { admin, botToken, chatId, link: opts.link };

  await ui.writePending(admin, opts.link, {
    busyUntil: null,
    ...(result.action ? { action: { ...result.action, employeeId: opts.employeeId } } : {}),
  });
  if (result.action) await ui.viewPendingAction(ctx);

  // كل المخرجات التي أنشأها هذا الدور (الموقع يعرضها كلها، لا الأولى فقط).
  const { data: tasks } = await admin
    .from("tasks")
    .select("id")
    .eq("workspace_id", opts.workspaceId)
    .eq("employee_id", opts.employeeId)
    .gte("created_at", opts.startedAt)
    .order("created_at", { ascending: true })
    .limit(15);
  const ids = new Set<string>((tasks ?? []).map((t) => t.id));
  if (result.createdTaskId) ids.add(result.createdTaskId);
  // عند وجود مخرج منظم، تعرض بطاقة المراجعة النص والصورة مرة واحدة؛ لا نكرر الرد الخام
  // ولا نضيف اسم الموظف أو وصف الصورة أو موعدها إلى النص القابل للنشر.
  if (!ids.size) {
    const { text, images } = extractPostMedia(String(result.reply ?? "").trim() || "خلصت 👌");
    if (result.imageUrl && !images.some((i) => i.url === result.imageUrl)) images.unshift({ url: result.imageUrl, alt: "" });
    const { byId } = await import("./telegram-format");
    const member = byId(opts.employeeId);
    const header = opts.header ?? (member ? `**${member.name}${ROLES[member.id] ? ` — ${ROLES[member.id]}` : ""}**` : `**${opts.employeeName}**`);
    const seen = new Set<string>();
    const sources = (result.sources ?? []).filter((s) => {
      let host = "";
      try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { return false; }
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      (s as { host?: string }).host = host;
      return true;
    });
    const srcBlock = sources.length
      ? `\n\n**🔗 المصادر:**\n${sources
          .map((s, i) => `${i + 1}. [${(s.title || (s as { host?: string }).host || "مصدر").replace(/[[\]]/g, "").slice(0, 70)}](${s.url})`)
          .join("\n")}`
      : "";
    if (images.length && text.length <= 900) await sendImages(botToken, chatId, images, `${header}\n\n${text}`);
    else {
      await sendMarkdown(botToken, chatId, `${header}\n\n${text || "خلصت 👌"}${srcBlock}`);
      await sendImages(botToken, chatId, images);
    }
    if (images.length && text.length <= 900 && srcBlock) await sendMarkdown(botToken, chatId, srcBlock.trim());
    await tg(botToken, "sendMessage", {
      chat_id: chatId,
      text: "تحب أعمل إيه بعد كده؟",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 المهام", callback_data: "t:all" }, { text: "✅ الموافقات", callback_data: "ap" }],
          [{ text: "🏠 القائمة", callback_data: "m" }],
        ],
      },
    }).catch(() => null);
  }
  let n = 0;
  for (const id of ids) {
    n++;
    await ui.viewTask(ctx, id, ids.size > 1 ? `🟡 <b>مخرج ${n} من ${ids.size} جاهز لمراجعتك:</b>` : "🟡 <b>مخرج جاهز لمراجعتك:</b>");
  }

  if (result.needsConnection) {
    const nc = result.needsConnection as { provider?: string; providers?: string[] };
    const provider = nc.provider ?? nc.providers?.[0];
    await tg(botToken, "sendMessage", {
      chat_id: chatId,
      text: "🔌 الطلب ده محتاج ربط منصة الأول.",
      reply_markup: {
        inline_keyboard: [[provider ? { text: "🔗 اربط الآن", callback_data: `ic:${provider}`.slice(0, 60) } : { text: "🔌 التكاملات", callback_data: "i" }]],
      },
    }).catch(() => null);
  }
}

/** مرآة شات الموقع → تيليجرام: رسالة المالك ورد الموظف بنفس الشكل، ونفس المحادثة. */
export async function mirrorSiteTurn(args: {
  workspaceId: string;
  employeeId: string;
  conversationId: string;
  message: string;
  startedAt: string;
  result: TurnResultLike;
}) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: links } = await admin
    .from("command_links")
    .select("id, workspace_id, status, active_employee, conversation_ids, pending_input")
    .eq("workspace_id", args.workspaceId)
    .eq("channel", "telegram")
    .eq("status", "active");
  if (!links?.length) return;
  const { platformBotToken } = await import("./telegram.server");
  const botToken = await platformBotToken();
  if (!botToken) return;
  const { byId } = await import("./telegram-format");
  const member = byId(args.employeeId);
  for (const link of links) {
    const chatId = Number((await admin.from("command_links").select("external_id").eq("id", link.id).single()).data?.external_id);
    if (!Number.isFinite(chatId)) continue;
    try {
      const ids = { ...((link.conversation_ids ?? {}) as Record<string, string>), [args.employeeId]: args.conversationId };
      await admin.from("command_links").update({ active_employee: args.employeeId, conversation_ids: ids }).eq("id", link.id);
      await sendMarkdown(botToken, chatId, `🖥️ **من الموقع — أنت:**\n${args.message.slice(0, 1500)}`);
      await deliverTurn(admin, {
        botToken,
        chatId,
        link: { ...link, active_employee: args.employeeId, conversation_ids: ids } as unknown as import("./telegram-ui.server").LinkRow,
        workspaceId: args.workspaceId,
        employeeId: args.employeeId,
        employeeName: member?.name ?? args.employeeId,
        startedAt: args.startedAt,
        result: args.result,
      });
    } catch (e) {
      console.error("[telegram] site mirror failed:", e);
    }
  }
}
