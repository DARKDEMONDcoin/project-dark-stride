/**
 * صلاحيات الموظفين + سجل التنفيذ. يُفحص قبل كل إجراء حقيقي (موقع وتيليجرام)
 * بجانب طلب الموافقة — الصلاحية تمنع، ولا تمنح تنفيذاً بلا موافقة أبداً.
 */
type Db = { from: (t: string) => any };

export type Policy = {
  enabled: boolean;
  can_send: boolean;
  can_publish: boolean;
  can_browse: boolean;
  daily_action_cap: number;
};

export const DEFAULT_POLICY: Policy = {
  enabled: true,
  can_send: true,
  can_publish: true,
  can_browse: true,
  daily_action_cap: 50,
};

export function actionCategory(actionId: string): "send" | "publish" | "browse" | "other" {
  const a = actionId.toLowerCase();
  if (/browser|form|browse/.test(a)) return "browse";
  if (/publish|post|tweet|reel|story|wordpress|webflow|ghost|shopify-product|indexnow/.test(a)) return "publish";
  if (/send|email|mail|message|whatsapp|slack|sms|telegram|discord|invite|reply/.test(a)) return "send";
  return "other";
}

export async function loadPolicy(db: Db, workspaceId: string, employeeId: string): Promise<Policy> {
  const { data } = await db
    .from("employee_policies")
    .select("enabled, can_send, can_publish, can_browse, daily_action_cap")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  return { ...DEFAULT_POLICY, ...(data ?? {}) };
}

export async function enforceEmployeePolicy(db: Db, workspaceId: string, employeeId: string, actionId: string) {
  const p = await loadPolicy(db, workspaceId, employeeId);
  if (!p.enabled) throw new Error("هذا الموظف موقوف من صفحة الصلاحيات — فعّله أولاً.");
  const cat = actionCategory(actionId);
  if (cat === "send" && !p.can_send) throw new Error("صلاحية الإرسال مغلقة لهذا الموظف من صفحة الصلاحيات.");
  if (cat === "publish" && !p.can_publish) throw new Error("صلاحية النشر مغلقة لهذا الموظف من صفحة الصلاحيات.");
  if (cat === "browse" && !p.can_browse) throw new Error("صلاحية التصفح مغلقة لهذا الموظف من صفحة الصلاحيات.");
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db
    .from("action_audit")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .eq("status", "done")
    .gte("created_at", since);
  if ((count ?? 0) >= p.daily_action_cap) {
    throw new Error(`بلغ الموظف حدّه اليومي (${p.daily_action_cap} إجراء). ارفع الحد من صفحة الصلاحيات أو انتظر للغد.`);
  }
}

export async function recordAudit(
  db: Db,
  e: {
    workspaceId: string;
    employeeId: string;
    actionId: string;
    provider: string | null;
    status: "done" | "failed" | "blocked";
    values?: Record<string, string>;
    detail?: string;
  },
) {
  const v = e.values ?? {};
  // ملخص بلا بيانات حساسة: المستلم/العنوان فقط، لا نصوص كاملة ولا كلمات مرور.
  const summary = [v["to"], v["subject"], v["title"], v["url"]].filter(Boolean).join(" · ").slice(0, 300) || null;
  await db
    .from("action_audit")
    .insert({
      workspace_id: e.workspaceId,
      employee_id: e.employeeId,
      action_id: e.actionId,
      provider: e.provider,
      status: e.status,
      summary,
      detail: e.detail?.slice(0, 500) ?? null,
    })
    .then(
      () => null,
      () => null,
    );
}
