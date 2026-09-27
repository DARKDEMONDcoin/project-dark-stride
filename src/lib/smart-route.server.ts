/**
 * توجيه ذكي بين الموظفين: قائمة الكلمات (handoff.ts) أولاً لأنها فورية،
 * ثم مصنّف ذكاء اصطناعي سريع فقط حين تكون القائمة غامضة (طلب مُعاد صياغته).
 */
import { detectHandoff, isDecisivelyMine } from "./handoff";
import { employeeDirectory, type EmployeeId } from "./team-knowledge";

type Handoff = NonNullable<ReturnType<typeof detectHandoff>>;
const IDS = Object.keys(employeeDirectory) as EmployeeId[];

export async function smartHandoff(message: string, currentId: string): Promise<Handoff | null> {
  const text = (message || "").trim();
  const byWords = detectHandoff(text, currentId);
  if (byWords) return byWords;
  // الكلمات تشير للموظف الحالي نفسه = طلب من اختصاصه، لا حاجة للمصنّف.
  if (detectHandoff(text, "__none__")?.id === currentId) return null;
  if (text.length < 15 || text.length > 1500 || isDecisivelyMine(text, currentId)) return null;
  try {
    const { freeChat } = await import("./nour-research.server");
    const roster = IDS.map((id) => `- ${id}: ${employeeDirectory[id].name} — ${employeeDirectory[id].role}`).join("\n");
    const raw = await freeChat(
      "route",
      [
        {
          role: "system",
          content: `صنّف طلب المستخدم لأنسب موظف. الفريق:\n${roster}\nالموظف الحالي: ${currentId}. إن كان الطلب يناسب الحالي أو غامضاً أو دردشة فأعد نفس المعرّف. أعد JSON فقط: {"id":"...","topic":"وصف قصير بالعربية","confidence":0-1}`,
        },
        { role: "user", content: text.slice(0, 1500) },
      ],
      { json: true, reasoningEffort: "low", timeoutMs: 6000, attempts: 1 },
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      id?: string;
      topic?: string;
      confidence?: number;
    };
    const id = parsed.id as EmployeeId | undefined;
    if (!id || id === currentId || !IDS.includes(id) || (parsed.confidence ?? 0) < 0.75) return null;
    const e = employeeDirectory[id];
    return { id, name: e.name, role: e.role, topic: String(parsed.topic || e.role).slice(0, 80) };
  } catch {
    return null; // فشل المصنّف لا يعطّل الرد أبداً
  }
}
