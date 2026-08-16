export type Mood = "happy" | "sad" | "need_energy" | "missing_you";

// Prompts and fallbacks are parameterized by the user's configured name
// (env.USER_NAME) — never hardcoded — so the AI copy is always correct for
// whoever is actually sharing the jar.
const MOOD_PROMPTS: Record<Mood, (name: string) => string> = {
  happy: (name) =>
    `Write a short, warm, playful romantic message (2-3 sentences) celebrating that your partner ${name} is feeling happy today. Sound genuine and personal, not generic.`,
  sad: (name) =>
    `Write a short, comforting, encouraging romantic message (2-3 sentences) to gently lift the mood of your partner ${name}, who is feeling sad today. Be tender and reassuring, not dismissive.`,
  need_energy: (name) =>
    `Write a short, motivating, energizing romantic message (2-3 sentences) to give your partner ${name} a boost, since they said they need energy today. Be uplifting and encouraging.`,
  missing_you: (name) =>
    `Write a short, affectionate, longing romantic message (2-3 sentences) for your partner ${name}, who is missing you today. Be warm and reassuring of your love and presence.`,
};

// Fallback bank used if the Gemini API call fails or no key is configured,
// so the jar never breaks even if the AI call errors out.
const FALLBACK_MESSAGES: Record<Mood, (name: string) => string[]> = {
  happy: (name) => [
    `Your happiness today made mine brighter too, ${name}. Keep shining ❤️`,
    "Seeing you happy is my favorite kind of good news. I love you.",
  ],
  sad: (name) => [
    `It's okay to have a heavy day, ${name}. I'm right here with you, always.`,
    "Whatever today feels like, you're not carrying it alone. I've got you ❤️",
  ],
  need_energy: (name) => [
    `One step at a time, ${name} — you've done harder things than this. I believe in you.`,
    "Deep breath. You're stronger than today's tiredness. I'm cheering for you.",
  ],
  missing_you: (name) => [
    "I'm missing you right back, more than these words can say ❤️",
    `Distance is just a detail — you're still the first thing on my mind, ${name}.`,
  ],
};

export async function generateJarMessage(
  mood: Mood,
  userName: string,
  apiKey: string | undefined,
  recentMessages: string[]
): Promise<{ message: string; source: "gemini" | "fallback" }> {
  if (apiKey) {
    try {
      const avoidClause =
        recentMessages.length > 0
          ? ` Do not repeat or closely resemble any of these previously used messages: ${recentMessages
              .slice(0, 15)
              .map((m) => `"${m}"`)
              .join(", ")}.`
          : "";

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: MOOD_PROMPTS[mood](userName) + avoidClause + " Reply with only the message, no quotes." }],
              },
            ],
            generationConfig: { temperature: 0.9, maxOutputTokens: 120 },
          }),
        }
      );
      if (res.ok) {
        const data: any = await res.json();
        const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          return { message: text.trim().replace(/^"|"$/g, ""), source: "gemini" };
        }
      }
    } catch {
      // fall through to fallback bank
    }
  }

  const bank = FALLBACK_MESSAGES[mood](userName);
  const unused = bank.filter((m) => !recentMessages.includes(m));
  const pool = unused.length > 0 ? unused : bank;
  return { message: pool[Math.floor(Math.random() * pool.length)], source: "fallback" };
}
