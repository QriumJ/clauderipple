// Thinking blocks another model left in a conversation that is now going to Anthropic.
//
// The translated providers hand the CLI their reasoning as `thinking` blocks, and an empty `thinking`
// when the upstream sent a reasoning item without a summary. The CLI keeps them in the transcript, so
// a session switched from such a model to a Claude model replays them, and Anthropic refuses the
// whole request: "messages.2.content.0.thinking: each thinking block must contain thinking" (measured
// 2026-09-28, gpt-6-astra → claude-opus-5-5, every retry of the turn).
//
// A block Anthropic wrote always carries a signature of Anthropic's own, a base64 string this router
// cannot produce. A translation provider cannot produce one either, so it signs with an envelope of
// its own naming where the reasoning came from (reasoning.ts) — which Anthropic would refuse just as
// fast, and which is why those go too. What is left that is signed is Anthropic's.
//
// The translated adapters themselves keep their own replayed reasoning (that is the point of the
// envelope), so this is the one place a translated provider's thinking must still be dropped: a
// CLI-side switch to a Claude model. Gemini and the other translators drop `thinking` on their own.
import { isOurSignature } from "./reasoning.ts";

type Block = { type?: unknown; signature?: unknown };
type Message = { role?: unknown; content?: unknown };

function foreign(block: unknown): boolean {
  const b = block as Block | null;
  if (!b || typeof b !== "object" || b.type !== "thinking") return false;
  // Unsigned: a translated provider's reasoning with nothing to carry, or an empty reasoning item.
  // Ours: a translated provider's envelope, which only its own adapter can read back.
  return !(typeof b.signature === "string" && b.signature.length > 0) || isOurSignature(b.signature);
}

/**
 * Removes unsigned thinking blocks from assistant turns, in place, and returns how many went.
 * A turn left with no content is removed with them: Anthropic refuses an empty assistant turn,
 * and joins the two user turns that then meet.
 */
export function dropForeignThinking(json: Record<string, unknown>): number {
  const messages = json.messages;
  if (!Array.isArray(messages)) return 0;
  let removed = 0;
  const kept: unknown[] = [];
  for (const message of messages as Message[]) {
    if (message?.role !== "assistant" || !Array.isArray(message.content) || !message.content.some(foreign)) {
      kept.push(message);
      continue;
    }
    const content = message.content.filter((block) => !foreign(block));
    removed += message.content.length - content.length;
    if (content.length > 0) kept.push({ ...message, content });
  }
  if (removed > 0) json.messages = kept;
  return removed;
}
