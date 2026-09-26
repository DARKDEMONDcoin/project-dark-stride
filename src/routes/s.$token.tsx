import { createFileRoute, notFound } from "@tanstack/react-router";

import { Markdown } from "@/components/app/Markdown";
import { getSharedOutput } from "@/lib/share.functions";

export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{24}$/.test(params.token)) throw notFound();
    const r = await getSharedOutput({ data: { token: params.token } });
    if (!r) throw notFound();
    return r;
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.title} | ${loaderData.company}` : "صفحة مشاركة | سهل";
    const desc = loaderData ? loaderData.body.replace(/[#*_>`-]/g, "").slice(0, 150) : "صفحة مشاركة من سهل";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  notFoundComponent: () => (
    <main dir="rtl" className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-black">الرابط غير متاح</h1>
        <p className="mt-2 text-muted-foreground">ربما أوقف صاحبه المشاركة أو انتهت صلاحيته.</p>
      </div>
    </main>
  ),
  errorComponent: () => (
    <main dir="rtl" className="grid min-h-screen place-items-center p-6">تعذّر فتح الصفحة، حاول لاحقاً.</main>
  ),
  component: SharedPage,
});

function SharedPage() {
  const r = Route.useLoaderData();
  return (
    <main dir="rtl" className="min-h-screen bg-background px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-6 sm:p-10">
        <div className="text-sm text-muted-foreground">{r.company}</div>
        <h1 className="mt-1 font-display text-3xl font-black break-words">{r.title}</h1>
        <div className="mt-1 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ar")}</div>
        <div className="mt-6 leading-relaxed">
          <Markdown body={r.body} />
        </div>
      </article>
      <p className="mt-6 text-center text-xs text-muted-foreground">أُعدّت بواسطة فريق سهل</p>
    </main>
  );
}
