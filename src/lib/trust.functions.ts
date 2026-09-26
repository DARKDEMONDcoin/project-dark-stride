/** صفحة الثقة: ما يعرفه الفريق عنك + صلاحيات الموظفين + سجل كل إجراء. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ws = z.object({ workspaceId: z.string().uuid() });

export const getTrustOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ws.parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [mem, dec, pol, audit] = await Promise.all([
      db.from("brand_memories").select("id, kind, content, employee_id, created_at").eq("workspace_id", data.workspaceId).is("valid_until", null).order("created_at", { ascending: false }).limit(60),
      db.from("decisions").select("id, title, decision, employee_id, created_at").eq("workspace_id", data.workspaceId).eq("status", "active").order("created_at", { ascending: false }).limit(60),
      db.from("employee_policies").select("*").eq("workspace_id", data.workspaceId),
      db.from("action_audit").select("id, employee_id, action_id, provider, status, summary, detail, created_at").eq("workspace_id", data.workspaceId).order("created_at", { ascending: false }).limit(100),
    ]);
    return {
      memories: (mem.data ?? []) as { id: string; kind: string; content: string; employee_id: string | null; created_at: string }[],
      decisions: (dec.data ?? []) as { id: string; title: string; decision: string; employee_id: string; created_at: string }[],
      policies: (pol.data ?? []) as { employee_id: string; enabled: boolean; can_send: boolean; can_publish: boolean; can_browse: boolean; daily_action_cap: number }[],
      audit: (audit.data ?? []) as { id: string; employee_id: string; action_id: string; provider: string | null; status: string; summary: string | null; detail: string | null; created_at: string }[],
    };
  });

export const savePolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ws
      .extend({
        employeeId: z.enum(["sonny", "eva", "sam", "nour", "dana", "adam"]),
        enabled: z.boolean(),
        can_send: z.boolean(),
        can_publish: z.boolean(),
        can_browse: z.boolean(),
        daily_action_cap: z.number().int().min(0).max(1000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, employeeId, ...rest } = data;
    const { error } = await (context.supabase as any)
      .from("employee_policies")
      .upsert({ workspace_id: workspaceId, employee_id: employeeId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const forgetItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ kind: z.enum(["memory", "decision"]), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } =
      data.kind === "memory"
        ? await db.from("brand_memories").update({ valid_until: new Date().toISOString() }).eq("id", data.id)
        : await db.from("decisions").update({ status: "archived" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
