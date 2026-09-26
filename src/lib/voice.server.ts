/** تحويل النص إلى صوت عبر بوابة الذكاء الاصطناعي. */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_>`|~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3500);
}

export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const input = speakableText(text);
  if (!input) throw new Error("لا يوجد نص قابل للقراءة.");
  const { getSecret } = await import("./secrets.server");
  const key = await getSecret("LOVABLE_API_KEY");
  if (!key) throw new Error("خدمة الصوت غير مهيّأة.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      voice: "alloy",
      input,
      response_format: "mp3",
      instructions: "تحدّث بالعربية بنبرة دافئة وواضحة وسرعة طبيعية.",
    }),
  });
  if (!res.ok) {
    console.error(`[voice] tts failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    if (res.status === 402) throw new Error("رصيد الذكاء الاصطناعي انتهى.");
    if (res.status === 429) throw new Error("ضغط كبير الآن، جرّب بعد دقيقة.");
    throw new Error("تعذّر تحويل الرد إلى صوت.");
  }
  return res.arrayBuffer();
}
