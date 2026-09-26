/**
 * دوال الخادم لتنفيذ إجراءات الموظفين الحقيقية بعد اعتماد المالك.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { actionsFor } from "./employee-actions.server";

async function assertOwner(
  supabase: {
    rpc: (
      fn: "owns_workspace",
      args: { _workspace_id: string },
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  workspaceId: string,
) {
  const { data, error } = await supabase.rpc("owns_workspace", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Forbidden: لا تملك هذه مساحة العمل.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** قائمة الإجراءات المتاحة لموظف معيّن. */
export const listEmployeeActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ employeeId: z.string().min(2).max(20) }).parse(input),
  )
  .handler(({ data }) =>
    actionsFor(data.employeeId).map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      inputs: a.inputs,
    })),
  );

/** لقطة معاينة حية لصفحة النموذج قبل اعتماد إجراء المتصفح. */
export const previewBrowserAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ workspaceId: z.string().uuid(), url: z.string().url().max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, data.workspaceId);
    const { browsePage } = await import("./cloud-browser.server");
    const page = await browsePage(data.url, { screenshot: true });
    return { title: page?.title ?? null, screenshotUrl: page?.screenshotUrl ?? null };
  });

/** تنفيذ إجراء فعلي (إرسال بريد، حجز موعد، تحديث CRM…). */
export const runEmployeeAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        actionId: z.string().min(3).max(60),
        values: z.record(z.string(), z.string()).default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);
    const { runEmployeeActionServer } = await import("./employee-actions.server");
    const res = await runEmployeeActionServer(admin, {
      workspaceId: data.workspaceId,
      actionId: data.actionId,
      values: data.values,
    });
    // نعيد نتيجة JSON آمنة للتسلسل (الموظفون قد يعيدون كائنات منصات خام).
    const safe = JSON.parse(JSON.stringify(res.result ?? null)) as Json;
    return { actionId: res.actionId, provider: res.provider, ok: true as const, result: safe };
  });

/** مهمة تصفح متعددة الخطوات (قراءة وتنقل وبحث) — تتوقف عند أي خطوة حساسة. */
export const runBrowserTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        goal: z.string().trim().min(5).max(1500),
        startUrl: z.string().url().max(2000).optional(),
        resumeSessionId: z.string().max(100).optional(),
        maxSteps: z.number().int().min(1).max(15).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertOwner(context.supabase, data.workspaceId);
    const { enforceEmployeePolicy, recordAudit } = await import("./employee-policy.server");
    await enforceEmployeePolicy(admin, data.workspaceId, "eva", "eva-browser-task");
    const { runBrowserAgent } = await import("./browser-agent.server");
    const r = await runBrowserAgent(data);
    await recordAudit(admin, {
      workspaceId: data.workspaceId,
      employeeId: "eva",
      actionId: "eva-browser-task",
      provider: "browser",
      status: r.status === "error" ? "failed" : "done",
      values: { title: data.goal.slice(0, 120), url: data.startUrl ?? "" },
    });
    return JSON.parse(JSON.stringify(r)) as typeof r;
  });

/** جولة مقارنة بين 2–5 مواقع بجدول ومصادر. */
export const compareSitesTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        goal: z.string().trim().min(5).max(1000),
        urls: z.array(z.string().url().max(2000)).min(2).max(5),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, data.workspaceId);
    const { compareSites } = await import("./browser-agent.server");
    return compareSites({ goal: data.goal, urls: data.urls });
  });
