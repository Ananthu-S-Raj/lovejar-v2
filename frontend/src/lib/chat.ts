// Canonical chat message shape. Chat history comes from D1 in snake_case
// (created_at), live WebSocket frames arrive in camelCase (createdAt); the
// popup reuses history. Every consumer normalizes through normalizeChatMessage()
// so identity (sender) and timestamps are consistent everywhere. isMine() is
// the single authoritative side check — never repeated with custom logic.

export type ChatMessage = {
  id: number;
  sender: "user" | "admin";
  body: string;
  kind: "text" | "hug" | "kiss";
  created_at: number;
};

export function normalizeChatMessage(raw: unknown): ChatMessage {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const sender = obj.sender === "admin" ? "admin" : "user";
  const kind = obj.kind === "hug" || obj.kind === "kiss" ? (obj.kind as "hug" | "kiss") : "text";
  return {
    id: Number(obj.id ?? 0),
    sender,
    body: String(obj.body ?? ""),
    kind,
    created_at: Number(obj.created_at ?? obj.createdAt ?? 0),
  };
}

export function isMine(message: Pick<ChatMessage, "sender">, role: string | null): boolean {
  return message.sender === role;
}
