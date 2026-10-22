// The composer's "+" menu beyond attachments: compact the conversation, or start fresh.
// Pure (no platform imports) so the send behaviour is unit-tested without the native runtime.

export type ComposerMenuId = "compact" | "restart";

export interface ComposerMenuEntry {
  id: ComposerMenuId;
  ko: string;
  en: string;
  /** confirmation asked before the action runs; only for destructive ones */
  confirm?: { ko: string; en: string };
}

export const COMPOSER_MENU: readonly ComposerMenuEntry[] = [
  { id: "compact", ko: "대화 압축", en: "Compact conversation" },
  { id: "restart", ko: "새로 시작", en: "Start fresh", confirm: { ko: "지금 대화를 마치고 같은 설정으로 새 세션을 시작합니다.", en: "End this conversation and start fresh with the same settings." } },
];

/** The message an action sends. The host turns it into the SDK slash command; "/clear" is the
 * fresh-session path it already handles, and "/compact" passes through to the CLI/bridge. */
export function composerCommand(id: ComposerMenuId): string {
  return id === "compact" ? "/compact" : "/clear";
}
