/**
 * الطبقة الموحّدة لمفاتيح المنصة: جدول app_secrets الخاص بالخادم أولاً،
 * ثم خزنة Supabase Secrets كاحتياط. القيم لا تعبر هذه الوحدة إلى المتصفح.
 */

let cache: { at: number; rows: Record<string, string> } | null = null;
const TTL = 60 * 1000;

/** إبطال الذاكرة المؤقتة — يُنادى بعد أي تعديل على المفاتيح. */
export function resetSecretsCache(): void {
  cache = null;
}

/** يقرأ مفاتيح المنصة من الجدول الخادمي، مع إبقاء أسرار التشغيل متاحة عند تعطّله. */
export async function loadSecrets(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL) return cache.rows;
  const rows: Record<string, string> = {};
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("app_secrets").select("name, value");
    if (error) throw error;
    for (const row of (data ?? []) as { name: string; value: string }[]) {
      const value = (row.value ?? "").trim();
      if (value) rows[row.name] = value;
    }
  } catch (error) {
    console.error(
      "[secrets] تعذّرت قراءة app_secrets؛ سيُستخدم مخزن أسرار التشغيل:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/** قيمة مفتاح واحد: الجدول الخادمي أولاً ثم خزنة التشغيل. */
export async function getSecret(name: string): Promise<string> {
  const rows = await loadSecrets();
  return rows[name] || (process.env[name] ?? "").trim();
}

/** قيم عدة مفاتيح من المصدرين في نداء واحد. */
export async function getSecrets<T extends readonly string[]>(
  names: T,
): Promise<Record<T[number], string>> {
  const rows = await loadSecrets();
  const out = {} as Record<T[number], string>;
  for (const name of names) {
    out[name as T[number]] = rows[name] || (process.env[name] ?? "").trim();
  }
  return out;
}
