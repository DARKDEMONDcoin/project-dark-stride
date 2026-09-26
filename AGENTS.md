<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Platform API keys use the server-only `app_secrets` table first and runtime secrets second via `src/lib/secrets.server.ts`; per-user connection credentials remain encrypted. This keeps legacy keys readable without exposing them to clients.
- Social deliverables use `src/lib/post-format.ts` as the single sanitizer/media extractor across the site, queue, and Telegram; this prevents channel-specific leakage and duplicate presentation.

- Cloud browsing goes through `src/lib/cloud-browser.server.ts` (Browserbase via raw CDP WebSocket, read-only; sensitive intents require owner approval) because the Worker cannot run Chromium or Playwright.
- Browser actions show a live screenshot BEFORE approval (ActionCard via previewBrowserAction, Telegram via browsePage in viewPendingAction) and after execution — owner sees exactly what will be filled.
- Form requests with a URL and explicit field values deterministically create the shared browser approval action; they never depend solely on model JSON output.
- Supabase Function Secrets and the TanStack server runtime are isolated, write-only secret stores; never claim one can enumerate or read values from the other. Platform keys needed by TanStack must exist in runtime secrets or `app_secrets`.
- Multi-step browsing lives in `src/lib/browser-agent.server.ts` (observe→decide→act loop, page content treated as untrusted, sensitive clicks stop for approval, captcha/login hands off the live Browserbase session and resumes by sessionId); keeps agent safety rules in one place.
