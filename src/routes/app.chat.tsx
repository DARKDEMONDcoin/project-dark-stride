import { createFileRoute, Outlet } from "@tanstack/react-router";

import { ChatShellHost } from "@/components/app/ChatShellHost";

export const Route = createFileRoute("/app/chat")({
  component: () => (
    <ChatShellHost>
      <Outlet />
    </ChatShellHost>
  ),
});
