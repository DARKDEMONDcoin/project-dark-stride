/** رد صوتي: يحوّل رد الموظف إلى صوت عربي عند الطلب. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const speakText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ workspaceId: z.string().uuid(), text: z.string().min(1).max(20000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: ws } = await (context.supabase as any)
      .from("workspaces")
      .select("id")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (!ws) throw new Error("غير مصرّح.");
    const { synthesizeSpeech } = await import("./voice.server");
    const bytes = await synthesizeSpeech(data.text);
    return { audio: Buffer.from(bytes).toString("base64"), mime: "audio/mpeg" };
  });
