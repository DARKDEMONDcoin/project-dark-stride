/**
 * مهام الفريق المشتركة: هدف واحد يُقسَّم على عدة موظفين، كلٌّ ينفّذ جزءه
 * مستفيداً من مخرجات من سبقه، ثم دمج نهائي واعتماد واحد من المالك.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { employeeDirectory, type EmployeeId } from "./team-knowledge";

const IDS = Object.keys(employeeDirectory) as EmployeeId[];

async function assertOwner(supabase: any, workspaceId: string) {
  const { data, error } = await supabase.rpc("owns_workspace", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Forbidden: لا تملك هذه مساحة العمل.");
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as T;
}

export const runTeamTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ workspaceId: z.string().uuid(), goal: z.string().trim().min(8).max(2000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, data.workspaceId);
    const db = context.supabase as any;
    const { freeChat } = await import("./nour-research.server");
    const { data: ws } = await db.from("workspaces").select("name, industry, tone, banned_words").eq("id", data.workspaceId).single();
    const brand = ws ? `النشاط: ${ws.name} (${ws.industry}). النبرة: ${ws.tone}. كلمات ممنوعة: ${(ws.banned_words ?? []).join("، ") || "لا يوجد"}.` : "";
    const roster = IDS.map((id) => `- ${id}: ${employeeDirectory[id].name} — ${employeeDirectory[id].role}`).join("\n");

    const plan = parseJson<{ steps: { employee: string; instruction: string }[] }>(
      await freeChat(
        "team-plan",
        [
          {
            role: "system",
            content: `أنت مدير فريق «سهل». قسّم الهدف إلى 2–5 خطوات متتابعة، كل خطوة لموظف واحد مناسب من:\n${roster}\nلا تُضف خطوات نشر أو إرسال أو دفع — المالك يعتمد في النهاية. أعد JSON فقط: {"steps":[{"employee":"id","instruction":"تعليمات محددة بالعربية"}]}`,
          },
          { role: "user", content: data.goal },
        ],
        { json: true, reasoningEffort: "medium" },
      ),
    );
    const steps = (plan.steps ?? [])
      .filter((s) => IDS.includes(s.employee as EmployeeId) && s.instruction)
      .slice(0, 5);
    if (steps.length === 0) throw new Error("تعذّر تقسيم المهمة، أعد صياغة الهدف.");

    const { data: task, error } = await db
      .from("team_tasks")
      .insert({ workspace_id: data.workspaceId, goal: data.goal })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { data: rows } = await db
      .from("team_task_steps")
      .insert(steps.map((s, i) => ({ team_task_id: task.id, workspace_id: data.workspaceId, position: i, employee_id: s.employee, instruction: s.instruction.slice(0, 1500) })))
      .select("id, position");

    const outputs: string[] = [];
    try {
      for (const [i, s] of steps.entries()) {
        const e = employeeDirectory[s.employee as EmployeeId];
        const rowId = rows?.find((r: any) => r.position === i)?.id;
        await db.from("team_task_steps").update({ status: "running" }).eq("id", rowId);
        const out = await freeChat(
          `team-${s.employee}`,
          [
            {
              role: "system",
              content: `أنت ${e.name} — ${e.role} في فريق «سهل». ${brand}\nالهدف العام للفريق: ${data.goal}\nنفّذ جزءك فقط باحتراف وبالعربية، وسلّم مخرجاً جاهزاً للاستخدام. لا تنشر ولا ترسل شيئاً.`,
            },
            {
              role: "user",
              content: `${outputs.length ? `مخرجات الزملاء السابقة:\n${outputs.join("\n\n---\n\n").slice(-8000)}\n\n` : ""}مهمتك: ${s.instruction}`,
            },
          ],
          { reasoningEffort: "medium" },
        );
        outputs.push(`### ${e.name}\n${out}`);
        await db.from("team_task_steps").update({ status: "done", output: out }).eq("id", rowId);
      }
      const final = await freeChat(
        "team-merge",
        [
          { role: "system", content: `ادمج مخرجات الفريق في تسليم نهائي واحد متماسك بالعربية يحقق الهدف، بعناوين واضحة، بلا تكرار. ${brand}` },
          { role: "user", content: `الهدف: ${data.goal}\n\n${outputs.join("\n\n").slice(-14000)}` },
        ],
        { reasoningEffort: "medium" },
      );
      await db.from("team_tasks").update({ status: "awaiting_approval", final_output: final }).eq("id", task.id);
    } catch (err) {
      await db.from("team_tasks").update({ status: "error" }).eq("id", task.id);
      throw err;
    }
    return { id: task.id as string };
  });

export const listTeamTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: tasks } = await db
      .from("team_tasks")
      .select("id, goal, status, final_output, created_at, team_task_steps(id, position, employee_id, instruction, status, output)")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(20);
    return (tasks ?? []) as {
      id: string; goal: string; status: string; final_output: string | null; created_at: string;
      team_task_steps: { id: string; position: number; employee_id: string; instruction: string; status: string; output: string | null }[];
    }[];
  });

export const decideTeamTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("team_tasks").update({ status: data.decision }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
