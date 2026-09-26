import { createFileRoute } from "@tanstack/react-router";

import { secretsMatch } from "@/lib/timing-safe";

/**
 * ويبهوك تيليجرام: يستقبل رسائل صاحب البيزنس ويرد بمسودة أو بنتيجة الطلب.
 * يدعم وضعين: بوت خاص بكل مساحة عمل (‎?ws=…‎)، وبوت سهل المشترك (‎?shared=1‎)
 * حيث نستنتج مساحة العمل من المحادثة نفسها. الأمان: سرّ مشتق من توكن البوت.
 */
type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id?: number; chat?: { id?: number } };
  };
};

const setupDone = new Set<string>();
const SAHL_BOT_NAME = "سهل";
const SAHL_BOT_SHORT_DESCRIPTION =
  "فريقك العربي بالذكاء الاصطناعي، جاهز لتنفيذ شغلك من Telegram.";
const SAHL_BOT_DESCRIPTION =
  "فريقك الذكي في مكان واحد:\n\n📱 سِراج — السوشيال ميديا\n🔎 نور — المحتوى والسيو\n🎨 دانة — التصميم والهوية\n💼 سالم — المبيعات والعملاء\n📅 أمَل — التنظيم والمهام\n📊 آدم — البيانات والإعلانات\n\nاكتب ما تريد، وسيتولى الموظف المناسب تنفيذه.\nكل شيء متزامن مع حسابك على سهل.";
/** يضمن أن الويبهوك يستقبل ضغطات الأزرار وأن قائمة الأوامر مسجّلة (مرة لكل بوت). */
async function ensureBotSetup(botToken: string, requestUrl: string, shared: boolean) {
  if (setupDone.has(botToken)) return;
  setupDone.add(botToken);
  try {
    const { tg, webhookSecret } = await import("@/lib/telegram.server");
    const { BOT_COMMANDS } = await import("@/lib/telegram-ui.server");
    const info = await tg<{ url?: string; allowed_updates?: string[] }>(botToken, "getWebhookInfo");
    if (info.url && !(info.allowed_updates ?? []).includes("callback_query")) {
      await tg(botToken, "setWebhook", {
        url: info.url || requestUrl,
        secret_token: await webhookSecret(botToken),
        allowed_updates: ["message", "edited_message", "channel_post", "callback_query"],
        drop_pending_updates: false,
      });
    }
    await tg(botToken, "setMyCommands", { commands: BOT_COMMANDS });
    await tg(botToken, "setChatMenuButton", { menu_button: { type: "commands" } }).catch(() => null);
    if (shared) {
      await Promise.all([
        tg(botToken, "setMyName", { name: SAHL_BOT_NAME }),
        tg(botToken, "setMyShortDescription", { short_description: SAHL_BOT_SHORT_DESCRIPTION }),
        tg(botToken, "setMyDescription", { description: SAHL_BOT_DESCRIPTION }),
      ]);
    }
  } catch (e) {
    setupDone.delete(botToken);
    console.error("[telegram] bot setup failed:", e);
  }
}
type TgMessage = {
  chat?: { id?: number; title?: string; username?: string; type?: string };
  from?: { id?: number };
  message_id?: number;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string; file_name?: string };
  video_note?: { file_id: string; duration?: number };
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
};

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const shared = params.get("shared") === "1";
        const wsParam = params.get("ws") ?? "";
        if (!shared && !/^[0-9a-f-]{36}$/i.test(wsParam)) {
          return new Response("bad request", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          loadTelegramConfig,
          webhookSecret,
          telegramReply,
          platformBotToken,
          workspaceForChat,
        } = await import("@/lib/telegram.server");

        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        let botToken = "";
        if (shared) {
          botToken = await platformBotToken();
          if (!botToken) return new Response("not found", { status: 404 });
        } else {
          const config = await loadTelegramConfig(supabaseAdmin, wsParam);
          if (!config) return new Response("not found", { status: 404 });
          botToken = config.botToken;
        }
        if (!secretsMatch(provided, await webhookSecret(botToken))) {
          return new Response("forbidden", { status: 403 });
        }

        let update: TgUpdate;
        try {
          update = (await request.json()) as TgUpdate;
        } catch {
          return new Response("bad request", { status: 400 });
        }

        // مرة لكل بوت: نفعّل استقبال الأزرار ونسجّل قائمة الأوامر.
        void ensureBotSetup(botToken, request.url, shared);

        // ── ضغطة زر في القوائم التفاعلية ──
        const cb = update.callback_query;
        if (cb?.id) {
          const cbChat = cb.message?.chat?.id;
          const { tg } = await import("@/lib/telegram.server");
          let toast: string | undefined;
          try {
            if (typeof cbChat === "number" && cb.data) {
              const { data: link } = await supabaseAdmin
                .from("command_links")
                .select("id, workspace_id, status, active_employee, conversation_ids, pending_input")
                .eq("channel", "telegram")
                .eq("external_id", String(cbChat))
                .maybeSingle();
              if (!link || link.status !== "active") {
                const { handleOnboardingCallback } = await import("@/lib/telegram-onboarding.server");
                toast = await handleOnboardingCallback(
                  { admin: supabaseAdmin, botToken, chatId: cbChat },
                  cb.data,
                );
              } else {
                const { handleCallback } = await import("@/lib/telegram-ui.server");
                toast = await handleCallback(
                  {
                    admin: supabaseAdmin,
                    botToken,
                    chatId: cbChat,
                    link,
                    ...(cb.message?.message_id ? { messageId: cb.message.message_id } : {}),
                  },
                  cb.data,
                );
              }
            }
          } catch (e) {
            console.error("[telegram] callback failed:", e);
            toast = `تعذّر التنفيذ: ${(e instanceof Error ? e.message : "").slice(0, 150)}`;
          }
          await tg(botToken, "answerCallbackQuery", {
            callback_query_id: cb.id,
            ...(toast ? { text: toast.slice(0, 190) } : {}),
          }).catch(() => null);
          return Response.json({ ok: true });
        }

        const message =
          update.message ??
          update.edited_message ??
          update.channel_post ??
          update.edited_channel_post;
        const chatId = message?.chat?.id;
        if (!message || typeof chatId !== "number") return Response.json({ ok: true });

        const text = (message.text ?? message.caption ?? "").trim();

        // مع بوت سهل المشترك نعرف صاحب المحادثة من قنوات التحكّم المسجّلة.
        let workspaceId = wsParam;
        if (shared) {
          const resolved = await workspaceForChat(supabaseAdmin, String(chatId));
          if (!resolved) {
            // تسجيل مباشر من البوت أو ربط بكود/رابط — بلا حاجة لفتح الموقع.
            if (message.chat?.type && message.chat.type !== "private") {
              await telegramReply(botToken, chatId, "ابدأ مع سهل من محادثة خاصة مع البوت.").catch(() => null);
              return Response.json({ ok: true });
            }
            const { handleOnboardingMessage } = await import("@/lib/telegram-onboarding.server");
            const from = message.from as { first_name?: string } | undefined;
            await handleOnboardingMessage(
              { admin: supabaseAdmin, botToken, chatId },
              text || "/start",
              from?.first_name,
            ).catch((e) => console.error("[telegram] onboarding failed:", e));
            return Response.json({ ok: true });
          }
          workspaceId = resolved;
        }
        void workspaceId;

        try {
          // محادثة المالك الخاصة: فريق سهل كامل (نص/صوت/صور/ملفات) بعقل الموقع نفسه.
          // منشورات القنوات والمحادثات غير المربوطة تبقى على المسار القديم.
          const isChannel = Boolean(update.channel_post ?? update.edited_channel_post);
          if (!isChannel && !update.edited_message) {
            const { handleTelegramTeam } = await import("@/lib/telegram-team.server");
            const handled = await handleTelegramTeam(supabaseAdmin, {
              botToken,
              chatId,
              ...(typeof update.update_id === "number" ? { updateId: update.update_id } : {}),
              message,
            });
            if (handled) return Response.json({ ok: true });
          }
          if (!text) {
            await telegramReply(
              botToken,
              chatId,
              "أرسل طلبك نصاً من فضلك — أتعامل حالياً مع الرسائل النصية.",
            );
            return Response.json({ ok: true });
          }
          const { handleCommandMessage } = await import("@/lib/command-core.server");
          const reply = await handleCommandMessage(supabaseAdmin, {
            channel: "telegram",
            externalId: String(chatId),
            text,
          });
          await telegramReply(botToken, chatId, reply);
        } catch (e) {
          const detail = e instanceof Error ? e.message : "خطأ غير معروف";
          console.error("[telegram] handling failed:", detail);
          try {
            await telegramReply(botToken, chatId, `تعذّر تنفيذ الطلب: ${detail.slice(0, 300)}`);
          } catch {
            /* تجاهل فشل الإبلاغ */
          }
        }

        // تيليجرام يعيد الإرسال عند أي رد غير ناجح — نرد دائماً بنجاح بعد المعالجة.
        return Response.json({ ok: true });
      },
    },
  },
});
