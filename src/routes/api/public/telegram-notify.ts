import { createFileRoute } from "@tanstack/react-router";

import { secretsMatch } from "@/lib/timing-safe";

/**
 * تنبيهات فورية على تيليجرام تُطلقها قاعدة البيانات عند أي تغيير مهم
 * (مهمة جاهزة للمراجعة، اعتماد/رفض من الموقع، فشل نشر، انقطاع/ربط تكامل،
 * مقترح جديد) — تحترم تفضيلات التنبيه في الإعدادات. محمي بترويسة x-cron-secret.
 */
type Body = { kind?: string; workspace_id?: string; ref?: string };

const PREF_FOR: Record<string, string | null> = {
  approval_ready: "approval_ready",
  publishing_failed: "publishing_failed",
  integration_disconnected: "integration_disconnected",
  proposal_new: "task_digest",
  integration_connected: null,
  task_done: null,
  task_rejected: null,
  post_published: null,
  decision_new: "task_digest",
  brain_new: null,
  briefing_ready: "weekly_summary",
  autopilot_paused: "publishing_failed",
};

export const Route = createFileRoute("/api/public/telegram-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const { data: valid } = await admin.rpc("verify_cron_token", { _name: "telegram-notify", _token: provided });
        if (valid !== true && !secretsMatch(provided, process.env["LOVABLE_CRON_SECRET"])) {
          return new Response("unauthorized", { status: 401 });
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("bad request", { status: 400 });
        }
        const kind = String(body.kind ?? "");
        const ws = String(body.workspace_id ?? "");
        const ref = String(body.ref ?? "");
        const uuid = /^[0-9a-f-]{36}$/i;
        if (!(kind in PREF_FOR) || !uuid.test(ws) || !uuid.test(ref)) {
          return new Response("bad request", { status: 400 });
        }

        // تفضيلات صاحب مساحة العمل.
        const pref = PREF_FOR[kind];
        if (pref) {
          const { data: wsRow } = await admin.from("workspaces").select("owner_id").eq("id", ws).maybeSingle();
          if (wsRow?.owner_id) {
            const { data: prefs } = await admin
              .from("notification_preferences")
              .select("*")
              .eq("user_id", wsRow.owner_id)
              .maybeSingle();
            if (prefs && (prefs as Record<string, unknown>)[pref] === false) return Response.json({ ok: true, muted: true });
          }
        }

        const { data: links } = await admin
          .from("command_links")
          .select("id, workspace_id, status, active_employee, conversation_ids, pending_input, external_id")
          .eq("channel", "telegram")
          .eq("status", "active")
          .eq("workspace_id", ws);
        if (!links?.length) return Response.json({ ok: true, links: 0 });

        const { loadTelegramConfig, platformBotToken, tg } = await import("@/lib/telegram.server");
        const ui = await import("@/lib/telegram-ui.server");
        const config = await loadTelegramConfig(admin, ws).catch(() => null);
        const tokens = [
          ...(config && !config.shared && config.botToken ? [config.botToken] : []),
          await platformBotToken(),
        ].filter(Boolean);

        // نص وأزرار التنبيه.
        let html = "";
        let kb: { text: string; callback_data?: string; url?: string }[][] = [];
        const { byId } = await import("@/lib/telegram-format");
        const { providerLabel } = await import("@/lib/platforms");
        const name = (id: string) => byId(id)?.name ?? id;

        if (kind === "approval_ready" || kind === "task_done" || kind === "task_rejected") {
          const { data: t } = await admin.from("tasks").select("id, employee_id, title").eq("id", ref).maybeSingle();
          if (!t) return Response.json({ ok: true });
          if (kind === "approval_ready") {
            html = `🟡 <b>${ui.esc(name(t.employee_id))}</b> خلّص «${ui.esc(t.title)}» — جاهز لمراجعتك.`;
            kb = [
              [
                { text: "👀 راجع", callback_data: `tv:${t.id}` },
                { text: "✅ اعتماد", callback_data: `aa:${t.id}` },
              ],
            ];
          } else {
            html = kind === "task_done" ? `✅ اتعتمد «${ui.esc(t.title)}» من الموقع.` : `✖️ اترفض «${ui.esc(t.title)}» من الموقع.`;
          }
        } else if (kind === "publishing_failed") {
          const { data: p } = await admin.from("social_posts").select("provider, last_error, body").eq("id", ref).maybeSingle();
          if (!p) return Response.json({ ok: true });
          html = `⚠️ <b>فشل النشر على ${ui.esc(providerLabel(p.provider))}</b>\n${ui.esc((p.last_error ?? "").slice(0, 400))}\n\n«${ui.esc(p.body.slice(0, 200))}»`;
          kb = [[{ text: "🔌 التكاملات", callback_data: "i" }, { text: "🏠 القائمة", callback_data: "m" }]];
        } else if (kind === "integration_disconnected" || kind === "integration_connected") {
          const { data: i } = await admin.from("integrations").select("provider, account").eq("id", ref).maybeSingle();
          if (!i) return Response.json({ ok: true });
          html =
            kind === "integration_connected"
              ? `🟢 اتربط <b>${ui.esc(providerLabel(i.provider))}</b>${i.account ? ` (${ui.esc(i.account)})` : ""} — الفريق يقدر يستخدمه دلوقتي.`
              : `🔴 <b>${ui.esc(providerLabel(i.provider))}</b> اتفصل. الموظفين مش هيقدروا يستخدموه لحد ما تربطه تاني.`;
          if (kind === "integration_disconnected") kb = [[{ text: "🔗 اربط تاني", callback_data: `ic:${i.provider}`.slice(0, 60) }]];
        } else if (kind === "proposal_new") {
          const { data: p } = await admin.from("proposals").select("id, employee_id, title, reason").eq("id", ref).maybeSingle();
          if (!p) return Response.json({ ok: true });
          html = `💡 <b>${ui.esc(name(p.employee_id))}</b> بيقترح: ${ui.esc(p.title)}\n${ui.esc(p.reason.slice(0, 300))}`;
          kb = [[{ text: "🚀 نفّذ", callback_data: `pa:${p.id}` }, { text: "🙈 تجاهل", callback_data: `pd:${p.id}` }]];
        }
        else if (kind === "post_published") {
          const { data: p } = await admin.from("social_posts").select("id, provider, body, remote_ref").eq("id", ref).maybeSingle();
          if (!p) return Response.json({ ok: true });
          html = `✅ <b>اتنشر على ${ui.esc(providerLabel(p.provider))}</b>\n«${ui.esc(p.body.slice(0, 250))}»`;
          kb = [[{ text: "🗓️ التقويم", callback_data: "zc" }, { text: "👀 المنشور", callback_data: `zcv:${p.id}` }]];
        } else if (kind === "decision_new") {
          const { data: d } = await admin.from("decisions").select("id, employee_id, title, decision").eq("id", ref).maybeSingle();
          if (!d) return Response.json({ ok: true });
          html = `📌 <b>قرار جديد</b> — ${ui.esc(name(d.employee_id))}\n<b>${ui.esc(d.title)}</b>\n${ui.esc(d.decision.slice(0, 300))}`;
          kb = [[{ text: "📌 القرارات", callback_data: "d" }]];
        } else if (kind === "brain_new") {
          const { data: b } = await admin.from("brain_items").select("id, title").eq("id", ref).maybeSingle();
          if (!b) return Response.json({ ok: true });
          html = `🧠 اتضاف للمعرفة من الموقع: <b>${ui.esc(b.title)}</b>`;
          kb = [[{ text: "🧠 المعرفة", callback_data: `bv:${b.id}` }]];
        } else if (kind === "briefing_ready") {
          html = "☀️ <b>إحاطة النهارده جاهزة</b> — ملخص الموافقات والمنشورات والترتيب والأفكار.";
          kb = [[{ text: "☀️ افتح الإحاطة", callback_data: "zb" }]];
        }
        else if (kind === "autopilot_paused") {
          const { data: a } = await admin.from("social_autopilot").select("paused_reason").eq("id", ref).maybeSingle();
          if (!a?.paused_reason) return Response.json({ ok: true });
          html = `⏸️ <b>الطيار الآلي توقف</b>\n${ui.esc(a.paused_reason.slice(0, 400))}`;
          kb = [[{ text: "⚙️ اضبط الطيار", callback_data: "zos" }, { text: "▶️ شغّله تاني", callback_data: "zot" }]];
        }
        if (!html) return Response.json({ ok: true });

        let sent = 0;
        for (const link of links) {
          const state = ui.readPending(link as unknown as import("@/lib/telegram-ui.server").LinkRow);
          // تغيير عمله المالك من تيليجرام نفسه، أو رد جارٍ سيعرض المهمة بنفسه → لا نكرر.
          if (state.quiet?.id === ref && Date.now() - state.quiet.at < 120_000) continue;
          if (kind === "approval_ready" && state.busyUntil && state.busyUntil > Date.now()) continue;
          for (const token of tokens) {
            try {
              await tg(token, "sendMessage", {
                chat_id: link.external_id,
                text: html,
                parse_mode: "HTML",
                ...(kb.length ? { reply_markup: { inline_keyboard: kb } } : {}),
                link_preview_options: { is_disabled: true },
              });
              sent++;
              break;
            } catch {
              /* جرّب البوت التالي */
            }
          }
        }
        return Response.json({ ok: true, sent });
      },
    },
  },
});
