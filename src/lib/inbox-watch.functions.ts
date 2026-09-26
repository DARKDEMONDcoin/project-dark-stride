/**
 * مراقبة البريد الاستباقية (أمَل): رسائل بلا رد + رد جاهز + كشف الاحتيال.
 * القراءة فقط؛ الرد يُحفظ «مسودة» في Gmail بضغطة المالك ولا يُرسل تلقائياً أبداً.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type { InboxItem } from "./inbox-watch.server";

async function assertOwner(supabase: any, workspaceId: string) {
  const { data, error } = await supabase.rpc("owns_workspace", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Forbidden");
}

export const scanInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ workspaceId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, data.workspaceId);
    const { scanWorkspaceInbox } = await import("./inbox-watch.server");
    return scanWorkspaceInbox(data.workspaceId);
  });

export const saveReplyDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        threadId: z.string().min(1).max(100),
        to: z.string().min(3).max(300),
        subject: z.string().max(300),
        body: z.string().min(1).max(8000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, data.workspaceId);
    const { gmailCall } = await import("./inbox-watch.server");
    const call = await gmailCall(data.workspaceId);
    if (!call) throw new Error("اربط Gmail من صفحة التكاملات أولاً.");
    const { base64Url, rfc822 } = await import("./direct-actions.server");
    const subject = /^re:/i.test(data.subject) ? data.subject : `Re: ${data.subject}`;
    await call(`https://gmail.googleapis.com/gmail/v1/users/me/drafts`, "POST", {
      message: { threadId: data.threadId, raw: base64Url(rfc822(data.to, subject, data.body)) },
    });
    return { ok: true };
  });
