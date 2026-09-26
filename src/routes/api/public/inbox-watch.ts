import { createFileRoute } from "@tanstack/react-router";

import { secretsMatch } from "@/lib/timing-safe";

/**
 * فحص البريد الدوري (كل ساعة): لكل مساحة عمل مربوط بها Gmail، تكتشف أمَل الرسائل
 * العاجلة أو الاحتيالية وتنبّه المالك فوراً على تيليجرام — مرة واحدة لكل رسالة.
 * لا يُرسل أي رد تلقائياً. محمي بترويسة x-cron-secret.
 */
const MAX_WORKSPACES = 25;

export const Route = createFileRoute("/api/public/inbox-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const { data: valid } = await admin.rpc("verify_cron_token", { _name: "inbox-watch", _token: provided });
        if (valid !== true && !secretsMatch(provided, process.env["LOVABLE_CRON_SECRET"])) {
          return new Response("unauthorized", { status: 401 });
        }

        const { data: accounts } = await admin
          .from("pipedream_accounts")
          .select("workspace_id")
          .eq("provider", "gmail")
          .eq("status", "connected")
          .limit(MAX_WORKSPACES);
        const ids = [...new Set((accounts ?? []).map((a) => a.workspace_id))];
        if (!ids.length) return Response.json({ ok: true, workspaces: 0 });

        const { scanWorkspaceInbox } = await import("@/lib/inbox-watch.server");
        const { loadTelegramConfig, platformBotToken, tg } = await import("@/lib/telegram.server");
        const { esc } = await import("@/lib/telegram-ui.server");
        const db = admin as any;
        const report: { workspaceId: string; alerts: number; note?: string }[] = [];

        for (const ws of ids) {
          try {
            const { items } = await scanWorkspaceInbox(ws);
            const important = items.filter((i) => i.scam || (i.urgency === "high" && i.needsReply));
            let sent = 0;
            if (important.length) {
              const { data: links } = await admin
                .from("command_links")
                .select("external_id")
                .eq("channel", "telegram")
                .eq("status", "active")
                .eq("workspace_id", ws);
              const config = await loadTelegramConfig(admin, ws).catch(() => null);
              const token = (config && !config.shared && config.botToken) || (await platformBotToken());
              const { data: waLinks } = await admin
                .from("command_links")
                .select("external_id")
                .eq("channel", "whatsapp")
                .eq("status", "active")
                .eq("workspace_id", ws);
              const { whatsappCreds, sendWhatsapp } = await import("@/lib/whatsapp.server");
              const waCreds = waLinks?.length ? await whatsappCreds(admin, ws).catch(() => null) : null;
              for (const it of important) {
                // مرة واحدة لكل رسالة: القيد الفريد يمنع التكرار بين الدورات.
                const { error } = await db.from("inbox_alerts").insert({
                  workspace_id: ws,
                  message_id: it.id,
                  kind: it.scam ? "scam" : "urgent",
                  subject: it.subject.slice(0, 300),
                  sender: it.from.slice(0, 300),
                  summary: it.summary.slice(0, 500),
                });
                if (error) continue;
                let delivered = false;
                if (token && links?.length) {
                  const html = it.scam
                    ? `🚨 <b>تحذير احتيال</b> — أمَل\nمن: ${esc(it.from)}\n«${esc(it.subject)}»\n${esc(it.scamReason || it.summary)}\n\nلا تضغط أي رابط ولا ترد.`
                    : `📬 <b>رسالة عاجلة تنتظر ردك</b> — أمَل\nمن: ${esc(it.from)}\n«${esc(it.subject)}»\n${esc(it.summary)}\n\nالرد جاهز في صفحة «رسائل بانتظار ردك».`;
                  for (const l of links) {
                    await tg(token, "sendMessage", { chat_id: l.external_id, text: html, parse_mode: "HTML" }).catch(() => null);
                  }
                  delivered = true;
                }
                if (waCreds && waLinks?.length) {
                  const text = it.scam
                    ? `🚨 *تحذير احتيال* — أمَل\nمن: ${it.from}\n«${it.subject}»\n${it.scamReason || it.summary}\n\nلا تضغط أي رابط ولا ترد.`
                    : `📬 *رسالة عاجلة تنتظر ردك* — أمَل\nمن: ${it.from}\n«${it.subject}»\n${it.summary}\n\nالرد جاهز في صفحة «رسائل بانتظار ردك».`;
                  for (const l of waLinks) {
                    await sendWhatsapp(waCreds, String(l.external_id).replace(/\D/g, ""), text.slice(0, 3500)).catch(() => null);
                  }
                  delivered = true;
                }
                if (delivered) sent += 1;
              }
            }
            report.push({ workspaceId: ws, alerts: sent });
          } catch (e) {
            report.push({ workspaceId: ws, alerts: 0, note: String(e).slice(0, 160) });
          }
        }
        return Response.json({ ok: true, workspaces: report.length, report });
      },
    },
  },
});
