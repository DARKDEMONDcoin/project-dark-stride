/**
 * مزامنة حية بين الموقع وتيليجرام: أي تغيير في بيانات مساحة العمل (من البوت أو
 * من تبويب آخر) يحدّث الشاشة فوراً دون إعادة تحميل.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/data";

const TABLES = [
  "messages",
  "conversations",
  "tasks",
  "integrations",
  "proposals",
  "decisions",
  "brain_items",
  "automations",
] as const;

export function useLiveWorkspaceSync() {
  const qc = useQueryClient();
  const { data: workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  useEffect(() => {
    if (!workspaceId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries(), 400);
    };
    let channel = supabase.channel(`ws-live-${workspaceId}`);
    for (const table of TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
        refresh,
      );
    }
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, qc]);
}

export function LiveWorkspaceSync() {
  useLiveWorkspaceSync();
  return null;
}
