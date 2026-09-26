/** صفحات مشاركة للمخرجات (عرض سعر، تقرير، خطة) عبر رابط سري قابل للإيقاف. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        employeeId: z.string().max(20).optional(),
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(60000),
        days: z.number().int().min(1).max(365).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
      .from("shared_outputs")
      .insert({
        workspace_id: data.workspaceId,
        employee_id: data.employeeId ?? null,
        title: data.title,
        body: data.body,
        expires_at: new Date(Date.now() + (data.days ?? 30) * 86400_000).toISOString(),
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string, token: row.token as string };
  });

export const revokeShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("shared_outputs").update({ revoked: true }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** عام: يقرأ صفحة واحدة بالرابط السري فقط، عبر دالة قاعدة بيانات محصورة بالخادم. */
export const getSharedOutput = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().regex(/^[a-f0-9]{24}$/) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await (supabaseAdmin as any).rpc("get_shared_output", { _token: data.token });
    const r = (rows ?? [])[0] as
      | { title: string; body: string; employee_id: string | null; company: string; created_at: string }
      | undefined;
    return r ?? null;
  });
