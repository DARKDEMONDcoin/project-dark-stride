/**
 * مصنّف نية البحث المحلي (بدون نموذج، أقل من مللي ثانية).
 * يحدد: نوع السؤال، ومدى حاجته للحداثة، وأنسب طريقة لاستدعاء Tavily.
 * الهدف: كل سؤال يذهب للمصدر الأنسب له، وحصة Tavily تُصرف حيث تصنع فرقاً.
 */
export type SearchKind =
  | "news"
  | "finance"
  | "prices"
  | "sports"
  | "local"
  | "tech"
  | "health"
  | "science"
  | "howto"
  | "entity"
  | "general";

export type SearchIntent = {
  kinds: SearchKind[];
  /** يحتاج معلومة حديثة جداً (اليوم/الأسبوع). */
  fresh: boolean;
  timeRange?: "day" | "week" | "month" | "year" | undefined;
  tavilyTopic: "general" | "news" | "finance";
  /** يستحق Tavily فوراً مع المصادر المجانية (لا احتياطياً). */
  tavilyFirst: boolean;
};

const R: Record<Exclude<SearchKind, "general">, RegExp> = {
  // «حدث» بلا «أ/ا» قبلها: وإلا صُنّفت «أحدث اتجاهات التصميم» خبراً وجاءت نتائج إخبارية عشوائية.
  news: /(خبر|أخبار|اخبار|عاجل|(?<![أاإآ])حدث|أحداث|تصريح|انتخابات|حرب|news|breaking|announce)/i,
  finance: /(سهم|أسهم|اسهم|بورصة|البورصة|سعر الدولار|سعر اليورو|سعر الصرف|سعر الذهب|بيتكوين|تضخم|سعر الفائدة|\bstocks?\b|\bshares\b|crypto|bitcoin|exchange rate|inflation|nasdaq)/i,
  prices: /(سعر|أسعار|اسعار|تكلفة|بكام|كام سعر|باقة|باقات|اشتراك|\bprices?\b|pricing|\bcosts?\b|\bplans?\b)/i,
  // لا «هدف» ولا «نتيجة»: تردان في أسئلة التسويق («هدف الحملة»، «نتيجة الإعلان») فتنحرف إلى أخبار الرياضة.
  sports: /(مباراة|ماتش|الدوري|كأس العالم|كأس|الأهلي|الزمالك|منتخب|لاعب كرة|\bmatch\b|premier league|\bfifa\b)/i,
  local: /(قريب مني|بالقرب|في القاهرة|في الرياض|في دبي|في جدة|فرع|عنوان|مطعم|near me|nearby|\baddress\b)/i,
  tech: /(ذكاء اصطناعي|تطبيق|برنامج|آيفون|ايفون|أندرويد|اندرويد|إصدار|تحديث|\bapi\b|\bai\b|\bgpt|iphone|android|\brelease\b|\bupdate\b|software)/i,
  health: /(صحة|مرض|علاج|دواء|أعراض|سعرات|رجيم|\bhealth\b|disease|symptom|treatment|\bdiet\b)/i,
  science: /(دراسة|بحث علمي|أبحاث|إحصائية|احصائية|تقرير|\bstudy\b|research|statistics|\breport\b|survey)/i,
  howto: /(ازاي|إزاي|كيف|طريقة|خطوات|how to|tutorial|\bguide\b|\bsteps\b)/i,
  entity: /(مين|من هو|من هي|إيه هو|ايه هي|who is|biography)/i,
};

/** كلمات لحظية فعلاً — «أحدث/2026» وحدها تعني «حديث» لا «هذا الأسبوع». */
const FRESH = /(اليوم|النهارده|الآن|دلوقتي|حالياً|حاليا|هذا الأسبوع|الاسبوع ده|\blatest\b|\btoday\b|\bnow\b|this week|\bcurrent\b)/i;
const RECENT = /(أحدث|احدث|آخر|جديد|\brecent\b|\b20\d{2}\b)/i;

export function classifySearch(text: string): SearchIntent {
  const t = (text ?? "").slice(0, 400);
  const kinds = (Object.keys(R) as (keyof typeof R)[]).filter((k) => R[k].test(t)) as SearchKind[];
  if (!kinds.length) kinds.push("general");
  const fresh = FRESH.test(t) || kinds.includes("news") || kinds.includes("sports") || kinds.includes("finance");

  const tavilyTopic: SearchIntent["tavilyTopic"] = kinds.includes("finance")
    ? "finance"
    : kinds.includes("news") || kinds.includes("sports")
      ? "news"
      : "general";

  const timeRange: SearchIntent["timeRange"] = /(اليوم|النهارده|الآن|دلوقتي|today|now|عاجل|breaking)/i.test(t)
    ? "day"
    : fresh
      ? "week"
      : RECENT.test(t) || kinds.includes("prices") || kinds.includes("tech")
        ? "year"
        : undefined;

  // المجاني قوي في: الموسوعي، الأكاديمي، الشرح. ضعيف في: اللحظي، الأسعار، الرياضة، المحلي.
  const tavilyFirst =
    fresh || RECENT.test(t) || kinds.some((k) => k === "prices" || k === "finance" || k === "local" || k === "sports");

  return { kinds, fresh, timeRange, tavilyTopic, tavilyFirst };
}

/**
 * نص لاتيني بلا كلمات حقيقية («asdkjh qwe»): أغلب كلماته فيها 5 حروف ساكنة متتالية
 * أو هي صفوف لوحة المفاتيح. العربي والأرقام والرموز الحقيقية لا تُعد عشوائية.
 */
export function looksLikeGibberish(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || /[\u0600-\u06FF]/.test(t) || !/^[a-z\s]+$/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  const rows = /^(qwe|wer|ert|asd|sdf|dfg|zxc|xcv|jkl|hjk|uio|iop)/;
  const bad = words.filter((w) => /[bcdfghjklmnpqrstvwxz]{5,}/.test(w) || (w.length <= 6 && rows.test(w) && !/[aeiou]{1}.*[aeiou]/.test(w.slice(3))));
  return bad.length / words.length >= 0.5 && words.every((w) => !/^(the|and|how|what|best|price|news)$/.test(w));
}
