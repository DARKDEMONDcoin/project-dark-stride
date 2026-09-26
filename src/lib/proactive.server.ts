/**
 * المجدول الاستباقي — الموظف لا ينتظر أن تطلب. كل يوم يقرأ بيانات مساحة العمل
 * الحقيقية (الطابور، الموافقات، التقارير، الكلمات، الحسابات المربوطة) ويقترح
 * ما ينبغي عمله الآن مع سببه. لا اقتراح بلا إشارة حقيقية من بياناتك.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type ProposalDraft = {
  employeeId: string;
  /** القدرة التي تُنفَّذ عند القبول (اختيارية: بعض الاقتراحات تنبيه فقط). */
  skillId?: string;
  /** مفتاح ثابت للإشارة — يمنع تكرار نفس الاقتراح. */
  signal: string;
  title: string;
  reason: string;
  impact: string;
  priority: number;
  values: Record<string, string>;
};

const DAY = 86_400_000;

/** يقرأ الإشارات الحقيقية ويحوّلها إلى اقتراحات مرتبة بالأولوية. */
export async function detectProposals(
  client: Client,
  workspaceId: string,
): Promise<ProposalDraft[]> {
  const now = Date.now();
  const soon = new Date(now + 3 * DAY).toISOString();
  const nowIso = new Date(now).toISOString();

  const [workspaceRes, scheduledRes, reviewRes, reportRes, keywordsRes, connectedRes] =
    await Promise.all([
      client
        .from("workspaces")
        .select("name, industry, tone, country")
        .eq("id", workspaceId)
        .maybeSingle(),
      client
        .from("social_posts")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .gte("scheduled_at", nowIso)
        .lte("scheduled_at", soon),
      client
        .from("tasks")
        .select("id, title, employee_id, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "review")
        .order("created_at", { ascending: true })
        .limit(50),
      client
        .from("tasks")
        .select("id, created_at")
        .eq("workspace_id", workspaceId)
        .eq("employee_id", "adam")
        .gte("created_at", new Date(now - 21 * DAY).toISOString())
        .limit(1),
      client
        .from("tracked_keywords")
        .select("keyword, domain")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .limit(20),
      client
        .from("integrations")
        .select("provider, employee_id")
        .eq("workspace_id", workspaceId)
        .eq("status", "connected"),
    ]);

  const workspace = workspaceRes.data;
  if (!workspace) return [];

  const business = `${workspace.name} — ${workspace.industry}`;
  const drafts: ProposalDraft[] = [];

  // ١) الطابور فارغ للأيام الثلاثة القادمة: أهم فجوة في أي حساب سوشيال.
  if (!(scheduledRes.data ?? []).length) {
    drafts.push({
      employeeId: "sonny",
      skillId: "weekly-batch",
      signal: "sonny:empty-queue-3d",
      title: "طابور النشر فارغ للأيام الثلاثة القادمة",
      reason: "لا يوجد أي منشور مجدول حتى بعد ثلاثة أيام، والانقطاع يخفض الوصول بسرعة.",
      impact: "دفعة أسبوعية جاهزة (٥ منشورات) تحفظ استمرارية الحساب.",
      priority: 1,
      values: { business, count: "5" },
    });
  }

  // ٢) موافقات متأخرة: عمل جاهز محتجز بانتظارك.
  const aging = (reviewRes.data ?? []).filter(
    (t) => now - new Date(t.created_at).getTime() > 3 * DAY,
  );
  if (aging.length) {
    drafts.push({
      employeeId: aging[0]?.employee_id ?? "sonny",
      signal: "workspace:aging-approvals",
      title: `${aging.length} مخرجاً جاهزاً ينتظر اعتمادك`,
      reason: `أقدمها «${aging[0]?.title ?? ""}» بانتظار المراجعة منذ أكثر من ثلاثة أيام.`,
      impact: "اعتمادها الآن يحوّل عملاً منجزاً إلى نتيجة فعلية على الأرض.",
      priority: 1,
      values: {},
    });
  }

  // ٣) لا تقرير أداء منذ ثلاثة أسابيع: قرارات تُتخذ بلا أرقام.
  if (!(reportRes.data ?? []).length) {
    drafts.push({
      employeeId: "adam",
      skillId: "performance-report",
      signal: "adam:stale-report-21d",
      title: "لا تقرير أداء منذ ثلاثة أسابيع",
      reason: "آخر عمل لآدم أقدم من ٢١ يوماً، فأنت تقرّر الآن بلا صورة رقمية محدّثة.",
      impact: "تقرير بالأرقام الحقيقية مع قرارات مرتبة بالأثر × الجهد.",
      priority: 2,
      values: { focus: "الزيارات والتحويلات وأهم القنوات" },
    });
  }

  // ٤) كلمات مفتاحية مُتابعة بلا عمل تحسين حديث.
  const keywords = keywordsRes.data ?? [];
  if (keywords.length) {
    drafts.push({
      employeeId: "nour",
      skillId: "keyword-clusters",
      signal: "nour:keywords-untouched",
      title: `تتابع ${keywords.length} كلمة مفتاحية بلا خطة محتوى محدّثة`,
      reason: `منها «${keywords[0]?.keyword ?? ""}» — المتابعة بلا محتوى جديد لا تحرّك الترتيب.`,
      impact: "تجميع الكلمات في عناقيد بنيّة بحث واضحة وصفحة مستهدفة لكل عنقود.",
      priority: 3,
      values: {
        keywords: keywords
          .map((k) => k.keyword)
          .slice(0, 12)
          .join("، "),
      },
    });
  }

  // ٥) لا حساب نشر مربوط: كل المخرجات ستبقى نصاً في الشاشة.
  const connected = connectedRes.data ?? [];
  if (!connected.length) {
    drafts.push({
      employeeId: "sonny",
      signal: "workspace:no-connections",
      title: "لا يوجد أي حساب مربوط بعد",
      reason: "بلا ربط حساب واحد على الأقل لا يمكن لأي موظف أن ينشر أو يرسل فعلياً.",
      impact: "ربط حساب واحد يحوّل الموظفين من كاتب مسوّدات إلى منفّذ حقيقي.",
      priority: 1,
      values: {},
    });
  }

  drafts.push(...(await detectEmployeeSignals(client, workspaceId, business, connected)));
  return drafts.sort((a, b) => a.priority - b.priority);
}

/** إشارات تخصصية لكل موظف — كل واحد يراقب مجاله فقط ويبادر بسبب حقيقي من البيانات. */
async function detectEmployeeSignals(
  client: Client,
  workspaceId: string,
  business: string,
  connected: { provider: string; employee_id: string }[],
): Promise<ProposalDraft[]> {
  const now = Date.now();
  const since = (d: number) => new Date(now - d * DAY).toISOString();
  const has = (p: string[]) => connected.some((c) => p.includes(c.provider));
  const recentWork = (emp: string, days: number) =>
    client
      .from("tasks")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("employee_id", emp)
      .gte("created_at", since(days))
      .limit(1);

  const [failedRes, noImageRes, brokenRes, samRes, evaRes, adamRes] = await Promise.all([
    client
      .from("social_posts")
      .select("id, provider, last_error")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .gte("updated_at", since(3))
      .limit(20),
    client
      .from("social_posts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .is("image_url", null)
      .gte("scheduled_at", new Date(now).toISOString())
      .limit(20),
    client
      .from("integrations")
      .select("provider")
      .eq("workspace_id", workspaceId)
      .in("status", ["error", "expired", "needs_reauth"])
      .limit(10),
    recentWork("sam", 14),
    recentWork("eva", 7),
    recentWork("adam", 7),
  ]);

  const out: ProposalDraft[] = [];
  const failed = failedRes.data ?? [];
  if (failed.length) {
    out.push({
      employeeId: "sonny",
      signal: "sonny:failed-posts-3d",
      title: `${failed.length} منشور فشل نشره خلال آخر ٣ أيام`,
      reason: `على ${[...new Set(failed.map((f) => f.provider))].join("، ")} — ${failed[0]?.last_error?.slice(0, 120) ?? "بدون تفاصيل"}.`,
      impact: "إصلاح السبب وإعادة الجدولة يعيد المحتوى المتوقف للجمهور.",
      priority: 1,
      values: {},
    });
  }
  const noImage = noImageRes.data ?? [];
  if (noImage.length) {
    out.push({
      employeeId: "dana",
      skillId: "social-kit",
      signal: "dana:scheduled-without-image",
      title: `${noImage.length} منشور مجدول بدون صورة`,
      reason: "المنشورات بلا صورة تحصل عادةً على وصول وتفاعل أقل بكثير.",
      impact: "دانة تجهّز صوراً بهوية العلامة للمنشورات القادمة.",
      priority: 2,
      values: { brand: business, pillars: "المنشورات المجدولة القادمة" },
    });
  }
  const broken = brokenRes.data ?? [];
  if (broken.length) {
    out.push({
      employeeId: "eva",
      signal: "workspace:broken-integrations",
      title: `${broken.length} تكامل انقطع ويحتاج إعادة ربط`,
      reason: `${broken.map((b) => b.provider).join("، ")} — أي عمل يعتمد عليه متوقف الآن.`,
      impact: "إعادة الربط بضغطة من صفحة التكاملات يعيد التنفيذ الفعلي.",
      priority: 1,
      values: {},
    });
  }
  if (has(["hubspot", "salesforce", "pipedrive", "sheets", "airtable"]) && !(samRes.data ?? []).length) {
    out.push({
      employeeId: "sam",
      skillId: "reengage-leads",
      signal: "sam:idle-pipeline-14d",
      title: "لا متابعة للعملاء المحتملين منذ أسبوعين",
      reason: "الـCRM مربوط لكن لم تُجهَّز أي متابعة منذ ١٤ يوماً — العملاء يبردون بسرعة.",
      impact: "رسائل إعادة تنشيط جاهزة للاعتماد قبل الإرسال.",
      priority: 2,
      values: { reason: "انقطاع المتابعة", offer: business },
    });
  }
  if (has(["gmail", "outlook", "calendar"]) && !(evaRes.data ?? []).length) {
    out.push({
      employeeId: "eva",
      skillId: "weekly-review",
      signal: "eva:weekly-review-7d",
      title: "مراجعة الأسبوع لم تُجهَّز بعد",
      reason: "بريدك وتقويمك مربوطان ولم تُعدّ أمَل أي مراجعة منذ ٧ أيام.",
      impact: "ملخص بالمواعيد القادمة والرسائل المعلقة وأولويات الأسبوع.",
      priority: 3,
      values: { context: business },
    });
  }
  if (has(["analytics", "meta-ads", "google-ads"]) && !(adamRes.data ?? []).length) {
    out.push({
      employeeId: "adam",
      skillId: "anomaly-watch",
      signal: "adam:anomaly-watch-7d",
      title: "فحص الأرقام غير الطبيعية مستحق",
      reason: "مصادر البيانات مربوطة ولم يفحص آدم أي هبوط أو ارتفاع مفاجئ منذ أسبوع.",
      impact: "اكتشاف مبكر لأي هبوط في الزيارات أو حملة تحرق الميزانية.",
      priority: 2,
      values: { metrics: "الزيارات، التحويلات، تكلفة الإعلانات" },
    });
  }
  return out;
}

/**
 * يحدّث لوحة المبادرات: يضيف الجديد، ويغلق ما زالت إشارته، ويتجنب إعادة
 * اقتراح ما رفضته خلال آخر أسبوع.
 */
export async function refreshProposals(
  client: Client,
  workspaceId: string,
): Promise<{ added: number; closed: number; open: number }> {
  const drafts = await detectProposals(client, workspaceId);
  const signals = new Set(drafts.map((d) => d.signal));

  const { data: rows } = await client
    .from("proposals")
    .select("id, signal, status, updated_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["open", "dismissed"])
    .order("updated_at", { ascending: false })
    .limit(200);

  const open = new Map<string, string>();
  const dismissedRecently = new Set<string>();
  const weekAgo = Date.now() - 7 * DAY;
  for (const row of rows ?? []) {
    if (row.status === "open") open.set(row.signal, row.id);
    else if (new Date(row.updated_at).getTime() > weekAgo) dismissedRecently.add(row.signal);
  }

  const fresh = drafts.filter((d) => !open.has(d.signal) && !dismissedRecently.has(d.signal));
  if (fresh.length) {
    await client.from("proposals").insert(
      fresh.map((d) => ({
        workspace_id: workspaceId,
        employee_id: d.employeeId,
        skill_id: d.skillId ?? null,
        signal: d.signal,
        title: d.title,
        reason: d.reason,
        impact: d.impact,
        priority: d.priority,
        values: d.values,
      })),
    );
  }

  // الاقتراح الذي اختفت إشارته لم يعد صحيحاً — نغلقه بهدوء.
  const stale = [...open.entries()].filter(([signal]) => !signals.has(signal)).map(([, id]) => id);
  if (stale.length) {
    await client.from("proposals").update({ status: "done" }).in("id", stale);
  }

  return {
    added: fresh.length,
    closed: stale.length,
    open: open.size - stale.length + fresh.length,
  };
}

/** قبول مبادرة: تُنفَّذ قدرتها فعلاً (إن كانت لها قدرة) وتُربط بالمهمة الناتجة. */
export async function acceptProposal(
  client: Client,
  params: { workspaceId: string; proposalId: string },
): Promise<{ taskId: string | null; title: string }> {
  const { data: proposal, error } = await client
    .from("proposals")
    .select("*")
    .eq("id", params.proposalId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!proposal) throw new Error("المبادرة غير موجودة.");

  let taskId: string | null = null;
  if (proposal.skill_id) {
    const { executeSkill } = await import("./nour-run.server");
    const values = (proposal.values ?? {}) as Record<string, string>;
    const run = await executeSkill(client, {
      workspaceId: params.workspaceId,
      employeeId: proposal.employee_id,
      skillId: proposal.skill_id,
      values,
      origin: "مبادرة من الموظف",
    });
    taskId = run.taskId;
  }

  await client
    .from("proposals")
    .update({ status: "accepted", task_id: taskId })
    .eq("id", proposal.id);

  return { taskId, title: proposal.title };
}
